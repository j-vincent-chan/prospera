/**
 * Embeddings for the suggestion engine (text-embedding-3-small, 1536 dims).
 *
 * Three stores: one vector per evidence item (a publication, an award, a
 * biosketch statement, Profiles keywords, the directory focus), one document
 * vector per investigator, and one per notice. Rows are keyed by a content
 * hash so re-runs only embed what changed.
 */

import { createHash } from "crypto";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;
const BATCH = 96;
const MAX_ITEM_CHARS = 1_500;
const MAX_DOC_CHARS = 12_000;
/** Most recent publications embedded per person. */
const MAX_PUBLICATIONS = 60;

export function contentHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function client(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const openai = client();
  if (!openai) throw new Error("OPENAI_API_KEY is not configured.");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.replace(/\s+/g, " ").trim().slice(0, 8_000) || " ");
    const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  if (!v) throw new Error("Empty embedding response.");
  return v;
}

/** pgvector accepts the JSON array literal. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------------------------------------------------------------------------
// Investigators
// ---------------------------------------------------------------------------

export type EvidenceKind = "publication" | "grant" | "biosketch" | "profile" | "focus" | "trial";

type EvidenceInput = { kind: EvidenceKind; refId: string; content: string; year: number | null };

const yearOf = (iso: string | null | undefined) => {
  const y = Number.parseInt(String(iso ?? "").slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

/** Everything verified we know about a person, as embeddable items. */
export async function collectInvestigatorEvidence(db: SupabaseClient, investigatorId: string): Promise<EvidenceInput[]> {
  const [{ data: inv }, { data: pubs }, { data: grants }, { data: sources }] = await Promise.all([
    db.from("investigators").select("full_name, home_department, division, raw_profile_json").eq("id", investigatorId).maybeSingle(),
    db
      .from("investigator_publications")
      .select("pmid, title, journal, publication_date")
      .eq("investigator_id", investigatorId)
      .eq("identity_status", "verified")
      .order("publication_date", { ascending: false, nullsFirst: false })
      .limit(MAX_PUBLICATIONS),
    db.from("investigator_nih_grants").select("project_num, project_title, ic_name, fiscal_year, raw_json").eq("investigator_id", investigatorId).neq("identity_status", "rejected").order("fiscal_year", { ascending: false }).limit(40),
    db.from("investigator_sources").select("source, state, personal_statement, contributions, meta, document_date").eq("investigator_id", investigatorId),
  ]);
  const items: EvidenceInput[] = [];
  for (const p of (pubs ?? []) as Array<{ pmid: string; title: string | null; journal: string | null; publication_date: string | null }>) {
    if (!p.title) continue;
    items.push({ kind: "publication", refId: p.pmid, content: `${p.title}${p.journal ? ` (${p.journal}${p.publication_date ? `, ${p.publication_date.slice(0, 4)}` : ""})` : ""}`.slice(0, MAX_ITEM_CHARS), year: yearOf(p.publication_date) });
  }
  const seenGrant = new Set<string>();
  for (const g of (grants ?? []) as Array<{ project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; raw_json: unknown }>) {
    const base = g.project_num.replace(/^\d/, "").replace(/-.*$/, "");
    if (!g.project_title || seenGrant.has(base)) continue;
    seenGrant.add(base);
    const abstract = typeof (g.raw_json as { abstract_text?: string } | null)?.abstract_text === "string" ? (g.raw_json as { abstract_text: string }).abstract_text : "";
    const terms = typeof (g.raw_json as { terms?: string } | null)?.terms === "string" ? (g.raw_json as { terms: string }).terms.replace(/[<>]/g, " ").replace(/\s+/g, " ").slice(0, 400) : "";
    items.push({ kind: "grant", refId: g.project_num, content: `${g.project_title}. ${g.ic_name?.split(/\s+[—–-]\s+/)[0] ?? ""} ${g.fiscal_year ?? ""}. ${abstract ? abstract.slice(0, 900) : terms}`.slice(0, MAX_ITEM_CHARS), year: g.fiscal_year });
  }
  for (const s of (sources ?? []) as Array<{ source: string; state: string; personal_statement: string | null; contributions: Array<{ title: string; summary: string }> | null; meta: Record<string, unknown> | null; document_date: string | null }>) {
    if (s.source === "biosketch" && s.state === "on_file" && (s.personal_statement || s.contributions?.length)) {
      const text = [s.personal_statement, ...(s.contributions ?? []).map((c) => `${c.title}. ${c.summary}`)].filter(Boolean).join(" ");
      items.push({ kind: "biosketch", refId: "biosketch", content: text.slice(0, MAX_ITEM_CHARS), year: yearOf(s.document_date) });
    }
    if (s.source === "profiles" && s.state === "available" && s.meta) {
      const kw = [...((s.meta.keywords as string[] | undefined) ?? []), ...((s.meta.freetext_keywords as string[] | undefined) ?? [])];
      const narrative = typeof s.meta.narrative === "string" ? s.meta.narrative : "";
      if (kw.length || narrative) items.push({ kind: "profile", refId: "profiles", content: `${kw.join(", ")}. ${narrative}`.slice(0, MAX_ITEM_CHARS), year: null });
    }
  }
  const raw = ((inv as { raw_profile_json?: Record<string, unknown> } | null)?.raw_profile_json ?? {}) as Record<string, unknown>;
  const focus = [raw.primary_research_area, raw.research_summary, raw.secondary_research_areas, raw.primary_disease_focus, raw.technological_expertise].filter((v): v is string => typeof v === "string" && v.trim().length > 0).join(". ");
  if (focus.trim()) items.push({ kind: "focus", refId: "focus", content: focus.slice(0, MAX_ITEM_CHARS), year: null });
  return items;
}

/** Embed new/changed evidence for one person, drop stale rows, refresh the document vector. */
export async function syncInvestigatorEmbeddings(db: SupabaseClient, investigatorId: string): Promise<{ items: number; embedded: number }> {
  const items = await collectInvestigatorEvidence(db, investigatorId);
  const { data: existing } = await db.from("evidence_embeddings").select("id, kind, ref_id, content_hash").eq("investigator_id", investigatorId);
  const have = new Map((existing ?? []).map((r) => [`${r.kind}:${r.ref_id}`, r as { id: string; content_hash: string }]));
  const wanted = new Map(items.map((it) => [`${it.kind}:${it.refId}`, it]));

  const stale = (existing ?? []).filter((r) => !wanted.has(`${r.kind}:${r.ref_id}`)).map((r) => r.id as string);
  for (let i = 0; i < stale.length; i += 100) await db.from("evidence_embeddings").delete().in("id", stale.slice(i, i + 100));

  const toEmbed = items.filter((it) => have.get(`${it.kind}:${it.refId}`)?.content_hash !== contentHash(it.content));
  if (toEmbed.length) {
    const vectors = await embedTexts(toEmbed.map((it) => it.content));
    const rows = toEmbed.map((it, i) => ({
      investigator_id: investigatorId,
      kind: it.kind,
      ref_id: it.refId,
      content: it.content,
      content_hash: contentHash(it.content),
      year: it.year,
      embedding: toVector(vectors[i]!),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("evidence_embeddings").upsert(rows.slice(i, i + 100), { onConflict: "investigator_id,kind,ref_id" });
      if (error) throw new Error(`evidence_embeddings: ${error.message}`);
    }
  }

  // Document vector: the person's evidence in one text (most recent first).
  const doc = items.map((it) => it.content).join("\n").slice(0, MAX_DOC_CHARS);
  const docHash = contentHash(doc);
  if (doc.trim()) {
    const { data: cur } = await db.from("investigator_embeddings").select("content_hash").eq("investigator_id", investigatorId).maybeSingle();
    if ((cur as { content_hash?: string } | null)?.content_hash !== docHash) {
      const v = await embedText(doc);
      const { error } = await db.from("investigator_embeddings").upsert({ investigator_id: investigatorId, content_hash: docHash, item_count: items.length, embedding: toVector(v), updated_at: new Date().toISOString() }, { onConflict: "investigator_id" });
      if (error) throw new Error(`investigator_embeddings: ${error.message}`);
    }
  } else {
    await db.from("investigator_embeddings").delete().eq("investigator_id", investigatorId);
  }
  return { items: items.length, embedded: toEmbed.length };
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export function opportunityEmbeddingText(o: { title: string | null; description: string | null; raw_payload_json: unknown; activity_title?: string | null; agency?: string | null }): string {
  const summary = (o.raw_payload_json as { summary?: Record<string, unknown> } | null)?.summary ?? {};
  const desc = typeof summary.summary_description === "string" && summary.summary_description.length > (o.description?.length ?? 0) ? summary.summary_description : o.description ?? "";
  return [o.title ?? "", o.activity_title ?? "", o.agency ?? "", desc.replace(/<[^>]+>/g, " ")].filter(Boolean).join("\n").replace(/\s+/g, " ").slice(0, 7_000);
}

export async function syncOpportunityEmbeddings(db: SupabaseClient, opportunityIds: string[]): Promise<{ embedded: number; skipped: number }> {
  let embedded = 0;
  let skipped = 0;
  for (let i = 0; i < opportunityIds.length; i += 50) {
    const ids = opportunityIds.slice(i, i + 50);
    const [{ data: rows }, { data: cur }] = await Promise.all([
      db.from("funding_opportunities").select("id, title, description, raw_payload_json, activity_title, agency").in("id", ids),
      db.from("opportunity_embeddings").select("opportunity_id, content_hash").in("opportunity_id", ids),
    ]);
    const have = new Map((cur ?? []).map((r) => [r.opportunity_id as string, r.content_hash as string]));
    const pending: Array<{ id: string; text: string; hash: string }> = [];
    for (const r of (rows ?? []) as Array<{ id: string; title: string | null; description: string | null; raw_payload_json: unknown; activity_title: string | null; agency: string | null }>) {
      const text = opportunityEmbeddingText(r);
      if (!text.trim()) {
        skipped += 1;
        continue;
      }
      const hash = contentHash(text);
      if (have.get(r.id) === hash) {
        skipped += 1;
        continue;
      }
      pending.push({ id: r.id, text, hash });
    }
    if (!pending.length) continue;
    const vectors = await embedTexts(pending.map((p) => p.text));
    const { error } = await db.from("opportunity_embeddings").upsert(
      pending.map((p, j) => ({ opportunity_id: p.id, content_hash: p.hash, embedding: toVector(vectors[j]!), updated_at: new Date().toISOString() })),
      { onConflict: "opportunity_id" },
    );
    if (error) throw new Error(`opportunity_embeddings: ${error.message}`);
    embedded += pending.length;
  }
  return { embedded, skipped };
}

/** Ids of notices that are open (or still to open) and lack a current embedding. */
export async function listOpenOpportunityIds(db: SupabaseClient, limit = 5000): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const ids: string[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await db
      .from("funding_opportunities")
      .select("id")
      .or(`close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`)
      .order("posted_date", { ascending: false, nullsFirst: false })
      .range(from, Math.min(from + 999, limit - 1));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) ids.push(r.id as string);
    if ((data ?? []).length < 1000) break;
  }
  return ids;
}

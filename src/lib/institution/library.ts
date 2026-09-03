/**
 * Proposal library read models + document helpers: text extraction (PDF /
 * Word), sensitive-content scan, excerpt, semantic + full-text search, the
 * item sheet, steward queue counts, rates panel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtMonDY, fmtMonY } from "@/lib/funding-opportunities/receipt-cycles";
import { embedText, toVector } from "@/lib/outreach/embeddings";
import { CONTENT_TYPE_SHORT, OUTCOME_LABEL, TRUST_LABEL, type ContentType, type LibraryOutcome, type ReviewStatus, type TrustTier } from "@/lib/institution/types";

export type LibraryItemRecord = {
  id: string;
  title: string;
  content_type: ContentType;
  sponsor: string | null;
  mechanism: string | null;
  department: string | null;
  funding_year: string | null;
  outcome: LibraryOutcome | null;
  trust_tier: TrustTier;
  uploader_id: string | null;
  uploader_name: string | null;
  uploader_department: string | null;
  source_label: string | null;
  linked_award_number: string | null;
  effective_date: string | null;
  review_due: string | null;
  last_confirmed_at: string | null;
  last_confirmed_by_name: string | null;
  review_status: ReviewStatus;
  steward_note: string | null;
  reviewed_at: string | null;
  reminder_sent_at: string | null;
  excerpt: string | null;
  sensitive_findings: SensitiveFindings | null;
  tags: string[];
  download_count: number;
  version: number;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
};

export const ITEM_COLUMNS = "id, title, content_type, sponsor, mechanism, department, funding_year, outcome, trust_tier, uploader_id, uploader_name, uploader_department, source_label, linked_award_number, effective_date, review_due, last_confirmed_at, last_confirmed_by_name, review_status, steward_note, reviewed_at, reminder_sent_at, excerpt, sensitive_findings, tags, download_count, version, file_name, file_size, mime_type, created_at, updated_at, removed_at";

export type LibraryFilters = { q: string; type: string; sponsor: string; mechanism: string; department: string; trust: string; page: number };
export const LIBRARY_PER_PAGE = 25;

export function parseLibraryFilters(sp: Record<string, string | string[] | undefined>): LibraryFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  return { q: s("q").trim(), type: s("type"), sponsor: s("sponsor"), mechanism: s("mechanism"), department: s("department"), trust: s("trust"), page: Math.max(1, Number(s("page")) || 1) };
}

export function libraryHref(f: Partial<LibraryFilters>, base: LibraryFilters, extra: Record<string, string> = {}): string {
  const m = { ...base, ...f };
  const p = new URLSearchParams();
  if (m.q) p.set("q", m.q);
  if (m.type) p.set("type", m.type);
  if (m.sponsor) p.set("sponsor", m.sponsor);
  if (m.mechanism) p.set("mechanism", m.mechanism);
  if (m.department) p.set("department", m.department);
  if (m.trust) p.set("trust", m.trust);
  if (m.page > 1) p.set("page", String(m.page));
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const qs = p.toString();
  return `/library${qs ? `?${qs}` : ""}`;
}

export function itemMeta(it: LibraryItemRecord): string {
  const bits = [CONTENT_TYPE_SHORT[it.content_type], it.sponsor, it.mechanism, it.department, it.funding_year, it.outcome === "funded" ? "funded" : it.outcome === "not_funded" ? "not funded" : it.outcome === "template" ? "template" : null];
  if (it.trust_tier === "curated" && !it.outcome) bits.push("curated");
  return bits.filter(Boolean).join(" · ");
}

export function itemSource(it: LibraryItemRecord): string {
  if (it.source_label) return it.source_label;
  if (it.trust_tier === "osr") return "OSR · Research Development";
  if (it.trust_tier === "curated") return `Curated · ${it.uploader_name ?? "Curator"}${it.uploader_department ? ` (${it.uploader_department})` : ""}`;
  return [it.uploader_name ?? "Colleague", it.uploader_department].filter(Boolean).join(" · ");
}

export type LibraryRow = { id: string; title: string; meta: string; trust: TrustTier; trustLabel: string; source: string; confirmed: string; stale: boolean; status: ReviewStatus; mine: boolean };

export function libraryRow(it: LibraryItemRecord, today: string, viewerId: string | null): LibraryRow {
  const confirmedIso = (it.last_confirmed_at ?? it.reviewed_at ?? it.created_at).slice(0, 10);
  return {
    id: it.id,
    title: it.title,
    meta: itemMeta(it),
    trust: it.trust_tier,
    trustLabel: TRUST_LABEL[it.trust_tier],
    source: itemSource(it),
    confirmed: fmtMonDY(confirmedIso),
    stale: Boolean(it.review_due && it.review_due < today) && it.review_status === "published",
    status: it.review_status,
    mine: Boolean(viewerId && it.uploader_id === viewerId),
  };
}

export type LibraryData = {
  filters: LibraryFilters;
  header: { published: number; departments: number; uploadsThisMonth: number };
  rows: LibraryRow[];
  total: number;
  page: number;
  perPage: number;
  searchMode: "semantic" | "text" | "browse";
  facets: { sponsors: string[]; mechanisms: string[]; departments: string[] };
  rates: { rows: Array<{ label: string; value: string }>; agreement: string | null; effective: string | null; verifiedAt: string | null; sourceUrl: string | null };
  queue: { pending: number; flagged: number; pastReview: number };
};

async function rankedIdsForQuery(db: SupabaseClient, q: string): Promise<{ ids: string[] | null; mode: "semantic" | "text" }> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const vec = await embedText(q);
      const { data, error } = await db.rpc("match_library_items", { query_embedding: toVector(vec), match_count: 60, similarity_floor: 0.2 });
      if (!error && data) {
        const ids = (data as Array<{ item_id: string }>).map((r) => r.item_id);
        if (ids.length) return { ids, mode: "semantic" };
      }
    } catch {
      // fall through to full-text search
    }
  }
  const { data } = await db.from("library_items").select("id").textSearch("search_tsv", q, { type: "websearch", config: "english" }).limit(200);
  return { ids: ((data ?? []) as Array<{ id: string }>).map((r) => r.id), mode: "text" };
}

export async function loadLibrary(db: SupabaseClient, filters: LibraryFilters, opts: { today: string; viewerId: string | null; viewerIsSteward: boolean }): Promise<LibraryData> {
  const monthStart = `${opts.today.slice(0, 7)}-01`;
  const ranked = filters.q ? await rankedIdsForQuery(db, filters.q) : { ids: null, mode: "browse" as const };
  let q = db.from("library_items").select(ITEM_COLUMNS).is("removed_at", null).order("last_confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000);
  if (ranked.ids) q = q.in("id", ranked.ids.length ? ranked.ids : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: items }, { data: rates }, { count: pending }, { count: flagged }, { count: pastReview }, { count: uploadsMonth }] = await Promise.all([
    q,
    db.from("institution_rates").select("label, value, agreement_label, effective_from, verified_at, source_url").order("sort_order"),
    opts.viewerIsSteward ? db.from("library_items").select("id", { count: "exact", head: true }).eq("review_status", "pending_review").is("removed_at", null) : Promise.resolve({ count: 0 }),
    opts.viewerIsSteward ? db.from("library_item_flags").select("id", { count: "exact", head: true }).is("resolved_at", null) : Promise.resolve({ count: 0 }),
    opts.viewerIsSteward ? db.from("library_items").select("id", { count: "exact", head: true }).eq("review_status", "published").is("removed_at", null).lt("review_due", opts.today) : Promise.resolve({ count: 0 }),
    db.from("library_items").select("id", { count: "exact", head: true }).is("removed_at", null).gte("created_at", monthStart),
  ]);
  const all = ((items ?? []) as LibraryItemRecord[]).filter((it) => it.review_status === "published" || it.uploader_id === opts.viewerId || opts.viewerIsSteward);
  const published = all.filter((it) => it.review_status === "published");
  const facets = {
    sponsors: Array.from(new Set(published.map((i) => i.sponsor).filter((x): x is string => Boolean(x)))).sort(),
    mechanisms: Array.from(new Set(published.map((i) => i.mechanism).filter((x): x is string => Boolean(x)))).sort(),
    departments: Array.from(new Set(published.map((i) => i.department).filter((x): x is string => Boolean(x)))).sort(),
  };
  let filtered = all.filter((it) => (!filters.type || it.content_type === filters.type) && (!filters.sponsor || (it.sponsor ?? "").startsWith(filters.sponsor)) && (!filters.mechanism || it.mechanism === filters.mechanism) && (!filters.department || it.department === filters.department) && (!filters.trust || it.trust_tier === filters.trust));
  if (ranked.ids) {
    const order = new Map(ranked.ids.map((id, i) => [id, i]));
    filtered = filtered.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
  }
  const total = filtered.length;
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / LIBRARY_PER_PAGE)));
  const slice = filtered.slice((page - 1) * LIBRARY_PER_PAGE, page * LIBRARY_PER_PAGE);
  const rateRows = (rates ?? []) as Array<{ label: string; value: string; agreement_label: string | null; effective_from: string | null; verified_at: string | null; source_url: string | null }>;
  return {
    filters,
    header: { published: published.length, departments: new Set(published.map((i) => i.department).filter(Boolean)).size, uploadsThisMonth: uploadsMonth ?? 0 },
    rows: slice.map((it) => libraryRow(it, opts.today, opts.viewerId)),
    total,
    page,
    perPage: LIBRARY_PER_PAGE,
    searchMode: ranked.mode,
    facets,
    rates: { rows: rateRows.map((r) => ({ label: r.label, value: r.value })), agreement: rateRows[0]?.agreement_label ?? null, effective: rateRows[0]?.effective_from ?? null, verifiedAt: rateRows.map((r) => r.verified_at).filter(Boolean).sort().slice(-1)[0] ?? null, sourceUrl: rateRows[0]?.source_url ?? null },
    queue: { pending: pending ?? 0, flagged: flagged ?? 0, pastReview: pastReview ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Item sheet
// ---------------------------------------------------------------------------

export type LibraryItemDetail = {
  item: LibraryItemRecord;
  row: LibraryRow;
  typeLabel: string;
  provenance: Array<[string, string]>;
  history: Array<{ what: string; when: string }>;
  openFlags: number;
  canConfirm: boolean;
  confirmLabel: "Confirm still accurate" | "Request update";
  mine: boolean;
  citation: string;
};

export async function loadLibraryItem(db: SupabaseClient, id: string, opts: { today: string; viewerId: string | null; viewerIsSteward: boolean }): Promise<LibraryItemDetail | null> {
  const [{ data: it }, { data: events }, { count: versions }, { count: flags }] = await Promise.all([
    db.from("library_items").select(ITEM_COLUMNS).eq("id", id).maybeSingle(),
    db.from("library_item_events").select("kind, text, created_at").eq("item_id", id).order("created_at", { ascending: false }).limit(12),
    db.from("library_item_versions").select("id", { count: "exact", head: true }).eq("item_id", id),
    db.from("library_item_flags").select("id", { count: "exact", head: true }).eq("item_id", id).is("resolved_at", null),
  ]);
  if (!it) return null;
  const item = it as LibraryItemRecord;
  const row = libraryRow(item, opts.today, opts.viewerId);
  const prior = Math.max(0, (versions ?? 1) - 1);
  const mine = Boolean(opts.viewerId && item.uploader_id === opts.viewerId);
  const canConfirm = mine || opts.viewerIsSteward;
  return {
    item,
    row,
    typeLabel: CONTENT_TYPE_SHORT[item.content_type] + (item.content_type === "specific_aims" || item.content_type === "research_strategy" ? " (example)" : ""),
    provenance: [
      ["Source", row.source],
      ["Uploaded", fmtMonY(item.created_at.slice(0, 10))],
      ["Last confirmed", row.confirmed],
      ["Review due", item.review_due ? fmtMonY(item.review_due) : "—"],
      ["Version", `v${item.version}${prior ? ` · ${prior} prior` : ""}`],
      ["Used in", `${item.download_count} download${item.download_count === 1 ? "" : "s"}`],
    ],
    history: ((events ?? []) as Array<{ kind: string; text: string; created_at: string }>).map((e) => ({ what: e.text, when: fmtMonDY(e.created_at.slice(0, 10)) })),
    openFlags: flags ?? 0,
    canConfirm,
    confirmLabel: canConfirm && item.trust_tier === "community" ? "Confirm still accurate" : canConfirm ? "Confirm still accurate" : "Request update",
    mine,
    citation: `${item.title}. ${itemSource(item)}. ${item.outcome ? `${OUTCOME_LABEL[item.outcome]}. ` : ""}Prospera proposal library, UCSF, v${item.version}${item.last_confirmed_at ? `, confirmed ${fmtMonDY(item.last_confirmed_at.slice(0, 10))}` : ""}. Shared for calibration, not for copying.`,
  };
}

// ---------------------------------------------------------------------------
// Steward queue
// ---------------------------------------------------------------------------

export type QueueData = {
  pending: Array<LibraryRow & { submitted: string; findings: string | null; note: string | null }>;
  flagged: Array<{ flagId: string; item: LibraryRow; reason: string; note: string | null; by: string; when: string }>;
  pastReview: Array<LibraryRow & { reviewDue: string; reminded: string | null }>;
  changesRequested: Array<LibraryRow & { note: string | null }>;
};

export async function loadStewardQueue(db: SupabaseClient, today: string, viewerId: string | null): Promise<QueueData> {
  const [{ data: pending }, { data: flags }, { data: past }, { data: changes }] = await Promise.all([
    db.from("library_items").select(ITEM_COLUMNS).eq("review_status", "pending_review").is("removed_at", null).order("created_at"),
    db.from("library_item_flags").select("id, reason, note, flagged_by_name, created_at, library_items(" + ITEM_COLUMNS + ")").is("resolved_at", null).order("created_at"),
    db.from("library_items").select(ITEM_COLUMNS).eq("review_status", "published").is("removed_at", null).lt("review_due", today).order("review_due"),
    db.from("library_items").select(ITEM_COLUMNS).eq("review_status", "changes_requested").is("removed_at", null).order("reviewed_at", { ascending: false }),
  ]);
  const reasonLabel: Record<string, string> = { outdated: "Out of date", sensitive: "Unpublished data or named people", wrong_metadata: "Wrong sponsor, mechanism or department", other: "Something else" };
  return {
    pending: ((pending ?? []) as LibraryItemRecord[]).map((it) => ({ ...libraryRow(it, today, viewerId), submitted: fmtMonDY(it.created_at.slice(0, 10)), findings: it.sensitive_findings ? summarizeFindings(it.sensitive_findings) : null, note: it.steward_note })),
    flagged: ((flags ?? []) as unknown as Array<Record<string, unknown>>).map((f) => {
      const it = (Array.isArray(f.library_items) ? f.library_items[0] : f.library_items) as LibraryItemRecord;
      return { flagId: String(f.id), item: libraryRow(it, today, viewerId), reason: reasonLabel[String(f.reason)] ?? String(f.reason), note: (f.note as string | null) ?? null, by: String(f.flagged_by_name ?? "A reader"), when: fmtMonDY(String(f.created_at).slice(0, 10)) };
    }),
    pastReview: ((past ?? []) as LibraryItemRecord[]).map((it) => ({ ...libraryRow(it, today, viewerId), reviewDue: fmtMonDY(it.review_due!), reminded: it.reminder_sent_at ? fmtMonDY(it.reminder_sent_at.slice(0, 10)) : null })),
    changesRequested: ((changes ?? []) as LibraryItemRecord[]).map((it) => ({ ...libraryRow(it, today, viewerId), note: it.steward_note })),
  };
}

// ---------------------------------------------------------------------------
// Document helpers (server only)
// ---------------------------------------------------------------------------

export const LIBRARY_MAX_BYTES = 25 * 1024 * 1024;
export const LIBRARY_MIME = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export async function extractDocumentText(buffer: Buffer, mime: string): Promise<{ text: string; pages: number | null; error: string | null }> {
  try {
    if (mime === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      return { text: normalizeText(String(text ?? "")), pages: totalPages ?? null, error: null };
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer });
      return { text: normalizeText(r.value ?? ""), pages: null, error: null };
    }
    return { text: "", pages: null, error: "Text can't be extracted from legacy .doc files; the original is still kept for download." };
  } catch (e) {
    return { text: "", pages: null, error: e instanceof Error ? e.message : "Text extraction failed." };
  }
}

function normalizeText(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, 400_000);
}

export type SensitiveFindings = { collaborators: number; unpublished: number; emails: number; samples: string[] };

/** Heuristic scan shown in step 2 of the upload flow ("Found in the document"). */
export function scanSensitive(text: string): SensitiveFindings {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const unpub = text.match(/\b(unpublished|preliminary data|data not shown|manuscript in preparation|in prep\b|under review)\b/gi) ?? [];
  const names = new Set<string>();
  for (const m of text.matchAll(/\b(?:Dr|Drs|Prof|Professor)\.?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\b([A-Z][a-z]+\s[A-Z][a-z]+),\s(?:MD|PhD|M\.D\.|Ph\.D\.)/g)) names.add(m[1]);
  const samples = [...Array.from(names).slice(0, 5).map((n) => `Named: ${n}`), ...Array.from(new Set(emails)).slice(0, 3).map((e) => `Email: ${e}`), ...Array.from(new Set(unpub.map((u) => u.toLowerCase()))).slice(0, 3).map((u) => `Mentions “${u}”`)];
  return { collaborators: names.size, unpublished: unpub.length, emails: new Set(emails.map((e) => e.toLowerCase())).size, samples };
}

export function summarizeFindings(f: SensitiveFindings): string | null {
  const bits = [f.collaborators ? `${f.collaborators} named collaborator${f.collaborators === 1 ? "" : "s"}` : null, f.unpublished ? `${f.unpublished} mention${f.unpublished === 1 ? "" : "s"} of unpublished work` : null, f.emails ? `${f.emails} email address${f.emails === 1 ? "" : "es"}` : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

export function excerptOf(text: string, max = 420): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), Math.floor(max * 0.7));
  return `${cut.slice(0, end + 1).trim()}…`;
}

export function embeddingTextFor(it: { title: string; content_type: string; sponsor: string | null; mechanism: string | null; department: string | null; excerpt: string | null; extracted_text?: string | null; tags?: string[] }): string {
  return [it.title, [CONTENT_TYPE_SHORT[it.content_type as ContentType], it.sponsor, it.mechanism, it.department].filter(Boolean).join(" · "), (it.tags ?? []).join(", "), it.excerpt ?? "", (it.extracted_text ?? "").slice(0, 6000)].filter(Boolean).join("\n");
}

export async function embedLibraryItem(admin: SupabaseClient, itemId: string): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) return false;
  const { data } = await admin.from("library_items").select("id, title, content_type, sponsor, mechanism, department, excerpt, extracted_text, tags").eq("id", itemId).maybeSingle();
  if (!data) return false;
  try {
    const vec = await embedText(embeddingTextFor(data as Parameters<typeof embeddingTextFor>[0]));
    const { error } = await admin.from("library_items").update({ embedding: toVector(vec) }).eq("id", itemId);
    return !error;
  } catch {
    return false;
  }
}

export function suggestTags(input: { content_type: ContentType; sponsor: string | null; mechanism: string | null; outcome: LibraryOutcome | null; linked_award_number: string | null }): string[] {
  const tags = [CONTENT_TYPE_SHORT[input.content_type].toLowerCase()];
  if (input.mechanism) tags.push(input.mechanism);
  if (input.sponsor) tags.push(input.sponsor.split("·").slice(-1)[0].trim());
  if (input.outcome === "funded") tags.push("funded");
  if (input.linked_award_number) tags.push(`linked award ${input.linked_award_number}`);
  return Array.from(new Set(tags.filter(Boolean)));
}

/**
 * The reverse direction: which open notices fit one person. Uses the same
 * embeddings and thresholds as the suggestion engine so the two screens
 * never disagree. Falls back to nothing (not to keyword overlap) when the
 * person has no embedded evidence — the page says so.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncInvestigatorEmbeddings, type EvidenceKind } from "@/lib/outreach/embeddings";
import { SIM } from "@/lib/outreach/suggest";
import type { SuggestionTier } from "@/lib/outreach/types";

export type OpportunityFit = {
  opportunityId: string;
  title: string;
  agency: string | null;
  tier: SuggestionTier;
  similarity: number;
  why: string;
};

type ScoredItem = { kind: EvidenceKind; ref_id: string; content: string; year: number | null; similarity: number };

const kindPhrase: Record<EvidenceKind, string> = { publication: "PubMed", grant: "RePORTER, profile ID", biosketch: "Biosketch", profile: "UCSF Profiles", focus: "research focus on file", trial: "ClinicalTrials.gov" };

function reasonFor(items: ScoredItem[], tier: SuggestionTier): string {
  const supporting = items.filter((i) => i.similarity >= SIM.support);
  const top = items[0];
  if (!top) return "Keyword-level overlap only.";
  const name = top.kind === "publication" ? `“${top.content.split(" (")[0]}”` : top.kind === "grant" ? `${top.ref_id.replace(/^\d/, "").replace(/-.*$/, "")} (${top.content.split(". ")[0]})` : top.kind === "biosketch" ? "the biosketch personal statement" : top.kind === "profile" ? "the UCSF Profiles keywords" : "the research focus on file";
  const more = supporting.length > 1 ? ` and ${supporting.length - 1} more item${supporting.length > 2 ? "s" : ""}` : "";
  const sources = Array.from(new Set(supporting.map((i) => kindPhrase[i.kind])));
  if (tier === "strong") return `Direct overlap with ${name}${top.year ? ` (${top.year})` : ""}${more} (${sources.join(", ")}). Evidence: strong.`;
  if (tier === "potential") return `Overlaps ${name}${top.year ? ` (${top.year})` : ""}${more} (${sources.join(", ") || kindPhrase[top.kind]}); the rest of the profile only partly aligned. Evidence: ${supporting.length >= 2 ? "partial" : "limited"}.`;
  return `Loose overlap with ${name} only; no other evidence clears the bar.`;
}

export async function rankOpportunitiesForInvestigator(db: SupabaseClient, investigatorId: string, topN = 5): Promise<{ matches: OpportunityFit[]; embedded: boolean; openNotices: number }> {
  let { data: doc } = await db.from("investigator_embeddings").select("embedding").eq("investigator_id", investigatorId).maybeSingle();
  if (!doc && process.env.OPENAI_API_KEY) {
    try {
      await syncInvestigatorEmbeddings(db, investigatorId);
      ({ data: doc } = await db.from("investigator_embeddings").select("embedding").eq("investigator_id", investigatorId).maybeSingle());
    } catch {
      // No key or API hiccup: report as not embedded.
    }
  }
  const { count } = await db.from("opportunity_embeddings").select("opportunity_id", { count: "exact", head: true });
  const openNotices = count ?? 0;
  const vector = (doc as { embedding?: string } | null)?.embedding;
  if (!vector) return { matches: [], embedded: false, openNotices };

  const { data: hits, error } = await db.rpc("match_opportunities", { query_embedding: vector, match_count: Math.max(topN * 4, 20), only_open: true });
  if (error || !hits?.length) return { matches: [], embedded: true, openNotices };
  const ids = (hits as Array<{ opportunity_id: string; similarity: number }>).map((h) => h.opportunity_id);
  const [{ data: notices }, { data: embeds }] = await Promise.all([
    db.from("funding_opportunities").select("id, title, agency").in("id", ids),
    db.from("opportunity_embeddings").select("opportunity_id, embedding").in("opportunity_id", ids.slice(0, topN * 2)),
  ]);
  const byId = new Map(((notices ?? []) as Array<{ id: string; title: string; agency: string | null }>).map((n) => [n.id, n]));
  const embById = new Map(((embeds ?? []) as Array<{ opportunity_id: string; embedding: string }>).map((e) => [e.opportunity_id, e.embedding]));

  const out: OpportunityFit[] = [];
  for (const h of hits as Array<{ opportunity_id: string; similarity: number }>) {
    if (out.length >= topN) break;
    const n = byId.get(h.opportunity_id);
    if (!n || h.similarity < SIM.exploratory) continue;
    let items: ScoredItem[] = [];
    const emb = embById.get(h.opportunity_id);
    if (emb) {
      const { data } = await db.rpc("score_investigator_evidence", { p_investigator_id: investigatorId, query_embedding: emb });
      items = ((data ?? []) as ScoredItem[]).slice(0, 6);
    }
    const supporting = items.filter((i) => i.similarity >= SIM.support);
    const kinds = new Set(supporting.map((i) => i.kind));
    const tier: SuggestionTier = h.similarity >= SIM.strong && supporting.length >= 2 && kinds.size >= 2 ? "strong" : h.similarity >= SIM.potential || supporting.length >= 1 ? "potential" : "exploratory";
    out.push({ opportunityId: n.id, title: n.title, agency: n.agency, tier, similarity: h.similarity, why: reasonFor(items, tier) });
  }
  return { matches: out, embedded: true, openNotices };
}

/**
 * Row shapes and the person-level helpers both suggestion paths share
 * (moved verbatim from suggest.ts in PR 2.2 so the fit-v1 snapshot bridge,
 * src/lib/fit/suggestion-snapshot.ts, can apply the Outreach options and
 * the coverage rule exactly as the legacy engine does without a module
 * cycle). Nothing here reads the database.
 */
import type { EvidenceKind } from "@/lib/outreach/embeddings";
import type { Coverage, SuggestionOptions } from "@/lib/outreach/types";

export type MatchRow = { investigator_id: string; kind: EvidenceKind; ref_id: string; content: string; year: number | null; similarity: number };

export type Person = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  home_department: string | null;
  division: string | null;
  rank: string | null;
  research_community_id: string | null;
  created_at: string;
  do_not_contact_at: string | null;
  raw_profile_json: Record<string, unknown> | null;
};

export type SourceRow = { investigator_id: string; source: string; state: string; item_count: number; unverified_count: number; identity_method: string | null; last_refreshed_at: string | null; document_date: string | null; authorized_at: string | null; personal_statement: string | null; contributions: Array<{ title: string }> | null; meta: Record<string, unknown> | null };
export type GrantRow = { investigator_id: string; project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; raw_json: { project_end_date?: string; project_start_date?: string } | null };
export type PubRow = { id: string; investigator_id: string; pmid: string; title: string | null; journal: string | null; publication_date: string | null; identity_method: string; identity_status: string };
export type HistoryRow = { investigator_id: string; kind: "sent" | "reply"; at: string; label: string; notice: string; note: string | null };

export function personTitle(p: Person, profiles: SourceRow | undefined): string | null {
  const t = (profiles?.meta?.title as string | undefined) ?? (typeof p.raw_profile_json?.title === "string" ? (p.raw_profile_json.title as string) : null);
  if (t?.trim()) return t.trim();
  const r = p.rank?.trim();
  if (r && !/^(member|associate|leadership_committee|leadership committee)$/i.test(r)) return r;
  return null;
}

export type Elig = { mark: "yes" | "no" | "unclear"; value: string; excludedReason: string | null };

/** The legacy eligibility and option rule over the notice's eligibility facet terms and the person's title. */
export function eligibility(facetTerms: string[], title: string | null, opts: SuggestionOptions): Elig {
  const rules = facetTerms.map((t) => t.toLowerCase());
  const wantsIndependent = rules.some((r) => /independent|faculty appointment|principal investigator status/.test(r));
  const wantsEsi = rules.some((r) => /early[- ]stage|esi\b|new investigator|early career/.test(r));
  const wantsClinician = rules.some((r) => /clinician|physician|md\b|clinical degree/.test(r));
  const t = title?.toLowerCase() ?? "";
  const trainee = /postdoc|fellow|student|resident|trainee/.test(t);
  const faculty = /professor|instructor|investigator|director|chief|scientist|lecturer|chair/.test(t);
  if ((wantsIndependent || opts.earlyCareerOnly) && trainee) return { mark: "no", value: `${title} · not an independent appointment`, excludedReason: "PI must hold an independent faculty appointment" };
  if (wantsEsi || opts.earlyCareerOnly) {
    if (/assistant professor|instructor/.test(t)) return { mark: "yes", value: `${title} · early career`, excludedReason: null };
    if (/^(associate professor|professor)/.test(t) || /\bprofessor\b/.test(t) && !/assistant/.test(t)) {
      return opts.earlyCareerOnly ? { mark: "no", value: `${title} · established`, excludedReason: "Early-career investigators only (option)" } : { mark: "unclear", value: `${title} · ESI status not on file`, excludedReason: null };
    }
    return { mark: "unclear", value: "career stage not on file", excludedReason: null };
  }
  if (wantsClinician) return { mark: "unclear", value: title ? `${title} · clinical degree not on file` : "clinical degree not on file", excludedReason: null };
  if (wantsIndependent) {
    if (faculty) return { mark: "yes", value: "independent faculty appointment", excludedReason: null };
    return { mark: "unclear", value: "rank not on file", excludedReason: null };
  }
  if (!rules.length) return { mark: "yes", value: "no special rules found", excludedReason: null };
  return faculty ? { mark: "yes", value: title ?? "faculty", excludedReason: null } : { mark: "unclear", value: "rank not on file", excludedReason: null };
}

export function coverageOf(sources: SourceRow[], inCommunity: boolean): Coverage {
  let n = inCommunity ? 1 : 0;
  const by = new Map(sources.map((s) => [s.source, s]));
  if ((by.get("pubmed")?.item_count ?? 0) > 0) n += 1;
  if ((by.get("reporter")?.item_count ?? 0) > 0) n += 1;
  if (by.get("biosketch")?.state === "on_file") n += 1;
  if (by.get("orcid")?.state === "available" || by.get("profiles")?.state === "available") n += 1;
  return n >= 3 ? "strong" : n === 2 ? "partial" : "limited";
}

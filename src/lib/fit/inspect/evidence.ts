/**
 * Evidence-id resolution for the inspector (plan § PR 1.6 "per-category top
 * evidence"). Pure: the lookups are passed in, nothing is fetched here.
 *
 * Ids are the ones `collectEvidence` gives items (classify/normalize.ts):
 *   publication:<investigator_id>:<pmid>   → investigator_publications (pmid → title, year, journal)
 *   grant:<row uuid>                       → investigator_nih_grants (title, project number, FY, activity code)
 *   trial:<investigator_id>:<nct_id>       → investigator_clinical_trials (title, start year)
 *   biosketch:<investigator_id>[:statement | :contribution:<n>]
 *   profiles:<investigator_id>             → the UCSF Profiles narrative (a prior)
 *   directory:<investigator_id>            → the directory row (a prior)
 *   self_declared:<investigator_id>        → the self-declared record
 *   aspiration:<investigator_id>:<n>       → one aspiration line
 */
import { isPriorItemId } from "@/lib/fit/profile/report";

export type EvidenceKind = "publication" | "grant" | "trial" | "biosketch" | "profiles" | "directory" | "self_declared" | "aspiration" | "unknown";

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  publication: "Publication",
  grant: "NIH grant",
  trial: "Clinical trial",
  biosketch: "Biosketch",
  profiles: "UCSF Profiles",
  directory: "Directory",
  self_declared: "Self-declared",
  aspiration: "Aspiration",
  unknown: "Evidence",
};

export type PublicationLookupRow = { pmid: string; title: string | null; journal: string | null; publication_date: string | null };
export type GrantLookupRow = { id: string; project_num: string | null; project_title: string | null; fiscal_year: number | null; activity_code: string | null };
export type TrialLookupRow = { nct_id: string; title: string | null; start_date: string | null };

/** What the page passes in: maps keyed the way the ids reference the rows. */
export type EvidenceLookup = {
  publications: ReadonlyMap<string, PublicationLookupRow>;
  grants: ReadonlyMap<string, GrantLookupRow>;
  trials: ReadonlyMap<string, TrialLookupRow>;
};

export const EMPTY_LOOKUP: EvidenceLookup = { publications: new Map(), grants: new Map(), trials: new Map() };

/** One resolved evidence reference as the page renders it. */
export type EvidenceRef = {
  id: string;
  kind: EvidenceKind;
  kindLabel: string;
  /** Title when the lookup had the row, else a description of the id (PMID …, NCT…, "grant <uuid>"). */
  title: string;
  /** Journal · year, project number · FY · code, start year … */
  meta: string | null;
  /** PubMed / ClinicalTrials.gov page when the id carries a public identifier. */
  href: string | null;
  /** Found in the lookup (a title is real, not a placeholder). */
  resolved: boolean;
  /** A prior (Profiles narrative, directory row), not evidence (report.ts `isPriorItemId`). */
  prior: boolean;
};

export type ParsedEvidenceId =
  | { kind: "publication"; investigatorId: string; pmid: string }
  | { kind: "grant"; rowId: string }
  | { kind: "trial"; investigatorId: string; nctId: string }
  | { kind: "biosketch"; investigatorId: string; part: string | null }
  | { kind: "profiles" | "directory" | "self_declared"; investigatorId: string }
  | { kind: "aspiration"; investigatorId: string; n: string | null }
  | { kind: "unknown" };

/** Pure. Splits an evidence id into its parts; anything unexpected is `unknown`, never thrown. */
export function parseEvidenceId(id: string): ParsedEvidenceId {
  const parts = id.split(":");
  const head = parts[0];
  switch (head) {
    case "publication":
      if (parts.length >= 3) return { kind: "publication", investigatorId: parts[1]!, pmid: parts.slice(2).join(":") };
      break;
    case "grant":
      if (parts.length >= 2) return { kind: "grant", rowId: parts.slice(1).join(":") };
      break;
    case "trial":
      if (parts.length >= 3) return { kind: "trial", investigatorId: parts[1]!, nctId: parts.slice(2).join(":") };
      break;
    case "biosketch":
      if (parts.length >= 2) return { kind: "biosketch", investigatorId: parts[1]!, part: parts.length > 2 ? parts.slice(2).join(":") : null };
      break;
    case "profiles":
    case "directory":
    case "self_declared":
      if (parts.length >= 2) return { kind: head, investigatorId: parts[1]! };
      break;
    case "aspiration":
      if (parts.length >= 2) return { kind: "aspiration", investigatorId: parts[1]!, n: parts[2] ?? null };
      break;
    default:
      break;
  }
  return { kind: "unknown" };
}

const yearOf = (iso: string | null | undefined): string | null => (iso && /^\d{4}/.test(iso) ? iso.slice(0, 4) : null);

/** Pure. Resolves one id against the lookups; a missing row keeps the identifier visible so a reviewer can still find it. */
export function resolveEvidenceId(id: string, lookup: EvidenceLookup): EvidenceRef {
  const parsed = parseEvidenceId(id);
  const prior = isPriorItemId(id);
  switch (parsed.kind) {
    case "publication": {
      const row = lookup.publications.get(parsed.pmid);
      const year = yearOf(row?.publication_date);
      return {
        id,
        kind: "publication",
        kindLabel: EVIDENCE_KIND_LABEL.publication,
        title: row?.title?.trim() || `PMID ${parsed.pmid}`,
        meta: [row?.journal, year].filter(Boolean).join(" · ") || (row ? null : `PMID ${parsed.pmid}`),
        href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(parsed.pmid)}/`,
        resolved: Boolean(row),
        prior,
      };
    }
    case "grant": {
      const row = lookup.grants.get(parsed.rowId);
      const meta = [row?.project_num, row?.fiscal_year ? `FY${row.fiscal_year}` : null, row?.activity_code].filter(Boolean).join(" · ");
      return {
        id,
        kind: "grant",
        kindLabel: EVIDENCE_KIND_LABEL.grant,
        title: row?.project_title?.trim() || row?.project_num || `Grant ${parsed.rowId}`,
        meta: meta || null,
        href: null,
        resolved: Boolean(row),
        prior,
      };
    }
    case "trial": {
      const row = lookup.trials.get(parsed.nctId);
      const year = yearOf(row?.start_date);
      return {
        id,
        kind: "trial",
        kindLabel: EVIDENCE_KIND_LABEL.trial,
        title: row?.title?.trim() || parsed.nctId,
        meta: [parsed.nctId, year ? `started ${year}` : null].filter(Boolean).join(" · "),
        href: `https://clinicaltrials.gov/study/${encodeURIComponent(parsed.nctId)}`,
        resolved: Boolean(row),
        prior,
      };
    }
    case "biosketch":
      return {
        id,
        kind: "biosketch",
        kindLabel: EVIDENCE_KIND_LABEL.biosketch,
        title: parsed.part === "statement" ? "Biosketch personal statement" : parsed.part?.startsWith("contribution") ? `Biosketch contribution ${parsed.part.split(":")[1] ?? ""}`.trim() : "Biosketch",
        meta: null,
        href: null,
        resolved: true,
        prior,
      };
    case "profiles":
      return { id, kind: "profiles", kindLabel: EVIDENCE_KIND_LABEL.profiles, title: "UCSF Profiles narrative", meta: "prior — reliability 0.6, never counted as a source", href: null, resolved: true, prior };
    case "directory":
      return { id, kind: "directory", kindLabel: EVIDENCE_KIND_LABEL.directory, title: "Directory record (department, division, title)", meta: "prior — never counted as a source", href: null, resolved: true, prior };
    case "self_declared":
      return { id, kind: "self_declared", kindLabel: EVIDENCE_KIND_LABEL.self_declared, title: "Self-declared research axes", meta: null, href: null, resolved: true, prior };
    case "aspiration":
      return { id, kind: "aspiration", kindLabel: EVIDENCE_KIND_LABEL.aspiration, title: parsed.n ? `Aspiration line ${parsed.n}` : "Aspiration", meta: null, href: null, resolved: true, prior };
    default:
      return { id, kind: "unknown", kindLabel: EVIDENCE_KIND_LABEL.unknown, title: id, meta: null, href: null, resolved: false, prior };
  }
}

/** The distinct PMIDs, grant row ids and NCT ids an id list references — what the page has to look up. Pure. */
export function evidenceKeys(ids: Iterable<string>): { pmids: string[]; grantIds: string[]; nctIds: string[] } {
  const pmids = new Set<string>();
  const grantIds = new Set<string>();
  const nctIds = new Set<string>();
  for (const id of ids) {
    const p = parseEvidenceId(id);
    if (p.kind === "publication") pmids.add(p.pmid);
    else if (p.kind === "grant") grantIds.add(p.rowId);
    else if (p.kind === "trial") nctIds.add(p.nctId);
  }
  return { pmids: Array.from(pmids), grantIds: Array.from(grantIds), nctIds: Array.from(nctIds) };
}

/** Count of provenance ids by evidence kind — the "evidence by source" line. Pure. */
export function countByKind(ids: Iterable<string>): Array<{ kind: EvidenceKind; label: string; count: number }> {
  const counts = new Map<EvidenceKind, number>();
  for (const id of ids) {
    const k = parseEvidenceId(id).kind;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => ({ kind, label: EVIDENCE_KIND_LABEL[kind], count }));
}

/**
 * "Opportunities that fit" on Investigator Detail v2: tier pills with
 * evidence-backed reasons instead of numeric scores.
 *
 * The PI profile is built from the directory's own fields plus what the
 * verified sources say — grant titles (RePORTER, profile ID), affiliation- or
 * ORCID-matched publication titles (PubMed) and UCSF Profiles keywords — so
 * every reason can name the evidence it rests on. Name-only publications are
 * never used here (README: visible in evidence, never in reasons).
 */

import { normalizeTextToTags } from "@/lib/normalization/normalize-text-to-tags";
import { buildPiQuickMatchProfile } from "@/lib/quick-match/normalize-pi";
import { scorePiAgainstOpportunity } from "@/lib/quick-match/score";
import type { PiQuickMatchProfile, QuickMatchBuckets } from "@/lib/quick-match/types";
import { shortIc } from "@/lib/investigators/sources";

export type FitTier = "strong" | "potential" | "exploratory";

export const TIER_LABEL: Record<FitTier, string> = { strong: "Strong match", potential: "Potential match", exploratory: "Exploratory" };

export type EvidenceRef =
  | { kind: "grant"; projectNum: string; label: string }
  | { kind: "pubmed"; count: number; sinceYear: number | null; method: string }
  | { kind: "profiles" }
  | { kind: "directory" };

export type EvidenceProfile = {
  profile: PiQuickMatchProfile;
  /** tag → the evidence that contributed it. */
  evidence: Map<string, EvidenceRef[]>;
  hasVerifiedEvidence: boolean;
};

export type FitMatch = {
  opportunityId: string;
  title: string;
  agency: string | null;
  tier: FitTier;
  why: string;
};

const humanize = (t: string) => t.replaceAll("_", " ");
const uniq = <T,>(a: T[]) => Array.from(new Set(a));

function addEvidence(map: Map<string, EvidenceRef[]>, tags: string[], ref: EvidenceRef) {
  for (const t of tags) {
    const list = map.get(t) ?? [];
    list.push(ref);
    map.set(t, list);
  }
}

export function buildEvidenceProfile(input: {
  inv: { id: string; full_name: string; home_department: string | null; division: string | null; raw_profile_json?: unknown };
  feats: { science_tags?: string[] | null; disease_tags?: string[] | null; method_tags?: string[] | null; translational_tags?: string[] | null } | null;
  grants: Array<{ project_num: string; project_title: string | null; ic_name: string | null; identity_status: string }>;
  publications: Array<{ title: string | null; publication_date: string | null; identity_method: string; identity_status: string }>;
  profilesKeywords: string[];
}): EvidenceProfile {
  const base = buildPiQuickMatchProfile(input.inv, input.feats);
  const evidence = new Map<string, EvidenceRef[]>();
  addEvidence(evidence, [...base.researchPrimary, ...base.researchSecondary, ...base.diseasePrimary, ...base.diseaseSecondary, ...base.technical], { kind: "directory" });

  const research = new Set([...base.researchPrimary, ...base.researchSecondary]);
  const disease = new Set([...base.diseasePrimary, ...base.diseaseSecondary]);
  const technical = new Set(base.technical);
  let verified = false;

  for (const g of input.grants) {
    if (g.identity_status !== "verified" || !g.project_title) continue;
    const b = normalizeTextToTags(g.project_title);
    const tags = [...b.science, ...b.translational, ...b.disease, ...b.method];
    if (!tags.length) continue;
    verified = true;
    for (const t of [...b.science, ...b.translational]) research.add(t);
    for (const t of b.disease) disease.add(t);
    for (const t of b.method) technical.add(t);
    addEvidence(evidence, tags, { kind: "grant", projectNum: g.project_num, label: `${g.project_num}${shortIc(g.ic_name) ? ` (${shortIc(g.ic_name)})` : ""}` });
  }

  const pubs = input.publications.filter((p) => p.identity_status === "verified" && p.title);
  if (pubs.length) {
    const years = pubs.map((p) => Number.parseInt(p.publication_date?.slice(0, 4) ?? "", 10)).filter((y) => Number.isFinite(y));
    const since = years.length ? Math.min(...years) : null;
    const methods = uniq(pubs.map((p) => p.identity_method));
    const method = methods.includes("affiliation") ? "affiliation-matched" : methods.includes("orcid") ? "ORCID-matched" : methods.includes("profiles") ? "UCSF Profiles-matched" : "confirmed";
    const tagCounts = new Map<string, number>();
    for (const p of pubs) {
      const b = normalizeTextToTags(p.title!);
      for (const t of [...b.science, ...b.translational]) { research.add(t); tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1); }
      for (const t of b.disease) { disease.add(t); tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1); }
      for (const t of b.method) { technical.add(t); tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1); }
    }
    if (tagCounts.size) verified = true;
    for (const [t, n] of tagCounts) addEvidence(evidence, [t], { kind: "pubmed", count: n, sinceYear: since, method });
  }

  if (input.profilesKeywords.length) {
    const b = normalizeTextToTags(input.profilesKeywords.join(". "));
    const tags = [...b.science, ...b.translational, ...b.disease, ...b.method];
    if (tags.length) verified = true;
    for (const t of [...b.science, ...b.translational]) research.add(t);
    for (const t of b.disease) disease.add(t);
    for (const t of b.method) technical.add(t);
    addEvidence(evidence, tags, { kind: "profiles" });
  }

  // Tags the sources added join the secondary buckets; directory primaries stay primary.
  const profile: PiQuickMatchProfile = {
    ...base,
    researchSecondary: uniq([...base.researchSecondary, ...Array.from(research)]).filter((t) => !base.researchPrimary.includes(t)),
    diseaseSecondary: uniq([...base.diseaseSecondary, ...Array.from(disease)]).filter((t) => !base.diseasePrimary.includes(t)),
    technical: uniq([...base.technical, ...Array.from(technical)]),
  };
  return { profile, evidence, hasVerifiedEvidence: verified };
}

function strongestEvidence(tags: string[], evidence: Map<string, EvidenceRef[]>): EvidenceRef | null {
  let grant: EvidenceRef | null = null;
  let pub: EvidenceRef | null = null;
  let profiles: EvidenceRef | null = null;
  for (const t of tags) {
    for (const e of evidence.get(t) ?? []) {
      if (e.kind === "grant" && !grant) grant = e;
      else if (e.kind === "pubmed" && (!pub || (pub.kind === "pubmed" && e.count > pub.count))) pub = e;
      else if (e.kind === "profiles" && !profiles) profiles = e;
    }
  }
  return grant ?? pub ?? profiles;
}

function evidencePhrase(e: EvidenceRef): string {
  switch (e.kind) {
    case "grant":
      return `${e.label} is a prior award in this area (RePORTER, profile ID)`;
    case "pubmed":
      return `${e.count} ${e.method} publication${e.count === 1 ? "" : "s"}${e.sinceYear ? ` since ${e.sinceYear}` : ""} (PubMed)`;
    case "profiles":
      return "listed among the research keywords on UCSF Profiles";
    case "directory":
      return "research focus on file";
  }
}

function listTags(tags: string[], max = 3): string {
  const shown = tags.slice(0, max).map(humanize);
  return tags.length > max ? `${shown.join(", ")} and ${tags.length - max} more` : shown.join(", ");
}

export function rankFitMatches(
  ep: EvidenceProfile,
  opportunities: Array<{ id: string; title: string; agency: string | null; tags: QuickMatchBuckets }>,
  topN = 5,
): FitMatch[] {
  const ranked: Array<FitMatch & { score: number; raw: number }> = [];
  for (const o of opportunities) {
    const s = scorePiAgainstOpportunity(ep.profile, o.tags);
    const b = s.breakdown;
    if (b.rawScore <= 0) continue;
    const researchHits = [...b.primaryResearchHits, ...b.secondaryResearchHits];
    const diseaseHits = [...b.primaryDiseaseHits, ...b.secondaryDiseaseHits];
    const methodHits = b.technicalHits;
    const all = [...diseaseHits, ...researchHits, ...methodHits];
    const strongest = strongestEvidence(all, ep.evidence);
    const verifiedHit = strongest != null && strongest.kind !== "directory";

    let tier: FitTier;
    if (s.totalScore >= 60 && verifiedHit && diseaseHits.length && researchHits.length) tier = "strong";
    else if (s.totalScore >= 30 || (verifiedHit && s.totalScore >= 15)) tier = "potential";
    else tier = "exploratory";

    let why: string;
    if (tier === "strong") {
      why = `Direct overlap on ${listTags([...researchHits, ...diseaseHits])}; ${evidencePhrase(strongest!)}. Evidence: strong.`;
    } else if (tier === "potential") {
      const facets: Array<[string, string[]]> = [["Disease", diseaseHits], ["Research", researchHits], ["Methods", methodHits]];
      const matched = facets.filter(([, t]) => t.length);
      const missing = facets.filter(([, t]) => !t.length).map(([n]) => n.toLowerCase());
      const lead = matched[0]!;
      const ev = strongestEvidence(lead[1], ep.evidence) ?? strongest;
      why = `${lead[0]} facet matches (${listTags(lead[1])}${ev ? `; ${evidencePhrase(ev)}` : ""})${missing.length ? `; ${missing.slice(0, 2).join(" and ")} facet${missing.length > 1 ? "s" : ""} only partly aligned` : ""}. Evidence: ${verifiedHit ? "partial" : "limited"}.`;
    } else {
      why = `Keyword overlap on ${listTags(all, 2)} only; no ${diseaseHits.length ? "funding" : "disease or funding"} alignment.`;
    }

    ranked.push({ opportunityId: o.id, title: o.title, agency: o.agency, tier, why, score: s.totalScore, raw: b.rawScore });
  }
  const order: Record<FitTier, number> = { strong: 0, potential: 1, exploratory: 2 };
  ranked.sort((a, b) => order[a.tier] - order[b.tier] || b.score - a.score || b.raw - a.raw);
  return ranked.slice(0, topN).map((m) => ({ opportunityId: m.opportunityId, title: m.title, agency: m.agency, tier: m.tier, why: m.why }));
}

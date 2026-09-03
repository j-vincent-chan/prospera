/**
 * The suggestion engine (Outreach v4).
 *
 * Ranks the directory against an opportunity profile using embeddings of
 * verified evidence — publications, awards, biosketch statements, Profiles
 * keywords, the directory focus — then applies eligibility rules, options,
 * flags and tier caps, and freezes a snapshot per person: tier, coverage,
 * templated reasons (each citing a verified item), a facet checklist and the
 * evidence groups the "Why this suggestion" view shows. Name-only PubMed
 * matches never enter the ranking. Nothing here adds or sends anything.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText, toVector, type EvidenceKind } from "@/lib/outreach/embeddings";
import { extractOpportunityProfile, parseProfile, profileIsEmpty, profileQueryText, type NoticeForProfile } from "@/lib/outreach/profile";
import {
  DEFAULT_SUGGESTION_OPTIONS,
  type ChecklistRow,
  type Coverage,
  type EvidenceGroup,
  type EvidenceItem,
  type OpportunityProfile,
  type SuggestionFlag,
  type SuggestionOptions,
  type SuggestionReason,
  type SuggestionSnapshot,
  type SuggestionTier,
} from "@/lib/outreach/types";
import { fmtMonD, fmtMonDYear, fmtMonYear, monthsSince, shortIc } from "@/lib/investigators/sources";

// Cosine thresholds for text-embedding-3-small. Calibrated on the launch
// directory; nudge here, not in the tier logic.
export const SIM = { strong: 0.5, potential: 0.42, exploratory: 0.34, support: 0.38 } as const;
const MATCH_ROWS = 900;
const RECENT_CONTACT_DAYS = 90;
const RENEWAL_WINDOW_MONTHS = 6;

type MatchRow = { investigator_id: string; kind: EvidenceKind; ref_id: string; content: string; year: number | null; similarity: number };

type Person = {
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

type SourceRow = { investigator_id: string; source: string; state: string; item_count: number; unverified_count: number; identity_method: string | null; last_refreshed_at: string | null; document_date: string | null; authorized_at: string | null; personal_statement: string | null; contributions: Array<{ title: string }> | null; meta: Record<string, unknown> | null };
type GrantRow = { investigator_id: string; project_num: string; project_title: string | null; ic_name: string | null; fiscal_year: number | null; raw_json: { project_end_date?: string; project_start_date?: string } | null };
type PubRow = { id: string; investigator_id: string; pmid: string; title: string | null; journal: string | null; publication_date: string | null; identity_method: string; identity_status: string };
type HistoryRow = { investigator_id: string; kind: "sent" | "reply"; at: string; label: string; notice: string; note: string | null };

const lastName = (p: Person) => p.last_name?.trim() || p.full_name.trim().split(/\s+/).slice(-1)[0] || p.full_name;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const stem = (t: string) => t.replace(/(ies|es|s)$/i, (m) => (m === "ies" ? "y" : ""));

/** Which facet terms a text mentions (loose: stemmed substring on each word of the term). */
export function termHits(text: string, terms: string[]): string[] {
  const hay = ` ${norm(text)} `;
  const out: string[] = [];
  for (const term of terms) {
    const t = norm(term);
    if (!t || t === "any" || t === "none") continue;
    const words = t.split(" ").filter((w) => w.length > 2);
    if (!words.length) continue;
    // Stemmed word, or a 6-letter prefix for longer words (psoriasis ~ psoriatic, autoimmune ~ autoimmunity).
    const ok = words.every((w) => hay.includes(stem(w)) || (w.length >= 7 && hay.includes(w.slice(0, 6))));
    if (ok) out.push(term);
  }
  return out;
}

const ACTIVITY_RE = /\b([RKUPFTDS]\d{2}|DP\d|RM\d|UM\d|UG\d|SC\d)\b/gi;
function activityCodes(terms: string[]): string[] {
  const out = new Set<string>();
  for (const t of terms) for (const m of t.toUpperCase().matchAll(ACTIVITY_RE)) out.add(m[1]!);
  return Array.from(out);
}
const grantCode = (projectNum: string) => projectNum.replace(/^\d/, "").match(/^([A-Z]{1,2}\d{2})/)?.[1] ?? null;

function personTitle(p: Person, profiles: SourceRow | undefined): string | null {
  const t = (profiles?.meta?.title as string | undefined) ?? (typeof p.raw_profile_json?.title === "string" ? (p.raw_profile_json.title as string) : null);
  if (t?.trim()) return t.trim();
  const r = p.rank?.trim();
  if (r && !/^(member|associate|leadership_committee|leadership committee)$/i.test(r)) return r;
  return null;
}

type Elig = { mark: "yes" | "no" | "unclear"; value: string; excludedReason: string | null };
function eligibility(facetTerms: string[], title: string | null, opts: SuggestionOptions): Elig {
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

function coverageOf(sources: SourceRow[], inCommunity: boolean): Coverage {
  let n = inCommunity ? 1 : 0;
  const by = new Map(sources.map((s) => [s.source, s]));
  if ((by.get("pubmed")?.item_count ?? 0) > 0) n += 1;
  if ((by.get("reporter")?.item_count ?? 0) > 0) n += 1;
  if (by.get("biosketch")?.state === "on_file") n += 1;
  if (by.get("orcid")?.state === "available" || by.get("profiles")?.state === "available") n += 1;
  return n >= 3 ? "strong" : n === 2 ? "partial" : "limited";
}

export type SuggestionComputed = SuggestionSnapshot & { investigatorId: string; summary: string };

/** Pure ranking step, exported for tests. */
export function computeSuggestion(input: {
  person: Person;
  profile: OpportunityProfile;
  opts: SuggestionOptions;
  matches: MatchRow[];
  sources: SourceRow[];
  grants: GrantRow[];
  pubs: PubRow[];
  history: HistoryRow[];
  communityLabel: string | null;
  communityTagged: boolean;
  now: Date;
}): SuggestionComputed | null {
  const { person: p, profile, opts, now } = input;
  const facets = profile.facets;
  const byKind = new Map(input.sources.map((s) => [s.source, s]));
  const title = personTitle(p, byKind.get("profiles"));
  const matches = [...input.matches].sort((a, b) => b.similarity - a.similarity);
  const top = matches[0]?.similarity ?? 0;
  const supporting = matches.filter((m) => m.similarity >= SIM.support);
  const supportKinds = new Set(supporting.map((m) => m.kind));
  const verifiedPubs = input.pubs.filter((x) => x.identity_status === "verified");
  const unverifiedPubs = input.pubs.filter((x) => x.identity_status === "unverified");
  const hasAnyEvidence = matches.length > 0 || input.grants.length > 0 || verifiedPubs.length > 0;

  if (!hasAnyEvidence && !(input.communityTagged && p.research_community_id)) return null;
  if (top < SIM.exploratory && !(input.communityTagged && p.research_community_id)) return null;

  // Facet checks against the supporting evidence (falling back to the top three items).
  const evidenceText = (supporting.length ? supporting : matches.slice(0, 3)).map((m) => m.content).join(" \n ");
  const topicHits = termHits(evidenceText, facets.topics);
  const diseaseHits = facets.disease.some((d) => /^(any|all|unrestricted)$/i.test(d)) ? ["any"] : termHits(evidenceText, facets.disease);
  const methodHits = termHits(evidenceText, facets.methods);
  const excludedHits = termHits(evidenceText, facets.excluded);
  const wantedCodes = activityCodes(facets.mechanism);
  const heldCodes = Array.from(new Set(input.grants.map((g) => grantCode(g.project_num)).filter((c): c is string => Boolean(c))));
  const mechanismYes = wantedCodes.length ? heldCodes.some((c) => wantedCodes.includes(c) || (wantedCodes.includes("R01") && /^(R01|U01|P01|R35|R37|DP1|DP2)$/.test(c))) : heldCodes.length > 0;
  const elig = eligibility(facets.eligibility, title, opts);

  // Options.
  const lastSent = input.history.filter((h) => h.kind === "sent").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const daysSinceContact = lastSent ? Math.floor((now.getTime() - new Date(lastSent.at).getTime()) / 86_400_000) : null;
  let excludedReason: string | null = elig.excludedReason;
  if (!excludedReason && opts.excludeRecentlyContacted && daysSinceContact != null && daysSinceContact <= RECENT_CONTACT_DAYS) excludedReason = `Contacted ${daysSinceContact} days ago (option: exclude people contacted in the last 90 days)`;
  if (!excludedReason && opts.excludeRenewalsDue) {
    const soon = input.grants.find((g) => g.raw_json?.project_end_date && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) >= -RENEWAL_WINDOW_MONTHS && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) <= 0);
    if (soon) excludedReason = `${soon.project_num} ends within 6 months (option: exclude renewals due)`;
  }
  if (p.do_not_contact_at) excludedReason = "Do not contact";

  // Flags.
  const flags: SuggestionFlag[] = [];
  if (elig.mark === "unclear") flags.push({ kind: "eligibility", text: `Eligibility unclear: ${elig.value === "rank not on file" ? "rank and appointment type are not on file, so the independent-faculty rule couldn’t be checked" : elig.value}. Capped at Potential match until confirmed.` });
  if (verifiedPubs.length === 0 && unverifiedPubs.length > 0) flags.push({ kind: "identity", text: `Identity unverified: all ${unverifiedPubs.length} matched publications are name-only. Reasons rely on other sources.` });
  else if (unverifiedPubs.length > 0 && unverifiedPubs.length >= verifiedPubs.length) flags.push({ kind: "identity", text: `Identity unverified: ${unverifiedPubs.length} of ${unverifiedPubs.length + verifiedPubs.length} matched publications are name-only. Reasons rely on the ${verifiedPubs.length} verified paper${verifiedPubs.length === 1 ? "" : "s"}.` });
  if (excludedHits.length) flags.push({ kind: "conflict", text: `Sources conflict: the evidence mentions ${excludedHits.join(", ")}, which the notice lists as nonresponsive. Aims would need reframing. Capped at Potential match.` });
  const refreshed = input.sources.map((s) => s.last_refreshed_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null;
  const staleMonths = refreshed ? monthsSince(refreshed, now) : null;
  if (!hasAnyEvidence) flags.push({ kind: "limited", text: "Limited data: no PubMed or RePORTER results have been fetched for this profile." });
  if (staleMonths != null && staleMonths >= 12) flags.push({ kind: "stale", text: `Stale profile: last refreshed ${fmtMonYear(refreshed!)}.` });

  // Tier.
  let tier: SuggestionTier;
  const strongShape = top >= SIM.strong && supporting.length >= 2 && supportKinds.size >= 2 && topicHits.length > 0 && (diseaseHits.length > 0 || facets.disease.length === 0);
  if (!hasAnyEvidence) tier = "exploratory";
  else if (strongShape) tier = "strong";
  else if (top >= SIM.potential || (top >= SIM.strong && supporting.length >= 1)) tier = "potential";
  else tier = "exploratory";
  if (tier === "strong" && flags.some((f) => f.kind === "eligibility" || f.kind === "identity" || f.kind === "conflict")) tier = "potential";
  if (tier !== "exploratory" && flags.some((f) => f.kind === "limited")) tier = "exploratory";

  const inCommunity = Boolean(p.research_community_id);
  const coverage = coverageOf(input.sources, inCommunity);
  const score = top * 0.75 + Math.min(supporting.length, 4) * 0.04 + (tier === "strong" ? 0.1 : 0);

  // Reasons — verified items only.
  const facetPhrase = (hits: string[], label: string) => (hits.length ? `${label} (${hits.slice(0, 2).join(", ")})` : null);
  const reasons: SuggestionReason[] = [];
  const pubMatches = supporting.filter((m) => m.kind === "publication").slice(0, 2);
  const pubMeta = new Map(input.pubs.map((x) => [x.pmid, x]));
  if (pubMatches.length) {
    const first = pubMatches[0]!;
    const pm = pubMeta.get(first.ref_id);
    const years = Array.from(new Set(pubMatches.map((m) => m.year).filter(Boolean))).sort();
    const which = [facetPhrase(topicHits, "topic"), facetPhrase(diseaseHits.filter((d) => d !== "any"), "disease"), facetPhrase(methodHits, "methods")].filter(Boolean).join(" and ");
    const method = pm?.identity_method === "orcid" ? "ORCID-linked" : pm?.identity_method === "profiles" ? "Listed on UCSF Profiles" : pm?.identity_method === "manual" ? "Confirmed by you" : "Affiliation-matched";
    reasons.push({
      text: pubMatches.length > 1
        ? `${pubMatches.length} publications since ${years[0] ?? "recently"}, including “${first.content.split(" (")[0]}”, match the ${which || "notice’s scientific scope"}.`
        : `“${first.content.split(" (")[0]}”${pm?.journal ? ` (${pm.journal}${pm.publication_date ? `, ${pm.publication_date.slice(0, 4)}` : ""})` : ""} matches the ${which || "notice’s scientific scope"}.`,
      source: `PubMed · ${years.length > 1 ? `${years[0]}–${String(years[years.length - 1]).slice(-2)}` : years[0] ?? "verified"}`,
      title: `${method}, high confidence`,
      evidenceIds: pubMatches.map((m) => `publication:${m.ref_id}`),
    });
  }
  const grantMatch = supporting.find((m) => m.kind === "grant") ?? (mechanismYes ? matches.find((m) => m.kind === "grant") : undefined);
  const grantRow = grantMatch ? input.grants.find((g) => g.project_num === grantMatch.ref_id) : null;
  if (grantMatch && grantRow) {
    const end = grantRow.raw_json?.project_end_date?.slice(0, 10) ?? null;
    const active = end ? end >= now.toISOString().slice(0, 10) : (grantRow.fiscal_year ?? 0) >= now.getUTCFullYear() - 1;
    const code = grantCode(grantRow.project_num) ?? "award";
    reasons.push({
      text: `${active ? "Active" : "Prior"} ${shortIc(grantRow.ic_name) ?? "NIH"} ${code} on ${grantRow.project_title?.toLowerCase().replace(/\.$/, "") ?? "a related project"} shows ${code} experience${wantedCodes.length && mechanismYes ? " in the mechanism this notice uses" : " in the same area"}.`,
      source: `RePORTER · ${grantRow.project_num.replace(/^\d/, "").replace(/-.*$/, "")}`,
      title: "Matched by profile ID",
      evidenceIds: [`grant:${grantRow.project_num}`],
    });
  }
  const bio = byKind.get("biosketch");
  const bioMatch = matches.find((m) => m.kind === "biosketch");
  if (reasons.length < 3 && bio?.state === "on_file" && bio.personal_statement && (bioMatch?.similarity ?? 0) >= SIM.exploratory) {
    reasons.push({ text: `Self-described focus: “${bio.personal_statement.split(/(?<=\.)\s/)[0]?.slice(0, 160)}”`, source: `Biosketch · ${bio.document_date ? bio.document_date.slice(0, 4) : "on file"}`, title: bio.authorized_at ? `Authorized ${fmtMonDYear(bio.authorized_at)}` : "On file", evidenceIds: ["biosketch:biosketch"] });
  }
  const prof = byKind.get("profiles");
  const profMatch = matches.find((m) => m.kind === "profile");
  if (reasons.length < 3 && prof?.state === "available" && profMatch && profMatch.similarity >= SIM.exploratory) {
    const kw = ((prof.meta?.keywords as string[] | undefined) ?? []).slice(0, 3);
    if (kw.length) reasons.push({ text: `UCSF Profiles lists ${kw.join(", ")} among the research keywords.`, source: "UCSF Profiles", title: "Institutional profile", evidenceIds: ["profile:profiles"] });
  }
  const reply = input.history.filter((h) => h.kind === "reply").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  if (reasons.length < 3 && reply && /interested|maybe/i.test(reply.label)) {
    reasons.push({ text: `Replied ${reply.label} to ${reply.notice} in ${fmtMonYear(reply.at)}.`, source: `Reply · ${fmtMonYear(reply.at)}`, title: "Recorded reply", evidenceIds: [] });
  }
  if (!reasons.length) {
    reasons.push(input.communityLabel && inCommunity ? { text: `${input.communityLabel} roster membership is the only evidence on file.`, source: "Roster", title: "Community roster", evidenceIds: [] } : { text: "Keyword-level overlap only; no verified item clears the evidence bar.", source: "Directory", title: "Directory fields", evidenceIds: [] });
  }

  // Checklist.
  const checklist: ChecklistRow[] = [
    { facet: "Topics", value: topicHits.length ? topicHits.slice(0, 3).join(", ") : facets.topics.length ? "no overlap found" : "—", mark: topicHits.length ? "yes" : "no" },
    { facet: "Disease", value: diseaseHits[0] === "any" ? "any (notice unrestricted)" : diseaseHits.length ? diseaseHits.slice(0, 3).join(", ") : facets.disease.length ? `not ${facets.disease.slice(0, 2).join(" / ")}` : "—", mark: diseaseHits.length || !facets.disease.length ? "yes" : "no" },
    { facet: "Methods", value: methodHits.length ? methodHits.slice(0, 3).join(", ") : facets.methods.length ? "no overlap found" : "—", mark: methodHits.length || !facets.methods.length ? "yes" : "no" },
    { facet: "Mechanism", value: heldCodes.length ? `${heldCodes.slice(0, 3).join(", ")} on record` : "no NIH award on record", mark: mechanismYes ? "yes" : "no" },
    { facet: "Eligibility", value: elig.value, mark: elig.mark === "no" ? "no" : elig.mark },
    excludedHits.length ? { facet: "Exclusions", value: `evidence mentions ${excludedHits.slice(0, 2).join(", ")}`, mark: "conflict" } : { facet: "Exclusions", value: facets.excluded.length ? "none found" : "—", mark: "yes" },
  ];
  if (flags.some((f) => f.kind === "identity")) checklist.push({ facet: "Identity", value: `${unverifiedPubs.length} of ${unverifiedPubs.length + verifiedPubs.length} papers unverified`, mark: "unclear" });

  // Evidence groups (snapshot).
  const researchItems: EvidenceItem[] = supporting.filter((m) => m.kind === "publication").slice(0, 4).map((m) => {
    const pm = pubMeta.get(m.ref_id);
    const tags = termHits(m.content, [...facets.topics, ...facets.disease, ...facets.methods]);
    const ident = pm?.identity_method === "orcid" ? "ORCID-linked" : pm?.identity_method === "profiles" ? "Listed on UCSF Profiles" : pm?.identity_method === "manual" ? "Confirmed by you" : `Affiliation-matched${p.home_department ? ` (UCSF ${p.home_department})` : ""}`;
    return { id: `publication:${m.ref_id}`, heading: pm?.title ?? m.content, sub: [pm?.journal, pm?.publication_date ? fmtMonYear(pm.publication_date) : m.year ? String(m.year) : null].filter(Boolean).join(" · "), link: { label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${m.ref_id}/` }, tags: tags.length ? tags.join(", ") : null, identity: { text: ident, kind: "ok" }, publicationId: pm?.id ?? null, similarity: m.similarity };
  });
  for (const u of unverifiedPubs.slice(0, 2)) {
    researchItems.push({ id: `publication:${u.pmid}`, heading: u.title ?? `PMID ${u.pmid}`, sub: [u.journal, u.publication_date?.slice(0, 4)].filter(Boolean).join(" · "), link: { label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${u.pmid}/` }, tags: "—", identity: { text: "Name-only match · not used in reasons", kind: "warn" }, publicationId: u.id });
  }
  const fundingItems: EvidenceItem[] = input.grants.slice(0, 3).map((g) => {
    const end = g.raw_json?.project_end_date?.slice(0, 10) ?? null;
    const start = g.raw_json?.project_start_date?.slice(0, 10) ?? null;
    const code = grantCode(g.project_num) ?? "award";
    const active = end ? end >= now.toISOString().slice(0, 10) : (g.fiscal_year ?? 0) >= now.getUTCFullYear() - 1;
    const m = matches.find((x) => x.kind === "grant" && x.ref_id === g.project_num);
    return {
      id: `grant:${g.project_num}`,
      heading: `${g.project_num.replace(/^\d/, "").replace(/-.*$/, "")} · ${g.project_title ?? "Untitled project"}`,
      sub: [shortIc(g.ic_name), start && end ? `${start.slice(0, 4)}–${end.slice(0, 4)}` : g.fiscal_year ? `FY ${g.fiscal_year}` : null, "PI"].filter(Boolean).join(" · "),
      link: { label: "RePORTER", href: `https://reporter.nih.gov/search/results?projects=${encodeURIComponent(g.project_num)}` },
      tags: m ? termHits(m.content, [...facets.topics, ...facets.disease]).join(", ") || null : null,
      inferred: `${active ? "Holds an active" : "Held a"} ${code} as PI → mechanism experience: ${mechanismYes ? "yes" : "partial"}.${end && monthsSince(end, now) >= -6 && monthsSince(end, now) <= 0 ? ` Ends ${fmtMonYear(end)} → renewal likely in the next 6 months.` : ""}`,
      similarity: m?.similarity ?? null,
    };
  });
  const selfItems: EvidenceItem[] = [];
  if (bio?.state === "on_file" && bio.personal_statement) selfItems.push({ id: "biosketch:biosketch", heading: "Personal statement", sub: `Biosketch dated ${bio.document_date ? fmtMonYear(bio.document_date) : "—"}${bio.authorized_at ? ` · authorized ${fmtMonYear(bio.authorized_at)}` : ""}`, quote: bio.personal_statement.slice(0, 400), inferred: bioMatch && bioMatch.similarity >= SIM.support ? "Self-described focus overlaps the notice’s topics." : null });
  if (prof?.state === "available") {
    const kw = ((prof.meta?.keywords as string[] | undefined) ?? []).slice(0, 6);
    if (kw.length) selfItems.push({ id: "profile:profiles", heading: "Research interests (institutional profile)", sub: `UCSF Profiles${prof.last_refreshed_at ? ` · refreshed ${fmtMonYear(prof.last_refreshed_at)}` : ""}`, tags: kw.join(", ") });
  }
  const addedVia = typeof p.raw_profile_json?.source === "string" ? ({ signal: "Signal sync", manual_entry: "manual entry", csv: "CSV import" } as Record<string, string>)[p.raw_profile_json.source as string] ?? null : null;
  const institutionalItems: EvidenceItem[] = [{ id: "roster", heading: [p.home_department, title ?? "rank not on file", input.communityLabel].filter(Boolean).join(" · "), sub: `Added ${fmtMonYear(p.created_at)}${addedVia ? ` via ${addedVia}` : ""}`, inferred: elig.mark === "unclear" ? "Appointment type unknown → eligibility unclear." : null }];
  const historyItems: EvidenceItem[] = input.history.slice(0, 4).map((h, i) => ({ id: `history:${i}`, heading: h.kind === "sent" ? `Outreach sent · ${h.notice}` : `Replied ${h.label} · ${h.notice}`, sub: `${fmtMonDYear(h.at)}${h.note ? ` · “${h.note.slice(0, 80)}”` : ""}`, inferred: h.kind === "reply" ? (/interested/i.test(h.label) ? "Positive reply to a similar notice → prior interest: yes." : /not now|declin/i.test(h.label) ? "Declined a similar notice → negative signal for this notice." : null) : "No reply is not treated as a negative signal." }));

  const groups: EvidenceGroup[] = [
    { key: "research", title: "Research alignment", meta: verifiedPubs.length ? `PubMed · ${supporting.filter((m) => m.kind === "publication").length} of ${verifiedPubs.length} publications relevant` : "PubMed", items: researchItems, empty: byKind.get("pubmed")?.last_refreshed_at ? "No publication clears the relevance bar." : "Not yet fetched.", action: byKind.get("pubmed")?.last_refreshed_at ? null : { kind: "fetch_pubmed", label: "Fetch PubMed" } },
    { key: "funding", title: "Funding alignment", meta: "NIH RePORTER · matched by profile ID", items: fundingItems, empty: byKind.get("reporter")?.identity_method ? "No NIH projects on record." : "No RePORTER profile ID on file, so awards could not be matched.", action: byKind.get("reporter")?.identity_method ? null : { kind: "add_profile_id", label: "Add profile ID" } },
    { key: "self", title: "Self-described expertise", meta: bio?.state === "on_file" ? `Biosketch · document dated ${bio.document_date ? fmtMonYear(bio.document_date) : "—"}` : "Biosketch", items: selfItems, empty: bio?.state === "declined" ? "Biosketch not authorized for Prospera use." : "No biosketch on file. Missing biosketches never lower the tier.", action: bio?.state === "on_file" || bio?.state === "declined" ? null : { kind: "request_biosketch", label: bio?.state === "requested" ? "Send reminder" : "Request biosketch" } },
    { key: "institutional", title: "Institutional alignment", meta: "Directory · roster", items: institutionalItems },
    { key: "history", title: "Prior engagement", meta: "Prospera history", items: historyItems, empty: `No previous outreach or suggestions for Dr. ${lastName(p)}. New to you.` },
  ];

  const identityLine = byKind.get("reporter")?.identity_method === "profile_id" && verifiedPubs.length ? "confirmed (profile ID + affiliation)" : verifiedPubs.some((x) => x.identity_method === "orcid") ? "confirmed (ORCID)" : verifiedPubs.length ? "confirmed (affiliation)" : byKind.get("reporter")?.identity_method === "profile_id" ? "confirmed (profile ID)" : unverifiedPubs.length ? `unverified (${unverifiedPubs.length} name-only)` : "not checked";
  const freshWarn = !refreshed || (staleMonths ?? 0) >= 12;
  const freshLine = !refreshed ? `Never refreshed · added ${fmtMonYear(p.created_at)}` : (staleMonths ?? 0) >= 12 ? `Stale · profile is ${staleMonths} months old` : `Refreshed ${fmtMonD(refreshed)}`;
  const historyLine = lastSent ? `Contacted ${fmtMonD(lastSent.at)} · ${lastSent.notice} · ${reply ? `replied ${reply.label}` : "no reply"}` : reply ? `Replied ${reply.label} · ${reply.notice} · ${fmtMonYear(reply.at)}` : null;
  const historyKind: "good" | "warn" | null = historyLine ? (reply && /interested/i.test(reply.label) ? "good" : "warn") : null;

  const themes = [topicHits[0], diseaseHits.find((d) => d !== "any"), methodHits[0]].filter(Boolean).join(", ");
  const summary = [
    reasons[0] ? reasons[0].text : null,
    grantRow ? `${grantRow.project_title ? `An ${grantCode(grantRow.project_num) ?? "NIH"} award on ${grantRow.project_title.toLowerCase().replace(/\.$/, "")} ` : ""}${mechanismYes ? "shows mechanism experience." : "is on record."}` : "No NIH award is on record; evidence rests on publications and profile text.",
    flags[0] ? flags[0].text.split(". ")[0] + "." : themes ? `Overlap is on ${themes}.` : null,
  ].filter(Boolean).join(" ");

  return { investigatorId: p.id, tier, coverage, score, flags, reasons, checklist, groups, identityLine, freshLine, freshWarn, historyLine, historyKind, isNew: input.history.length === 0, excludedReason, summary };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type SuggestionRun = { ok: true; suggested: number; excluded: number; communities: number; profile: OpportunityProfile } | { ok: false; error: string };

export async function runSuggestions(db: SupabaseClient, itemId: string, actor?: { id: string | null; name: string }): Promise<SuggestionRun> {
  const { data: item } = await db.from("outreach_items").select("id, team_id, opportunity_id, profile, profile_version, suggestion_options").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, error: "Outreach item not found." };
  const it = item as { id: string; team_id: string; opportunity_id: string; profile: unknown; profile_version: number; suggestion_options: Partial<SuggestionOptions> | null };
  const opts: SuggestionOptions = { ...DEFAULT_SUGGESTION_OPTIONS, ...(it.suggestion_options ?? {}) };
  await db.from("outreach_items").update({ suggestions_state: "loading", suggestions_error: null }).eq("id", itemId);

  try {
    const { data: notice } = await db.from("funding_opportunities").select("id, title, opportunity_number, agency, description, raw_payload_json, activity_code, activity_title, award_ceiling, clinical_trial_note, applicant_types, funding_instrument, updated_at").eq("id", it.opportunity_id).maybeSingle();
    if (!notice) throw new Error("Notice not found.");
    const n = notice as NoticeForProfile & { updated_at: string };

    let profile = parseProfile(it.profile);
    if (profileIsEmpty(profile)) {
      profile = await extractOpportunityProfile(db, n, it.profile_version);
      await db.from("outreach_items").update({ profile, profile_version: profile.version }).eq("id", itemId);
    }

    const query = await embedText(profileQueryText(profile, n));
    const { data: matchRows, error: matchErr } = await db.rpc("match_evidence", { query_embedding: toVector(query), match_count: MATCH_ROWS, min_similarity: SIM.exploratory - 0.06 });
    if (matchErr) throw new Error(`match_evidence: ${matchErr.message}`);
    const matches = (matchRows ?? []) as MatchRow[];
    const byPerson = new Map<string, MatchRow[]>();
    for (const m of matches) byPerson.set(m.investigator_id, [...(byPerson.get(m.investigator_id) ?? []), m]);

    const [{ data: people }, { data: sourceRows }, { data: grantRows }, { data: pubRows }, { data: communities }, { data: recipients }, { data: existing }, { data: sentRows }, { data: replyRows }] = await Promise.all([
      db.from("investigators").select("id, full_name, first_name, last_name, email, home_department, division, rank, research_community_id, created_at, do_not_contact_at, raw_profile_json").is("archived_at", null),
      db.from("investigator_sources").select("investigator_id, source, state, item_count, unverified_count, identity_method, last_refreshed_at, document_date, authorized_at, personal_statement, contributions, meta"),
      db.from("investigator_nih_grants").select("investigator_id, project_num, project_title, ic_name, fiscal_year, raw_json").neq("identity_status", "rejected").order("fiscal_year", { ascending: false }),
      db.from("investigator_publications").select("id, investigator_id, pmid, title, journal, publication_date, identity_method, identity_status").neq("identity_status", "rejected"),
      db.from("pipeline_communities").select("id, label"),
      db.from("outreach_recipients").select("investigator_id, community_id, kind, status").eq("item_id", itemId).is("removed_at", null),
      db.from("outreach_suggestions").select("investigator_id, status, dismissed_reason, dismissed_by, dismissed_at").eq("item_id", itemId),
      db.from("outreach_message_recipients").select("investigator_id, sent_at, outreach_messages!inner(team_id, subject, item_id)").eq("outreach_messages.team_id", it.team_id).eq("status", "sent"),
      db.from("outreach_recipients").select("investigator_id, status, replied_at, reply_note, outreach_items!inner(team_id, opportunity_id, funding_opportunities(opportunity_number, title))").eq("outreach_items.team_id", it.team_id).like("status", "replied_%"),
    ]);

    const communityLabel = new Map(((communities ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]));
    const taggedCommunities = new Set(((recipients ?? []) as Array<{ kind: string; community_id: string | null }>).filter((r) => r.kind === "community" && r.community_id).map((r) => r.community_id as string));
    const addedPeople = new Set(((recipients ?? []) as Array<{ kind: string; investigator_id: string | null }>).filter((r) => r.kind === "person" && r.investigator_id).map((r) => r.investigator_id as string));
    const prior = new Map(((existing ?? []) as Array<{ investigator_id: string; status: string; dismissed_reason: string | null; dismissed_by: string | null; dismissed_at: string | null }>).map((e) => [e.investigator_id, e]));

    const history = new Map<string, HistoryRow[]>();
    for (const s of (sentRows ?? []) as Array<{ investigator_id: string | null; sent_at: string | null; outreach_messages: { subject: string; item_id: string } | { subject: string; item_id: string }[] }>) {
      if (!s.investigator_id || !s.sent_at) continue;
      const m = Array.isArray(s.outreach_messages) ? s.outreach_messages[0] : s.outreach_messages;
      history.set(s.investigator_id, [...(history.get(s.investigator_id) ?? []), { investigator_id: s.investigator_id, kind: "sent", at: s.sent_at, label: "sent", notice: (m?.subject ?? "outreach").replace(/^Funding opportunity:\s*/i, "").slice(0, 70), note: null }]);
    }
    for (const r of (replyRows ?? []) as Array<{ investigator_id: string | null; status: string; replied_at: string | null; reply_note: string | null; outreach_items: { funding_opportunities: { opportunity_number: string | null; title: string | null } | Array<{ opportunity_number: string | null; title: string | null }> | null } | Array<{ funding_opportunities: unknown }> }>) {
      if (!r.investigator_id || !r.replied_at) continue;
      const oi = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
      const fo = oi && "funding_opportunities" in oi ? (Array.isArray(oi.funding_opportunities) ? oi.funding_opportunities[0] : oi.funding_opportunities) as { opportunity_number: string | null; title: string | null } | null : null;
      const label = r.status === "replied_interested" ? "Interested" : r.status === "replied_maybe" ? "Maybe" : "Not now";
      history.set(r.investigator_id, [...(history.get(r.investigator_id) ?? []), { investigator_id: r.investigator_id, kind: "reply", at: r.replied_at, label, notice: fo?.opportunity_number ?? fo?.title?.slice(0, 60) ?? "a notice", note: r.reply_note }]);
    }

    const sourcesBy = new Map<string, SourceRow[]>();
    for (const s of (sourceRows ?? []) as SourceRow[]) sourcesBy.set(s.investigator_id, [...(sourcesBy.get(s.investigator_id) ?? []), s]);
    const grantsBy = new Map<string, GrantRow[]>();
    for (const g of (grantRows ?? []) as GrantRow[]) grantsBy.set(g.investigator_id, [...(grantsBy.get(g.investigator_id) ?? []), g]);
    const pubsBy = new Map<string, PubRow[]>();
    for (const x of (pubRows ?? []) as PubRow[]) pubsBy.set(x.investigator_id, [...(pubsBy.get(x.investigator_id) ?? []), x]);

    const now = new Date();
    const computed: SuggestionComputed[] = [];
    for (const p of (people ?? []) as Person[]) {
      const s = computeSuggestion({
        person: p,
        profile,
        opts,
        matches: byPerson.get(p.id) ?? [],
        sources: sourcesBy.get(p.id) ?? [],
        grants: grantsBy.get(p.id) ?? [],
        pubs: pubsBy.get(p.id) ?? [],
        history: (history.get(p.id) ?? []).sort((a, b) => (a.at < b.at ? 1 : -1)),
        communityLabel: p.research_community_id ? communityLabel.get(p.research_community_id) ?? null : null,
        communityTagged: Boolean(p.research_community_id && taggedCommunities.has(p.research_community_id)),
        now,
      });
      if (s) computed.push(s);
    }
    computed.sort((a, b) => b.score - a.score);

    // Persist: keep what a person decided (dismissed / added), refresh the rest.
    const rows = computed.map((s) => {
      const prev = prior.get(s.investigatorId);
      const status = addedPeople.has(s.investigatorId) ? "added" : prev?.status === "dismissed" ? "dismissed" : s.excludedReason ? "excluded" : "active";
      return {
        item_id: itemId,
        investigator_id: s.investigatorId,
        tier: s.tier,
        coverage: s.coverage,
        score: s.score,
        flags: s.flags,
        reasons: s.reasons,
        checklist: s.checklist,
        evidence: { groups: s.groups },
        summary: s.summary,
        identity_line: s.identityLine,
        fresh_line: s.freshLine,
        fresh_warn: s.freshWarn,
        history_line: s.historyLine,
        history_kind: s.historyKind,
        is_new: s.isNew,
        status,
        excluded_reason: s.excludedReason,
        dismissed_reason: prev?.status === "dismissed" ? prev.dismissed_reason : null,
        dismissed_by: prev?.status === "dismissed" ? prev.dismissed_by : null,
        dismissed_at: prev?.status === "dismissed" ? prev.dismissed_at : null,
        snapshot_at: now.toISOString(),
        profile_version: profile.version,
      };
    });
    const keep = new Set(rows.map((r) => r.investigator_id));
    const dropIds = Array.from(prior.entries()).filter(([id, e]) => !keep.has(id) && e.status !== "dismissed" && e.status !== "added").map(([id]) => id);
    if (dropIds.length) await db.from("outreach_suggestions").delete().eq("item_id", itemId).in("investigator_id", dropIds);
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("outreach_suggestions").upsert(rows.slice(i, i + 100), { onConflict: "item_id,investigator_id" });
      if (error) throw new Error(`outreach_suggestions: ${error.message}`);
    }

    // Communities: evaluated from member matches (curated profiles arrive with the Communities screen).
    const memberTotals = new Map<string, number>();
    for (const p of (people ?? []) as Person[]) if (p.research_community_id) memberTotals.set(p.research_community_id, (memberTotals.get(p.research_community_id) ?? 0) + 1);
    const personById = new Map(((people ?? []) as Person[]).map((p) => [p.id, p]));
    const evals = ((communities ?? []) as Array<{ id: string; label: string }>).map((c) => {
      const members = computed.filter((s) => personById.get(s.investigatorId)?.research_community_id === c.id && !s.excludedReason);
      const strong = members.filter((s) => s.tier === "strong").length;
      const potential = members.filter((s) => s.tier === "potential").length;
      const total = memberTotals.get(c.id) ?? 0;
      const align = Array.from(new Set(members.flatMap((s) => s.checklist.filter((k) => k.mark === "yes" && ["Topics", "Disease", "Methods"].includes(k.facet)).flatMap((k) => k.value.split(", "))))).filter((v) => v && !/^(any|—|no overlap|none)/i.test(v)).slice(0, 3);
      let tier: "strong" | "potential" | "not_suggested" | "cant_evaluate";
      if (total === 0) tier = "cant_evaluate";
      else if (strong >= 2 || (strong >= 1 && potential >= 2)) tier = "strong";
      else if (strong + potential >= 1) tier = "potential";
      else tier = "not_suggested";
      const reason = total === 0
        ? "No roster on file for this community, so relevance couldn’t be judged."
        : `${strong + potential} of ${total} member${total === 1 ? " is" : "s are"} strong or potential matches. No curated focus is on file yet, so this is evaluated from member matches only.`;
      return { item_id: itemId, community_id: c.id, tier, reason, alignment: align, member_matches: strong + potential, member_total: total, evaluated_at: now.toISOString() };
    });
    if (evals.length) {
      const { data: prevEvals } = await db.from("outreach_community_evaluations").select("community_id, dismissed_at, dismissed_by").eq("item_id", itemId);
      const prevBy = new Map(((prevEvals ?? []) as Array<{ community_id: string; dismissed_at: string | null; dismissed_by: string | null }>).map((e) => [e.community_id, e]));
      const { error } = await db.from("outreach_community_evaluations").upsert(evals.map((e) => ({ ...e, dismissed_at: prevBy.get(e.community_id)?.dismissed_at ?? null, dismissed_by: prevBy.get(e.community_id)?.dismissed_by ?? null })), { onConflict: "item_id,community_id" });
      if (error) throw new Error(`outreach_community_evaluations: ${error.message}`);
    }

    const suggested = rows.filter((r) => r.status === "active" && r.tier !== "exploratory").length;
    const excluded = rows.filter((r) => r.status === "excluded").length;
    const suggestedCommunities = evals.filter((e) => e.tier === "strong" || e.tier === "potential").length;
    await db.from("outreach_items").update({ suggestions_state: "ready", suggestions_error: null, suggestions_generated_at: now.toISOString(), suggestions_profile_version: profile.version, notice_version_seen: n.updated_at, suggestion_options: opts }).eq("id", itemId);
    await db.from("outreach_activity").insert({
      item_id: itemId,
      team_id: it.team_id,
      actor_id: actor?.id ?? null,
      actor_name: "Prospera",
      kind: "suggestions_generated",
      text: `evaluated ${evals.length} monitored communit${evals.length === 1 ? "y" : "ies"} and ranked ${(people ?? []).length} profiles · ${suggestedCommunities} communit${suggestedCommunities === 1 ? "y" : "ies"} and ${suggested} people suggested, ${excluded} excluded by eligibility or options`,
      payload: { suggested, excluded, communities: suggestedCommunities, profile_version: profile.version, requested_by: actor?.name ?? null },
    });
    return { ok: true, suggested, excluded, communities: suggestedCommunities, profile };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("outreach_items").update({ suggestions_state: "error", suggestions_error: message }).eq("id", itemId);
    return { ok: false, error: message };
  }
}

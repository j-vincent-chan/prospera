/**
 * FitResult → the Outreach suggestion snapshot (plan § PR 2.2: "runSuggestions
 * maps FitResult into the existing outreach_suggestions snapshot shape so the
 * UI keeps working"). Pure. Under `fit_engine = 'fit-v1'` the runner reads
 * `fit_results` for the notice and builds one snapshot per scored person
 * through this module instead of `computeSuggestion`; the legacy path is
 * untouched.
 *
 * Tier: Strong → strong, Moderate → potential, Exploratory → exploratory. A
 * Poor pair is not surfaced (null) — the way a below-bar person is not under
 * legacy. Eligibility is its own pass: an ineligible pair (E = 0) has no
 * `fit_results` row at all, so the runner lists every ineligible person from
 * a pure `eligibility()` pass over the stored profiles (retrieval.ts
 * `ineligibleForNotice`) and writes each as `excluded` with the failed rule
 * through `snapshotForIneligible` — the legacy engine's own eligibility
 * semantics, so the "excluded" count and the excluded list keep their
 * meaning. The Outreach options (recently contacted, early-career only,
 * renewals due) and do-not-contact apply exactly as under legacy on both
 * paths: the same helper decides them.
 *
 * Reasons cite the engine's rationale and gap sentence with the evidence
 * ids stage 5 credited; the checklist rows are the components; the evidence
 * groups keep the legacy keys (research, funding, self, institutional,
 * history) so the "Why this suggestion" view renders unchanged.
 */
import { fmtMonD, fmtMonDYear, fmtMonYear, monthsSince, shortIc } from "@/lib/investigators/sources";
import { grantCode } from "@/lib/community/reporter-fields";
import type { SuggestionComputed } from "@/lib/outreach/suggest";
import { coverageOf, eligibility as legacyEligibility, personTitle, type GrantRow, type HistoryRow, type Person, type PubRow, type SourceRow } from "@/lib/outreach/suggest-shared";
import type { ChecklistMark, ChecklistRow, EvidenceGroup, EvidenceItem, SuggestionFlag, SuggestionOptions, SuggestionReason, SuggestionTier } from "@/lib/outreach/types";
import { suggestionTierOf } from "@/lib/fit/results";
import { floors } from "@/lib/fit/taxonomy";
import type { FitResult } from "@/lib/fit/types";

const RECENT_CONTACT_DAYS = 90;
const RENEWAL_WINDOW_MONTHS = 6;

/** The person-level inputs both snapshot paths share. */
export type PersonInput = {
  person: Person;
  opts: SuggestionOptions;
  sources: SourceRow[];
  grants: Array<GrantRow & { id?: string }>;
  pubs: PubRow[];
  history: HistoryRow[];
  communityLabel: string | null;
  now: Date;
};

export type SnapshotInput = PersonInput & { result: FitResult };

/** An investigator the eligibility pass excluded: the failed rules, no FitResult. */
export type IneligibleInput = PersonInput & { failed: string[] };

const TIER_TITLE: Record<SuggestionTier, string> = { strong: "Strong fit", potential: "Moderate fit", exploratory: "Exploratory fit" };

const pct = (n: number) => n.toFixed(2);

/** `publication:<investigator>:<pmid>` → `publication:<pmid>`, `grant:<row id>` → `grant:<project number>`, `trial:<investigator>:<nct>` → `trial:<nct>`; anything else as is. */
export function legacyEvidenceId(id: string, grantProjectNumbers: ReadonlyMap<string, string>): string {
  const parts = id.split(":");
  if (parts[0] === "publication" && parts.length >= 3) return `publication:${parts[parts.length - 1]}`;
  if (parts[0] === "trial" && parts.length >= 3) return `trial:${parts[parts.length - 1]}`;
  if (parts[0] === "grant" && parts.length >= 2) {
    const pn = grantProjectNumbers.get(parts.slice(1).join(":"));
    return pn ? `grant:${pn}` : id;
  }
  return id;
}

function mark(value: number, floor: number | undefined): ChecklistMark {
  if (floor === undefined) return value > 0 ? "yes" : "unclear";
  return value >= floor ? "yes" : "no";
}

/** The "Not eligible" reason the excluded list shows: the failed rules, joined. */
export const notEligibleReason = (failed: readonly string[]) => `Not eligible: ${failed.join("; ")}`;

/** Everything about the person that does not depend on the fit result: the option rule, staleness, the identity / freshness / history lines and the non-research evidence items. */
type PersonParts = {
  title: string | null;
  byKind: Map<string, SourceRow>;
  /** The legacy option rule and do-not-contact, applied in the legacy order on top of `first` (the engine's own exclusion, if any). */
  excludedReason: (first: string | null) => string | null;
  staleFlag: SuggestionFlag | null;
  lastSent: HistoryRow | null;
  identityLine: string;
  freshLine: string;
  freshWarn: boolean;
  historyLine: string | null;
  historyKind: "good" | "warn" | null;
  verifiedPubs: PubRow[];
  grantProjectNumbers: Map<string, string>;
  fundingItems: (inferred: (active: boolean, code: string) => string) => EvidenceItem[];
  selfItems: EvidenceItem[];
  institutionalItems: (inferred: string | null) => EvidenceItem[];
  historyItems: EvidenceItem[];
  fundingGroup: (items: EvidenceItem[]) => EvidenceGroup;
  selfGroup: EvidenceGroup;
  institutionalGroup: (items: EvidenceItem[]) => EvidenceGroup;
  historyGroup: EvidenceGroup;
  coverage: SuggestionComputed["coverage"];
};

function personParts(input: PersonInput): PersonParts {
  const { person: p, opts, now } = input;
  const byKind = new Map(input.sources.map((s) => [s.source, s]));
  const title = personTitle(p, byKind.get("profiles"));

  // Options and do-not-contact: the legacy rule, so both engines exclude the same people.
  const option = legacyEligibility([], title, opts);
  const lastSent = input.history.filter((h) => h.kind === "sent").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const daysSinceContact = lastSent ? Math.floor((now.getTime() - new Date(lastSent.at).getTime()) / 86_400_000) : null;
  const excludedReason = (first: string | null): string | null => {
    let reason: string | null = first ?? option.excludedReason;
    if (!reason && opts.excludeRecentlyContacted && daysSinceContact != null && daysSinceContact <= RECENT_CONTACT_DAYS) reason = `Contacted ${daysSinceContact} days ago (option: exclude people contacted in the last 90 days)`;
    if (!reason && opts.excludeRenewalsDue) {
      const soon = input.grants.find((g) => g.raw_json?.project_end_date && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) >= -RENEWAL_WINDOW_MONTHS && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) <= 0);
      if (soon) reason = `${soon.project_num} ends within 6 months (option: exclude renewals due)`;
    }
    if (p.do_not_contact_at) reason = "Do not contact";
    return reason;
  };

  const refreshed = input.sources.map((s) => s.last_refreshed_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null;
  const staleMonths = refreshed ? monthsSince(refreshed, now) : null;
  const staleFlag: SuggestionFlag | null = staleMonths != null && staleMonths >= 12 ? { kind: "stale", text: `Stale profile: last refreshed ${fmtMonYear(refreshed!)}.` } : null;

  const grantProjectNumbers = new Map<string, string>();
  for (const g of input.grants) if (g.id) grantProjectNumbers.set(g.id, g.project_num);

  const fundingItems = (inferred: (active: boolean, code: string) => string): EvidenceItem[] =>
    input.grants.slice(0, 3).map((g) => {
      const end = g.raw_json?.project_end_date?.slice(0, 10) ?? null;
      const start = g.raw_json?.project_start_date?.slice(0, 10) ?? null;
      const code = grantCode(g.project_num) ?? "award";
      const active = end ? end >= now.toISOString().slice(0, 10) : (g.fiscal_year ?? 0) >= now.getUTCFullYear() - 1;
      return {
        id: `grant:${g.project_num}`,
        heading: `${g.project_num.replace(/^\d/, "").replace(/-.*$/, "")} · ${g.project_title ?? "Untitled project"}`,
        sub: [shortIc(g.ic_name), start && end ? `${start.slice(0, 4)}–${end.slice(0, 4)}` : g.fiscal_year ? `FY ${g.fiscal_year}` : null, "PI"].filter(Boolean).join(" · "),
        link: { label: "RePORTER", href: `https://reporter.nih.gov/search/results?projects=${encodeURIComponent(g.project_num)}` },
        inferred: inferred(active, code),
        similarity: null,
      };
    });
  const bio = byKind.get("biosketch");
  const prof = byKind.get("profiles");
  const selfItems: EvidenceItem[] = [];
  if (bio?.state === "on_file" && bio.personal_statement) selfItems.push({ id: "biosketch:biosketch", heading: "Personal statement", sub: `Biosketch dated ${bio.document_date ? fmtMonYear(bio.document_date) : "—"}${bio.authorized_at ? ` · authorized ${fmtMonYear(bio.authorized_at)}` : ""}`, quote: bio.personal_statement.slice(0, 400) });
  if (prof?.state === "available") {
    const kw = ((prof.meta?.keywords as string[] | undefined) ?? []).slice(0, 6);
    if (kw.length) selfItems.push({ id: "profile:profiles", heading: "Research interests (institutional profile)", sub: `UCSF Profiles${prof.last_refreshed_at ? ` · refreshed ${fmtMonYear(prof.last_refreshed_at)}` : ""}`, tags: kw.join(", ") });
  }
  const institutionalItems = (inferred: string | null): EvidenceItem[] => [{ id: "roster", heading: [p.home_department, title ?? "rank not on file", input.communityLabel].filter(Boolean).join(" · "), sub: `Added ${fmtMonYear(p.created_at)}`, inferred }];
  const historyItems: EvidenceItem[] = input.history.slice(0, 4).map((h, i) => ({ id: `history:${i}`, heading: h.kind === "sent" ? `Outreach sent · ${h.notice}` : `Replied ${h.label} · ${h.notice}`, sub: `${fmtMonDYear(h.at)}${h.note ? ` · “${h.note.slice(0, 80)}”` : ""}`, inferred: h.kind === "reply" ? (/interested/i.test(h.label) ? "Positive reply to a similar notice → prior interest: yes." : /not now|declin/i.test(h.label) ? "Declined a similar notice → negative signal for this notice." : null) : "No reply is not treated as a negative signal." }));
  const verifiedPubs = input.pubs.filter((x) => x.identity_status === "verified");
  const reporter = byKind.get("reporter");
  const fundingGroup = (items: EvidenceItem[]): EvidenceGroup => ({ key: "funding", title: "Funding alignment", meta: "NIH RePORTER · matched by profile ID", items, empty: reporter?.identity_method ? "No NIH projects on record." : "No RePORTER profile ID on file, so awards could not be matched.", action: reporter?.identity_method ? null : { kind: "add_profile_id", label: "Add profile ID" } });
  const selfGroup: EvidenceGroup = { key: "self", title: "Self-described expertise", meta: bio?.state === "on_file" ? `Biosketch · document dated ${bio.document_date ? fmtMonYear(bio.document_date) : "—"}` : "Biosketch", items: selfItems, empty: bio?.state === "declined" ? "Biosketch not authorized for Prospera use." : "No biosketch on file. Missing biosketches never lower the tier.", action: bio?.state === "on_file" || bio?.state === "declined" ? null : { kind: "request_biosketch", label: bio?.state === "requested" ? "Send reminder" : "Request biosketch" } };
  const institutionalGroup = (items: EvidenceItem[]): EvidenceGroup => ({ key: "institutional", title: "Institutional alignment", meta: "Directory · roster", items });
  const historyGroup: EvidenceGroup = { key: "history", title: "Prior engagement", meta: "Prospera history", items: historyItems, empty: `No previous outreach or suggestions for Dr. ${p.last_name?.trim() || p.full_name.trim().split(/\s+/).slice(-1)[0] || p.full_name}. New to you.` };

  const unverifiedPubs = input.pubs.filter((x) => x.identity_status === "unverified");
  const identityLine = reporter?.identity_method === "profile_id" && verifiedPubs.length ? "confirmed (profile ID + affiliation)" : verifiedPubs.some((x) => x.identity_method === "orcid") ? "confirmed (ORCID)" : verifiedPubs.length ? "confirmed (affiliation)" : reporter?.identity_method === "profile_id" ? "confirmed (profile ID)" : unverifiedPubs.length ? `unverified (${unverifiedPubs.length} name-only)` : "not checked";
  const freshWarn = !refreshed || (staleMonths ?? 0) >= 12;
  const freshLine = !refreshed ? `Never refreshed · added ${fmtMonYear(p.created_at)}` : (staleMonths ?? 0) >= 12 ? `Stale · profile is ${staleMonths} months old` : `Refreshed ${fmtMonD(refreshed)}`;
  const reply = input.history.filter((h) => h.kind === "reply").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const historyLine = lastSent ? `Contacted ${fmtMonD(lastSent.at)} · ${lastSent.notice} · ${reply ? `replied ${reply.label}` : "no reply"}` : reply ? `Replied ${reply.label} · ${reply.notice} · ${fmtMonYear(reply.at)}` : null;
  const historyKind: "good" | "warn" | null = historyLine ? (reply && /interested/i.test(reply.label) ? "good" : "warn") : null;

  return { title, byKind, excludedReason, staleFlag, lastSent, identityLine, freshLine, freshWarn, historyLine, historyKind, verifiedPubs, grantProjectNumbers, fundingItems, selfItems, institutionalItems, historyItems, fundingGroup, selfGroup, institutionalGroup, historyGroup, coverage: coverageOf(input.sources, Boolean(p.research_community_id)) };
}

/** Pure. One snapshot per scored pair; null when the pair is not surfaced (Poor). */
export function snapshotFromFitResult(input: SnapshotInput): SuggestionComputed | null {
  const { person: p, result: r } = input;
  const tier = suggestionTierOf(r.tier);
  if (tier === null) return null;
  const parts = personParts(input);
  const moderate = floors("moderate");
  const excludedReason = parts.excludedReason(null);

  // Flags from the engine's caps and provenance, plus the legacy staleness check.
  const flags: SuggestionFlag[] = [];
  if (r.provenance.E.unknown.length) flags.push({ kind: "eligibility", text: `Eligibility unclear: ${r.provenance.E.unknown.join("; ")}. Capped at Potential match until confirmed.` });
  if (r.provenance.P.excluded_hit) flags.push({ kind: "conflict", text: `The notice excludes the dominant paradigm (${r.provenance.P.excluded_hit.replace(/_/g, " ")}). Aims would need reframing.` });
  else if (r.provenance.D.dominant_prohibited) flags.push({ kind: "conflict", text: `The notice prohibits the dominant study design (${r.provenance.D.dominant_prohibited.replace(/_/g, " ")}).` });
  if (r.caps.includes("low_profile_confidence")) flags.push({ kind: "limited", text: "Limited data: the fit profile is low-confidence or still partly unclassified. Capped at Potential match." });
  if (r.caps.includes("low_notice_confidence")) flags.push({ kind: "limited", text: "Limited data: the notice profile is low-confidence or incomplete. Capped at Potential match." });
  if (r.caps.includes("readiness_far")) flags.push({ kind: "limited", text: "Mechanism far above the investigator's readiness — consider as project lead, not PI. Capped at Potential match." });
  if (r.caps.includes("runway_short")) flags.push({ kind: "limited", text: "Runway is short for an application at this scale. Capped at Potential match." });
  if (parts.staleFlag) flags.push(parts.staleFlag);

  // Reasons: the rationale with the evidence stage 5 credited, the gap sentence, the mechanism line.
  const topIds = r.provenance.T.top_items.map((id) => legacyEvidenceId(id, parts.grantProjectNumbers));
  const reasons: SuggestionReason[] = [];
  if (r.rationale) reasons.push({ text: r.rationale, source: "Fit engine · paradigm, design, topic", title: TIER_TITLE[tier], evidenceIds: topIds });
  if (r.gap) reasons.push({ text: r.gap, source: "Fit engine · gap", title: "What would move this up", evidenceIds: [] });
  const held = r.provenance.K.mechanisms_held;
  if (held.length) reasons.push({ text: `Has held ${held.slice(0, 4).join(", ")} as PI${r.provenance.K.activity_code ? `; this notice is ${/^[AEFHILMNORSX]/i.test(r.provenance.K.activity_code) ? "an" : "a"} ${r.provenance.K.activity_code}` : ""}.`, source: "RePORTER · mechanisms held", title: "Track record", evidenceIds: [] });
  if (!reasons.length) reasons.push({ text: r.why_not ?? "No component carried a rationale.", source: "Fit engine", title: TIER_TITLE[tier], evidenceIds: [] });

  // Checklist: one row per gate or score, marked against the Moderate floors.
  const c = r.components;
  const bestP = r.provenance.P.best_pair;
  const bestU = r.provenance.U.best_pair;
  const coded = r.provenance.T.coded_matches;
  const checklist: ChecklistRow[] = [
    { facet: "Paradigm", value: `${pct(c.P)}${bestP ? ` · ${bestP.investigator.replace(/_/g, " ")} vs ${bestP.notice.replace(/_/g, " ")}` : ""}${r.provenance.P.exception ? ` · ${r.provenance.P.exception.replace(/_/g, " ")}` : ""}`, mark: mark(c.P, moderate.P) },
    { facet: "Unit", value: `${pct(c.U)}${bestU ? ` · ${bestU.investigator} vs ${bestU.notice}` : ""}`, mark: mark(c.U, moderate.U) },
    { facet: "Design", value: r.provenance.D.unmet_required.length ? `${pct(c.D)} · required design unsupported: ${r.provenance.D.unmet_required.map((g) => g.join(" / ")).join("; ")}` : pct(c.D), mark: r.provenance.D.unmet_required.length ? "no" : mark(c.D, moderate.D) },
    { facet: "Topic", value: `${pct(c.T)}${coded.length ? ` · ${coded.length} coded match${coded.length === 1 ? "" : "es"} (depth ${Math.max(...coded.map((m) => m.depth))})` : " · no coded match"}`, mark: mark(c.T, moderate.T) },
    { facet: "Methods", value: r.provenance.M.missing.length ? `${pct(c.M)} · missing ${r.provenance.M.missing.slice(0, 3).join(", ")}` : `${pct(c.M)}${r.provenance.M.met.length ? ` · ${r.provenance.M.met.slice(0, 3).join(", ")}` : ""}`, mark: mark(c.M, moderate.M) },
    { facet: "Mechanism", value: held.length ? `${pct(c.K)} · ${held.slice(0, 3).join(", ")} on record` : `${pct(c.K)} · no NIH award on record`, mark: mark(c.K, moderate.K) },
    { facet: "Eligibility", value: r.provenance.E.unknown.length ? r.provenance.E.unknown.join("; ") : "no rule failed", mark: r.provenance.E.unknown.length ? "unclear" : "yes" },
    r.provenance.P.excluded_hit || r.provenance.D.dominant_prohibited
      ? { facet: "Exclusions", value: `notice excludes ${(r.provenance.P.excluded_hit ?? r.provenance.D.dominant_prohibited ?? "").replace(/_/g, " ")}`, mark: "conflict" }
      : { facet: "Exclusions", value: "none hit", mark: "yes" },
  ];

  // Evidence groups (snapshot).
  const pubMeta = new Map(input.pubs.map((x) => [x.pmid, x]));
  const researchItems: EvidenceItem[] = [];
  for (const id of topIds.slice(0, 4)) {
    const [kind, ref] = id.split(":");
    if (kind !== "publication" || !ref) continue;
    const pm = pubMeta.get(ref);
    const ident = pm?.identity_method === "orcid" ? "ORCID-linked" : pm?.identity_method === "profiles" ? "Listed on UCSF Profiles" : pm?.identity_method === "manual" ? "Confirmed by you" : "Affiliation-matched";
    researchItems.push({ id, heading: pm?.title ?? `PMID ${ref}`, sub: [pm?.journal, pm?.publication_date ? fmtMonYear(pm.publication_date) : null].filter(Boolean).join(" · "), link: { label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${ref}/` }, tags: "carried the topic score", identity: { text: ident, kind: "ok" }, publicationId: pm?.id ?? null });
  }
  const groups: EvidenceGroup[] = [
    { key: "research", title: "Research alignment", meta: `Fit engine · topic ${pct(c.T)} over ${r.provenance.T.top_items.length} compatible item${r.provenance.T.top_items.length === 1 ? "" : "s"}`, items: researchItems, empty: parts.verifiedPubs.length ? "No compatible item carried the topic score." : "No verified publications on file." },
    parts.fundingGroup(parts.fundingItems((active, code) => `${active ? `Holds an active ${code}` : `Held a ${code}`} as PI → track record ${pct(c.K)}.`)),
    parts.selfGroup,
    parts.institutionalGroup(parts.institutionalItems(r.provenance.E.unknown.length ? "Eligibility could not be fully checked from the profile." : null)),
    parts.historyGroup,
  ];

  const summary = [r.rationale, r.gap].filter(Boolean).join(" ");
  return { investigatorId: p.id, tier, coverage: parts.coverage, score: r.score / 100, flags, reasons, checklist, groups, identityLine: parts.identityLine, freshLine: parts.freshLine, freshWarn: parts.freshWarn, historyLine: parts.historyLine, historyKind: parts.historyKind, isNew: input.history.length === 0, excludedReason, summary, title: parts.title };
}

/** Pure. The snapshot of a person the eligibility pass excluded: written as `excluded` with the failed rules (do-not-contact still wins, as under legacy); no fit score, no research items. */
export function snapshotForIneligible(input: IneligibleInput): SuggestionComputed {
  const { person: p, failed } = input;
  const parts = personParts(input);
  const reason = notEligibleReason(failed);
  const flags: SuggestionFlag[] = [{ kind: "eligibility", text: `${reason}.` }];
  if (parts.staleFlag) flags.push(parts.staleFlag);
  const reasons: SuggestionReason[] = [{ text: reason, source: "Fit engine · eligibility", title: "Not eligible", evidenceIds: [] }];
  const checklist: ChecklistRow[] = [{ facet: "Eligibility", value: failed.join("; "), mark: "no" }];
  const groups: EvidenceGroup[] = [
    { key: "research", title: "Research alignment", meta: "Fit engine · not scored: the notice's eligibility rules exclude this person", items: [], empty: "Not scored — excluded by an eligibility rule." },
    parts.fundingGroup(parts.fundingItems((active, code) => `${active ? `Holds an active ${code}` : `Held a ${code}`} as PI.`)),
    parts.selfGroup,
    parts.institutionalGroup(parts.institutionalItems(reason)),
    parts.historyGroup,
  ];
  return { investigatorId: p.id, tier: "exploratory", coverage: parts.coverage, score: 0, flags, reasons, checklist, groups, identityLine: parts.identityLine, freshLine: parts.freshLine, freshWarn: parts.freshWarn, historyLine: parts.historyLine, historyKind: parts.historyKind, isNew: input.history.length === 0, excludedReason: parts.excludedReason(reason), summary: reason, title: parts.title };
}

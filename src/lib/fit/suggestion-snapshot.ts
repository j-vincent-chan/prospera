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
 * legacy — except when eligibility failed (E = 0): that person is written as
 * `excluded` with the failed rule, which is what the legacy engine does with
 * its own eligibility rule, so the "excluded" count and the excluded list
 * keep their meaning. The Outreach options (recently contacted, early-career
 * only, renewals due) and do-not-contact apply exactly as under legacy: the
 * same helper decides them.
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

export type SnapshotInput = {
  person: Person;
  result: FitResult;
  opts: SuggestionOptions;
  sources: SourceRow[];
  grants: Array<GrantRow & { id?: string }>;
  pubs: PubRow[];
  history: HistoryRow[];
  communityLabel: string | null;
  now: Date;
};

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

/** Pure. One snapshot per scored pair; null when the pair is not surfaced. */
export function snapshotFromFitResult(input: SnapshotInput): SuggestionComputed | null {
  const { person: p, result: r, opts, now } = input;
  const byKind = new Map(input.sources.map((s) => [s.source, s]));
  const title = personTitle(p, byKind.get("profiles"));
  const failedE = r.components.E === 0;
  const mapped = suggestionTierOf(r.tier);
  if (mapped === null && !failedE) return null;
  const tier: SuggestionTier = mapped ?? "exploratory";
  const moderate = floors("moderate");

  // Options and do-not-contact: the legacy rule, so both engines exclude the same people.
  const option = legacyEligibility([], title, opts);
  const lastSent = input.history.filter((h) => h.kind === "sent").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const daysSinceContact = lastSent ? Math.floor((now.getTime() - new Date(lastSent.at).getTime()) / 86_400_000) : null;
  let excludedReason: string | null = failedE ? `Not eligible: ${r.provenance.E.failed.join("; ")}` : option.excludedReason;
  if (!excludedReason && opts.excludeRecentlyContacted && daysSinceContact != null && daysSinceContact <= RECENT_CONTACT_DAYS) excludedReason = `Contacted ${daysSinceContact} days ago (option: exclude people contacted in the last 90 days)`;
  if (!excludedReason && opts.excludeRenewalsDue) {
    const soon = input.grants.find((g) => g.raw_json?.project_end_date && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) >= -RENEWAL_WINDOW_MONTHS && monthsSince(g.raw_json.project_end_date.slice(0, 10), now) <= 0);
    if (soon) excludedReason = `${soon.project_num} ends within 6 months (option: exclude renewals due)`;
  }
  if (p.do_not_contact_at) excludedReason = "Do not contact";

  // Flags from the engine's caps and provenance, plus the legacy staleness check.
  const flags: SuggestionFlag[] = [];
  if (r.provenance.E.unknown.length) flags.push({ kind: "eligibility", text: `Eligibility unclear: ${r.provenance.E.unknown.join("; ")}. Capped at Potential match until confirmed.` });
  if (r.provenance.P.excluded_hit) flags.push({ kind: "conflict", text: `The notice excludes the dominant paradigm (${r.provenance.P.excluded_hit.replace(/_/g, " ")}). Aims would need reframing.` });
  else if (r.provenance.D.dominant_prohibited) flags.push({ kind: "conflict", text: `The notice prohibits the dominant study design (${r.provenance.D.dominant_prohibited.replace(/_/g, " ")}).` });
  if (r.caps.includes("low_profile_confidence")) flags.push({ kind: "limited", text: "Limited data: the fit profile is low-confidence or still partly unclassified. Capped at Potential match." });
  if (r.caps.includes("low_notice_confidence")) flags.push({ kind: "limited", text: "Limited data: the notice profile is low-confidence or incomplete. Capped at Potential match." });
  if (r.caps.includes("readiness_far")) flags.push({ kind: "limited", text: "Mechanism far above the investigator's readiness — consider as project lead, not PI. Capped at Potential match." });
  if (r.caps.includes("runway_short")) flags.push({ kind: "limited", text: "Runway is short for an application at this scale. Capped at Potential match." });
  const refreshed = input.sources.map((s) => s.last_refreshed_at).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null;
  const staleMonths = refreshed ? monthsSince(refreshed, now) : null;
  if (staleMonths != null && staleMonths >= 12) flags.push({ kind: "stale", text: `Stale profile: last refreshed ${fmtMonYear(refreshed!)}.` });

  // Reasons: the rationale with the evidence stage 5 credited, the gap sentence, the mechanism line.
  const grantProjectNumbers = new Map<string, string>();
  for (const g of input.grants) if (g.id) grantProjectNumbers.set(g.id, g.project_num);
  const topIds = r.provenance.T.top_items.map((id) => legacyEvidenceId(id, grantProjectNumbers));
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
    { facet: "Eligibility", value: failedE ? r.provenance.E.failed.join("; ") : r.provenance.E.unknown.length ? r.provenance.E.unknown.join("; ") : "no rule failed", mark: failedE ? "no" : r.provenance.E.unknown.length ? "unclear" : "yes" },
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
  const fundingItems: EvidenceItem[] = input.grants.slice(0, 3).map((g) => {
    const end = g.raw_json?.project_end_date?.slice(0, 10) ?? null;
    const start = g.raw_json?.project_start_date?.slice(0, 10) ?? null;
    const code = grantCode(g.project_num) ?? "award";
    const active = end ? end >= now.toISOString().slice(0, 10) : (g.fiscal_year ?? 0) >= now.getUTCFullYear() - 1;
    return {
      id: `grant:${g.project_num}`,
      heading: `${g.project_num.replace(/^\d/, "").replace(/-.*$/, "")} · ${g.project_title ?? "Untitled project"}`,
      sub: [shortIc(g.ic_name), start && end ? `${start.slice(0, 4)}–${end.slice(0, 4)}` : g.fiscal_year ? `FY ${g.fiscal_year}` : null, "PI"].filter(Boolean).join(" · "),
      link: { label: "RePORTER", href: `https://reporter.nih.gov/search/results?projects=${encodeURIComponent(g.project_num)}` },
      inferred: `${active ? `Holds an active ${code}` : `Held a ${code}`} as PI → track record ${pct(c.K)}.`,
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
  const institutionalItems: EvidenceItem[] = [{ id: "roster", heading: [p.home_department, title ?? "rank not on file", input.communityLabel].filter(Boolean).join(" · "), sub: `Added ${fmtMonYear(p.created_at)}`, inferred: r.provenance.E.unknown.length ? "Eligibility could not be fully checked from the profile." : null }];
  const historyItems: EvidenceItem[] = input.history.slice(0, 4).map((h, i) => ({ id: `history:${i}`, heading: h.kind === "sent" ? `Outreach sent · ${h.notice}` : `Replied ${h.label} · ${h.notice}`, sub: `${fmtMonDYear(h.at)}${h.note ? ` · “${h.note.slice(0, 80)}”` : ""}`, inferred: h.kind === "reply" ? (/interested/i.test(h.label) ? "Positive reply to a similar notice → prior interest: yes." : /not now|declin/i.test(h.label) ? "Declined a similar notice → negative signal for this notice." : null) : "No reply is not treated as a negative signal." }));
  const verifiedPubs = input.pubs.filter((x) => x.identity_status === "verified");
  const groups: EvidenceGroup[] = [
    { key: "research", title: "Research alignment", meta: `Fit engine · topic ${pct(c.T)} over ${r.provenance.T.top_items.length} compatible item${r.provenance.T.top_items.length === 1 ? "" : "s"}`, items: researchItems, empty: verifiedPubs.length ? "No compatible item carried the topic score." : "No verified publications on file." },
    { key: "funding", title: "Funding alignment", meta: "NIH RePORTER · matched by profile ID", items: fundingItems, empty: byKind.get("reporter")?.identity_method ? "No NIH projects on record." : "No RePORTER profile ID on file, so awards could not be matched.", action: byKind.get("reporter")?.identity_method ? null : { kind: "add_profile_id", label: "Add profile ID" } },
    { key: "self", title: "Self-described expertise", meta: bio?.state === "on_file" ? `Biosketch · document dated ${bio.document_date ? fmtMonYear(bio.document_date) : "—"}` : "Biosketch", items: selfItems, empty: bio?.state === "declined" ? "Biosketch not authorized for Prospera use." : "No biosketch on file. Missing biosketches never lower the tier.", action: bio?.state === "on_file" || bio?.state === "declined" ? null : { kind: "request_biosketch", label: bio?.state === "requested" ? "Send reminder" : "Request biosketch" } },
    { key: "institutional", title: "Institutional alignment", meta: "Directory · roster", items: institutionalItems },
    { key: "history", title: "Prior engagement", meta: "Prospera history", items: historyItems, empty: `No previous outreach or suggestions for Dr. ${p.last_name?.trim() || p.full_name.trim().split(/\s+/).slice(-1)[0] || p.full_name}. New to you.` },
  ];

  const unverifiedPubs = input.pubs.filter((x) => x.identity_status === "unverified");
  const identityLine = byKind.get("reporter")?.identity_method === "profile_id" && verifiedPubs.length ? "confirmed (profile ID + affiliation)" : verifiedPubs.some((x) => x.identity_method === "orcid") ? "confirmed (ORCID)" : verifiedPubs.length ? "confirmed (affiliation)" : byKind.get("reporter")?.identity_method === "profile_id" ? "confirmed (profile ID)" : unverifiedPubs.length ? `unverified (${unverifiedPubs.length} name-only)` : "not checked";
  const freshWarn = !refreshed || (staleMonths ?? 0) >= 12;
  const freshLine = !refreshed ? `Never refreshed · added ${fmtMonYear(p.created_at)}` : (staleMonths ?? 0) >= 12 ? `Stale · profile is ${staleMonths} months old` : `Refreshed ${fmtMonD(refreshed)}`;
  const reply = input.history.filter((h) => h.kind === "reply").sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const historyLine = lastSent ? `Contacted ${fmtMonD(lastSent.at)} · ${lastSent.notice} · ${reply ? `replied ${reply.label}` : "no reply"}` : reply ? `Replied ${reply.label} · ${reply.notice} · ${fmtMonYear(reply.at)}` : null;
  const historyKind: "good" | "warn" | null = historyLine ? (reply && /interested/i.test(reply.label) ? "good" : "warn") : null;

  const coverage = coverageOf(input.sources, Boolean(p.research_community_id));
  const summary = [r.rationale, r.gap, failedE ? excludedReason : null].filter(Boolean).join(" ");
  return { investigatorId: p.id, tier, coverage, score: r.score / 100, flags, reasons, checklist, groups, identityLine, freshLine, freshWarn, historyLine, historyKind, isNew: input.history.length === 0, excludedReason, summary, title };
}

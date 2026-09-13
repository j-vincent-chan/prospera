/**
 * Focus mode and the three drawers (design_handoff_prospera_review_outreach
 * README §3 and §4), as pure view builders. Records in — the notice's fit
 * profile, the person's fit profile, the audit tables, the directory rows —
 * and the words each card shows out. No Supabase, no clock.
 *
 * **Nothing here is written for the page.** The prototype's Opportunity card
 * carried hand-written objectives, a "best fit for" paragraph and a list of
 * deal-breakers; the product has no notice-level author, so every section is
 * composed from what the notice profile holds — its objective categories, its
 * required and excluded paradigms and designs, its eligibility rules, its
 * team expectations, and the verbatim quote with the Guide section behind
 * each of them. A section with nothing behind it says so, or is omitted.
 */
import type { AuditContent, EligibilityRule, RequirementRule } from "@/lib/fit/audit-view";
import { categoryDisplay, dominantSafe, sortedWeights } from "@/lib/fit/inspect/labels";
import type { InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { eligibilityRestrictions, type VerdictLabel } from "@/lib/fit/verdicts";
import { fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";
import type { KeyStat } from "@/lib/review/queue";
import { rowVerbs, type RowVerb } from "@/lib/review/reasons";

// ---------------------------------------------------------------------------
// Progress (README §3 "Progress row")
// ---------------------------------------------------------------------------

/** "Reviewing match 1 of 4 on notice 1 of 3" */
export function progressLine(input: { match: number; matches: number; notice: number; notices: number }): string {
  return `Reviewing match ${input.match} of ${input.matches} on notice ${input.notice} of ${input.notices}`;
}

/** "8 decisions left · 0 of 8 done" */
export function decisionsLine(input: { undecided: number; total: number }): string {
  const done = Math.max(0, input.total - input.undecided);
  return `${input.undecided} decision${input.undecided === 1 ? "" : "s"} left · ${done} of ${input.total} done`;
}

/** 0–100 for the 4px bar. */
export function progressPercentOf(input: { undecided: number; total: number }): number {
  return input.total ? Math.round((100 * (input.total - input.undecided)) / input.total) : 0;
}

/** "2 confirmed and waiting in the outreach draft. Nothing has been sent." / "Nothing was confirmed, so no outreach is queued." */
export function doneLine(confirmed: number): string {
  return confirmed ? `${confirmed} confirmed and waiting in the outreach draft. Nothing has been sent.` : "Nothing was confirmed, so no outreach is queued.";
}

export const FOCUS_NOTE = "One at a time, but never blind: the other candidates for this notice stay named below, because on a limited submission the question is which one, not whether each.";

// ---------------------------------------------------------------------------
// The decision bar (README §3 "Sticky decision bar")
// ---------------------------------------------------------------------------

export type FocusAction = RowVerb & { key: "1" | "2" | "3"; kind: "primary" | "secondary"; /** Opens the reasons panel instead of deciding. */ opensReasons: boolean };

/** Pure. The three keyed buttons for a label: 1 primary, 2 dismiss (opens the reasons) or reinstate, 3 watch. */
export function focusActions(label: VerdictLabel): FocusAction[] {
  const v = rowVerbs(label);
  const second: FocusAction = v.secondary.status
    ? { key: "2", kind: "secondary", label: v.secondary.label, status: v.secondary.status, reason: v.secondary.reason, opensReasons: false }
    : { key: "2", kind: "secondary", label: v.secondary.label, status: "rejected", reason: null, opensReasons: true };
  return [
    { key: "1", kind: "primary", label: v.primary.label, status: v.primary.status, reason: v.primary.reason, opensReasons: false },
    second,
    { key: "3", kind: "secondary", label: "Watch", status: "watch", reason: null, opensReasons: false },
  ];
}

// ---------------------------------------------------------------------------
// The investigator card (README §3 "Investigator card")
// ---------------------------------------------------------------------------

export type ProfileCard = {
  /** "Mid-career · Professor in residence" — what the fit profile records about stage and series; null when it records nothing. */
  stage: string | null;
  /** "Human translational · mechanistic immunology"; null when no paradigm is established. */
  paradigm: string | null;
  /** Theme chips: the profile's RCDC categories. */
  themes: string[];
  /** The drawer's "Funding-relevant facts": only rows the profile can fill. */
  facts: Array<{ key: string; value: string }>;
};

const STAGE_WORDS: Record<string, string> = { early: "Early-career", esi: "Early-stage investigator", mid: "Mid-career", established: "Established", senior: "Senior" };

/** Pure. The card's stage line and the drawer's facts, from the stored fit profile. */
export function profileCard(profile: InvestigatorFitProfile | null | undefined, extra: { rank: string | null; doNotContact: boolean }): ProfileCard {
  if (!profile) return { stage: null, paradigm: null, themes: [], facts: [] };
  const c = profile.characteristics;
  const stageWord = c.career_stage ? (STAGE_WORDS[c.career_stage] ?? c.career_stage.replace(/_/g, " ")) : null;
  const stage = [stageWord, c.title_series?.trim() || null].filter(Boolean).join(" · ") || null;
  const dominant = dominantSafe(profile.paradigm?.recent) ?? dominantSafe(profile.paradigm?.career);
  const paradigm = dominant ? `${dominant.family} · ${dominant.label.toLowerCase()}` : null;
  const themes = (profile.topic?.rcdc ?? []).filter(Boolean).slice(0, 6);

  const facts: Array<{ key: string; value: string }> = [];
  const appointment = [extra.rank?.trim() || null, c.title_series?.trim() || null, c.degrees?.length ? c.degrees.join(", ") : null, stageWord].filter(Boolean).join(" · ");
  if (appointment) facts.push({ key: "Appointment", value: appointment });
  const es = profile.evidence_summary;
  const held = c.mechanisms_held?.length ? ` Mechanisms held as PI: ${c.mechanisms_held.join(", ")}.` : "";
  if (es) facts.push({ key: "Award history", value: `${es.grants} award${es.grants === 1 ? "" : "s"} on file, ${c.active_awards} active.${held}` });
  if (c.clinical_role) facts.push({ key: "Clinical role", value: c.clinical_role.replace(/_/g, " ") });
  const collaborators = (profile.collaborators ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)).slice(0, 5);
  if (collaborators.length) facts.push({ key: "Collaborators", value: collaborators.join(", ") });
  const flags: string[] = [];
  if (c.esi === true) flags.push(c.esi_eligible_until ? `Early-stage investigator, estimated until ${c.esi_eligible_until.slice(0, 4)}` : "Early-stage investigator, estimated");
  if (c.esi === false) flags.push("Not an early-stage investigator");
  if (profile.do_not_suggest?.length) flags.push(`Asked not to be suggested for: ${profile.do_not_suggest.join(", ").replace(/_/g, " ")}`);
  if (extra.doNotContact) flags.push("Do not contact is set on the profile");
  facts.push({ key: "Eligibility flags", value: flags.length ? flags.join(". ") : "None recorded." });
  return { stage, paradigm, themes, facts };
}

export const PARADIGM_UNKNOWN = "Not established from what is on file";

// ---------------------------------------------------------------------------
// Publications and awards (the card's carousels and the drawer's full lists)
// ---------------------------------------------------------------------------

export type FocusPublication = {
  id: string;
  pmid: string;
  title: string;
  /** "Journal · 2025" */
  meta: string;
  role: string | null;
  /** First or senior author reads teal; a middle author reads muted. */
  roleLead: boolean;
  abstract: string | null;
  /** "Cited in Prospera's assessment", when the rationale rests on it. */
  relevance: string | null;
};

export type FocusGrant = {
  id: string;
  number: string;
  sponsor: string | null;
  active: boolean;
  title: string;
  /** "PI · 2023 – 2027 · $100k/yr" */
  line: string;
  detail: string | null;
  relevance: string | null;
};

export type FocusProfile = {
  summary: { text: string; source: string } | null;
  photoUrl: string | null;
  publications: FocusPublication[];
  grants: FocusGrant[];
};

export const EMPTY_FOCUS_PROFILE: FocusProfile = { summary: null, photoUrl: null, publications: [], grants: [] };

/** Pure. The author-position vocabulary as the card reads it. */
export function authorRole(position: string | null | undefined): { label: string | null; lead: boolean } {
  switch ((position ?? "").trim().toLowerCase()) {
    case "first":
      return { label: "First author", lead: true };
    case "last":
      return { label: "Senior author", lead: true };
    case "corresponding":
      return { label: "Corresponding author", lead: true };
    case "middle":
      return { label: "Co-author", lead: false };
    default:
      return { label: null, lead: false };
  }
}

export const CITED = "Cited in Prospera's assessment";

/** "$100k/yr" · "$1.8M/yr" — the award as a per-year figure, RePORTER's `award_amount`. */
function perYear(amount: number | string | null | undefined): string | null {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M/yr`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k/yr`;
  return `$${Math.round(n)}/yr`;
}

export type GrantRowInput = {
  id: string;
  project_num: string;
  fiscal_year: number | null;
  project_title: string | null;
  ic_name: string | null;
  is_active: boolean | null;
  is_contact_pi: boolean | null;
  award_amount: number | string | null;
  abstract: string | null;
  phr_text: string | null;
  raw_json: { project_start_date?: string | null; project_end_date?: string | null } | null;
};

/** Pure. One award as the card lists it. `active` is the caller's reading (`grantIsActive`), passed in so this stays clock-free. */
export function focusGrant(g: GrantRowInput, active: boolean, cited: boolean): FocusGrant {
  const start = g.raw_json?.project_start_date?.slice(0, 4) ?? null;
  const end = g.raw_json?.project_end_date?.slice(0, 4) ?? null;
  const years = start && end ? `${start} – ${end}` : start ? `from ${start}` : end ? `to ${end}` : g.fiscal_year ? `FY${g.fiscal_year}` : null;
  const role = g.is_contact_pi ? "Contact PI" : "PI";
  return {
    id: g.id,
    number: g.project_num,
    sponsor: g.ic_name?.trim() || null,
    active,
    title: g.project_title?.trim() || "Untitled award",
    line: [role, years, perYear(g.award_amount)].filter(Boolean).join(" · "),
    detail: g.phr_text?.trim() || g.abstract?.trim() || null,
    relevance: cited ? CITED : null,
  };
}

export type PublicationRowInput = { id: string; pmid: string; title: string; journal: string | null; publication_date: string | null; author_position: string | null; abstract: string | null };

/** Pure. One publication as the card lists it. */
export function focusPublication(p: PublicationRowInput, cited: boolean): FocusPublication {
  const role = authorRole(p.author_position);
  const year = p.publication_date?.slice(0, 4) ?? null;
  return {
    id: p.id,
    pmid: p.pmid,
    title: p.title?.trim() || "Untitled",
    meta: [p.journal?.trim() || null, year].filter(Boolean).join(" · ") || "PubMed",
    role: role.label,
    roleLead: role.lead,
    abstract: p.abstract?.trim() || null,
    relevance: cited ? CITED : null,
  };
}

/** Pure. "1–2 of 8" for a page of size `per`. */
export function pageLabel(page: number, per: number, total: number): string {
  if (!total) return "0 of 0";
  const from = page * per + 1;
  const to = Math.min(total, page * per + per);
  return from === to ? `${from} of ${total}` : `${from}–${to} of ${total}`;
}

/** Pure. Cited items lead (the assessment rests on them), then the caller's own order. */
export function citedFirst<T extends { relevance: string | null }>(items: readonly T[]): T[] {
  return [...items.filter((i) => i.relevance), ...items.filter((i) => !i.relevance)];
}

// ---------------------------------------------------------------------------
// The opportunity card and drawer (README §3 "Opportunity card", §4 "Opportunity detail")
// ---------------------------------------------------------------------------

export type KeyFact = { label: string; value: string; sub: string | null };

export type TermRow = { label: string; source: string; value: string };

export type NoticeDetail = {
  /** The key-facts row: Award · Duration · Mechanism · Deadline · Internal routing · Letter of intent · Submissions. */
  facts: KeyFact[];
  /** Priority chips — the notice's distinguishing topic terms. */
  priorities: string[];
  /** Numbered: the objective categories the notice funds. */
  objectives: string[];
  /** The notice's own words on its objective, with the section. */
  objectiveQuote: { text: string; section: string } | null;
  notInScope: string[];
  bestFit: string;
  dealBreakers: string[];
  assemble: string[];
  /** "Why Prospera surfaced this" — the directory's matches, said in words. */
  why: string;
  /** "Terms and eligibility": every verbatim quote the profile carries, with its Guide section. */
  terms: TermRow[];
  /** "Assessed from the notice on Sep 6"; null when no profile was built. */
  provenance: string | null;
  summarySource: string;
};

const HUMAN_KEY: Record<string, string> = {
  objective: "Objective",
  "paradigm.required": "Research approach required",
  "paradigm.required_any": "Research approach, any of",
  "paradigm.allowed": "Research approach allowed",
  "paradigm.excluded": "Research approach excluded",
  clinical_trial_text: "Clinical trials",
  "design.required_any": "Study designs required",
  "design.required_any_2": "Study designs required, second group",
  "design.prohibited": "Study designs prohibited",
  "materials.required": "Materials required",
  "materials.expected": "Materials expected",
  "materials.human_required": "Human materials",
  population: "Study population",
  "unit.required": "Unit of analysis",
  "team.multi_pi_allowed": "Multiple PIs",
  "team.consortium_required": "Consortium",
  "team.required_partners": "Required partners",
  "mechanism.period_years": "Project period",
  "mechanism.ceiling_direct_per_year": "Award ceiling",
  "topic.distinguishing_terms": "Distinguishing terms",
  "eligibility.investigator_rules": "Eligibility rules",
  "eligibility.esi_only": "Early-stage investigators",
  "eligibility.new_investigator_only": "New investigators",
  "eligibility.clinician_required": "Clinician required",
  "eligibility.degree_required": "Degree required",
  "eligibility.independent_appointment_required": "Independent appointment",
  "eligibility.citizenship_rule": "Citizenship",
  non_responsive: "Not responsive",
};

/** Pure. "paradigm.required" → "Research approach required"; an unknown key is spelled out. */
export function termLabel(key: string): string {
  return HUMAN_KEY[key] ?? key.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const labelsOf = (axis: string, ids: readonly string[] | null | undefined, max = 6): string[] => (ids ?? []).slice(0, max).map((id) => categoryDisplay(axis, id).label);
const weightLabels = (axis: string, weights: Record<string, number | undefined> | null | undefined, max = 6): string[] => sortedWeights(weights).slice(0, max).map((w) => categoryDisplay(axis, w.id).label);
const list = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const CLINICAL_TRIAL_WORDS: Record<string, string> = {
  required: "Clinical trials are required.",
  not_allowed: "Clinical trials are not allowed.",
  optional: "Clinical trials are optional.",
  basic_experimental_studies_with_humans: "Basic experimental studies with humans are required.",
};

export type NoticeDetailInput = {
  profile: OpportunityFitProfile | null;
  keyStats: KeyStat[];
  activityCode: string | null;
  instrument: string | null;
  loiDue: string | null;
  loiNote: string | null;
  limited: boolean;
  cap: number | null;
  byTier: { strong: number; moderate: number; exploratory: number };
  today: string;
};

/** Pure. Everything the Opportunity card and drawer show, from the notice's fit profile and the header's facts. */
export function noticeDetail(input: NoticeDetailInput): NoticeDetail {
  const p = input.profile;
  const [deadline, routing, award] = input.keyStats;
  const facts: KeyFact[] = [];
  if (award) facts.push({ label: "Award", value: award.value, sub: award.label === "award ceiling" ? null : award.label });
  if (p?.mechanism.period_years) facts.push({ label: "Duration", value: `${p.mechanism.period_years} year${p.mechanism.period_years === 1 ? "" : "s"}`, sub: null });
  const mechanism = [input.activityCode?.trim() || null, input.instrument?.trim().replace(/_/g, " ").toLowerCase() || null].filter(Boolean).join(" ");
  if (mechanism) facts.push({ label: "Mechanism", value: mechanism, sub: p?.mechanism.clinical_trial && p.mechanism.clinical_trial !== "unknown" ? `clinical trials ${p.mechanism.clinical_trial.replace(/_/g, " ")}` : null });
  if (deadline) facts.push({ label: "Deadline", value: deadline.value, sub: deadline.label.replace(/^deadline · /, "") });
  if (routing && routing.value !== "—") facts.push({ label: "Internal routing", value: routing.value, sub: routing.label.replace(/^internal routing · /, "") });
  facts.push({ label: "Letter of intent", value: input.loiDue ? fmtMonD(input.loiDue, input.today) : input.loiNote?.trim() || "Not required", sub: input.loiDue ? (input.loiDue < input.today ? "passed" : "due") : null });
  if (input.limited) facts.push({ label: "Submissions", value: input.cap ? `${input.cap} per institution` : "Limited", sub: "limited submission" });

  const priorities = (p?.topic.terms ?? []).filter(Boolean).slice(0, 8);
  const objectives = weightLabels("objective", p?.objective, 6);
  const objQuote = p?.provenance?.objective;
  const objectiveQuote = objQuote?.quote ? { text: objQuote.quote, section: objQuote.section } : null;

  const notInScope = [
    ...(p?.non_responsive ?? []).filter(Boolean),
    ...weightLabels("paradigm", p?.paradigm.excluded, 6).map((l) => `${l} — excluded as a research approach`),
    ...labelsOf("design", p?.design.prohibited, 6).map((l) => `${l} — a prohibited design`),
  ];

  const requiredParadigm = [...weightLabels("paradigm", p?.paradigm.required, 4), ...weightLabels("paradigm", p?.paradigm.required_any, 4)];
  const requiredDesigns = labelsOf("design", p?.design.required_any, 8);
  const bestFitParts: string[] = [];
  if (requiredParadigm.length) bestFitParts.push(`Work that is ${list(requiredParadigm.map(lower))}`);
  if (requiredDesigns.length) bestFitParts.push(`${requiredParadigm.length ? "using" : "Work using"} ${list(requiredDesigns.map(lower))}`);
  if (p?.population) bestFitParts.push(`in ${p.population}`);
  const units = p?.unit.required?.length ? labelsOf("unit", p.unit.required, 3) : [];
  if (units.length) bestFitParts.push(`at the level of ${list(units.map(lower))}`);
  const bestFit = bestFitParts.length ? `${bestFitParts.join(", ")}.` : p ? "The notice names no required research approach; the topic terms above are what would separate a responsive application from one that is not." : "No fit profile has been built for this notice yet.";

  const dealBreakers: string[] = [];
  for (const r of eligibilityRestrictions(p?.eligibility)) dealBreakers.push(`${r.charAt(0).toUpperCase()}${r.slice(1)}.`);
  const ct = p?.mechanism.clinical_trial;
  if (ct && ct !== "unknown" && ct !== "optional") dealBreakers.push(CLINICAL_TRIAL_WORDS[ct] ?? `Clinical trials: ${ct.replace(/_/g, " ")}.`);
  if (p?.materials.human_required) dealBreakers.push("Human materials or participants are required.");
  if (input.limited) dealBreakers.push(input.cap ? `Limited submission — UCSF may put forward ${input.cap} application${input.cap === 1 ? "" : "s"}.` : "Limited submission — UCSF must choose whom to put forward.");
  if (p?.paradigm.excluded && Object.keys(p.paradigm.excluded).length) dealBreakers.push(`${list(weightLabels("paradigm", p.paradigm.excluded, 4))} work is excluded.`);

  const assemble: string[] = [];
  if (p?.team.consortium_required) assemble.push("A consortium — the notice requires one.");
  for (const partner of p?.team.required_partners ?? []) assemble.push(partner);
  if (p?.team.multi_pi_allowed === true) assemble.push("Multiple PDs/PIs are allowed, so a co-led application is open.");
  if (p?.team.multi_pi_allowed === false) assemble.push("A single PD/PI — multiple PIs are not allowed.");
  for (const m of labelsOf("materials", p?.materials.required, 6)) assemble.push(`${m} — required.`);
  for (const m of labelsOf("materials", p?.materials.expected, 6)) assemble.push(`${m} — expected.`);
  if (p?.design.required_any_2?.length) assemble.push(`A second required design among ${list(labelsOf("design", p.design.required_any_2, 6).map(lower))}.`);

  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [input.byTier.strong ? n(input.byTier.strong, "strong match", "strong matches") : null, input.byTier.moderate ? n(input.byTier.moderate, "moderate match", "moderate matches") : null].filter(Boolean);
  const why = `${parts.length ? `${parts.join(" and ")} in your directory clear the bar for this notice` : "No one in your directory clears the bar for this notice"}${input.byTier.exploratory ? `; ${n(input.byTier.exploratory, "more person is", "more people are")} exploratory leads` : ""}. The engine compares research approach, unit of analysis, study design and topic against the notice's requirements; topic alone never qualifies a match.`;

  const terms: TermRow[] = Object.entries(p?.provenance ?? {})
    .filter(([, q]) => q && typeof q.quote === "string" && q.quote.trim())
    .map(([key, q]) => ({ label: termLabel(key), source: q.section, value: q.quote.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    facts,
    priorities,
    objectives,
    objectiveQuote,
    notInScope,
    bestFit,
    dealBreakers,
    assemble,
    why,
    terms,
    provenance: p ? `Assessed from the notice on ${fmtMonD(p.computed_at.slice(0, 10), input.today)}${p.sources.text === "synopsis" ? " · synopsis only" : ""}` : null,
    summarySource: "The notice's own synopsis · not Prospera's words",
  };
}

// ---------------------------------------------------------------------------
// The assessment drawer's checks (README §4 "Prospera's assessment")
// ---------------------------------------------------------------------------

export type CheckMark = "yes" | "no" | "unknown";

export type CheckRow = { key: string; mark: CheckMark; criterion: string; note: string | null };

export type Checks = {
  /** False when the notice was never checked against this person (no notice profile, or a stub row). */
  assessed: boolean;
  rows: CheckRow[];
};

const eligibilityMark = (r: EligibilityRule): CheckMark => (r.state === "met" ? "yes" : r.state === "fails" ? "no" : "unknown");
const requirementMark = (r: RequirementRule): CheckMark => (r.state === "met" ? "yes" : r.state === "not_met" ? "no" : "unknown");

/**
 * Pure. The two audit tables as one checklist: who may apply first, then what
 * the application must contain — the same order the audit view keeps them
 * apart in, since human subjects is a requirement and not an eligibility rule.
 */
export function checksOf(audit: AuditContent | null | undefined, label: VerdictLabel): Checks {
  if (!audit || !audit.scored || label === "cannot_assess") return { assessed: false, rows: [] };
  const rows: CheckRow[] = [
    ...audit.eligibility.map((r) => ({ key: `e-${r.key}`, mark: eligibilityMark(r), criterion: r.rule, note: r.quote ? `${r.quote.section}: “${r.quote.quote}”` : null })),
    ...audit.requirements.map((r) => ({ key: `r-${r.key}`, mark: requirementMark(r), criterion: r.rule, note: r.quote ? `${r.quote.section}: “${r.quote.quote}”` : null })),
  ];
  return { assessed: true, rows };
}

export const CHECK_GLYPH: Record<CheckMark, string> = { yes: "✓", no: "✕", unknown: "?" };

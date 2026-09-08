/**
 * What a shown pair says for itself (plan § PR 3.2; spec §10 "Exploratory is
 * a feature", "Poor is hidden but never deleted"; §16 "Explanation: every
 * claim cites an evidence ID that exists"). Pure: view models over
 * `fit_results` list rows (results.ts `FIT_RESULT_LIST_COLUMNS`) and the
 * evidence lookups the inspector already resolves ids with — no Supabase.
 *
 * Three things every surface shares:
 *
 *   - **Who sees what (D7).** Exploratory and "Why not?" are strategist
 *     tooling during the pilot; a PI looking at their own page sees Strong and
 *     Moderate only. Email is the only link between a signed-in user and a
 *     directory record (the onboarding step's rule), so the audience is
 *     `investigator` exactly when the viewer's email is the subject's.
 *
 *   - **Groups.** Recommended (Strong, Moderate) and Exploratory, each in
 *     `compareFitRows`' order. What a row then *says* is `row-line.ts`' job
 *     (PR 3.2b): two sentences, the binding gap first on anything below
 *     Strong.
 *
 *   - **A rationale that cites evidence.** The engine's rationale names stage
 *     5's credited items by id inside the Topic clause; those ids are found,
 *     resolved to titles, and shown as chips. A rationale that cites nothing
 *     falls back to stage 5's `top_items`, then to the top evidence behind the
 *     paradigm category the pair matched on (the profile's provenance), so no
 *     shown tier is left without an item. A judged row's rationale (the
 *     reconciler's, when it cited existing evidence — PR 3.1) names the short
 *     ids the judge was given; `judged_evidence` maps them back to items.
 */
import type { FitEngine } from "@/lib/fit/flag";
import { resolveEvidenceId, type EvidenceLookup, type EvidenceRef } from "@/lib/fit/inspect/evidence";
import type { ShownConfidence } from "@/lib/fit/judge/types";
import { compareFitRows, type FitResultListRow } from "@/lib/fit/results";
import type { AxisProvenance, Tier } from "@/lib/fit/types";
import { GAP_REASON_TITLE, type EvidenceGroup, type EvidenceItem, type SuggestionReason, type SuggestionTier } from "@/lib/outreach/types";

// ---------------------------------------------------------------------------
// Audience (D7)
// ---------------------------------------------------------------------------

export type FitAudience = "strategist" | "investigator";

const normEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** D7: the viewer is the investigator when their sign-in email is the directory record's; everyone else is a strategist. */
export function fitAudienceFor(viewer: { email?: string | null }, subject: { email?: string | null }): FitAudience {
  const a = normEmail(viewer.email);
  const b = normEmail(subject.email);
  return a && b && a === b ? "investigator" : "strategist";
}

/** D7: Exploratory is strategists-only during the pilot. */
export const showsExploratory = (audience: FitAudience): boolean => audience === "strategist";

/** "Why not?" (Poor pairs on request) is strategist tooling too. */
export const showsWhyNot = showsExploratory;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type FitGroups<R> = { recommended: R[]; exploratory: R[] };

/** Pure. Recommended (Strong, Moderate) and Exploratory in `compareFitRows`' order; Exploratory is empty for a PI (D7); Poor never enters a group. */
export function groupFitRows<R extends { tier: Tier; score: number }>(rows: readonly R[], idOf: (r: R) => string, audience: FitAudience): FitGroups<R> {
  const sorted = [...rows].sort((a, b) => compareFitRows(a, b, idOf));
  return {
    recommended: sorted.filter((r) => r.tier === "strong" || r.tier === "moderate"),
    exploratory: showsExploratory(audience) ? sorted.filter((r) => r.tier === "exploratory") : [],
  };
}

/**
 * Pure. The Outreach snapshot's reasons as a fit-v1 surface lists them: an
 * Exploratory row leads with the gap sentence (the `GAP_REASON_TITLE`
 * reason, wherever the snapshot put it — spec §10), every other row and every
 * legacy row keeps the snapshot's order. The recipients row and the evidence
 * view both read this, so the gap line is the same line in both.
 */
export function orderedReasons(s: { tier: SuggestionTier; reasons: readonly SuggestionReason[] }, engine: FitEngine): SuggestionReason[] {
  if (engine !== "fit-v1" || s.tier !== "exploratory") return [...s.reasons];
  const gap = s.reasons.findIndex((r) => r.title === GAP_REASON_TITLE);
  return gap > 0 ? [s.reasons[gap]!, ...s.reasons.filter((_, i) => i !== gap)] : [...s.reasons];
}

/** Pure. The gap line a fit-v1 Exploratory row leads with, or null (no gap reason, another tier, a legacy team). */
export function gapReasonOf(s: { tier: SuggestionTier; reasons: readonly SuggestionReason[] }, engine: FitEngine): SuggestionReason | null {
  const first = orderedReasons(s, engine)[0];
  return engine === "fit-v1" && s.tier === "exploratory" && first?.title === GAP_REASON_TITLE ? first : null;
}

// ---------------------------------------------------------------------------
// Evidence citations
// ---------------------------------------------------------------------------

/** An internal evidence id as `collectEvidence` mints them: `publication:<investigator>:<pmid>`, `grant:<row>`, `trial:<investigator>:<nct>`, `biosketch:<investigator>[:statement | :contribution:<n>]`, `profiles:<id>`, `directory:<id>`, `self_declared:<id>`, `aspiration:<id>:<n>`. */
const EVIDENCE_ID_RE = /\b(?:publication|grant|trial|biosketch|profiles|directory|self_declared|aspiration):[A-Za-z0-9][A-Za-z0-9-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)*/g;

/** Pure. The distinct evidence ids a rationale cites, in order of appearance. */
export function citedEvidenceIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(EVIDENCE_ID_RE)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/** Pure. The short judge ids (`PMID:123`, an NCT id, a project number, `biosketch:statement`) a judged rationale cites, mapped to the items they stand for, in order of appearance. */
export function citedJudgedRefs(text: string | null | undefined, evidence: ReadonlyArray<{ id: string; ref: string }> | null | undefined): string[] {
  if (!text || !evidence?.length) return [];
  return evidence
    .map((e) => ({ ref: e.ref, at: e.id ? text.indexOf(e.id) : -1 }))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((e) => e.ref)
    .filter((ref, i, all) => all.indexOf(ref) === i);
}

export type RationaleSource = "engine" | "judged";

/** Where the cited items came from: the rationale text, stage 5's top items, the profile's paradigm provenance, the judge's evidence list — or nowhere (`none`, the surface says so). */
export type RationaleFallback = "cited" | "top_items" | "profile" | "judged_evidence" | "none";

export type RationaleView = {
  /** The rationale with internal ids replaced by short titles. */
  text: string;
  evidence: EvidenceRef[];
  source: RationaleSource;
  fallback: RationaleFallback;
};

export type RationaleInput = Pick<FitResultListRow, "rationale" | "top_items" | "best_pair" | "judged_at" | "judged_evidence">;

export type RationaleOptions = {
  /** The investigator's stored `profile.provenance` (per axis and category) — the last fallback: the top evidence behind the paradigm category the pair matched on. */
  profileProvenance?: ReadonlyArray<AxisProvenance> | null;
  /** Chips shown (default 3). */
  max?: number;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A resolved item as it reads inside a sentence. */
export function shortTitleOf(ref: EvidenceRef): string {
  switch (ref.kind) {
    case "publication":
      return ref.resolved ? `“${clip(ref.title, 60)}”` : ref.title;
    case "grant":
      return ref.meta?.split(" · ")[0] || ref.title;
    case "trial":
      return ref.meta?.split(" · ")[0] || ref.title;
    case "biosketch":
      return ref.title.toLowerCase();
    case "profiles":
      return "the UCSF Profiles narrative";
    case "directory":
      return "the directory record";
    case "self_declared":
      return "the self-declared axes";
    case "aspiration":
      return "a stated aspiration";
    default:
      return ref.title;
  }
}

/** Pure. The ids behind a pair's paradigm match from the profile's provenance: the `best_pair.investigator` category first, else the first paradigm entry with items, else the first entry with items. */
export function profileFallbackIds(provenance: ReadonlyArray<AxisProvenance> | null | undefined, category: string | null | undefined): string[] {
  if (!provenance?.length) return [];
  const withItems = provenance.filter((p) => Array.isArray(p.top_items) && p.top_items.length);
  const exact = category ? withItems.find((p) => p.axis === "paradigm" && p.category === category) : undefined;
  const pick = exact ?? withItems.find((p) => p.axis === "paradigm") ?? withItems[0];
  return pick ? pick.top_items : [];
}

/**
 * Pure. The rationale a surface shows, with the evidence it cites resolved:
 * the ids in the text, else stage 5's `top_items`, else the profile's
 * paradigm provenance; a judged row's short ids through `judged_evidence`,
 * else the judge's first item. Never an empty text: a row with no rationale
 * reads "No rationale stored." so the fallback below it still names an item.
 */
export function rationaleView(row: RationaleInput, lookup: EvidenceLookup, opts: RationaleOptions = {}): RationaleView {
  const max = Math.max(1, opts.max ?? 3);
  const source: RationaleSource = row.judged_at ? "judged" : "engine";
  const raw = row.rationale?.trim() || "";
  let ids: string[] = [];
  let fallback: RationaleFallback = "none";
  let text = raw || "No rationale stored.";

  if (source === "judged") {
    ids = citedJudgedRefs(raw, row.judged_evidence);
    if (ids.length) fallback = "cited";
  }
  if (!ids.length) {
    const cited = citedEvidenceIds(raw);
    if (cited.length) {
      ids = cited;
      fallback = "cited";
      // the engine's Topic clause lists the ids; read them as titles
      for (const id of cited) text = text.split(id).join(shortTitleOf(resolveEvidenceId(id, lookup)));
    }
  }
  if (!ids.length && row.top_items?.length) {
    ids = row.top_items;
    fallback = "top_items";
  }
  if (!ids.length && source === "judged" && row.judged_evidence?.length) {
    ids = row.judged_evidence.map((e) => e.ref);
    fallback = "judged_evidence";
  }
  if (!ids.length) {
    const fromProfile = profileFallbackIds(opts.profileProvenance, row.best_pair?.investigator ?? null);
    if (fromProfile.length) {
      ids = fromProfile;
      fallback = "profile";
    }
  }
  const evidence = ids.slice(0, max).map((id) => resolveEvidenceId(id, lookup));
  return { text, evidence, source, fallback };
}

/** The ids `rationaleView` would need resolved for a row (every candidate source), so a caller can look them up in one pass before rendering. */
export function evidenceIdsToResolve(row: RationaleInput, opts: Pick<RationaleOptions, "profileProvenance"> = {}): string[] {
  const out = new Set<string>();
  for (const id of citedEvidenceIds(row.rationale)) out.add(id);
  for (const id of row.top_items ?? []) out.add(id);
  for (const e of row.judged_evidence ?? []) out.add(e.ref);
  for (const id of profileFallbackIds(opts.profileProvenance, row.best_pair?.investigator ?? null)) out.add(id);
  return Array.from(out);
}

/** Pure. True when a row can cite nothing without the profile's provenance — the caller reads it only then. */
export function needsProfileFallback(row: RationaleInput): boolean {
  if (row.judged_at && (citedJudgedRefs(row.rationale, row.judged_evidence).length || row.judged_evidence?.length)) return false;
  return !citedEvidenceIds(row.rationale).length && !(row.top_items?.length ?? 0);
}

// ---------------------------------------------------------------------------
// Stage 8's marker
// ---------------------------------------------------------------------------

export type JudgedView = {
  /** The tier after adjudication (the row's tier; the sweep writes it). */
  tier: Tier | null;
  /** The engine's tier before stage 8. */
  from: Tier | null;
  confidence: ShownConfidence | null;
  at: string | null;
  changed: boolean;
  /** "judged · high". */
  label: string;
  /** The tooltip. */
  title: string;
};

const CONFIDENCE_WORD: Record<ShownConfidence, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence", review: "needs review", structured_only: "structure only" };

const tierWord = (t: Tier | null) => (t ? t[0]!.toUpperCase() + t.slice(1) : "unknown");

/** Pure. The "judged" marker of a row stage 8 has adjudicated; null for an engine-only row. */
export function judgedOf(row: Pick<FitResultListRow, "judged_at" | "judged_tier" | "judged_from" | "judged_confidence">): JudgedView | null {
  if (!row.judged_at) return null;
  const tier = row.judged_tier ?? null;
  const from = row.judged_from ?? null;
  const changed = Boolean(tier && from && tier !== from);
  const confidence = row.judged_confidence ?? null;
  const when = row.judged_at.slice(0, 10);
  const what = changed ? `${tierWord(from)} → ${tierWord(tier)}` : `confirmed ${tierWord(tier)}`;
  return {
    tier,
    from,
    confidence,
    at: row.judged_at,
    changed,
    label: `judged · ${confidence ? CONFIDENCE_WORD[confidence].replace(" confidence", "") : "reviewed"}`,
    title: `Stage 8 — blind pass, skeptic and reconciler — judged this pair on ${when}: ${what}${confidence ? ` (${CONFIDENCE_WORD[confidence]})` : ""}. The tier is the judged one; the engine's was ${tierWord(from)}.`,
  };
}

// ---------------------------------------------------------------------------
// The Outreach snapshot's rationale
// ---------------------------------------------------------------------------

export type SnapshotRationale = { text: string; evidence: EvidenceItem[]; fallback: "cited" | "research" | "funding" | "self" | "institutional" | "none" };

/**
 * Pure. The rationale a suggestion snapshot shows with the evidence it cites:
 * the first reason's text and its evidence ids resolved against the snapshot's
 * own evidence groups; a reason that cites nothing falls back to the first
 * research item, then funding, self-described, institutional — the roster
 * row is always there, so a shown suggestion is never without an item.
 */
export function snapshotRationale(s: { reasons: readonly SuggestionReason[]; groups: readonly EvidenceGroup[]; summary?: string | null }, max = 3): SnapshotRationale {
  const first = s.reasons[0] ?? null;
  const text = first?.text?.trim() || s.summary?.trim() || "No rationale stored.";
  const items = s.groups.flatMap((g) => g.items);
  const cited = (first?.evidenceIds ?? []).map((id) => items.find((it) => it.id === id)).filter((it): it is EvidenceItem => Boolean(it));
  if (cited.length) return { text, evidence: cited.slice(0, max), fallback: "cited" };
  for (const key of ["research", "funding", "self", "institutional"] as const) {
    const grp = s.groups.find((g) => g.key === key);
    if (grp?.items.length) return { text, evidence: grp.items.slice(0, max), fallback: key };
  }
  return { text, evidence: [], fallback: "none" };
}

/**
 * "Why this suggestion" (plan § PR 3.2, follow-up "3.2b"). Pure: the view model behind the
 * disclosure the fit rows now carry, over one `fit_results` detail row
 * (`FIT_RESULT_DETAIL_COLUMNS`) — no Supabase, no engine.
 *
 * The row's two sentences say what matched and what is missing. Everything
 * the engine used to shout in the row goes here instead, in the register of
 * the admin inspector at `/investigators/[id]/fit`: the nine components
 * against the floors of the tier above, the caps that held the tier, the
 * paradigm and unit pairs, the required designs with no support, the coded
 * topic matches with their MeSH tree depth, methods met and missing, the
 * mechanisms held against the notice's activity code, and the eligibility
 * rules Prospera could not check — those last quoted in the notice's own
 * words, which is why they belong behind a disclosure and not in a row.
 *
 * Every id is read through the display-label map on the way out, so the
 * panel shows no snake_case either.
 */
import { capLabel, COMPONENT_HELP, COMPONENT_LABEL, designLabel, displayLabel, EXCEPTION_LABEL, FIT_TIER_WORD, humanizeIds, paradigmLabel, unitLevelLabel } from "@/lib/fit/inspect/display-labels";
import type { FitResultDetailRow } from "@/lib/fit/results";
import { floors } from "@/lib/fit/taxonomy";
import type { CodedTopicMatch, Component, FloorTier, NumericFloorKey, Tier, UnmetFloor } from "@/lib/fit/types";

/** The order §8 names the components in; E is a pass/fail gate and is shown as one, not as a bar. */
export const COMPONENT_ORDER: readonly Component[] = ["P", "U", "D", "T", "M", "O", "K", "A"];

/** Components a tier sets a numeric floor on (§10 table). */
const FLOORED: ReadonlyArray<Component> = ["P", "U", "D", "T", "M", "K"];

/** The tier whose floors a row is measured against — the one above the tier the floors alone gave. */
export const NEXT_TIER_UP: Record<Tier, FloorTier | null> = { poor: "exploratory", exploratory: "moderate", moderate: "strong", strong: null };

export type ComponentRow = {
  key: Component;
  label: string;
  help: string;
  value: number;
  /** The floor the tier above sets on this component; null when it sets none ("any"). */
  floor: number | null;
  /** Above that floor; null when there is no floor to be above. */
  met: boolean | null;
};

/** A floor the next tier up wanted and this pair did not clear (§10). */
export type FloorRow = { key: NumericFloorKey; label: string; value: number; floor: number };

/** An eligibility rule, in the notice's own words where the notice supplied them. */
export type EligibilityNote = { text: string; kind: "failed" | "unchecked" };

export type PairDetail = {
  tier: Tier;
  tierWord: string;
  score: number;
  computedAt: string;
  engineVersion: string;
  components: ComponentRow[];
  /** The tier the floors alone gave, and the tier those floors were measured against. */
  floorsTier: Tier | null;
  measuredAgainst: FloorTier | null;
  floorsMissed: FloorRow[];
  /** Why the tier was held down, as reasons rather than cap ids. */
  caps: string[];
  paradigm: { pair: string | null; view: string | null; excluded: string | null; exception: string | null };
  unit: string | null;
  design: { unmet: string[]; prohibited: string | null };
  topic: { codes: CodedTopicMatch[]; items: string[] };
  methods: { met: string[]; missing: string[] };
  track: { held: string[]; activityCode: string | null };
  eligibility: EligibilityNote[];
  collaborators: string[];
  flags: string[];
};

const FLOOR_KEY_LABEL: Record<NumericFloorKey, string> = {
  P: "Paradigm",
  U: "Unit of analysis",
  D: "Study design",
  T: "Topic",
  M: "Methods",
  K: "Track record",
  D_required_group_min: "Every required design group",
  T_specific_depth: "A coded topic match at this tree depth",
  P_with_aspiration: "Paradigm, with a stated aspiration",
};

const list = (xs: readonly string[] | null | undefined): string[] => (xs ?? []).filter((x) => typeof x === "string" && x.trim().length > 0);

/** Pure. The numeric floor a tier sets on a component, or null when it sets none. */
export function floorFor(tier: FloorTier | null, key: Component): number | null {
  if (!tier || !FLOORED.includes(key)) return null;
  const v = floors(tier)[key as "P" | "U" | "D" | "T" | "M" | "K"];
  return typeof v === "number" ? v : null;
}

/** Pure. The eight scored components against the floors of the tier above, in §8 order. */
export function componentRows(components: Partial<Record<Component, number>> | null | undefined, against: FloorTier | null): ComponentRow[] {
  return COMPONENT_ORDER.map((key) => {
    const value = Math.max(0, Math.min(1, Number(components?.[key] ?? 0)));
    const floor = floorFor(against, key);
    return { key, label: COMPONENT_LABEL[key], help: COMPONENT_HELP[key], value, floor, met: floor === null ? null : value >= floor };
  });
}

/** Pure. The floors the next tier up wanted, named rather than keyed. */
export function floorRows(unmet: readonly UnmetFloor[] | null | undefined): FloorRow[] {
  return (unmet ?? [])
    .filter((f) => f && typeof f.floor === "number" && typeof f.value === "number")
    .map((f) => ({ key: f.key, label: FLOOR_KEY_LABEL[f.key] ?? displayLabel(String(f.key)), value: f.value, floor: f.floor }));
}

/** Pure. The eligibility rules behind the row: the ones that failed, then the ones Prospera could not check (the notice's words, quoted). */
export function eligibilityNotes(row: Pick<FitResultDetailRow, "e_failed" | "e_unknown">): EligibilityNote[] {
  return [
    ...list(row.e_failed).map((text): EligibilityNote => ({ text: humanizeIds(text), kind: "failed" })),
    ...list(row.e_unknown).map((text): EligibilityNote => ({ text: humanizeIds(text), kind: "unchecked" })),
  ];
}

/** Pure. One stored pair as the disclosure reads it. */
export function pairDetail(row: FitResultDetailRow): PairDetail {
  const floorsTier = row.floors_tier ?? null;
  const measuredAgainst = NEXT_TIER_UP[floorsTier ?? row.tier] ?? null;
  const pPair = row.p_best_pair;
  const uPair = row.u_best_pair;
  return {
    tier: row.tier,
    tierWord: FIT_TIER_WORD[row.tier],
    score: Number(row.score),
    computedAt: row.computed_at,
    engineVersion: row.engine_version,
    components: componentRows(row.components, measuredAgainst),
    floorsTier,
    measuredAgainst,
    floorsMissed: floorRows(row.floors_unmet),
    caps: list(row.caps).map((c) => capLabel(c)),
    paradigm: {
      pair: pPair ? `${paradigmLabel(pPair.investigator)} → ${paradigmLabel(pPair.notice)}` : null,
      view: row.p_view === "recent" ? "recent work only" : row.p_view === "career" ? "the whole career" : null,
      excluded: row.p_excluded ? paradigmLabel(row.p_excluded) : null,
      exception: row.p_exception ? EXCEPTION_LABEL[row.p_exception as keyof typeof EXCEPTION_LABEL] ?? displayLabel(row.p_exception) : null,
    },
    unit: uPair ? `${unitLevelLabel(uPair.investigator)} → ${unitLevelLabel(uPair.notice)}` : null,
    design: {
      unmet: (row.d_unmet ?? []).filter((g) => Array.isArray(g) && g.length).map((g) => g.map((d) => designLabel(d)).join(" or ")),
      prohibited: row.d_prohibited ? designLabel(row.d_prohibited) : null,
    },
    topic: {
      codes: (row.t_coded ?? []).filter((m) => m && typeof m.code === "string").slice(0, 24),
      items: list(row.t_items),
    },
    methods: { met: list(row.m_met), missing: list(row.m_missing) },
    track: { held: list(row.k_held), activityCode: row.k_code ?? null },
    eligibility: eligibilityNotes(row),
    collaborators: list(row.collaborators),
    flags: list(row.flags).map((f) => humanizeIds(f)),
  };
}

/** Pure. Detail rows keyed by the id that varies on the surface reading them. */
export function detailsBy<K extends "investigator_id" | "opportunity_id">(rows: readonly FitResultDetailRow[], key: K): Map<string, PairDetail> {
  return new Map(rows.map((r) => [r[key], pairDetail(r)]));
}

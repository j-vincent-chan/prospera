/**
 * What the ranking ran on (plan § PR 3.2, follow-up "3.2b"). Pure: a view model over the small
 * columns of `investigator_fit_profiles` and the newest `computed_at` among
 * the rows a page shows — no Supabase.
 *
 * The groups used to be introduced by "refreshed nightly", which answers a
 * question nobody asks. What a strategist needs before trusting a list is
 * three facts: what the ranking read, when it ran, and what it could not
 * read. The third is the one that changes a decision — a profile with no
 * biosketch and no self-declared axes is ranking on publications alone, and
 * a thin Exploratory list is then a fact about the profile, not about the
 * person.
 */
import { CONFIDENCE_WORD } from "@/lib/fit/inspect/display-labels";
import { axisLabel, type InspectAxis } from "@/lib/fit/inspect/labels";
import type { AxisConfidence, Confidence, EvidenceSummary } from "@/lib/fit/types";

/** The columns the surface reads; `confidence` and `evidence_summary` are JSON, so anything may be missing. */
export type ProfileStateRow = {
  taxonomy_version: string | null;
  item_count: number | null;
  pending_items: number | null;
  computed_at: string | null;
  confidence: Partial<AxisConfidence> | null;
  evidence_summary: Partial<EvidenceSummary> | null;
};

export type ProfileState = {
  /** Items the profile was built over; null when the count is not on file. */
  itemCount: number | null;
  /** "187 publications · 22 NIH awards · 5 trials" — the kinds behind the count. */
  sources: string[];
  /** When the profile was built (ISO), and when the newest shown row was scored (ISO). */
  builtAt: string | null;
  rankedAt: string | null;
  taxonomyVersion: string | null;
  /** What the ranking could not use, in plain language; empty when nothing is missing. */
  gaps: string[];
  /** No stored profile at all — the sweep has nothing to rank on. */
  missing: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A biosketch counts as usable only once it is actually on file. */
const BIOSKETCH_ON_FILE = new Set(["on_file", "available"]);

/** The five structured axes plus topic, in the order the inspector lists them. */
const AXES: readonly InspectAxis[] = ["paradigm", "unit", "design", "materials", "objective", "topic"];

/** Pure. The evidence kinds behind the item count, largest first, zeros dropped. */
export function evidenceSources(summary: Partial<EvidenceSummary> | null | undefined): string[] {
  const s = summary ?? {};
  const parts: Array<[number, string]> = [
    [Number(s.publications_verified ?? 0), "verified publication"],
    [Number(s.grants ?? 0), "NIH award"],
    [Number(s.trials ?? 0), "registered trial"],
  ];
  return parts.filter(([n]) => n > 0).map(([n, word]) => plural(n, word));
}

/** Pure. What the ranking could not use — the sources with nothing on file, the axes it could not read confidently, and the items still queued. */
export function profileGaps(row: ProfileStateRow): string[] {
  const gaps: string[] = [];
  const s = row.evidence_summary ?? {};
  if (!BIOSKETCH_ON_FILE.has(String(s.biosketch ?? ""))) gaps.push("no biosketch on file");
  if (!s.self_declared) gaps.push("no self-declared research axes");
  if (Number(s.publications_verified ?? 0) === 0) gaps.push("no verified publications");
  if (Number(s.grants ?? 0) === 0) gaps.push("no NIH awards on file");
  const low = AXES.filter((a) => (row.confidence?.[a] as Confidence | undefined) === "low");
  if (low.length) gaps.push(`${low.map((a) => axisLabel(a).toLowerCase()).join(", ")} read at ${CONFIDENCE_WORD.low} confidence`);
  const pending = Number(row.pending_items ?? 0);
  if (pending > 0) gaps.push(`${plural(pending, "item")} still waiting to be classified`);
  return gaps;
}

/** Pure. The profile-state line above the groups; `rankedAt` is the newest `fit_results.computed_at` among the shown rows. */
export function profileState(row: ProfileStateRow | null, rankedAt: string | null): ProfileState {
  if (!row) return { itemCount: null, sources: [], builtAt: null, rankedAt, taxonomyVersion: null, gaps: [], missing: true };
  const itemCount = row.item_count === null || row.item_count === undefined ? null : Number(row.item_count);
  return {
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
    sources: evidenceSources(row.evidence_summary),
    builtAt: row.computed_at ?? null,
    rankedAt,
    taxonomyVersion: row.taxonomy_version ?? null,
    gaps: profileGaps(row),
    missing: false,
  };
}

/** Pure. The newest timestamp among the rows a page shows; null when it shows none. */
export function newestComputedAt(rows: ReadonlyArray<{ computed_at?: string | null }>): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const at = r.computed_at ?? null;
    if (at && (best === null || at > best)) best = at;
  }
  return best;
}

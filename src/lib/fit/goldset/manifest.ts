/**
 * The versioned gold set (plan § PR 2.4; spec §14 "the set is versioned and
 * grows with the feedback loop"): `docs/fit-engine/goldset/goldset-v1.manifest.json`
 * is the set — pairs, strata, cell coverage, seed, engine and taxonomy
 * versions, the grid tallies behind the 30 % rule, and the display
 * summaries the CSV and the labeling page show — written by
 * scripts/fit-goldset-export.ts and imported here at build time (one file,
 * no copy under src/, no database table: the page reads the manifest from
 * the bundle and only the labels from the database). The file is FROZEN
 * once written: the export refuses to overwrite it without `--force`, and
 * with `--force` refuses while `fit_labels` holds gold rows for it — a new
 * draw is a new `--version`. Editing the manifest or `labelers.json` takes
 * a rebuild and a redeploy to reach the page.
 *
 * `labelers.json` beside it names the two labelers and the adjudicator by
 * email or auth user id once D4 is decided; while A and B are null the page
 * assigns those two slots by order of first label (goldset/labels.ts); the
 * adjudicator slot exists only from this file.
 */
import manifestJson from "../../../../docs/fit-engine/goldset/goldset-v1.manifest.json";
import labelersJson from "../../../../docs/fit-engine/goldset/labelers.json";
import type { FamilySlot } from "@/lib/fit/goldset/families";
import type { LegacyTier } from "@/lib/fit/goldset/legacy";
import type { SpecStratum, Stratum } from "@/lib/fit/goldset/stratify";
import type { Confidence, Tier } from "@/lib/fit/types";

export const GOLDSET_VERSION = "v1";
export const GOLDSET_DIR = "docs/fit-engine/goldset";
export const GOLDSET_MANIFEST_PATH = `${GOLDSET_DIR}/goldset-${GOLDSET_VERSION}.manifest.json`;
export const GOLDSET_CSV_PATH = `${GOLDSET_DIR}/goldset-${GOLDSET_VERSION}.csv`;
export const LABELERS_PATH = `${GOLDSET_DIR}/labelers.json`;

export type ManifestInvestigator = {
  name: string;
  /** Dominant paradigm category on the engine's view, with its label and family. */
  dominant: { category: string | null; label: string; family: FamilySlot; weight: number; view: "recent" | "career" };
  /** Top evidence titles behind the dominant category (provenance top-3, resolved); for a synthetic investigator, the fixture narrative. */
  evidence: string[];
  item_count: number;
  pending_items: number;
  paradigm_confidence: Confidence;
  /** `evidence_embeddings` rows for this person — the legacy rule's items (0 for a synthetic investigator). */
  evidence_vectors: number;
};

export type ManifestNotice = {
  number: string;
  title: string;
  /** `funding_opportunities.clinical_trial_designation`, humanized ("Clinical Trial Required" …). */
  designation: string;
  activity_code: string | null;
  family: FamilySlot;
  family_from: "required" | "required_any" | "none";
  /** Section I / Part 1 Purpose (≤ 600 characters). */
  excerpt: string;
  excerpt_source: string;
};

export type ManifestAtExport = {
  fit_v1_tier: Tier | null;
  legacy_tier: LegacyTier;
  /** The pair's rank in the investigator page's window (1-based, ≤ `legacy.top_hits`); null outside it or without a vector. */
  legacy_rank: number | null;
  legacy_similarity: number | null;
  outreach_tier: string | null;
  /** The bucket the pair was drawn from: "outreach:strong", "legacy:potential", "cell:discovery->population", "synthetic:<case>", "random", "thin", "fit_v1:moderate". */
  source: string;
};

export type ManifestPair = {
  /** `g001` … — the CSV's `pair_id`. */
  id: string;
  investigator_id: string;
  opportunity_id: string;
  stratum: Stratum;
  cell: { investigator: FamilySlot; notice: FamilySlot };
  forbidden: boolean;
  /** Built from the adversarial fixture (goldset/synthetic.ts): no vector, no legacy score; its `fit_labels` rows carry `synthetic_source` instead of `investigator_id`. */
  synthetic: boolean;
  /** The fixture case behind a synthetic pair; null otherwise. */
  synthetic_source: string | null;
  sources: string[];
  at_export: ManifestAtExport;
  investigator: ManifestInvestigator;
  notice: ManifestNotice;
};

export type LegacyGridTally = {
  /** Roster investigators with a document vector (the only ones the page ranks). */
  investigators: number;
  /** The page's candidate set: open notices with an embedding. */
  candidates: number;
  /** Every roster × candidate pair; an investigator without a vector contributes dropped pairs only. */
  pairs: number;
  /** The page rule over those pairs: shown tiers, then not_shown (in the window, behind the five) and dropped. */
  strong: number;
  potential: number;
  exploratory: number;
  not_shown: number;
  dropped: number;
  /** Shown pairs whose notice is outside the profiled corpus (fit-v1 never scores them). */
  shown_outside_corpus: number;
};

export type FitResultsGridTally = {
  /** Stored `fit_results` rows for roster investigators over the open profiled corpus. */
  investigators: number;
  notices: number;
  pairs: number;
  strong: number;
  moderate: number;
  exploratory: number;
  poor: number;
  /** Roster × corpus pairs with no stored row. */
  none: number;
};

export type GoldsetManifest = {
  version: string;
  seed: number;
  generated_at: string;
  taxonomy_version: string;
  engine_version: string;
  /** The legacy rule's thresholds and window: `top_hits` (the `match_opportunities` count), `shown_top_n` (what the page shows), `evidence_items` (the top-6 rule). */
  legacy: { sim: Record<string, number>; top_hits: number; shown_top_n: number; evidence_items: number };
  quotas: Record<SpecStratum, number>;
  counts: Record<Stratum, number>;
  corpus: { investigators: number; notices: number; investigators_with_vector: number; notices_with_vector: number; legacy_candidates: number; evidence_vectors: number; fit_results_available: boolean; outreach_snapshots: number };
  /** The 30 % rule's inputs (spec §14 "Rollout comparison"): each engine's list over the whole grid, not the set. */
  legacy_grid: LegacyGridTally;
  fit_results_grid: FitResultsGridTally;
  current_mix: { pool: Record<string, number>; drawn: Record<string, number> };
  fit_v1_mix: { pool: Record<string, number>; drawn_elsewhere: number; supplementary: number };
  cells: {
    covered: Array<{ key: string; forbidden: boolean; synthetic: boolean; candidates: number; pairs: number }>;
    uncovered: Array<{ key: string; forbidden: boolean; reason: string }>;
    forbidden_total: number;
    forbidden_covered: number;
    synthetic: number;
  };
  synthetic_investigators: Array<{ id: string; source: string; name: string; family: FamilySlot; pairs: number }>;
  dropped_investigators: Array<{ id: string; name: string; item_count: number; paradigm_confidence: Confidence; pairs: number }>;
  shortfalls: string[];
  pairs: ManifestPair[];
};

export type LabelerConfig = {
  /** Email or auth user id of labeler A, B and the adjudicator; null = unassigned (A and B by order of first label; no adjudicator). */
  a: string | null;
  b: string | null;
  adjudicator: string | null;
};

export const GOLDSET_MANIFEST = manifestJson as unknown as GoldsetManifest;

const labelersRaw = labelersJson as unknown as Partial<LabelerConfig> & Record<string, unknown>;

/** The configured labelers (null slots when D4 is still open). */
export const LABELER_CONFIG: LabelerConfig = {
  a: typeof labelersRaw.a === "string" && labelersRaw.a.trim() ? labelersRaw.a.trim() : null,
  b: typeof labelersRaw.b === "string" && labelersRaw.b.trim() ? labelersRaw.b.trim() : null,
  adjudicator: typeof labelersRaw.adjudicator === "string" && labelersRaw.adjudicator.trim() ? labelersRaw.adjudicator.trim() : null,
};

/** The configured values, one list, for `loadLabelerIdentities`. */
export const LABELER_CONFIG_VALUES: readonly string[] = [LABELER_CONFIG.a, LABELER_CONFIG.b, LABELER_CONFIG.adjudicator].filter((x): x is string => Boolean(x));

export function goldsetPairs(): ManifestPair[] {
  return GOLDSET_MANIFEST.pairs;
}

export function manifestPairByKey(manifest: Pick<GoldsetManifest, "pairs"> = GOLDSET_MANIFEST): Map<string, ManifestPair> {
  return new Map(manifest.pairs.map((p) => [`${p.investigator_id}|${p.opportunity_id}`, p]));
}

export function manifestPairById(manifest: Pick<GoldsetManifest, "pairs"> = GOLDSET_MANIFEST): Map<string, ManifestPair> {
  return new Map(manifest.pairs.map((p) => [p.id, p]));
}

/** Pure. Pairs added and removed between two manifests, by (investigator, notice) — the `--force` report. */
export function diffManifestPairs(before: Pick<GoldsetManifest, "pairs">, after: Pick<GoldsetManifest, "pairs">): { added: ManifestPair[]; removed: ManifestPair[]; kept: number } {
  const b = manifestPairByKey(before);
  const a = manifestPairByKey(after);
  const added = after.pairs.filter((p) => !b.has(`${p.investigator_id}|${p.opportunity_id}`));
  const removed = before.pairs.filter((p) => !a.has(`${p.investigator_id}|${p.opportunity_id}`));
  return { added, removed, kept: after.pairs.length - added.length };
}

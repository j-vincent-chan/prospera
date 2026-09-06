/**
 * The versioned gold set (plan § PR 2.4; spec §14 "the set is versioned and
 * grows with the feedback loop"): `docs/fit-engine/goldset/goldset-v1.manifest.json`
 * is the set — pairs, strata, cell coverage, seed, engine and taxonomy
 * versions, and the display summaries the CSV and the labeling page show
 * — written by scripts/fit-goldset-export.ts and imported here at build
 * time (one file, no copy under src/, no database table: the page reads
 * the manifest from the bundle and only the labels from the database).
 *
 * `labelers.json` beside it names the two labelers and the adjudicator by
 * email or auth user id once D4 is decided; while its slots are null the
 * page assigns slots by order of first label (goldset/labels.ts).
 */
import manifestJson from "../../../../docs/fit-engine/goldset/goldset-v1.manifest.json";
import labelersJson from "../../../../docs/fit-engine/goldset/labelers.json";
import type { FamilySlot } from "@/lib/fit/goldset/families";
import type { LegacyTier } from "@/lib/fit/goldset/legacy";
import type { Stratum } from "@/lib/fit/goldset/stratify";
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
  /** Top evidence titles behind the dominant category (provenance top-3, resolved). */
  evidence: string[];
  item_count: number;
  pending_items: number;
  paradigm_confidence: Confidence;
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
  legacy_similarity: number | null;
  outreach_tier: string | null;
};

export type ManifestPair = {
  /** `g001` … — the CSV's `pair_id`. */
  id: string;
  investigator_id: string;
  opportunity_id: string;
  stratum: Stratum;
  cell: { investigator: FamilySlot; notice: FamilySlot };
  forbidden: boolean;
  sources: string[];
  at_export: ManifestAtExport;
  investigator: ManifestInvestigator;
  notice: ManifestNotice;
};

export type GoldsetManifest = {
  version: string;
  seed: number;
  generated_at: string;
  taxonomy_version: string;
  engine_version: string;
  legacy: { sim: Record<string, number>; top_hits: number; evidence_items: number };
  quotas: Record<Stratum, number>;
  counts: Record<Stratum, number>;
  corpus: { investigators: number; notices: number; investigators_with_vector: number; notices_with_vector: number; evidence_vectors: number; fit_results_available: boolean; outreach_snapshots: number };
  current_mix: { pool: Record<string, number>; drawn: Record<string, number> };
  cells: {
    covered: Array<{ key: string; forbidden: boolean; candidates: number; pairs: number }>;
    uncovered: Array<{ key: string; forbidden: boolean; reason: string }>;
    forbidden_total: number;
    forbidden_covered: number;
  };
  dropped_investigators: Array<{ id: string; name: string; item_count: number; paradigm_confidence: Confidence; pairs: number }>;
  shortfalls: string[];
  pairs: ManifestPair[];
};

export type LabelerConfig = {
  /** Email or auth user id of labeler A, B and the adjudicator; null = unassigned (slots by order of first label). */
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

export function goldsetPairs(): ManifestPair[] {
  return GOLDSET_MANIFEST.pairs;
}

export function manifestPairByKey(manifest: Pick<GoldsetManifest, "pairs"> = GOLDSET_MANIFEST): Map<string, ManifestPair> {
  return new Map(manifest.pairs.map((p) => [`${p.investigator_id}|${p.opportunity_id}`, p]));
}

export function manifestPairById(manifest: Pick<GoldsetManifest, "pairs"> = GOLDSET_MANIFEST): Map<string, ManifestPair> {
  return new Map(manifest.pairs.map((p) => [p.id, p]));
}

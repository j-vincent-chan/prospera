/**
 * `fit_results` rows (plan § PR 2.2): the stored shape of the pure engine's
 * FitResult, the converters both ways, the reads the three surfaces do under
 * `fit_engine = 'fit-v1'`, and the tier map onto the Outreach snapshot's
 * three-value vocabulary. Light on purpose — no engine, no profile builder —
 * so the page renders and the suggestion runner import nothing heavy.
 *
 * Reads answer `available: false` while the table is not on the database
 * (the migration is written, not applied) instead of throwing, the way
 * the inspector treats `fit_labels`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuggestionTier } from "@/lib/outreach/types";
import type { CapId, Components, FitProvenance, FitResult, Tier } from "@/lib/fit/types";

export const FIT_RESULTS_MIGRATION = "supabase/migrations/20260917100000_fit_results_and_engine_flag.sql";

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet). */
export const MISSING_TABLE = /could not find the table|relation .* does not exist|schema cache/i;

/** One row of `fit_results`. `provenance` carries the engine module version beside the stage provenance. */
export type FitResultRow = {
  investigator_id: string;
  opportunity_id: string;
  /** The taxonomy version the pair was scored under — the flag value (`fit-v1`). */
  engine_version: string;
  components: Components;
  caps: CapId[];
  score: number;
  tier: Tier;
  provenance: FitProvenance & { engine: string };
  adjudication: unknown | null;
  rationale: string | null;
  why_not: string | null;
  gap: string | null;
  flags: string[];
  computed_at: string;
};

export const FIT_RESULT_COLUMNS = "investigator_id, opportunity_id, engine_version, components, caps, score, tier, provenance, adjudication, rationale, why_not, gap, flags, computed_at";

/** Pure. The row a FitResult is stored as. */
export function toFitResultRow(r: FitResult): FitResultRow {
  return {
    investigator_id: r.investigator_id,
    opportunity_id: r.opportunity_id,
    engine_version: r.taxonomy_version,
    components: { ...r.components },
    caps: [...r.caps],
    score: Number(r.score.toFixed(4)),
    tier: r.tier,
    provenance: { ...r.provenance, engine: r.engine_version },
    adjudication: null,
    rationale: r.rationale,
    why_not: r.why_not,
    gap: r.gap,
    flags: [...r.flags],
    computed_at: r.computed_at,
  };
}

/** Pure. A stored row back as a FitResult (numeric columns arrive as strings from PostgREST). */
export function fromFitResultRow(row: FitResultRow): FitResult {
  const { engine, ...provenance } = row.provenance ?? ({} as FitResultRow["provenance"]);
  return {
    investigator_id: row.investigator_id,
    opportunity_id: row.opportunity_id,
    engine_version: engine ?? "",
    taxonomy_version: row.engine_version,
    computed_at: row.computed_at,
    components: row.components,
    caps: row.caps ?? [],
    score: Number(row.score),
    tier: row.tier,
    provenance: provenance as FitProvenance,
    flags: row.flags ?? [],
    gap: row.gap ?? null,
    why_not: row.why_not ?? null,
    rationale: row.rationale ?? null,
  };
}

/** The Outreach snapshot's tier for a fit tier: Strong → strong, Moderate → potential, Exploratory → exploratory; Poor is not surfaced (null). */
export function suggestionTierOf(tier: Tier): SuggestionTier | null {
  switch (tier) {
    case "strong":
      return "strong";
    case "moderate":
      return "potential";
    case "exploratory":
      return "exploratory";
    default:
      return null;
  }
}

export type FitResultsRead = { rows: FitResultRow[]; available: boolean; error: string | null };

const PAGE = 1000;

async function readRows(db: SupabaseClient, build: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => ReturnType<ReturnType<SupabaseClient["from"]>["select"]>, max: number): Promise<FitResultsRead> {
  const rows: FitResultRow[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    const { data, error } = await build(db.from("fit_results").select(FIT_RESULT_COLUMNS)).range(from, to);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { rows: [], available: false, error: null };
      return { rows: [], available: true, error: error.message };
    }
    const page = (data ?? []) as FitResultRow[];
    rows.push(...page.map((r) => ({ ...r, score: Number(r.score) })));
    if (page.length < to - from + 1) break;
  }
  return { rows, available: true, error: null };
}

/** The scored notices of one investigator, best first; `tiers` narrows (default: every tier). */
export async function loadFitResultsForInvestigator(db: SupabaseClient, investigatorId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows(
    db,
    (q) => {
      let b = q.eq("investigator_id", investigatorId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("opportunity_id");
    },
    limit
  );
}

/** The scored investigators of one notice, best first. */
export async function loadFitResultsForNotice(db: SupabaseClient, opportunityId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows(
    db,
    (q) => {
      let b = q.eq("opportunity_id", opportunityId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("investigator_id");
    },
    limit
  );
}

/** Every row of a set of investigators (the community fits cache), in chunks. */
export async function loadFitResultsForInvestigators(db: SupabaseClient, investigatorIds: readonly string[], opts: { tiers?: Tier[] } = {}): Promise<FitResultsRead> {
  const all: FitResultRow[] = [];
  for (let i = 0; i < investigatorIds.length; i += 50) {
    const slice = investigatorIds.slice(i, i + 50);
    const r = await readRows(
      db,
      (q) => {
        let b = q.in("investigator_id", slice);
        if (opts.tiers?.length) b = b.in("tier", opts.tiers);
        return b.order("investigator_id").order("opportunity_id");
      },
      100_000
    );
    if (!r.available || r.error) return r;
    all.push(...r.rows);
  }
  return { rows: all, available: true, error: null };
}

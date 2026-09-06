/**
 * `fit_results` rows (plan § PR 2.2): the stored shape of the pure engine's
 * FitResult, the converters both ways, the reads the three surfaces do under
 * `fit_engine = 'fit-v1'`, and the tier map onto the Outreach snapshot's
 * three-value vocabulary. Light on purpose — no engine, no profile builder —
 * so the page renders and the suggestion runner import nothing heavy.
 *
 * A Poor row is trimmed: `components`, `caps`, `why_not`, `flags` and `gap`
 * are kept (the "Why not?" and the inspector need them) but `provenance` is
 * only `{ engine, E, P }` and `rationale` is null — the stage-5 item lists,
 * the per-stage pairs and the component clauses that make a row large are
 * stored for Strong / Moderate / Exploratory only, the three tiers the
 * surfaces read. `fromFitResultRow` fills a Poor row's
 * missing stages with empty provenance so the FitResult shape stays total.
 *
 * Reads answer `available: false` while the table is not on the database
 * (the migration is written, not applied) instead of throwing, the way
 * the inspector treats `fit_labels`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuggestionTier } from "@/lib/outreach/types";
import type { CapId, Components, FitProvenance, FitResult, InvestigatorFitProfile, Tier } from "@/lib/fit/types";

export const FIT_RESULTS_MIGRATION = "supabase/migrations/20260917100000_fit_results_and_engine_flag.sql";

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet). */
export const MISSING_TABLE = /could not find the table|relation .* does not exist|schema cache/i;

/** The stub provenance a Poor row stores: the engine module version and the two gate stages. */
export type PoorProvenance = { engine: string; E: FitProvenance["E"]; P: FitProvenance["P"] };

/** One row of `fit_results`. `provenance` carries the engine module version beside the stage provenance (a Poor row: the stub only). */
export type FitResultRow = {
  investigator_id: string;
  opportunity_id: string;
  /** The taxonomy version the pair was scored under — the flag value (`fit-v1`). */
  engine_version: string;
  components: Components;
  caps: CapId[];
  score: number;
  tier: Tier;
  provenance: (FitProvenance & { engine: string }) | PoorProvenance;
  adjudication: unknown | null;
  rationale: string | null;
  why_not: string | null;
  gap: string | null;
  flags: string[];
  computed_at: string;
};

export const FIT_RESULT_COLUMNS = "investigator_id, opportunity_id, engine_version, components, caps, score, tier, provenance, adjudication, rationale, why_not, gap, flags, computed_at";

/** The four columns the community fits cache aggregates over. */
export const FIT_RESULT_KEY_COLUMNS = "investigator_id, opportunity_id, tier, score";

export type FitResultKeyRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score">;

/** Pure. The provenance a row stores: the full stage provenance, or the stub for a Poor pair. */
export function storedProvenance(r: Pick<FitResult, "tier" | "provenance" | "engine_version">): FitResultRow["provenance"] {
  if (r.tier === "poor") return { engine: r.engine_version, E: r.provenance.E, P: r.provenance.P };
  return { ...r.provenance, engine: r.engine_version };
}

/** Pure. Empty provenance for the stages a Poor row does not store. */
export function emptyProvenance(): FitProvenance {
  return {
    E: { failed: [], unknown: [] },
    P: { view: "recent", best_pair: null, excluded_hit: null, exception: null },
    U: { best_pair: null },
    D: { unmet_required: [], dominant_prohibited: null },
    T: { top_items: [], coded_matches: [] },
    M: { met: [], missing: [] },
    K: { mechanisms_held: [], activity_code: null },
    A: { runway_weeks: null, in_pipeline: false, recently_dismissed: false },
    floors: { tier_by_floors: "poor", unmet: [] },
    collaborators: [],
  };
}

/** Pure. The row a FitResult is stored as (a Poor pair with the stub provenance). */
export function toFitResultRow(r: FitResult): FitResultRow {
  return {
    investigator_id: r.investigator_id,
    opportunity_id: r.opportunity_id,
    engine_version: r.taxonomy_version,
    components: { ...r.components },
    caps: [...r.caps],
    score: Number(r.score.toFixed(4)),
    tier: r.tier,
    provenance: storedProvenance(r),
    adjudication: null,
    rationale: r.tier === "poor" ? null : r.rationale,
    why_not: r.why_not,
    gap: r.gap,
    flags: [...r.flags],
    computed_at: r.computed_at,
  };
}

/** Pure. A stored row back as a FitResult (numeric columns arrive as strings from PostgREST; a Poor row's missing stages are empty). */
export function fromFitResultRow(row: FitResultRow): FitResult {
  const { engine, ...stored } = row.provenance ?? ({} as FitResultRow["provenance"]);
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
    provenance: { ...emptyProvenance(), ...stored },
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

export type FitResultsRead<Row = FitResultRow> = { rows: Row[]; available: boolean; error: string | null };

const PAGE = 1000;

type Builder = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function readRows<Row extends Pick<FitResultRow, "score">>(db: SupabaseClient, columns: string, build: (q: Builder) => Builder, max: number): Promise<FitResultsRead<Row>> {
  const rows: Row[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    const { data, error } = await build(db.from("fit_results").select(columns)).range(from, to);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { rows: [], available: false, error: null };
      return { rows: [], available: true, error: error.message };
    }
    const page = (data ?? []) as Row[];
    rows.push(...page.map((r) => ({ ...r, score: Number(r.score) })));
    if (page.length < to - from + 1) break;
  }
  return { rows, available: true, error: null };
}

/** The scored notices of one investigator, best first; `tiers` narrows (default: every tier). */
export async function loadFitResultsForInvestigator(db: SupabaseClient, investigatorId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows<FitResultRow>(
    db,
    FIT_RESULT_COLUMNS,
    (q) => {
      let b = q.eq("investigator_id", investigatorId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("opportunity_id");
    },
    limit
  );
}

/** The scored investigators of one notice, best first; `tiers` narrows (default: every tier). */
export async function loadFitResultsForNotice(db: SupabaseClient, opportunityId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows<FitResultRow>(
    db,
    FIT_RESULT_COLUMNS,
    (q) => {
      let b = q.eq("opportunity_id", opportunityId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("investigator_id");
    },
    limit
  );
}

/** The stored investigator fit profiles, id order, for a pure pass (the fit-v1 eligibility list in `runSuggestions`); `available: false` before the PR 1.4 migration. */
export async function loadInvestigatorFitProfiles(db: SupabaseClient): Promise<{ rows: Array<{ investigator_id: string; profile: InvestigatorFitProfile }>; available: boolean; error: string | null }> {
  const rows: Array<{ investigator_id: string; profile: InvestigatorFitProfile }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("investigator_fit_profiles").select("investigator_id, profile").order("investigator_id").range(from, from + PAGE - 1);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { rows: [], available: false, error: null };
      return { rows: [], available: true, error: error.message };
    }
    const page = (data ?? []) as Array<{ investigator_id: string; profile: InvestigatorFitProfile }>;
    rows.push(...page.filter((r) => r.profile));
    if (page.length < PAGE) break;
  }
  return { rows, available: true, error: null };
}

/** The (investigator, notice, tier, score) rows of a set of investigators — the four columns the community fits cache aggregates — in chunks. */
export async function loadFitResultsForInvestigators(db: SupabaseClient, investigatorIds: readonly string[], opts: { tiers?: Tier[] } = {}): Promise<FitResultsRead<FitResultKeyRow>> {
  const all: FitResultKeyRow[] = [];
  for (let i = 0; i < investigatorIds.length; i += 50) {
    const slice = investigatorIds.slice(i, i + 50);
    const r = await readRows<FitResultKeyRow>(
      db,
      FIT_RESULT_KEY_COLUMNS,
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

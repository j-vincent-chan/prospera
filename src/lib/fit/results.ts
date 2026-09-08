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
import type { Adjudication, ShownConfidence } from "@/lib/fit/judge/types";
import type { CapId, CodedTopicMatch, Components, FitProvenance, FitResult, InvestigatorFitProfile, Tier, UnmetFloor } from "@/lib/fit/types";

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
  /** Stage 8's compact summary (PR 3.1 `judge/types.ts`); null until the pair is judged. */
  adjudication: Adjudication | null;
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

/** Pure. The row a FitResult is stored as (a Poor pair with the stub provenance); `adjudication` when stage 8 has judged the pair. */
export function toFitResultRow(r: FitResult, adjudication: Adjudication | null = null): FitResultRow {
  return {
    investigator_id: r.investigator_id,
    opportunity_id: r.opportunity_id,
    engine_version: r.taxonomy_version,
    components: { ...r.components },
    caps: [...r.caps],
    score: Number(r.score.toFixed(4)),
    tier: r.tier,
    provenance: storedProvenance(r),
    adjudication,
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

/** The order the surfaces list pairs in: Strong, Moderate, Exploratory, Poor. */
export const TIER_RANK: Record<Tier, number> = { strong: 0, moderate: 1, exploratory: 2, poor: 3 };

/** The tiers a list surface shows, in `TIER_RANK` order; Poor is hidden — shown only under "Why not?" (`loadWhyNotForInvestigator`, PR 3.2). */
export const SURFACED_TIERS: Tier[] = ["strong", "moderate", "exploratory"];

/**
 * Pure. Best first: tier rank, then score descending, then `id` for a stable
 * order. A tier is a set of floors, not a score band (spec §10: "a candidate
 * with S = 70 and an unmet methods floor is Moderate"), so a Moderate can
 * outscore a Strong — score order alone would list it first.
 */
export function compareFitRows<R extends { tier: Tier; score: number }>(a: R, b: R, id: (r: R) => string): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || Number(b.score) - Number(a.score) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
}

/** The six summary columns (PR 2.3): the key, the tier, the score and the two sentences (rationale, Exploratory gap). */
export const FIT_RESULT_SUMMARY_COLUMNS = "investigator_id, opportunity_id, tier, score, rationale, gap";

export type FitResultSummaryRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "rationale" | "gap">;

/**
 * The list surfaces' columns (PR 3.2): the summary six plus slim JSON paths
 * — never the `provenance` / `adjudication` blobs (D32, D44) — for what a
 * shown row must be able to cite and mark: stage 5's credited items and the
 * paradigm pair (the rationale's evidence fallbacks, explain-view.ts), and
 * stage 8's compact verdict (the "judged" marker: tier, the engine's tier
 * before it, confidence, when, and the short-id → item map its rationale
 * cites). PR 3.2b adds two scalar columns, not blobs: `flags`, which the row
 * shows in place of the rationale, and `computed_at`, which the
 * profile-state line above the groups reads.
 */
export const FIT_RESULT_LIST_COLUMNS =
  "investigator_id, opportunity_id, tier, score, rationale, gap, flags, computed_at, top_items:provenance->T->top_items, best_pair:provenance->P->best_pair, judged_at:adjudication->>judged_at, judged_tier:adjudication->reconciliation->>tier, judged_from:adjudication->reconciliation->>tier_structured, judged_confidence:adjudication->reconciliation->>confidence, judged_evidence:adjudication->evidence";

export type FitResultListRow = FitResultSummaryRow & {
  /** The engine's plain-language caveats ("mechanism far above readiness; consider as project lead, not PI") — the row shows these, never the rationale (PR 3.2b). */
  flags: string[] | null;
  /** When the sweep scored this pair; the profile-state line above the groups reads the newest (PR 3.2b). */
  computed_at: string;
  /** Stage 5's credited item ids (a Poor row's stub provenance has none). */
  top_items: string[] | null;
  best_pair: { investigator: string; notice: string } | null;
  judged_at: string | null;
  judged_tier: Tier | null;
  judged_from: Tier | null;
  judged_confidence: ShownConfidence | null;
  /** Short id → internal item id, so a judged rationale's citations resolve. */
  judged_evidence: Array<{ id: string; ref: string }> | null;
};

/**
 * What the strategist review queue joins `fit_results` for (PR 3.3): the tier
 * and score a flagged pair is **shown** at, and its sentence. Nothing from the
 * `adjudication` blob — the queue reads the review items themselves from
 * `fit_adjudications`, which keeps them when the sweep drops the derived blob
 * (see `lib/fit/review/queue.ts`), so this read is a lookup by pair, never a
 * filter on stage 8.
 */
export const FIT_RESULT_REVIEW_COLUMNS = "investigator_id, opportunity_id, tier, score, rationale";

/** One `fit_results` row as the review queue joins it. */
export type FitResultReviewRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "rationale">;

/** The "Why not?" columns (PR 3.2): a Poor row's one-line reason and nothing else — no provenance, no components. */
export const FIT_RESULT_WHY_NOT_COLUMNS = "investigator_id, opportunity_id, tier, score, why_not";

export type FitResultWhyNotRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "why_not">;

/** The evidence view's columns (PR 3.2): the component vector and caps behind one shown pair, with the stage-8 summary. */
export const FIT_RESULT_COMPONENT_COLUMNS = "investigator_id, opportunity_id, tier, score, components, caps, judged_at:adjudication->>judged_at, judged_tier:adjudication->reconciliation->>tier, judged_from:adjudication->reconciliation->>tier_structured, judged_confidence:adjudication->reconciliation->>confidence";

export type FitResultComponentRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "components" | "caps"> & Pick<FitResultListRow, "judged_at" | "judged_tier" | "judged_from" | "judged_confidence">;

/**
 * "Why this suggestion" (PR 3.2b): what one shown pair puts behind the
 * disclosure — the component vector and the caps the Outreach evidence view
 * already reads (D44), plus the slim provenance paths that carry the four
 * things the row no longer prints: the coded topic matches with their tree
 * depth, the eligibility rules that could not be checked (the notice's own
 * words), the required designs with no support, and the floors the next tier
 * up wanted. Never the whole `provenance` blob, and never on a list path:
 * this read is keyed to the handful of pairs a page actually shows.
 */
export const FIT_RESULT_DETAIL_COLUMNS =
  "investigator_id, opportunity_id, tier, score, computed_at, engine_version, components, caps, flags, gap, why_not, " +
  "e_failed:provenance->E->failed, e_unknown:provenance->E->unknown, " +
  "p_view:provenance->P->>view, p_best_pair:provenance->P->best_pair, p_excluded:provenance->P->>excluded_hit, p_exception:provenance->P->>exception, " +
  "u_best_pair:provenance->U->best_pair, " +
  "d_unmet:provenance->D->unmet_required, d_prohibited:provenance->D->>dominant_prohibited, " +
  "t_coded:provenance->T->coded_matches, t_items:provenance->T->top_items, " +
  "m_met:provenance->M->met, m_missing:provenance->M->missing, " +
  "k_held:provenance->K->mechanisms_held, k_code:provenance->K->>activity_code, " +
  "floors_tier:provenance->floors->>tier_by_floors, floors_unmet:provenance->floors->unmet, " +
  "collaborators:provenance->collaborators";

/** One pair as "Why this suggestion" reads it: the stored row's small columns and the stage provenance the panel names, each addressed by path. */
export type FitResultDetailRow = Pick<FitResultRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "computed_at" | "engine_version" | "components" | "caps" | "flags" | "gap" | "why_not"> & {
  e_failed: string[] | null;
  e_unknown: string[] | null;
  p_view: FitProvenance["P"]["view"] | null;
  p_best_pair: FitProvenance["P"]["best_pair"];
  p_excluded: string | null;
  p_exception: string | null;
  u_best_pair: FitProvenance["U"]["best_pair"];
  d_unmet: string[][] | null;
  d_prohibited: string | null;
  t_coded: CodedTopicMatch[] | null;
  t_items: string[] | null;
  m_met: string[] | null;
  m_missing: string[] | null;
  k_held: string[] | null;
  k_code: string | null;
  floors_tier: Tier | null;
  floors_unmet: UnmetFloor[] | null;
  collaborators: string[] | null;
};

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

/** The list columns of one notice's scored investigators (the opportunity page and peek); `tiers` narrows (default: every tier). Score order from the database; callers sort with `compareFitRows`. */
export async function loadFitListForNotice(db: SupabaseClient, opportunityId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead<FitResultListRow>> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows<FitResultListRow>(
    db,
    FIT_RESULT_LIST_COLUMNS,
    (q) => {
      let b = q.eq("opportunity_id", opportunityId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("investigator_id");
    },
    limit
  );
}

/** The list columns of one investigator's scored notices (the investigator page); `tiers` narrows (default: every tier). Score order from the database, then `opportunity_id` — a caller that reads one tier at a time in `TIER_RANK` order gets `compareFitRows`' order. */
export async function loadFitListForInvestigator(db: SupabaseClient, investigatorId: string, opts: { tiers?: Tier[]; limit?: number } = {}): Promise<FitResultsRead<FitResultListRow>> {
  const limit = Math.max(1, opts.limit ?? 5000);
  return readRows<FitResultListRow>(
    db,
    FIT_RESULT_LIST_COLUMNS,
    (q) => {
      let b = q.eq("investigator_id", investigatorId);
      if (opts.tiers?.length) b = b.in("tier", opts.tiers);
      return b.order("score", { ascending: false }).order("opportunity_id");
    },
    limit
  );
}

export type WhyNotRead = FitResultsRead<FitResultWhyNotRow> & { /** Every Poor row of the subject, shown or not. */ total: number };

/** "Why not?" (PR 3.2, spec §10 "Poor is hidden but never deleted"): one investigator's Poor rows nearest the bar — the `limit` highest-scoring — with the one-line `why_not`, and the count of every Poor row. One read. */
export async function loadWhyNotForInvestigator(db: SupabaseClient, investigatorId: string, limit = 5): Promise<WhyNotRead> {
  const { data, error, count } = await db.from("fit_results").select(FIT_RESULT_WHY_NOT_COLUMNS, { count: "exact" }).eq("investigator_id", investigatorId).eq("tier", "poor").order("score", { ascending: false }).order("opportunity_id").limit(Math.max(1, limit));
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { rows: [], available: false, error: null, total: 0 };
    return { rows: [], available: true, error: error.message, total: 0 };
  }
  const rows = ((data ?? []) as FitResultWhyNotRow[]).map((r) => ({ ...r, score: Number(r.score) }));
  return { rows, available: true, error: null, total: count ?? rows.length };
}

/** The component vectors of one notice's rows for a set of investigators (the Outreach evidence view, PR 3.2): one read per 200 ids, every tier — a dismissed suggestion may sit at Poor, whose row keeps `components`. */
export async function loadFitComponentsForNotice(db: SupabaseClient, opportunityId: string, investigatorIds: readonly string[]): Promise<FitResultsRead<FitResultComponentRow>> {
  const all: FitResultComponentRow[] = [];
  for (let i = 0; i < investigatorIds.length; i += 200) {
    const slice = investigatorIds.slice(i, i + 200);
    const r = await readRows<FitResultComponentRow>(db, FIT_RESULT_COMPONENT_COLUMNS, (q) => q.eq("opportunity_id", opportunityId).in("investigator_id", slice).order("investigator_id"), 1000);
    if (!r.available || r.error) return r;
    all.push(...r.rows);
  }
  return { rows: all, available: true, error: null };
}

/** "Why this suggestion" for the notices one investigator is shown against: one read, keyed to the shown pairs (never a list path). */
export async function loadFitDetailsForInvestigator(db: SupabaseClient, investigatorId: string, opportunityIds: readonly string[]): Promise<FitResultsRead<FitResultDetailRow>> {
  return loadFitDetails(db, (q) => q.eq("investigator_id", investigatorId).in("opportunity_id", dedupe(opportunityIds)), opportunityIds.length);
}

/** "Why this suggestion" for the people one notice is shown against: one read, keyed to the shown pairs. */
export async function loadFitDetailsForNotice(db: SupabaseClient, opportunityId: string, investigatorIds: readonly string[]): Promise<FitResultsRead<FitResultDetailRow>> {
  return loadFitDetails(db, (q) => q.eq("opportunity_id", opportunityId).in("investigator_id", dedupe(investigatorIds)), investigatorIds.length);
}

const dedupe = (ids: readonly string[]) => Array.from(new Set(ids));

/** Bounded by construction: a page shows a handful of rows, and an empty id list is answered without a read. */
async function loadFitDetails(db: SupabaseClient, build: (q: Builder) => Builder, count: number): Promise<FitResultsRead<FitResultDetailRow>> {
  if (count === 0) return { rows: [], available: true, error: null };
  return readRows<FitResultDetailRow>(db, FIT_RESULT_DETAIL_COLUMNS, build, Math.max(count, 1));
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

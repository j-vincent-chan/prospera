/**
 * The investigator page's "Funding that fits" under `fit_engine = 'fit-v1'`
 * (plan § PR 3.2; redesigned in fit-UX PR 3): the nightly `fit_results` read
 * back as one verdict per shown pair — the engine's tier plus the three
 * verdicts §3a keeps apart, one sentence of reason, one caveat, one action —
 * with the ruled-out pairs in the same row shape behind the footer's toggle
 * (§3f) rather than in a "Why not?" list of their own.
 *
 * Reads, all bounded, **none per candidate**:
 *   1. the open profiled notices (one head count — the corpus the sweep scores);
 *   2. Recommended: Strong then Moderate, each read bounded to the group size
 *      and score-ordered, stopped once the group is full (PR 2.3's cascade —
 *      a Strong is never cut by a higher-scoring Moderate);
 *   3. Exploratory: one read (strategists only — D7);
 *   4. ruled out: one read of the top Poor rows with their count (strategists
 *      only), through the same verdict columns as the rest, so an excluded
 *      pair can say which rule or gate excluded it (§3f);
 *   5. the notices behind every shown row: one read — the title, the meta
 *      line's four facts and the receipt-cycle columns the deadline needs;
 *   6. **the notice fit profiles behind every shown row: one read** (C3), for
 *      approach, eligibility, requirements and `sources.complete`;
 *   7. **the investigator's own fit profile: one read** (C3), for approach and
 *      the evidence counts — the same read that used to fetch only
 *      `profile->provenance`, now unconditional because every row needs it;
 *   8. the evidence titles the rationales cite: at most one read per item kind.
 *
 * 5 and 6 are two reads over the same id list rather than one join: the
 * profile lives in `opportunity_fit_profiles`, keyed by `opportunity_id`, and
 * PostgREST would embed it only through a declared relationship. Two `in()`
 * reads over ≤ 15 ids is the cheaper of the two things that were available.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceIdsToResolve, groupFitRows, judgedOf, leadLineOf, needsProfileFallback, rationaleView, showsWhyNot, type FitAudience, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { loadFitVerdictsForInvestigator, loadRuledOutForInvestigator, MISSING_TABLE, suggestionTierOf, whyLineOf, type FitResultVerdictRow } from "@/lib/fit/results";
import type { InvestigatorFitProfile, Tier } from "@/lib/fit/types";
import { noticeDue, noticeMeta, ruledOutReasonOf, type DueField, type RuledOutReason } from "@/lib/fit/verdict-fields";
import { verdictPanel, type PanelContent } from "@/lib/fit/verdict-panel";
import { loadInvestigatorProfiles, loadNoticeProfiles, noticeInputFor, type NoticeProfiles } from "@/lib/fit/verdict-profiles";
import { fitVerdicts, type FitVerdicts } from "@/lib/fit/verdicts";
import { cycleFactsFromRow, isoToday, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";
import type { SuggestionTier } from "@/lib/outreach/types";

export type InvestigatorFitRow = {
  opportunityId: string;
  title: string;
  agency: string | null;
  /** The pill vocabulary (Moderate → potential). */
  tier: SuggestionTier | null;
  fitTier: Tier;
  /** S, 0–100. */
  score: number;
  /** An Exploratory row's first line: the gap sentence. */
  lead: string | null;
  rationale: RationaleView;
  judged: JudgedView | null;
  /** The one-line form the peek and legacy-shaped callers use (rationale with titles, then the gap for Exploratory). */
  why: string;
  /** fit-UX PR 3: the row's judgment — label, three verdicts, reason, caveat, action. */
  verdicts: FitVerdicts;
  /** "NINDS · PAR-26-041 · R01 · $500k direct / yr". */
  meta: string | null;
  /** The right-hand column: the notice's deadline. */
  due: DueField;
  /** "Why, and what it rests on". */
  disclosure: PanelContent;
  /** §3f: a Poor pair, listed only behind the footer's toggle. */
  ruledOut: boolean;
  /** Why it was ruled out, for the footer's parenthetical; null on a listed row. */
  ruledOutReason: RuledOutReason | null;
};

export type InvestigatorFitSurface = {
  engine: "fit-v1";
  audience: FitAudience;
  /** `fit_results` is not on the database yet. */
  unavailable: boolean;
  /** Open notices with a fit profile — the corpus the sweep scores. */
  openNotices: number;
  /** The person has at least one stored row. */
  scored: boolean;
  recommended: InvestigatorFitRow[];
  exploratory: InvestigatorFitRow[];
  /** Strategists only (D7, §3f): the Poor pairs nearest the bar, in the same row shape; empty for a PI. */
  ruledOut: InvestigatorFitRow[];
  /** Every Poor pair of the person (shown or not); 0 for a PI. */
  poorTotal: number;
};

export type InvestigatorFitOptions = {
  audience: FitAudience;
  /** Group sizes. */
  recommended?: number;
  exploratory?: number;
  /** How many ruled-out rows the footer's toggle shows. */
  ruledOut?: number;
};

/** The notice columns a row needs: the title, the meta line's four facts, and what `dueDisplay` reads. */
const NOTICE_COLUMNS = "id, title, agency, agency_code, opportunity_number, activity_code, award_ceiling, receipt_cycles, cycles_source, standard_dates_apply, close_date, expiration_date, forecasted, status";

type NoticeRow = CycleColumns & { id: string; title: string; agency: string | null; activity_code: string | null; award_ceiling: number | string | null };

/** The investigator's fit surface; `audience` decides what is read at all (D7: a PI gets Recommended only). */
export async function loadInvestigatorFitSurface(db: SupabaseClient, investigatorId: string, opts: InvestigatorFitOptions): Promise<InvestigatorFitSurface> {
  const wantRecommended = Math.max(1, opts.recommended ?? 5);
  const wantExploratory = Math.max(0, opts.exploratory ?? 5);
  const wantRuledOut = Math.max(0, opts.ruledOut ?? 5);
  const strategist = showsWhyNot(opts.audience);
  const base: InvestigatorFitSurface = { engine: "fit-v1", audience: opts.audience, unavailable: false, openNotices: 0, scored: false, recommended: [], exploratory: [], ruledOut: [], poorTotal: 0 };

  const today = isoToday();
  const { count } = await db.from("funding_opportunities").select("id, opportunity_fit_profiles!inner(opportunity_id)", { count: "exact", head: true }).or(openNoticeFilter(today));
  base.openNotices = count ?? 0;

  // Recommended: Strong, then Moderate, each bounded, stopped once full.
  const rows: FitResultVerdictRow[] = [];
  for (const tier of ["strong", "moderate"] as const) {
    if (rows.length >= wantRecommended) break;
    const read = await loadFitVerdictsForInvestigator(db, investigatorId, { tiers: [tier], limit: wantRecommended });
    if (!read.available) return { ...base, unavailable: true };
    if (read.error) throw new Error(`fit_results: ${read.error}`);
    rows.push(...read.rows);
  }
  // Exploratory and the ruled-out rows: strategists only (D7).
  let exploratoryRows: FitResultVerdictRow[] = [];
  let ruledOut: Awaited<ReturnType<typeof loadRuledOutForInvestigator>> = { rows: [], available: true, error: null, total: 0 };
  if (strategist) {
    if (wantExploratory > 0) {
      const read = await loadFitVerdictsForInvestigator(db, investigatorId, { tiers: ["exploratory"], limit: wantExploratory });
      if (!read.available) return { ...base, unavailable: true };
      if (read.error) throw new Error(`fit_results: ${read.error}`);
      exploratoryRows = read.rows;
    }
    if (wantRuledOut > 0) {
      ruledOut = await loadRuledOutForInvestigator(db, investigatorId, wantRuledOut);
      if (!ruledOut.available) return { ...base, unavailable: true };
      if (ruledOut.error) throw new Error(`fit_results: ${ruledOut.error}`);
    }
  }
  const groups = groupFitRows([...rows.slice(0, wantRecommended), ...exploratoryRows], (r) => r.opportunity_id, opts.audience);
  const shown = [...groups.recommended, ...groups.exploratory];
  const scored = shown.length > 0 || ruledOut.total > 0 || (!strategist && (await hasAnyRow(db, investigatorId)));
  if (!shown.length && !ruledOut.rows.length) return { ...base, scored };

  const all = [...shown, ...ruledOut.rows];
  const ids = Array.from(new Set(all.map((r) => r.opportunity_id)));

  // The notices, their fit profiles and the person's own profile: three reads
  // over the shown rows, none per candidate.
  const [notices, noticeProfiles, investigatorProfiles] = await Promise.all([
    db.from("funding_opportunities").select(NOTICE_COLUMNS).in("id", ids),
    loadNoticeProfiles(db, ids),
    loadInvestigatorProfiles(db, [investigatorId]),
  ]);
  if (notices.error) throw new Error(`funding_opportunities: ${notices.error.message}`);
  const byId = new Map(((notices.data ?? []) as NoticeRow[]).map((n) => [n.id, n]));
  const investigator = investigatorProfiles.profiles.get(investigatorId) ?? null;
  const provenance = investigator?.provenance ?? null;

  // The evidence titles behind every shown row: at most one read per kind.
  const lookup: EvidenceLookup = all.length
    ? await loadEvidenceLookup(db, all.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: needsProfileFallback(r) ? provenance : null })), { investigatorId })
    : EMPTY_LOOKUP;

  const toRow = (r: FitResultVerdictRow, ruled: boolean): InvestigatorFitRow | null => {
    const n = byId.get(r.opportunity_id);
    if (!n) return null;
    return investigatorRow(r, n, { lookup, provenance, investigator, noticeProfiles, audience: opts.audience, today, ruled });
  };
  const present = (x: InvestigatorFitRow | null): x is InvestigatorFitRow => x !== null;
  return {
    ...base,
    scored: true,
    recommended: groups.recommended.map((r) => toRow(r, false)).filter(present),
    exploratory: groups.exploratory.map((r) => toRow(r, false)).filter(present),
    ruledOut: ruledOut.rows.map((r) => toRow(r, true)).filter(present),
    poorTotal: ruledOut.total,
  };
}

/** Pure. One stored pair as the redesigned card renders it. */
export function investigatorRow(
  r: FitResultVerdictRow,
  n: NoticeRow,
  ctx: {
    lookup: EvidenceLookup;
    provenance: InvestigatorFitProfile["provenance"] | null;
    investigator: InvestigatorFitProfile | null;
    noticeProfiles: NoticeProfiles;
    audience: FitAudience;
    today: string;
    ruled: boolean;
  }
): InvestigatorFitRow {
  const rationale = rationaleView(r, ctx.lookup, { profileProvenance: ctx.provenance });
  const { lead } = leadLineOf(r, rationale.text);
  const { notice, noticeComplete } = noticeInputFor(ctx.noticeProfiles, r.opportunity_id);
  const verdicts = fitVerdicts({ row: r, notice, investigator: ctx.investigator, lookup: ctx.lookup, audience: ctx.audience, noticeComplete });
  return {
    opportunityId: n.id,
    title: n.title,
    agency: n.agency,
    tier: suggestionTierOf(r.tier),
    fitTier: r.tier,
    score: Number(r.score),
    lead,
    rationale,
    judged: judgedOf(r),
    why: whyLineOf(r, rationale.text),
    verdicts,
    meta: noticeMeta(n),
    due: noticeDue(cycleFactsFromRow(n), ctx.today),
    disclosure: verdictPanel({ row: r, label: verdicts.label, rationale, notice }),
    ruledOut: ctx.ruled,
    ruledOutReason: ctx.ruled ? ruledOutReasonOf(r) : null,
  };
}

/** A PI sees no Poor count, so "scored at all" needs its own head count (one read) when nothing surfaced. */
async function hasAnyRow(db: SupabaseClient, investigatorId: string): Promise<boolean> {
  const { count, error } = await db.from("fit_results").select("opportunity_id", { count: "exact", head: true }).eq("investigator_id", investigatorId);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return false;
    throw new Error(`fit_results: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

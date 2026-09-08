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
import { AUDIT_MAX_ITEMS, auditView, rationaleItemGroup, type AuditContent, type AuditItemGroup } from "@/lib/fit/audit-view";
import { EMPTY_LOOKUP, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { loadFitVerdictsForInvestigator, loadRuledOutForInvestigator, MISSING_TABLE, suggestionTierOf, type FitResultVerdictRow } from "@/lib/fit/results";
import type { InvestigatorFitProfile, Tier } from "@/lib/fit/types";
import { noticeDue, noticeMeta, ruledOutReasonOf, type DueField, type RuledOutReason } from "@/lib/fit/verdict-fields";
import { verdictPanel, type PanelContent } from "@/lib/fit/verdict-panel";
import { investigatorSurfaceState, type FitState } from "@/lib/fit/surface-states";
import { loadInvestigatorProfiles, loadNoticeProfiles, noticeInputFor, profilesDegraded, type NoticeProfiles } from "@/lib/fit/verdict-profiles";
import { fitVerdicts, plainWhyLine, type FitVerdicts, type VerdictLabel } from "@/lib/fit/verdicts";
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
  /** fit-UX PR 4: the audit layer behind "All evidence and components →". Derived from the same two profiles the verdicts are — no read of its own. */
  audit: AuditContent;
  /** The items the audit layer lists, each with its source link. */
  items: AuditItemGroup[];
  /** §3f: a Poor pair, listed only behind the footer's toggle. */
  ruledOut: boolean;
  /** Why it was ruled out, for the footer's parenthetical; null on a listed row. */
  ruledOutReason: RuledOutReason | null;
};

export type InvestigatorFitSurface = {
  engine: "fit-v1";
  /** Whose surface this is. §3i's first state offers "Refresh sources", and the action needs the id it acts on. */
  investigatorId: string;
  audience: FitAudience;
  /** `fit_results` is not on the database yet. */
  unavailable: boolean;
  /** Open notices with a fit profile — the corpus the sweep scores. `0` when the count did not come back; `openNoticesCounted` is what tells the two apart. */
  openNotices: number;
  /**
   * fit-UX final round (B5): whether the corpus head count actually landed.
   *
   * The count's `error` was destructured away, so a failed read gave
   * `openNotices = 0` and §3i's second state rendered "**0 open notices were
   * assessed** against this profile and none reached Exploratory or better.
   * This is a real answer, not a gap" — a claim, in as many words, on a read
   * that established nothing. `directoryIsThin` and `profileBuilt` both refuse
   * to claim on a read that did not land; this is the same rule, and the two
   * copy paths that quote the corpus (`nothingClearsState`, `provenanceLine`)
   * take `number | null` so the number cannot be quoted without it.
   */
  openNoticesCounted: boolean;
  /** The person has at least one stored row. */
  scored: boolean;
  /**
   * fit-UX PR 5 (§3i's first state): the person has an
   * `investigator_fit_profiles` row, so there is something for a notice to be
   * assessed **against**. Without it "nothing clears the bar" would be a claim
   * about a sweep that never ran for this person — the two facts the card
   * could not tell apart before, and the reason it said "No fit results yet"
   * for both.
   */
  profileBuilt: boolean;
  recommended: InvestigatorFitRow[];
  exploratory: InvestigatorFitRow[];
  /** Strategists only (D7, §3f): the Poor pairs nearest the bar, in the same row shape; empty for a PI. */
  ruledOut: InvestigatorFitRow[];
  /** Every Poor pair of the person (shown or not); 0 for a PI. */
  poorTotal: number;
  /**
   * Neither counterpart profile read landed — the table is not on the database
   * or the read failed — so every row's approach and eligibility are
   * "unverified" for a reason that is about the system, not about the notice.
   * The card says it once in the footer (§3i, §3j).
   */
  profilesDegraded: boolean;
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
  const base: InvestigatorFitSurface = { engine: "fit-v1", investigatorId, audience: opts.audience, unavailable: false, openNotices: 0, openNoticesCounted: true, scored: false, profileBuilt: false, recommended: [], exploratory: [], ruledOut: [], poorTotal: 0, profilesDegraded: false };

  const today = isoToday();
  // The corpus count and the person's own fit profile, together: the profile
  // is needed in **every** path from here on — §3i's "no profile built" state
  // is decided on it, and the populated path reads it for approach and the
  // evidence counts — so hoisting it here is the same round trip the populated
  // path already paid for, run in parallel with a count it was serialised
  // behind. What it stops is the case that had no read at all: the early
  // return below used to answer "no fit results yet" for a person with no
  // profile and for a person whose profile cleared nothing, in the same words.
  const [corpus, investigatorProfiles] = await Promise.all([
    db.from("funding_opportunities").select("id, opportunity_fit_profiles!inner(opportunity_id)", { count: "exact", head: true }).or(openNoticeFilter(today)),
    loadInvestigatorProfiles(db, [investigatorId]),
  ]);
  if (investigatorProfiles.error) console.warn(`[fit] ${investigatorProfiles.error}`);
  // B5: the count's own `error` was destructured away, so a failed read read
  // as a corpus of zero and the card said so. A count that did not come back
  // establishes nothing; the rows still do.
  if (corpus.error) console.warn(`[fit] open notice count: ${corpus.error.message}`);
  base.openNoticesCounted = !corpus.error && corpus.count !== null && corpus.count !== undefined;
  base.openNotices = corpus.count ?? 0;
  // A read that did not land establishes nothing. `profileBuilt` stays true
  // when the table is missing or the read failed, so the card never tells a
  // strategist a profile was never built on the strength of a failed read;
  // `profilesDegraded` is what says the *reading* is the problem, once, in the
  // footer (§3i, §3j) — the same rule `directoryIsThin` keeps.
  base.profileBuilt = investigatorProfiles.available && !investigatorProfiles.error ? investigatorProfiles.profiles.has(investigatorId) : true;

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
  if (!shown.length && !ruledOut.rows.length) return { ...base, scored, profilesDegraded: profilesDegraded(investigatorProfiles) };

  const all = [...shown, ...ruledOut.rows];
  const ids = Array.from(new Set(all.map((r) => r.opportunity_id)));

  // The notices and their fit profiles: two reads over the shown rows, none
  // per candidate. The person's own profile was read above, beside the corpus
  // count, because every path needs it.
  const [notices, noticeProfiles] = await Promise.all([
    db.from("funding_opportunities").select(NOTICE_COLUMNS).in("id", ids),
    loadNoticeProfiles(db, ids),
  ]);
  if (notices.error) throw new Error(`funding_opportunities: ${notices.error.message}`);
  // The two profile reads degrade rather than throw (they are what a row is
  // *explained* with, not what it is); the failure is warned once and reaches
  // the reader through the footer, not through a blank page.
  if (noticeProfiles.error) console.warn(`[fit] ${noticeProfiles.error}`);
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
  // §3h, after labelling. Reading only the Strong and Moderate *tiers* is a
  // weaker promise than the one the PI's page makes: `verdictLabelOf` turns a
  // Strong pair whose notice profile is incomplete into `cannot_assess`, so a
  // tier-side gate alone showed the PI a **Can't assess** row — and a "Can't
  // assess 1" chip in their own header — for a notice the office could not read
  // properly. Screenshot 08 has All / Strong / Moderate and nothing else.
  const listed = (rows: InvestigatorFitRow[]) => (strategist ? rows : rows.filter((r) => audienceListsLabel(r.verdicts.label)));
  return {
    ...base,
    scored: true,
    recommended: listed(groups.recommended.map((r) => toRow(r, false)).filter(present)),
    exploratory: listed(groups.exploratory.map((r) => toRow(r, false)).filter(present)),
    ruledOut: strategist ? ruledOut.rows.map((r) => toRow(r, true)).filter(present) : [],
    poorTotal: ruledOut.total,
    profilesDegraded: profilesDegraded(noticeProfiles, investigatorProfiles),
  };
}

/** The two labels a PI's own list may contain (§3h). Not the two tiers: the label is what the row renders. */
const PI_LABELS: readonly VerdictLabel[] = ["strong", "moderate"];
const audienceListsLabel = (label: VerdictLabel) => PI_LABELS.includes(label);

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
  // **One input object, two view models.** `fitVerdicts` and `auditView` read
  // the same `row`, `notice` and `investigator`; assembling the audit's inputs
  // separately is how a row and the audit view it opens come to disagree about
  // which notice profile was checked against which profile.
  const input = { row: r, notice, investigator: ctx.investigator, lookup: ctx.lookup, audience: ctx.audience, noticeComplete };
  const verdicts = fitVerdicts(input);
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
    why: plainWhyLine(r, rationale.text),
    verdicts,
    meta: noticeMeta(n),
    due: noticeDue(cycleFactsFromRow(n), ctx.today),
    disclosure: verdictPanel({ row: r, label: verdicts.label, rationale, notice, investigator: ctx.investigator }),
    audit: auditView(input),
    // The same resolved ids the disclosure shows, without its 2–3 cap — the
    // lookup already holds them, so this is a slice and not a read.
    items: [rationaleItemGroup(rationaleView(r, ctx.lookup, { profileProvenance: ctx.provenance, max: AUDIT_MAX_ITEMS }))],
    ruledOut: ctx.ruled,
    ruledOutReason: ctx.ruled ? ruledOutReasonOf(r) : null,
  };
}

/**
 * Pure. §3i's state for a loaded surface, or `null` when the card has rows to
 * draw (fit-UX PR 5).
 *
 * **Here rather than in `fit-opportunities.tsx`.** Every input below is a
 * choice a component would otherwise make inline, and each has a plausible
 * wrong answer that no test in this repo could see — the card is JSX in a
 * client tree and the suite has no DOM environment, so a `listed` counted off
 * the wrong array or a `nearest` taken from `poorTotal` would ship green.
 * Three of them, specifically:
 *
 *   - **`listed` counts the rows the card lists**, which is Recommended plus
 *     Exploratory and *not* the ruled-out rows: those are behind the footer's
 *     toggle (§3f), so a card whose only content is a ruled-out row has
 *     nothing listed and is exactly the case §3i's answer is for. Counting
 *     them makes the answer unreachable.
 *   - **`nearest` is what the loader holds**, `ruledOut.length`, not
 *     `poorTotal`: the button offers to *show* them, and offering twelve while
 *     holding five is the misstated count the README warns about twice.
 *   - **the audience is the surface's**, so the PI's card is not written for a
 *     strategist (the bar it names, and whether it offers Refresh sources).
 */
export const corpusOf = (surface: Pick<InvestigatorFitSurface, "openNotices" | "openNoticesCounted">): number | null => (surface.openNoticesCounted ? surface.openNotices : null);

export function investigatorCardState(surface: InvestigatorFitSurface): FitState | null {
  return investigatorSurfaceState({
    audience: surface.audience,
    profileBuilt: surface.profileBuilt,
    listed: surface.recommended.length + surface.exploratory.length,
    corpus: corpusOf(surface),
    nearest: surface.ruledOut.length,
  });
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

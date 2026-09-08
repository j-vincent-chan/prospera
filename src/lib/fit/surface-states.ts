/**
 * The four states a fit list can be in when there is nothing to decide on, or
 * when the assessment cannot be trusted as-is (fit-UX PR 5; brief:
 * `docs/fit-ux/README.md` §"Screens / views" 5, `AUDIT_AND_DECISIONS.md` §3i).
 *
 * Pure — no Supabase, no `fetch`, no `await`. Every number in the copy is a
 * count the caller has already read; nothing here is typed as a literal, for
 * the reason the README gives about the filter chips: an earlier draft
 * hardcoded a count and immediately misstated it.
 *
 * The four, and where each is decided:
 *
 *   | state | decided by | from |
 *   |---|---|---|
 *   | `no_profile` | `investigatorSurfaceState` | `investigator_fit_profiles` has no row for the person |
 *   | `nothing_clears` | `investigatorSurfaceState` | a profile exists, and no shown row survived labelling |
 *   | `notice_changed` | `noticeChangedBanner` | the notice's `updated_at` is after the newest `fit_results.computed_at` behind the shown rows |
 *   | `directory_thin` | `noticeSurfaceState` | more of the directory is unprofiled than profiled |
 *
 * Three rules this module exists to keep:
 *
 *   1. **The card keeps its shape.** A state is a headline, a body and at most
 *      two actions — it is drawn *inside* the same card, so the page never
 *      changes character between "here are five notices" and "here are none".
 *      That is why a state is a value and not a component: the surfaces draw
 *      it, and `fit-state-card.tsx` is markup over this.
 *   2. **`nothing_clears` is an answer, not a gap** (§3i, and the brief says
 *      so twice). It leads with the answer, states the corpus it rests on, and
 *      says in as many words that it is a real answer. It never uses "no", "not"
 *      or "yet" as its first word, and `NOTHING_CLEARS_HEADLINE` is asserted
 *      against that in the tests.
 *   3. **A control is drawn only with its mechanism** (PR 3's `3b`). Every
 *      action carries either an `href` or an `id` a surface switches on, and
 *      the selectors omit an action whose mechanism the caller says it does not
 *      have — a PI cannot refresh someone's sources, an aside cannot re-run the
 *      nightly sweep, and "Show the *n* nearest" is not offered when there are
 *      no nearest rows in hand.
 *
 * **One departure from the prototype, deliberate.** `fit-redesign-a-inline.dc.html`
 * draws the reissue state as an amber banner carrying **Reassess** *and* a
 * panel below it carrying "Reassess now" (primary) and "Show them anyway" —
 * two controls for one mechanism, the rows hidden behind the second, and two
 * primary actions in one view. The brief's own sentence for this state is
 * "amber banner + Reassess, **and the suggestions shown** as assessed against
 * the previous version", so that is what this builds: one banner, one Reassess
 * where a surface has the mechanism, and the rows left where they are with a
 * note saying which version they were assessed against.
 */
import { fmtMonD, isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import type { FitAudience } from "@/lib/fit/explain-view";
import type { ActionKind } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** Which state a card is in. The ids are the four §3i names, not the copy. */
export type FitStateId = "no_profile" | "nothing_clears" | "directory_thin";

/**
 * What a state's control does. A surface switches on `id`; `href` is a
 * destination that needs no handler at all. Exactly one of the two decides how
 * the control is drawn, and a control with neither is never built.
 */
export type FitStateActionId = "refresh_sources" | "what_goes_into_a_profile" | "show_nearest" | "see_what_is_missing" | "show_anyway" | "reassess";

export type FitStateAction = {
  id: FitStateActionId;
  label: string;
  kind: ActionKind;
  /** A destination rather than a handler. Set for the two navigational actions. */
  href?: string;
};

export type FitState = {
  id: FitStateId;
  /** The card header's right-hand caption — "Profile not built yet". */
  when: string;
  headline: string;
  body: string;
  /** At most one `primary`; the tests assert it. */
  actions: FitStateAction[];
};

/**
 * The reissue state (§3i's third). Not a `FitState`: it does not replace the
 * list, it sits above one — the rows stay, and `note` says what they were
 * assessed against.
 */
export type FitStateBanner = {
  text: string;
  /** "3 suggestions, assessed against the previous version"; null when nothing is listed under it. */
  note: string | null;
  /** Drawn only where the surface has a mechanism that actually re-assesses. */
  action: FitStateAction | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (n: number) => new Intl.NumberFormat("en-US").format(Math.max(0, n));

/**
 * The date part of a timestamp, or null. `receipt-cycles.fmtMonD` takes a
 * calendar day and appends `T00:00:00Z`; handed a `timestamptz` it produces an
 * Invalid Date and the banner reads "The notice changed on Invalid Date". The
 * regex is the guard, not the slice.
 */
export function dayOf(ts: string | null | undefined): string | null {
  if (typeof ts !== "string") return null;
  const day = ts.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

// ---------------------------------------------------------------------------
// 1 — no profile built
// ---------------------------------------------------------------------------

/** Where "What goes into a profile" goes: the investigator page's own Data sources panel, which is the answer. */
export const PROFILE_SOURCES_HREF = "#data-sources";

/**
 * Where "See what is missing" goes: the directory, filtered to the people
 * missing a source. `SOURCES_FILTER_OPTIONS` already has `missing_any`, so
 * this is a query the directory screen answers today, not a page to build.
 */
export const DIRECTORY_MISSING_HREF = "/investigators?sources=missing_any";

const NO_PROFILE_BODY =
  "The nightly run builds a fit profile from PubMed, RePORTER and the biosketch before anything can be assessed against it.";

/**
 * Pure. The person has no `investigator_fit_profiles` row, so there is nothing
 * for a notice to be assessed *against* — a different fact from "assessed and
 * nothing cleared the bar", and the one the old card could not tell apart.
 *
 * The PI's own view (§3h) gets no action: `refreshSourcesAction` is behind
 * `requireTeamRole("member")` and refreshing a directory record is strategist
 * tooling. The sentence names who can instead of drawing a button that 403s.
 */
export function noProfileState(audience: FitAudience): FitState {
  const pi = audience === "investigator";
  return {
    id: "no_profile",
    when: "Profile not built yet",
    headline: pi ? "No assessment yet for your profile" : "No assessment yet for this investigator",
    body: pi
      ? `${NO_PROFILE_BODY} Your strategist can refresh your sources to queue the build.`
      : `${NO_PROFILE_BODY} Refreshing this investigator's sources queues the build.`,
    actions: pi
      ? []
      : [
          { id: "refresh_sources", label: "Refresh sources", kind: "primary" },
          { id: "what_goes_into_a_profile", label: "What goes into a profile", kind: "quiet", href: PROFILE_SOURCES_HREF },
        ],
  };
}

// ---------------------------------------------------------------------------
// 2 — profile built, nothing clears the bar
// ---------------------------------------------------------------------------

/**
 * The answer, written as one (§3i). It is the headline rather than the body
 * because the body has to carry the corpus, and a reader who stops after one
 * line must not stop on a gap.
 */
export const NOTHING_CLEARS_HEADLINE = "Nothing open is worth your attention right now";

/**
 * Pure. A profile exists and the sweep found nothing to list.
 *
 * `corpus` is the open profiled notices the sweep scored — the same number the
 * card's provenance line states, so the two cannot disagree. `nearest` is the
 * ruled-out rows the loader actually has in hand, not `poorTotal`: the button
 * offers to show them, and offering to show twelve while holding five is the
 * misstated count the README warns about.
 *
 * The bar is named for the audience, because the audience decides it: a
 * strategist's list runs down to Exploratory, a PI's stops at Moderate
 * (§3h, `listsLabel`), so "none reached Exploratory" would be false on the
 * page where Exploratory is never drawn.
 */
export function nothingClearsState(opts: { audience: FitAudience; corpus: number | null; nearest: number }): FitState {
  const pi = opts.audience === "investigator";
  const bar = pi ? "Moderate" : "Exploratory";
  const whose = pi ? "your profile" : "this profile";
  // B5: a `null` corpus is a **failed count**, not zero. The sweep still ran —
  // the rows are what says nothing cleared the bar — but "0 open notices were
  // assessed … This is a real answer, not a gap" on a read that did not land
  // is the §3i fault of a system problem worded as a fact about the data, and
  // it is the same rule `directoryIsThin` and `profileBuilt` already keep. The
  // answer stays; only the number it rests on comes off.
  const corpus =
    opts.corpus === null
      ? `Nothing open reached ${bar} or better for ${whose}. The open-notice count could not be read just now, so the corpus below this answer is not stated.`
      : `${count(opts.corpus)} open ${opts.corpus === 1 ? "notice was" : "notices were"} assessed against ${whose} and none reached ${bar} or better.`;
  return {
    id: "nothing_clears",
    when: "Profile built · nothing clears the bar",
    headline: NOTHING_CLEARS_HEADLINE,
    body: `${corpus} This is a real answer, not a gap: the list refreshes nightly and new notices arrive most weeks.`,
    // Strategist tooling, and only when there is something behind it: the
    // ruled-out rows are read for strategists alone (D7, §3f) and `nearest` is
    // 0 for a PI, so the button is absent on their page by the same means the
    // footer's toggle is.
    actions: opts.nearest > 0 ? [{ id: "show_nearest", label: `Show the ${opts.nearest} nearest, and why they fell short`, kind: "secondary" }] : [],
  };
}

// ---------------------------------------------------------------------------
// 3 — the notice changed after the assessment
// ---------------------------------------------------------------------------

/**
 * Pure. Whether the notice moved after the pairs below it were scored.
 *
 * **`updatedAt` is the app's existing "the notice changed" signal** — the same
 * `funding_opportunities.updated_at` the Outreach workspace's own stale banner
 * compares against (`queries.ts`, `noticeChangedSince`). Reusing it is what
 * lets the two surfaces say one sentence from one module instead of two
 * sentences from two call sites.
 *
 * A missing `assessedAt` is not staleness: a surface that did not read the
 * assessment time cannot claim the assessment is old.
 */
/**
 * Pure. Whether the notice **text** moved since the assessment was built —
 * B9's honest signal.
 *
 * `updated_at` is not that signal and never was.
 * `tr_funding_opportunities_updated_at` is a blanket `BEFORE UPDATE` trigger,
 * and `ingestion/reporter/exemplars-sync.ts` writes `exemplars_fetched_at`,
 * `exemplars_fetch_status`, `exemplars_count` and `exemplars_lineage` on open
 * NIH-like notices **daily** — bookkeeping columns, nothing about the notice's
 * own text — so the banner fired on Prospera's own cron, and on the aside
 * there is no Reassess to clear it with (`reassess: false`, deliberately:
 * nothing on that page re-runs the sweep). A banner that appears every day and
 * cannot be dismissed teaches a strategist to ignore the one that matters.
 *
 * The signal that *is* about the text is `guide_html_hash`: the hash of the
 * Guide page the notice was parsed from, recorded on
 * `opportunity_fit_profiles` at build time and compared against
 * `funding_opportunities.guide_html_hash` by the profile cron itself
 * (`profile/opportunity.ts` `profileDue` → "guide_html_hash changed").
 *
 * **Unknown is not changed.** Either hash missing — a notice with no Guide
 * page, a profile built from the synopsis, a surface that did not read one —
 * and this is `false`: nothing establishes that the text moved, and the whole
 * fault being fixed is a banner claiming a change nobody could see.
 */
export function noticeTextMoved(opts: { current: string | null | undefined; assessed: string | null | undefined }): boolean {
  const current = opts.current?.trim();
  const assessed = opts.assessed?.trim();
  if (!current || !assessed) return false;
  return current !== assessed;
}

export function noticeChangedAfter(opts: { updatedAt: string | null | undefined; assessedAt: string | null | undefined }): boolean {
  const changed = dayOf(opts.updatedAt);
  const assessed = dayOf(opts.assessedAt);
  if (!changed || !assessed) return false;
  return changed > assessed;
}

/**
 * Pure. The amber banner and its note.
 *
 * **"changed", not "reissued".** The prototype writes "The notice was reissued
 * on Sep 5"; `reissue_of` is a static lineage pointer to an earlier
 * announcement number and carries no date, so nothing in the data says a
 * reissue happened *on* a day. `updated_at` says the text moved, which is the
 * fact the caveats below were written before — and it is the word the
 * workspace already uses for it.
 *
 * `shown` is the rows the surface is about to draw; at zero there is no note,
 * because there is nothing under the banner to be assessed against anything.
 */
export function noticeChangedBanner(opts: { changedAt: string | null | undefined; shown: number; reassess: boolean; today?: string }): FitStateBanner | null {
  const day = dayOf(opts.changedAt);
  const on = day ? ` on ${fmtMonD(day, opts.today ?? isoToday())}` : "";
  return {
    text: `The notice changed${on}, after these were assessed. Eligibility and required designs may have changed.`,
    note: opts.shown > 0 ? `${plural(opts.shown, "suggestion")}, assessed against the previous version` : null,
    // The aside cannot re-run the nightly sweep and has no mechanism that
    // would; the workspace's own Reassess regenerates exactly the list under
    // this banner. One word, drawn only where it is true.
    action: opts.reassess ? { id: "reassess", label: "Reassess", kind: "secondary" } : null,
  };
}

// ---------------------------------------------------------------------------
// 4 — the directory is too thin to assess
// ---------------------------------------------------------------------------

/** What a surface knows about how much of its directory has been profiled. Degrades rather than throwing, like every other counterpart read. */
export type DirectoryCoverage = {
  /** Live directory records. */
  directory: number;
  /** Of those, the ones with a stored `investigator_fit_profiles` row. */
  profiled: number;
  available: boolean;
  error: string | null;
};

export const EMPTY_DIRECTORY_COVERAGE: DirectoryCoverage = { directory: 0, profiled: 0, available: true, error: null };

/**
 * Pure. When a list built from the profiled minority would read as an answer
 * without being one.
 *
 * **The boundary is a majority, not a magic number.** Any fixed ratio here
 * would be invented; "more of the directory is unprofiled than profiled" is
 * the one boundary the two counts define by themselves, and it is the claim
 * the copy makes. Below it the list is a sample of the directory rather than
 * the directory, and the surface says so instead of presenting it as the
 * answer.
 *
 * A read that did not land makes no claim: an unavailable table or a failed
 * count cannot establish that a directory is thin, and saying so anyway would
 * be the §3i fault of a system problem worded as a fact about the data.
 */
export function directoryIsThin(coverage: DirectoryCoverage): boolean {
  if (!coverage.available || coverage.error) return false;
  if (coverage.directory <= 0) return false;
  return coverage.profiled * 2 < coverage.directory;
}

/**
 * Pure. The thin-directory state.
 *
 * The prototype's body adds "the rest are missing a RePORTER profile ID,
 * publications, or both", which is a claim about every unprofiled person and
 * would need a read per candidate to make. The count says what is true and the
 * link goes where the answer is; the sentence the counts cannot support is not
 * written.
 *
 * `shown` gates the second action for the usual reason: "Show the 18 anyway"
 * with nothing to show is a control with no mechanism.
 */
export function directoryThinState(opts: { coverage: DirectoryCoverage; shown: number }): FitState {
  const { profiled, directory } = opts.coverage;
  return {
    id: "directory_thin",
    when: "Directory too thin to assess",
    headline: "Not enough of your directory is profiled to answer this",
    body: `${count(profiled)} of ${count(directory)} directory ${directory === 1 ? "profile has" : "profiles have"} a fit profile built; the rest have not been profiled yet, so nothing has been assessed for them. A list built from ${count(profiled)} would read as an answer without being one.`,
    actions: [
      { id: "see_what_is_missing", label: "See what is missing", kind: "primary", href: DIRECTORY_MISSING_HREF },
      ...(opts.shown > 0 ? [{ id: "show_anyway" as const, label: `Show the ${opts.shown} anyway`, kind: "quiet" as const }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// The selectors
// ---------------------------------------------------------------------------

/**
 * Pure. The same state with nothing primary in it — for a card that already
 * has a primary action of its own.
 *
 * "One primary action per view" is the redesign's rule, and the states are
 * written for the prototype's treatment, where a state fills the page and its
 * first action is the only filled button on it. The opportunity **aside** is
 * not that: its footer carries a standing "Review in Outreach", so a state
 * drawn above it with its own filled button gives a 340px column two things
 * that both look like the thing to do. The words do not change — only the
 * emphasis, which is the same distinction `coherent()` draws for a row's
 * chips: tone is the surface's, the claim is the state's.
 */
export function demoted(state: FitState): FitState {
  return { ...state, actions: state.actions.map((a) => (a.kind === "primary" ? { ...a, kind: "secondary" as const } : a)) };
}

/**
 * Pure. Which state the investigator card is in, or `null` when it has rows to
 * draw.
 *
 * The order is the order the facts constrain each other in: without a profile
 * nothing was assessed, so "nothing clears the bar" would be a claim about a
 * sweep that never ran. `listed` is the rows **after** labelling and the
 * audience gate, because that is what the card will actually draw.
 */
export function investigatorSurfaceState(opts: { audience: FitAudience; profileBuilt: boolean; listed: number; corpus: number | null; nearest: number }): FitState | null {
  if (!opts.profileBuilt) return noProfileState(opts.audience);
  if (opts.listed > 0) return null;
  return nothingClearsState({ audience: opts.audience, corpus: opts.corpus, nearest: opts.nearest });
}

/**
 * Pure. The Outreach workspace's stale banner, from the signal that tab
 * already has: `queries.ts` compares the notice's `updated_at` against the
 * version this item last saw and sets `noticeChangedSince`.
 *
 * A function rather than a ternary at the call site, because a ternary in JSX
 * is what this repo cannot test: the tab is a client component and the suite
 * has no DOM environment, so `noticeChangedSince ? banner : null` written
 * inline is a branch nothing can reach. Here both branches are.
 */
export function workspaceStaleBanner(item: { noticeChangedSince: boolean; noticeChangedAt: string | null }, shown: number, today?: string): FitStateBanner | null {
  if (!item.noticeChangedSince) return null;
  // Reassess: `regenerateSuggestionsAction` re-ranks exactly the list under
  // this banner, which is the one surface where that verb is true.
  return noticeChangedBanner({ changedAt: item.noticeChangedAt, shown, reassess: true, today });
}

/**
 * Pure. Which state the notice-facing card is in, or `null`.
 *
 * Only the thin-directory state replaces a notice-facing list; the reissue
 * state is a banner above one (`noticeChangedBanner`) and the two compose —
 * a stale assessment of a directory that is too thin to answer with says both,
 * in that order, and neither sentence is the other's.
 */
export function noticeSurfaceState(opts: { coverage: DirectoryCoverage; shown: number }): FitState | null {
  return directoryIsThin(opts.coverage) ? directoryThinState(opts) : null;
}

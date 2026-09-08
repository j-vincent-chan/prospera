# Fit UX redesign — implementation decisions and corrections to the brief

Working notes for the five PRs. Read alongside `README.md` and `AUDIT_AND_DECISIONS.md`; where this file
and the brief disagree, **this file wins** — every entry below was verified against the code on
`origin/main` at `b16ba6e`.

Baseline before this branch: `npx tsc --noEmit` clean, `npm test` 131 files / 1628 passed / 2 skipped.

## Corrections to the brief

The brief was written from a read-only review and is right about the shape of the problem. Four statements
about the current code are not accurate, and each changes what a PR has to do.

### C1 — `sources.complete` is stored, but not declared on the type

`AUDIT_AND_DECISIONS.md` §4.2 and the PR 1 prompt treat `sources.complete` / `partial` as an existing
field. It is stored and read — `src/lib/fit/service.ts:937` (`p.sources?.complete !== false`) and
`src/lib/fit/inspect/load.ts:157` (`complete:sources->complete`) — but `OpportunitySources` in
`src/lib/fit/types.ts` declares only `{ text, exemplar_count }`.

**Decision.** PR 1 adds `complete?: boolean` to `OpportunitySources`, documented as "a row without the field
counts as complete" (D22, matching both existing readers). No migration; the column already holds it.

### C2 — the list row carries no `components`, `caps` or `flags`

`FIT_RESULT_LIST_COLUMNS` selects the summary six plus slim JSON paths, deliberately (D32: never the
`provenance` / `adjudication` blobs). But the brief's `caveat` rule ("else the floor named in `caps`") and
its `evidence` rule (thin-evidence and confidence caps) both need columns the list row does not have.

**Decision.** Add them **additively** in `results.ts`: `FIT_RESULT_VERDICT_COLUMNS` and
`FitResultVerdictRow = FitResultListRow & Pick<FitResultRow, "components" | "caps" | "flags">`.
`FIT_RESULT_LIST_COLUMNS` keeps its shape — existing callers and their tests depend on it. `components` and
`caps` are a fixed 9-number object and a short string array, not the blobs D32 warns about.

### C3 — no list surface loads the counterpart fit profile

`loadInvestigatorFitSurface` reads `funding_opportunities` for `id, title, agency` only;
`notice-fit.ts` reads investigator names only. Neither loads `opportunity_fit_profiles` or
`investigator_fit_profiles` for the shown rows. So today nothing on a decision surface can see
`sources.complete`, the notice's eligibility rules, `materials.human_required`, or the paradigm lists —
which is exactly what "Can't assess", the eligibility verdict and the requirements table need.
`loadOpportunityInspection` exists but is single-id.

**Decision.** PR 3 adds one bounded multi-id read per surface (`.in("opportunity_id", ids)` /
`.in("investigator_id", ids)`), over the shown rows only, alongside the existing title read. This keeps the
"no per-candidate read" rule in `investigator-fits.ts`'s header comment. It also closes model limitation
§4.2 for the list surfaces, which the brief expected to remain open — say so in the PR description.

### C4 — identity review already supports grants and trials

`AUDIT_AND_DECISIONS.md` §4.3 states `reviewIdentityAction` takes `kind: "publication"`, and the PR 4
prompt makes "Not this person on publications only" a hard rule on that basis. In fact
`src/app/actions/investigator-actions.ts:312` takes `kind: keyof typeof KIND_TABLE`, and
`KIND_TABLE = { publication, grant, trial }`. Only the two call sites
(`investigator-detail-client.tsx:100`, `evidence-view.tsx:47`) hard-code `"publication"`.

**Decision.** The stated limitation does not exist. But the designer's instruction is explicit, and there
may be a reason to keep it beyond the one given, so **PR 4 still renders "Not this person" on publications
only** — scope is not widened on the strength of a corrected premise. Flagged for the pilot decision
instead of silently changed.

### C5 — the verdict row cannot be a server component

The PR 2 prompt in `CLAUDE_CODE_PROMPTS.md` asks for "a server component rendering one FitVerdicts row,
plus a small client wrapper for the disclosure", and PR 2's first draft did exactly that:
`verdict-row.tsx` with no `"use client"`, and a one-`<button>` `verdict-row-toggle.tsx` beside it.

That does not work. The row takes five function props — `onSelect`, `onToggle`, `onDeep`, `onFlag`,
`onAction` — and every one of them lands on `onClick` on a host element. A Server Component parent
passing any of them throws at request time (*"Event handlers cannot be passed to Client Component
props"*), and nothing catches it first: `npx tsc --noEmit`, `next lint` and `next build` are all green,
because the fit routes are `force-dynamic` and are never prerendered. And the shape that *does* work —
the client shell the README §"State management" already specifies, holding
`{ open, selected, filter, … }` — pulls the row module into the browser bundle anyway, so the split
bought no bundle either.

**Decision.** `verdict-row.tsx` is a client component; `verdict-row-toggle.tsx` is folded back into it.
The boundary is the row, which is where the README puts it. Its **data** props stay plain and
serializable, so a server page can load rows and hand them down through the shell. The disclosure lives
in `verdict-row-disclosure.tsx` — a separate module for §3c's sake, not for the client boundary's (see
D-f).

## Decisions the brief left open

### D-a — flag: reuse `teams.fit_engine`, do not add `teams.fit_ui`

The redesigned surfaces replace the fit-v1 rendering of the same data; the `legacy` path is untouched
either way. A second flag would need a migration and doubles the states to test for an A/B nobody has
asked for. Reuse `teams.fit_engine`.

### D-b — the Outreach workspace stays in the 880px `SlideOver`

`AUDIT_AND_DECISIONS.md` §3l draws the workspace full-page and calls the change reversible; the README
agrees the row grid fits either. Moving it out of `SlideOver` changes how the outreach board navigates,
which is not a UX-of-fit change and is not covered by any of the five PRs' acceptance criteria.

**Decision.** Keep `SlideOver width={880}` and render the row's stacked variant inside it. The full-width
move stays available and is called out in the PR description as the one deliberate departure from §3l.

### D-c — `verdicts.ts` is pure and audience-aware

No Supabase client, no `fetch`, no `await` — it takes already-loaded records (the verdict row, the notice
profile, the investigator profile, an `EvidenceLookup`) plus the audience. Loading is PR 3's problem. The
PI audience returns no per-row action (§3h); the deliberate gap is modelled, not filled with a button that
goes nowhere.

### D-d — the aside stays an aside

The prototype draws "Opportunity → PIs" full width; the real surface is the 340px aside at
`src/app/(app)/opportunities/[id]/page.tsx:122`. Per the README, implement the stacked variant — top 3
rows, chips wrapped, action full width — and link "See all *n* in Outreach →". The four-column row is for
the investigator page and the Outreach workspace only.

### D-e — the row's two fixed tracks are floors, not fixed widths

The README's row table gives the label 104px and the action 132px. Measured at 1366px — the app's
`min-w-page` and §5's acceptance width — against the repo's compiled Tailwind, with the investigator
page's real geometry (card 706px, flexible column 368px):

| | measured | README track | result |
|---|---|---|---|
| "Moderate match" | 113.0px | 104px | overflowed by 9.0px |
| "See what's missing" | 143.4px | 132px | overflowed by 11.4px, into the column gap |
| "Complete the profile" | 152.9px | 132px | overflowed by 20.9px — 6.9px of opaque button over the caveat text, and `elementFromPoint` inside the overlap returned the button, so it took the clicks too |

`Button` is `shrink-0`, so nothing gave.

**Decision.** `grid-cols-[18px_minmax(118px,max-content)_minmax(0,1fr)_minmax(132px,max-content)]`. Both
README numbers survive as the **floor**; `max-content` is the ceiling. 118 rather than 113 so that all
five labels resolve to the same track and titles stay aligned down the list — only a label wider than
118px would grow it, and none is. The action track grows per row, taking the room out of the flexible
column rather than out of the text: measured after, every overflow is 0 and nothing overlaps. The
disclosure's `pl-` moves with the label track (156 → 170), keeping the prototype's own relationship to
the title column.

### D-f — §3c is a module boundary, not a source grep

"Nothing disqualifying lives inside a disclosure" was asserted by slicing `verdict-row.tsx` between
`function DisclosurePanel` and the next section banner and grepping the slice — which a new prop three
lines above escapes, and which never covered `EvidenceCard` at all.

**Decision.** The panel is its own module, `verdict-row-disclosure.tsx`, and it does not import
`FitVerdicts`: the type is not in scope in it. The test asserts the whole file, plus that the panel's
own parameter list and the row's `<DisclosurePanel …/>` call site are the same closed set of eight
props. What no test in PR 2 can check is what PR 3 puts *into* `why`, `gaps[]` and `items[]` — those are
caller-supplied strings, and §3c at that level is PR 3's contract to test against real rows.

### D-g — urgency is a word before it is a colour

`ui/pill.tsx`'s header states the rule the whole system keeps: colour never carries meaning alone. The
row's deadline broke it — `normal` is `font-medium text-ink` and `urgent` is `font-semibold text-danger`,
and at 13px a medium→semibold step is close to invisible, so red did all the work while the caller's
string ("Oct 5 · 28 days") said nothing about urgency.

**Decision.** An urgent right-hand field carries a word above the date: "Closing soon" on a notice
(the vocabulary the app already uses for a deadline inside 30 days), "Needs attention" on a person —
one field, two captions, same as `DUE_CAPTION`. Whether a people-facing status is ever urgent is PR 3's
call; the word is there so that, if it is, it does not arrive as red alone.

## Standing constraints for every PR

- `TierPill` and `EvidenceChips` keep working unchanged for the two admin `/fit` inspectors.
- No numeric threshold typed into a component; floors are read from `taxonomy.json` at render time.
- No engine, `taxonomy.json` or threshold changes. No migrations, no backfills, no database writes.
- `npx tsc --noEmit` clean and `npm test` green before each commit, against the baseline above.

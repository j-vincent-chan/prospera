# Fit UX redesign — implementation decisions and corrections to the brief

Working notes for the five PRs. Read alongside `README.md` and `AUDIT_AND_DECISIONS.md`; where this file
and the brief disagree, **this file wins** — every entry below was verified against the code on
`origin/main` at `b16ba6e`.

Baseline before this branch: `npx tsc --noEmit` clean, `npm test` 131 files / 1628 passed / 2 skipped.

## Corrections to the brief

The brief was written from a read-only review and is right about the shape of the problem. Seven statements
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

**Decision (superseded).** The stated limitation does not exist. But the designer's instruction was
explicit, and there might have been a reason to keep it beyond the one given, so PR 4 rendered "Not this
person" on publications only — scope is not widened on the strength of a corrected premise. Flagged for
the pilot decision instead of silently changed.

**Decision (V1, the follow-up round). The user decided this, and the restriction is lifted.** "Not this
person" is offered on **any record `reviewIdentityAction` can write to**. The gate is no longer the kind
but the **table row id**, which is the constraint that was always doing the real work:

| Kind | `KIND_TABLE` row | Reachable on a surface that draws the control? |
|---|---|---|
| `publication` | `investigator_publications.id` | **Yes.** `runSuggestions` reads it (`suggest.ts` selects `id`) and the snapshot writes it onto the research items. |
| `grant` | `investigator_nih_grants.id` | **Yes, and it needed no new read.** `suggest.ts` already selects `id` beside `project_num`, and `personParts` already maps the two in `grantProjectNumbers`. The funding items now carry it. |
| `trial` | `investigator_clinical_trials.id` | **No — and no control is drawn.** Two separate reasons: no surface builds a trial *item* at all (the snapshot's five groups are research / funding / self / institutional / history, and the research group takes publications only), and the evidence id is `trial:<investigator>:<nct id>`, so even if one existed it would carry an **NCT id**, which `reviewIdentityAction`'s `uuid.safeParse(itemId)` rejects. Reaching one would need a new read of `investigator_clinical_trials` keyed on `(investigator_id, nct_id)`. Not added: there is nothing to attach it to yet, and the branch's standing rule is that a control is drawn only with its handler. |

`AuditItem.publicationId` is now `identityItem: { kind, rowId } | null` and `identityReviewId` is
`identityReviewOf`, which checks the item's own evidence-id prefix against the kind so the action is never
told a table the item is not in. `EvidenceItem` **keeps `publicationId`** as a legacy read-only field:
`outreach_suggestions.evidence` is a stored JSON blob and is not backfilled, so every snapshot generated
before this change would otherwise lose its control until the next suggestions run. `auditItem` reads the
old field as a publication.

Two consequences to expect in the running app: a **grant's** control appears only after suggestions are
regenerated for an item (existing snapshots carry no `identityItem` on their funding items), and the
**legacy** (`fit_engine = 'legacy'`) writer is untouched per D-a, so a legacy team keeps publications only.

Kinds outside `KIND_TABLE` — biosketch, UCSF Profiles, directory, self-declared, aspiration — are not
identity-attributable records and get no control.

`investigator-detail-client.tsx:100` needed no change: that surface renders a publications list and
nothing else. There is no grants or trials list on the investigator page for the control to widen onto.

### C5 — `approach` cannot read `best_pair.investigator`, and 6a is not the reason

`AUDIT_AND_DECISIONS.md` §5's PR-1 table derives `approach` from `best_pair.investigator` vs the notice's
paradigm list. Stage 2 stores the pair that best *supports the notice* — the investigator's most charitable
category, not their approach — so the chip would name the wrong research for the person.

**Fixture 2 is the case.** A cardiovascular epidemiologist (`epidemiology` 0.90, `population_health` 0.60)
has `best_pair.investigator = clinical_observational` (0.45). A `best_pair` chip reads *Clinical*; the
person is an epidemiologist.

**Fixture 6a is not, and PR 1's commit message is wrong about it.** That message claims 6a "is a Strong
match that reads 'Different approach'" on `best_pair` categories. It does not: 6a's `best_pair` is
`molecular_cellular_mechanistic` on **both** sides, so a `best_pair` chip reads "Same approach · Discovery"
— the right shape with a family that is not what the profile's mass says. The fault 6a shows is a misnamed
family, not a chip contradicting its own tier. Only the fixture-2 half of that argument holds. The commit
is not amended; this file is the record (see the header: where this file and anything else disagree, this
file wins).

**Decision.** Each side's family comes from its own profile: the family of the **heaviest category** in the
investigator's recent view (then career), and of the heaviest `paradigm.required` term on the notice, with
`best_pair` as the fallback for a row whose profiles are not loaded.

- **Heaviest category, not the family sum.** Families are different sizes — `population` has six
  categories, `discovery` two — so summing lets a family win on breadth: `basic_discovery` 0.90 against
  five population side lines at 0.20 reads "Population". The heaviest category is also what the engine
  itself calls the dominant paradigm (`engine/paradigm.ts`, `eligibility.noticeFamilies`).
- **`required_any` is a disjunction (D14).** Stage 2 scores it as the max over the set, so a notice whose
  alternatives include the investigator's family has said that approach is one it funds. Reading a single
  family out of the set would make fixture 6a — a Strong match against a BESH notice whose any-of set is
  `early_phase_human_experimental | human_biospecimen | molecular_cellular_mechanistic` — read "Different
  approach". This stays inside the set the notice itself wrote; it is not `best_pair`'s search of the whole
  matrix.

### C6 — how red a difference of approach is comes from the matrix

Not in the brief, but it follows from §2.8: every cross-family pair rendering as one red chip states the
axis without showing it. `paradigm.family_compat` grades these pairs — translational vs clinical is 0.60,
health_systems vs discovery is 0.05 — and the boundary between "this rules it out" and "this is a real
difference" is `paradigm.gates.poor_below`, the taxonomy's own answer: support for a required category is
`(w_i / w_max) · compat(i, o)`, so a pair's family compatibility is the most P it can reach, and under
`poor_below` that ceiling is beneath the gate that makes a pair Poor. Cross-cutting keeps its own handling:
it is not in the matrix and `familyCompat` throws for it.

### C7 — the verdict row cannot be a server component

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

**Decision (superseded in part).** Keep `SlideOver width={880}` and render the row's four-column grid
inside it. The full-width move stays available and is called out in the PR description as the one
deliberate departure from §3l.

**Decision (V2, the follow-up round). The user decided that Prospera should be responsive, starting
here.** The workspace stays in the `SlideOver` — moving it onto the page is still not a UX-of-fit change —
but the width stops being one number. `SlideOver`'s `width` is now a **CSS length**: a number is still
pixels, so every other caller (480 investigator form, 560 peek, 640 library) is unchanged, and a string is
used verbatim, which is what lets the workspace say `clamp(880px, 78vw, 1440px)`.

Measured before: a hard **880px in a 1366px viewport, leaving 486px — 36% of the screen — unused**, and no
growth on a larger monitor. The three numbers each answer for themselves:

- **880px floor** — D-j's measurement. The recipients row is
  `grid-cols-[18px_minmax(118px,max-content)_minmax(0,1fr)_minmax(132px,max-content)]`; below 880 the
  flexible column is what gives, so the floor is the row's, not a preference. `max-w-full` clips it on a
  window narrower than that, so it can never become a horizontal scrollbar.
- **78vw** — at the app's own 1366 minimum that is 1065px, and the 486px of dead space becomes 301px of
  board still readable behind the scrim, which is what a slide-over is for.
- **1440px ceiling** — a reading measure. The row's flexible column is the one that grows, and past
  ~1200px it carries a one-sentence reason across a line nobody tracks.

The opportunity peek keeps its 560 unchanged.

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

### D-e — the row is coherent with its label, and the label's own verb can be overridden

The three verdicts are computed independently (§3a: they never blend), which lets every part of a row be
true while the row is not: a pair the engine ruled out **on its floors** carries no cap, so nothing reaches
`blocking`, and the row renders "Same approach" in green, "Eligible" in green and "Well evidenced" in green
under a `Ruled out` label. §5 asks that these rows must not read as reassuring.

**Decision.** `verdicts.ts` runs one coherence pass over the finished row: on `ruled_out` the caveat is
`blocking` and no chip may be `ok`. **Tone only** — the words each verdict chose stay exactly as they were,
because each of them is true. The invariant is tested over generated rows (nine fixtures × four tiers ×
fourteen cap sets × eight flag sets × notice loaded or not × complete or not), not over the cases someone
thought of.

The same applies to the action. `VERDICT_ACTION` is still one verb per label, but a row already in the
Outreach pipeline gets "Open in Outreach": "Add to outreach" would duplicate the queue entry, and "See
what's missing" sends a strategist looking for a gap that is not there — the row is short of Strong
*because* it is in the pipeline (Strong's `A` floor is `runway_ok_not_in_pipeline`).

### D-f — three facts the engine records only as a flag, and two that are not eligibility

Stage 9 writes some of what decides a row to `flags` rather than to `caps`, and the caveat has to read them
or say something false:

- **Strong's `A` floor** (`runway_ok_not_in_pipeline`) fails on `in_pipeline`, `recently_dismissed` and a
  missing deadline. None of the three produces a cap and none is a component with a floor, so the row used
  to land on "No blocking constraint." Each now says itself.
- **The stage-8 caps** (`stage8_verdict`, `stage8_objection`, `stage8_pending_confirmation`) are neither
  gates nor confidence caps nor floors, so a pair a skeptic objection demoted was told nothing binds. The
  caveat names what stage 8 did, in `explain-view.judgedOf`'s vocabulary.
- **Two stage-1 failures are not eligibility facts** (§3e). `engine/eligibility.ts` puts `deadline has
  passed` and `self-declared do-not-suggest: <family>` into `E.failed` beside the investigator rules. The
  first is actionability; the second is the investigator's own D5 preference, and under the PI audience
  "Not eligible" tells someone they may not apply for a notice they asked not to be shown. Both stay off
  the eligibility chip and reach the row through the caveat, in their own words.

### D-g — "Thin" is the engine's `and`; a missing source is a different fact

`profile/aggregate.ts` caps a category when it rests on fewer than `min_items` items **and** fewer than
`min_grants` grants — a funded award is enough on its own. Read as an `or`, every investigator with no
linked RePORTER record is "Thin", 48 publications and six trials included.

**Decision.** `Thin` is the engine's own condition plus the `low_profile_confidence` cap, and nothing else.
A substantial record with a gap in it says so in its own words at `caution` — "Well evidenced · 48 papers,
6 trials; RePORTER not linked" — which keeps §4.4's requirement that the gap reach the row without making
the word "thin" meaningless. The brief's own example ("Thin · 14 papers, RePORTER not linked") is the
sentence this replaces.

### D-h — `noticeComplete` is required, and a missing notice profile degrades in the open

D22's signal lives on the `opportunity_fit_profiles.sources` **column**, not in the profile record. An
optional `VerdictInput.noticeComplete` let a caller omit the one input `cannot_assess` rests on and get a
confident row for a notice whose Part 2 never parsed — silently, and with the caveat swapped to a different
reason. It is now **required**; the record's own `complete: false` is still believed when it is there.

A row whose notice profile is not loaded at all keeps its tier — the assessment did happen, with the
profile, at scoring time — but its approach and eligibility chips read "not established" / "unverified" at
`caution`, and its caveat says the notice was not checked rather than "No blocking constraint."

### D-i — every slot is one sentence

§2.2's complaint is 50–90 words per row before anything actionable. Three paths broke it: `reason` split
the rationale on ` · `, which reconciler prose does not contain, so a judged row returned its whole
paragraph; `eligibility` joined every unevaluable rule (a 330-character chip, and the same blob again as
the caveat); and the paradigm-gate caveat always composed two sentences.

**Decision.** Judged prose is cut to its first sentence; a quoted rule is shortened and at most two are
shown with the rest counted; the caveat counts what the chip above it already quotes; and the paradigm-gate
caveat keeps its "what would open it" closer — the one the brief asks for — but drops it rather than run
past a readable line. The excluded-paradigm note, which `engine/explain.ts` appends *inside* the paradigm
clause with the same ` · ` separator, is folded back into the reason instead of being discarded with the
rest of the split.

### D-j — the row's two fixed tracks are floors, not fixed widths

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

### D-k — §3c is a module boundary, not a source grep

"Nothing disqualifying lives inside a disclosure" was asserted by slicing `verdict-row.tsx` between
`function DisclosurePanel` and the next section banner and grepping the slice — which a new prop three
lines above escapes, and which never covered `EvidenceCard` at all.

**Decision.** The panel is its own module, `verdict-row-disclosure.tsx`, and it does not import
`FitVerdicts`: the type is not in scope in it. The test asserts the whole file, plus that the panel's
own parameter list and the row's `<DisclosurePanel …/>` call site are the same closed set of eight
props. What no test in PR 2 can check is what PR 3 puts *into* `why`, `gaps[]` and `items[]` — those are
caller-supplied strings, and §3c at that level is PR 3's contract to test against real rows.

### D-l — urgency is a word before it is a colour

`ui/pill.tsx`'s header states the rule the whole system keeps: colour never carries meaning alone. The
row's deadline broke it — `normal` is `font-medium text-ink` and `urgent` is `font-semibold text-danger`,
and at 13px a medium→semibold step is close to invisible, so red did all the work while the caller's
string ("Oct 5 · 28 days") said nothing about urgency.

**Decision.** An urgent right-hand field carries a word above the date: "Closing soon" on a notice
(the vocabulary the app already uses for a deadline inside 30 days), "Needs attention" on a person —
one field, two captions, same as `DUE_CAPTION`. Whether a people-facing status is ever urgent is PR 3's
call; the word is there so that, if it is, it does not arrive as red alone.

### D-m — the app's 1366px floor stays for the pilot (Vincent, 2026-09-08)

`app-shell.tsx:24` sets `md:min-w-page`, and `minWidth.page` is `1366px`, so from the `md` breakpoint up
the whole application has a hard minimum width and scrolls horizontally below it rather than adapting.
Measured live at a 1256px viewport: the document overflows by **110px**, sidebar included. This predates
the redesign and applies to every screen in Prospera, not only the fit surfaces.

Measured with the floor lifted, driving the shell at each width:

| width | fit card | flexible column | header | row overflow / overlap | audit view |
|---|---|---|---|---|---|
| 1366 | 1046 | 683 | 1 line | 0 / 0 | clean |
| 1180 | 860 | 497 | 1 line | 0 / 0 | clean |
| 1024 | 704 | 341 | 1 line | 0 / 0 | clean |
| 900 | 580 | 217 | 1 line | 0 / 0 | not measured |
| 768 | 448 | **85** | **2 lines** | 0 / 0 | **20 overflowing descendants** |

So the floor is not what protects the row grid — `minmax(0,1fr)` absorbs the width down to 768. What
breaks is legibility (an 85px column carrying a title, a reason, a caveat and three chips is a column of
single words), the card header below ~900px, and the audit view's two `grid-cols-2` panel pairs at 768,
which have no stacking rule.

**Decision — leave it.** The pilot is desktop, and the work does not partition: the floor is precisely
what guarantees the viewport is never narrow, so lifting it exposes every surface at once — the
investigator header, the other five cards, the opportunities table, the outreach board — none of which
this branch has measured. Making the four fit surfaces responsive is small on its own (the stacked row
variant already exists for the 340px aside; it needs a breakpoint below ~1024, a header rule, and a
stacking rule for the audit view's panel pairs), but shipping it behind the floor would be untestable and
lifting the floor is an app-wide project with its own measurement pass. Treat responsiveness as its own
piece of work.

## Standing constraints for every PR

- `TierPill` and `EvidenceChips` keep working unchanged for the two admin `/fit` inspectors.
- No numeric threshold typed into a component; floors are read from `taxonomy.json` at render time.
- No engine, `taxonomy.json` or threshold changes. No migrations, no backfills, no database writes.
- `npx tsc --noEmit` clean and `npm test` green before each commit, against the baseline above.

## The merge onto `main` (2026-09-08, `merge/fit-ux-onto-main`)

`origin/main` moved ten commits while this branch was built. Eight are untouched here — announcement
acquisition (#57), the Grants.gov / NSF / CDMRP adapters (#58, #62, #63), the route extractor's section roles
(#56), the HTML-entity decode (#64), the lint fix (#59) and the invariant re-baseline (#65). Two collide, and
the resolution below was decided before the merge, not argued out during it.

### M1 — this branch's structure wins where the two overlap

**`494c6b8` (#61)** solves the same core problem independently: a row printing `fit_results.rationale` is the
engine's audit trail, not two sentences. It rewrote `fit-opportunities.tsx`, `recipients-tab.tsx`,
`investigator-fits.ts`, `notice-fit.ts`, `results.ts`, `explain-view.ts`, `component-bars.tsx` and added
`row-line.ts`, `pair-detail.ts`, `profile-state.ts`, `inspect/display-labels.ts`.

All **twelve** conflicted files were touched upstream by #61 alone, so each is resolved to this branch: it is
the full design handoff — the verdict model (`verdicts.ts`), the row and its disclosure, the three decision
surfaces, the audit view's eight sections and two rule tables, the four degraded states, the PI audience, and
the centrally-enforced no-numbers invariant (`decision-text.ts`).

Deleted from #61, each with the module here that does that job:

| Removed | Done here by |
|---|---|
| `src/lib/fit/row-line.ts` (+ test) | `verdicts.reasonOf` / `caveatOf` / `plainWhyLine`, through `decision-text.plainClause` |
| `src/lib/fit/pair-detail.ts` (+ test) | `audit-view.ts` — `componentRows`, `auditInternals`, `eligibilityTable`, `requirementsTable` |
| `src/components/fit/why-this-suggestion.tsx` | `verdict-row-disclosure.tsx` and the audit view behind it |
| `src/components/fit/component-bars.tsx` | `components/outreach/component-bars.tsx`, fed by `audit-view.componentRows` (PR 4 moved the bars inside the collapsed internals block) |
| `src/components/fit/fit-flags.tsx` | the row's caveat — flags reach it through `verdicts.ts` and are de-numbered centrally, which a component printing `flags` verbatim bypasses |
| `src/components/fit/profile-state-line.tsx` | the card footer (M4) |
| `FIT_RESULT_DETAIL_COLUMNS`, `FitResultDetailRow`, `loadFitDetailsFor{Investigator,Notice}` | `FIT_RESULT_VERDICT_COLUMNS` (C2), which the audit view reads without a second per-page round trip |
| `flags` / `computed_at` added to `FIT_RESULT_LIST_COLUMNS` | both are in `FIT_RESULT_VERDICT_COLUMNS`; C2 keeps the list columns' shape, and `results.test.ts` asserts it |
| `scripts/fit-row-report.ts` + `npm run fit:row-report` | nothing — it is a driver for `row-line.ts`. Its most valuable check, "does a raw id survive to a rendered string", is now a permanent assertion over all nine adversarial fixtures in `decision-surface.test.ts` rather than a script needing `.env.local` |

Restored: `explain-view.leadLineOf`, which #61 removed and which `investigator-fits.ts` and `notice-fit.ts`
still call on the legacy and list-mode paths. `results.whyLineOf` stays removed — both branches removed it.

Not taken: #61's opening of `/investigators/[id]/fit` to every signed-in member. That change exists because
#61's row linked there unconditionally; this branch's audit view is the non-admin path and
`verdict-list.tsx` already gates the inspector link on `viewerIsAdmin`, so both `/fit` routes stay behind
`requireAdmin` and `audit-sections.inspectorHref`'s contract stays true. `flag-list.tsx`'s `readOnly` prop
went with it — its only caller was that page.

### M2 — #60 is kept in full, and the downstream workaround is removed

**`8e4a3ae` (#60)** fixes at the engine what this branch patched downstream: `engine/tier.ts`'s
`collaboratorNames` writes the names `InvestigatorFitProfile.collaborators` holds and counts the ones with no
name, so `engine/explain.ts` no longer prints UUIDs into the gap sentence.

Removed with it: `decision-text.namedCollaborators` and its `COLLABORATORS` pattern,
`decision-text.PlainOptions` entirely (its one field was `collaborators`), `verdicts.plainOptionsFor`, and
**`PanelInput.investigator`** — checked first, and it had no other reader: `verdict-panel.ts` used it only to
build those options. `VerdictInput.investigator` is unaffected; it carries approach and the evidence counts.

What is left is the general rule. `isEngineValueText`'s `RECORD_ID` still drops any clause carrying a UUID,
which is what a `fit_results` row scored before #60 still holds — no backfill is planned, and the special case
guaranteed exactly that outcome for exactly one clause. `decision-surface.test.ts` now drives the fixtures
through `scorePairDetailed` with named collaborators to assert the names arrive from the engine.

### M3 — `inspect/display-labels.ts` is adopted, and this branch's text is routed through it

It is strictly better than what this branch had. `taxonomy.json` labels paradigm families, categories and unit
levels but gives designs, materials kinds, objectives and units **ids only**, so `verdicts.designWords` was
`replace(/_/g, " ")` — which leaves `rct` as "rct" and turns `wet_lab_experiment` into "wet lab experiment" —
and `anyOf` produced "gwas or secondary data analysis". #61's map is keyed by the union types in `types.ts`,
so a new id fails the build until it has words.

Routed through it:

- `verdicts.designWords` **is** `designLabel`; `anyOf` composes it. This reaches the caveat, the requirements
  table and both approach panels, which all call one of the two.
- `audit-view.materialWords` **is** `materialsLabel`; `auditInternals` names caps through `capLabel` (the
  reason, not the id de-underscored).
- **`decision-text.plainClause` and `plainOrNull` run `humanizeIds` first**, which is what makes this total:
  every decision-surface string on every surface passes through one of those two, so the engine's stored
  `gap`, `why_not` and flag sentences are read before the numeric rewrites and before the safety check. It
  goes first because the shapes the value-rewrites anchor on (`required, <id> <value>`) are the shapes
  `humanizeIds` anchors on; `DESIGN_SUPPORT` was widened to match a label rather than one `[A-Za-z0-9_]+`
  token. `plainOrNull` reads the ids **before** its "already safe" early return: a sentence naming
  `wet_lab_experiment` and no number is safe by the invariant and would otherwise ship the id.
- `humanizeIds` gained one verb, `missing`. `engine/methods.ts` builds `M.missing` from materials kind ids and
  `" | "`-joined design groups and `engine/explain.ts` prints the list verbatim after that word, which is
  where the last bare ids (`gwas`, `ehr`) were reaching a caveat.

`familyWords` is kept as it was — it already reads `familyLabel` from the taxonomy.

Measured over the nine adversarial fixtures, driven through the real engine: `rawIdsIn` is empty on **every**
rendered decision string — the five verdict fields, the panel's `why` and every bullet, `reasonOf`, `caveatOf`,
`plainWhyLine`, both approach panels, both rule tables and the internals line. Asserted, per fixture, in
`decision-surface.test.ts`.

### M4 — `profile-state.ts`'s third fact, in the footer the card already has

#61 is right that a strategist needs three facts before trusting a list — what the ranking read, when it ran,
and what it could not read — and that **the third is the one that changes a decision**. The other two were
already said here, and said better: the evidence verdict names what the ranking read in the row's own voice
and `FOOTER_EVIDENCE` already lifts it to the footer on the one surface where it is a fact about the card (L5),
and `provenanceLine` states the corpus and the refresh while `results.newestComputedAt` carries the timestamp
for the one thing a date decides on a decision surface (§3i's staleness).

So `profile-state.ts` keeps `profileGaps` and loses `profileState`, `evidenceSources` and its own
`newestComputedAt` (a duplicate of `results.newestComputedAt`), and there is **no second provenance surface**:
§3j is one provenance statement per card, so the gaps are a clause of `provenanceLine`, capped at two with the
rest counted. Strategist audience only — to a PI, "no biosketch on file, no self-declared research axes" is a
list of things they have not done, under a card about which notices to pursue (§3h).

The investigator page only, and for the same reason `FOOTER_EVIDENCE` moves there: its rows are notices
assessed against **one** profile, so the gaps are a fact about the card. On the notice→people surfaces the
subject changes with the row. `loadInvestigatorProfiles` selects one more scalar (`pending_items`) beside the
record it already reads — no extra round trip — because "12 items still waiting to be classified" is the one
gap the profile record cannot state. Nothing is claimed from a read that did not land; `profilesDegraded` is
what says the reading is the problem.

### M5 — two fixes from #61 that are not about the row model

Kept, because they are independent of which branch's row wins and each closes a live defect:

- `addRecipientsAction` returns `addedIds`, and the recipients tab's "Undo" removes exactly those rows. It
  used to refresh the page and tell the user to undo it themselves; the community "Tag" undo had the same
  defect from the other side (it looked the new row up in the pre-add list).
- The community row drops `opacity-60` on an inactive or dismissed entry. Its state is named by the pill and
  the text beside it, and 60% opacity puts `#475569` body text at about 2.5:1 — D-l's rule, one axis over.

### D-n — the PI's row action is a consult request (Vincent, 2026-09-08)

§3h left the brief's fourth question — *what should I do next?* — unanswered for an investigator, and was
explicit that the gap was a choice rather than an oversight: Outreach is the office's internal queue and a
PI cannot add themselves to it, so the options were "a real mechanism (request a consult, flag interest to
the strategist who owns the community) rather than a button that goes nowhere". It asked for the decision
before the pilot.

**Decision — build the mechanism §3h named.** The PI's verb is **"Ask my strategist"**, on Strong and
Moderate rows only, which is every row D7 lists for them. It opens a note box and writes one
`fit_consult_requests` row.

- **Routing.** To `pipeline_communities.strategist_id` — the field the Communities screen already collects
  — for the investigator's community. With no community, or a community with no strategist on file, it
  falls to the team rather than failing: a request is never dropped for a bookkeeping gap, and the UI only
  promises a name when there is one to promise.
- **It is not "add me to outreach".** The office's queue stays the office's. What the PI creates is a
  question, which a strategist answers; the request carries the verdict label so the strategist opens the
  same row the PI read.
- **The pipeline override does not apply to a PI.** A strategist's verb changes to "Open in Outreach" when
  the pair is already on the board, because that is where their work is. A PI has no view of that board,
  so "the office is already on this" is not a reason to stop them asking about it.
- **One open request per pair**, enforced by a partial unique index. Asking twice is the same ask.
- **It reaches people through the ordinary notification preferences** (`fit_consult_request`, immediate by
  default), and appears on Home as an attention item that says who owes the answer and how long it has
  waited. It is not a private channel.

`actionOf` still resolves the verb centrally, so the audience rule cannot be got wrong by a surface
forgetting to check it, and it is still `null` for a PI on any label D7 does not list.

### D-o — "this match is wrong" is a pair flag, and a third thing (Vincent, 2026-09-08)

The row had no way to say the pairing itself was wrong, and the two controls that looked like they might
serve meant other things:

| control | what it says | who can use it |
|---|---|---|
| `flagFitProfile` | an **axis of a person's profile** is weighted wrongly | admins, in the inspector |
| `dismissSuggestionAction` | remove a person **from one notice's outreach queue** | strategists, in Outreach |
| **pair flag** (new) | **this pairing is wrong** | either audience, at the row |

**Decision.** A pair flag is a label: `fit_labels` with `source = 'pair_flag'`, both ids required, one
standing flag per person, notice and labeller. It feeds METRICS as a negative on the pair, which neither
of the other two does — a dismissal is a queue movement that happens to carry a reason, and a profile flag
is not about a notice at all.

- **One vocabulary, two voices.** Five canonical reasons, phrased for whoever is reading: a strategist
  sees "Wrong research area", a PI sees "Not my research area". `notice_misread` is strategist-only,
  because it is a claim about how the engine read the notice and a PI has no way to judge it. METRICS
  counts one set.
- **It hands off rather than duplicating.** `wrong_person` is an identity claim, which
  `reviewIdentityAction` already owns; `wrong_area` and `wrong_research_type` are exactly what the
  correction pipeline turns into a proposed profile edit. The flag says which, so the existing paths run
  instead of a second one being invented.
- **Quiet by design.** It is a correction, not a call to action, so it renders as a low-emphasis control
  beside the verb rather than competing with it. Every flag is undoable from its toast.

### D-p — a PI may see the audit view's components about themselves (Vincent, 2026-09-08)

Left open by the redesign: the audit view's collapsed internals show `S` and the component values, and an
investigator can expand them on their own page.

**Decision — leave it.** It is their own assessment, and the numbers are about them. The redesign's rule
is that the *interface* explains the decision in words rather than making a person do arithmetic, which
the row and the caveat do; it was never that the arithmetic must be hidden from its subject. The view
stays collapsed by default, so nobody meets a score without asking for it.

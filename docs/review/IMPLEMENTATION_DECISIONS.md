# Review, Outreach and Today redesign — implementation decisions

The brief is `design_handoff_prospera_review_outreach/README.md` (kept beside the repo, not in it). It is
built screen by screen in the order the brief gives: app sidebar → Review (list mode) → Review (Focus mode
and the three drawers) → Outreach → Message → Today. This file records what each step decided where the
brief was silent, and where it was corrected against the live data.

Related: `docs/fit-ux/IMPLEMENTATION_DECISIONS.md` (the fit row grammar Review's rows extend), and
`docs/fit-engine/DECISIONS.md` (the engine).

## Step 1 — sidebar and Review, list mode (2026-09-12)

### R1 — what enters the queue, measured rather than assumed

The brief says the queue holds "notices with matches above the bar" and lists the exact policy as open
("Exploratory matches never enter the Review queue; a cap per notice and per person" — needs product
agreement). Measured against `fit_results` on 2026-09-12: 3,392 surfaced rows sit on open notices and
3,357 of them are Exploratory; 11 open notices carry a Strong or Moderate match (35 rows), and those
notices carry 7–86 Exploratory rows each. A queue of every surfaced match is sixty-odd notices and a
four-digit badge.

Default taken (`src/lib/review/queue.ts`, `QUEUE_TIERS` and `EXPLORATORY_CAP`):

- a notice **enters the queue** when it has at least one Strong or Moderate match and is not closed;
- on a queued notice the page **lists** every Strong and Moderate row and the three best Exploratory rows;
- the nav badge counts listed rows with no decision.

The footer says what the cap hid ("30 more exploratory leads not listed"). Both numbers are one-line
changes when product decides.

### R2 — the match record is a new table

Nothing held a strategist's judgment about a pair: `fit_results` is the engine's nightly output,
`fit_labels` is append-only evidence, and `outreach_recipients` exists only once a notice has an Outreach
item. `fit_match_decisions` (migration `20260929100000_fit_match_decisions.sql`) is the README's
`Decision` type with a team, a scope and the `auto` flag; Undo deletes the row. Confirming also writes the
existing Outreach mechanism (item in Triage, `suggested` recipient in `selected`), so a confirmed match is
visible in Outreach and the Message recipient list without a second model. Nothing is sent.

### R3 — which dismissals the engine learns from

Five of the eight reasons are fit judgments and are also written to `fit_labels` as a `dismissal` (tier
`poor`, the reason id): wrong type of research, opportunity too broad, wrong disease area, not eligible,
wrong person. Three are facts about the person that say nothing about the science — already aware,
already funded here, do not contact — and are recorded as decisions only. Auto-cleared rows are inferences,
never labels. The prototype's panel copy, "One tap — it retrains the notice's profile tonight", is not true
of this codebase (there is no nightly retrain from labels; recalibration is blocked on the D4 label set),
so the panel says what does happen: the tap is kept as a label for the notice's next calibration.

### R4 — "Ruled out" rows are standing pair flags

The brief's ruled-out row is "a prior human correction". The one such mechanism is the fit-UX pair flag
(`fit_labels.source = 'pair_flag'`, D-o). A queued row with a teammate's standing flag reads as Ruled out
with "Keep it ruled out" (rejected, `wrong_research_type_reaffirmed`) and "Reinstate" (confirmed). A row the
engine itself ruled out (E = 0) never reaches the queue, because only surfaced tiers are read.

### R5 — the pursuit verdict states facts

The prototype's "Worth pursuing" line was hand-written sample data; the product has no notice-level
judge. `pursuitVerdict` says only what the tiers and dates establish: a Strong match makes the notice
"Worth pursuing", Moderate alone "Worth a look", and the line beneath is the counts, the deadline, the
routing date and the submission rule in words.

### R6 — teammate history and the clash warning come from Outreach

"Teammate active" and the clash panel read the team's `outreach_recipients` on *other* notices: the
latest conversation per person, owned by the item's `owner_id`. A conversation is live when its status is
`contacted` (no reply) and it started inside 30 days; a live conversation owned by someone other than the
viewer is the clash. The warning never blocks; "Leave it with them" is Undo.

### R7 — the sidebar's Outreach count is partial until the Outreach step

The brief's Outreach badge is "rows in Needs you today". This build has one of its three categories — a
confirmed match with no message yet (recipient still `selected`). Replies to answer and nudges that are due
join when the Outreach re-base lands. Both counts come from Next's data cache (five minutes, revalidated by
every Review write) so the app shell pays no read per navigation.

### R8 — three things left out of this step rather than shipped inert

- **Focus mode** button and the `F` key: the next step. A primary button that does nothing is worse than none.
- **"Add an investigator"**: inert in the prototype (its known gaps list says so); needs a directory
  search wired to the match record.
- **The opportunity drawer**: "Open opportunity ↗" opens the notice's page until the drawers step.

### R9 — the nav label stays "Home"

The brief renames the home page "Today". Vincent named it Home on 2026-09-03 (`v2-redesign-workflow`); the
label, route and title stay until the Today step, where the question is his.

### R10 — Moderate's tier pill is neutral on every surface

The brief's tier table gives Moderate `#f1f5f9 / #334155`; the shipped fit-UX square variant was the
accent tint. Changed in `ui/pill.tsx` rather than at a call site, so the investigator page, the
opportunity aside and Review agree — the accent is Strong's alone.

### Deferred, from the brief's own list

Side-by-side comparison on a limited submission; outcome recording timed to the review-council date;
"Needs your call" / "Disagreements" filters; the queue policy above as a product decision; a density
setting (the row component takes `density`, nothing sets it yet).

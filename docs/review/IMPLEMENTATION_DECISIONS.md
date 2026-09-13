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

## Step 2 — Focus mode and the three drawers (2026-09-13)

### R11 — Focus mode lives in the URL

`?mode=focus` beside `?notice=`. A decision that finishes a notice navigates to the next one, and the mode has
to survive that navigation; a client flag would not. Toggling flips the client state and rewrites the URL with
`history.replaceState` so the switch costs no server round trip. Opening the page with `mode=focus` renders
Focus mode directly.

### R12 — the Opportunity card is composed, not authored

The prototype's card carried hand-written objectives, a "best fit for" paragraph, deal-breakers and a
"what you would need to assemble" list. The product has no notice-level author, so `lib/review/focus.ts`
composes every section from the notice's fit profile: the objective categories it funds (with the notice's own
quoted sentence and its Guide section), the required and excluded research approaches and designs
("Best fit for", "Not in scope"), the eligibility rules, trial designation, human-materials rule and
submission limit ("Could kill it"), the team and materials expectations ("What you would need to assemble"),
and the distinguishing topic terms as the priority chips. "Terms and eligibility" in the drawer is every
verbatim quote the profile carries, labelled by field and sourced to its section. A section with nothing
behind it says so. The summary is the notice's own synopsis and is labelled as such, not as Prospera's words.

### R13 — the investigator card's evidence is read on demand

Publications, awards, the research summary and the Profiles photo are three reads per person, and a notice
can list thirteen. The list page never reads them; Focus mode fetches the candidate under the cursor through
a read-only server action the first time they come into view, and keeps it for the page's life. The
research summary is the calibration card's own (`research-summary.ts`: the award's public-health-relevance
statement, else its abstract, else a Profiles narrative that reads as research). The card carries no
per-item "relevance" sentence — the prototype's were sample text — but items the assessment cites lead their
lists and are marked "Cited in Prospera's assessment". Citation counts are not stored, so the abstract panel
shows the PMID.

### R14 — the checklist is the audit's two rule tables

"Notice requirements, checked against [name]" is `auditView`'s eligibility table (who may apply) followed by
its requirements table (what the application must contain), kept in that order because the fit-UX work
keeps the two apart on purpose. Met is ✓ on the accent tint, Unknown is ? on the warn tint, Fails and Not
met are ✕ on the danger tint; the prototype's "~ partial" has no state in the model. A row with no audit, an
unscored stub, or a Can't-assess label shows "Not checked against this notice". `loadNoticeFit` now returns
the audit and the investigator profile per match so the drawer and the row read the same records.

### R15 — the drawers are `SlideOver`

Same scrim, focus trap, Esc and focus return as every other panel, at the brief's widths. The one visible
departure from the prototype is the close control: `SlideOver`'s icon button rather than a bordered ×. Esc
therefore closes an open drawer itself; the page's own Esc chain (reasons panel, then leave Focus) applies
once none is open. The sticky decision bar sits under the scrim.

### R16 — the large tier pill is a `Pill` variant

Five `tier-*-large` variants (34px, radius 8, 14px) in `ui/pill.tsx`, the same colours as the square set,
rather than a size override at the call site, so the two readings cannot drift.

## Step 3 — Outreach re-based on matches (2026-09-13)

### R17 — the match is the recipient row

An `outreach_recipients` row already is one investigator on one notice, so the match record for Outreach is
that row, extended (migration `20260930100000_outreach_match_stage.sql`) with its own `pursuit_stage`
(pursuing → submitted → outcome; parked and closed leave the board), `pursuit_outcome`, `next_step` and its
date, and an `owner_id` that falls back to the notice's owner. No second table, and the Review decision stays
where it is: the board reads it for "Carried from the match" and for the Unconfirm verb.

### R18 — the notice's stage stays, and follows its matches

Home, Reports, Calendar and the workspace still read `outreach_items.stage`. A match that moves ahead of its
notice pulls the notice along (pursuing → Developing, submitted → Submitted) and never back — "a notice is
busy when any of its matches is". The one exception is Undo: the toast's Undo puts the match back and, if the
change had pulled the notice and nothing else has moved it since, the notice too (found driving the real app —
the first cut left the notice in Developing). The kanban's loader and tabs are gone; `?stage=` and
`?community=` links still land on the board.

### R19 — the three groups are derived, not stored

Needs you today / Waiting on a PI / In progress are a pure function of the recipient's status, its send date
against the team's reply window, and its pursuit stage (`lib/outreach/matches.ts`). Declined matches, parked
notices, and matches parked, closed or with an outcome recorded are not rows. Communities as recipients are
not matches and stay in the workspace.

### R20 — what the verbs are wired to

Draft the message and Send a nudge open the notice's compose tab (the Message screen is step 4). Log a reply
is the existing reply record. Mark pursuing, Record submitted, Record outcome, Park and Close write the
match's stage; Log no reply is Close with the note "no reply". Hand to OSR sets the match's next step to
"OSR routing" on the team's routing date. Log a call is an activity note keyed to the person, which the
thread shows. Unconfirm deletes the Review decision (which removes the queued recipient); on a match added
by hand it reads "Remove from outreach" and removes the recipient. There is no auto-nudge in the product, so
the prototype's "Auto-nudge" next step and "Stop the auto-nudge" verb have no counterpart; a waiting row
says the day a nudge becomes due.

### R21 — the reply window is a team setting

`teams.reply_window_days` (3–21, default 7), edited on Team settings › Outreach. Read on its own rather than
through the `Team` record so a database without the column still opens Settings and the board.

### R22 — the thread is what was sent, what was said, and what was logged

Sent messages come from `outreach_message_recipients`, the reply from the recipient row, calls from activity
notes keyed to the person. No message has ever been sent from the app yet (2026-09-13), so today's threads
hold replies and calls only.

## Step 4 — Message, Draft outreach (2026-09-13)

### R23 — the Message screen is its own route, not the workspace's tab

The brief's screen lists recipients across notices ("PAR-25-122 · Pilot Projects…" under one name, another
notice under the next) and sends them all at once; the workspace is one notice. So `/outreach/draft` is a page:
every match that is Ready to send on the board, or one notice's with `?item=`, opening on `?match=`. The
board's Draft and Nudge verbs, its "Draft N messages" button and Review's queued bar all land there. The
workspace's Message tab stays as it was — the board is people-only, and the tab is still where a community
or a listserv is written to.

### R24 — one message per notice, personalised per recipient

Beats 1, 3 and 4 and the subject are one text per notice; "why you" is one per recipient. `assembleBody` puts
the personal-line token where "why you" goes and the existing send path (`renderForRecipient`, one
`outreach_messages` row per notice, one `outreach_message_recipients` row per person) does the rest, so the
records the thread and the reply matching read are unchanged. Sending marks the **match** contacted, as it
always did; the notice only moves Triage → Contacting, which is the pull R18 already allows. A beat that is
shared says "same for the 2 recipients on this notice" under it.

### R25 — every beat is editable, and "why you" also toggles

The prototype made "why you" the only editable beat. An uneditable sentence in a message someone is about to
sign is an inert control, so all four are textareas; what the prototype's note meant survives as "the only
sentence that changes per recipient". The toggle between the evidence-led line and the sharper one appears
only when the sharper one exists (R26), never as a button that does nothing.

### R26 — where "why you" comes from, and what it says when there is nothing

In order: the match's first cited evidence item from `fit_results` (the rationale's resolved refs, a real
item before a prior); else the item's legacy suggestion snapshot's strongest reason; else the default line
with the source label "no cited evidence — Prospera has not assessed this pair, so write this line yourself".
The sharper line is written from what the notice's profile *requires* (its "best fit" sentence) and exists only
when the profile requires something. Measured on 2026-09-13: all seven Ready matches on the pilot team were
added by hand, none has a fit row, and none of the seven investigators has an email on file — so every draft
today carries the honest fallback and "Send 0 · individually" is disabled with the names listed. The page
was built for the data it will have, not the data it has.

### R27 — the closing line is a team setting; saving is explicit

"Next step" reads `teams.outreach_closing_line` (migration `20261001100000_outreach_closing_line.sql`, set in
Team settings → Outreach → Closing line); the default sentence lives in code and the beat's source label says
which one it is. "Save as draft" writes the Compose tab's own `outreach_items.draft` (now also `beats` and
`alt`) — there is no autosave, so the button has something to do, and the stamp reads "Unsaved changes" until
it is pressed. A follow-up (the board's Nudge) is the same page with `?match=`: "why you" becomes the
follow-up line and the sharper toggle is hidden.

## Step 5 — Today (2026-09-13)

### R28 — the page is Today; the nav label stays Home

R9 left the name to this step. The route and the sidebar label stay "Home" (Vincent's 2026-09-03 decision);
the page itself is the brief's Today: the h1 is the date, in the app's own en-US form ("Saturday, September
13", not "Monday, 10 September"), and the line under it says what arrived, what it produced, and that nothing
went out on its own — "Nothing has been sent", or "2 messages went out overnight, each sent by hand" when
people did send, because the copy rule is about automation, not silence.

### R29 — the three queues are the three surfaces' own reads

"Decide on new matches" is `loadReviewQueue` (the same notices, order and counts as Review); "Answer a PI"
and "Follow up" are `loadMatchBoard`'s rows split by state (replies; sent past the reply window, sent inside
it, a pursuit whose next step has come due). Nothing is computed twice or differently, so a number on Today is
the number the queue shows when the button is pressed. Every row is a link; every card has one button.

### R30 — "Filed without a match" is what Prospera first saw since the last visit, with the engine's reason

The window is since the viewer's last Home visit, never more than 14 days back; "Overnight" inside 36 hours,
"Since Sep 10" after. A new notice (`funding_opportunities.created_at`, when Prospera first saw it — not
`posted_date`, which the sponsor sets) that is not in the queue is filed, and its reason is what `fit_results`
holds: no one above the bar, exploratory leads only, not assessed yet, not open, or the engine is off for the
team. The brief's hand-written reasons ("no investigator within scope") are not something the product can
say. Measured 2026-09-13: 0 notices in the last day, 20 in three days, 28 in seven; the feed runs once a
day at 08:14 UTC.

### R31 — the office's other business moved to the aside, and "Tag community" went

The old Home listed access requests, reassignments, consult requests, outcomes left unrecorded, internal
deadlines, saved-search hits and a "Tag community" nudge per untriaged notice in one mixed list with a button
per row. Those are not queues the brief names, but they are real; they sit under the filed list as "Also
waiting", still from `loadHome`, as links. The per-notice "Tag community" nudge went with the kanban's triage
column (up to twelve rows on the pilot team, one per untriaged notice) — tagging stays in the workspace. The
KPI tiles, "Closing in the next 30 days", the saved-search card and the PI-replies card are gone: the sub
line, the Outreach board's deadline filter, Opportunities and "Answer a PI" carry them.

## Audit of the merged app (2026-09-13)

Every page walked signed in as Vincent on a dev server at `bc12049`, the main journeys driven (Review
decide / undo / watch / dismiss-with-reason / dismiss-all, Focus mode keys and drawers, the Outreach board's
filters and verbs, the workspace's recipients and notes, the Draft page, Opportunities search / page size /
bad ids, Investigators search / bad ids, Calendar, Communities, Reports, Team settings), console and server
logs read after each. Three defects, each fixed at its root:

### A1 — an embed PostgREST refuses, and the callers swallowed the refusal

`team_memberships` and `team_access_requests` each have two foreign keys to `profiles`, so an unhinted
`profiles(...)` embed errors with "more than one relationship was found". Five call sites ignored the error
and read as if the team had no members: the workspace's owner select offered only "Unassigned", @mentions in
notes never resolved, `notifyImmediate` reached nobody, access requests never surfaced on Home or in the
digest. The fix is the hint (`profiles!user_id(...)`), and `lib/supabase/embeds.test.ts` reads the source tree
so the unhinted form cannot come back. Verified live: the owner select lists the four members.

### A2 — `disabled={pending}` does not stop a double-click

`isPending` turns true only after React re-renders, so clicks in the same tick each start a transition and the
action runs each time — three clicks on "Add note" wrote three notes. `lib/hooks/use-submit-transition.ts` is
`useTransition` with a synchronous in-flight guard, the same tuple, adopted on every component that writes
through a transition (41 files). Verified live: three clicks, one note.

### A3 — a stale `?item=` link landed on the board in silence

The board now says "That opportunity is not on your team's board — the link may be old." and drops the
parameter.

Not testable from the browser pane: file uploads (library, investigator import), the cron routes, sending
email. Not changed: the app's 1366px minimum width, which scrolls sideways in a narrower pane.

## The brief's open items (2026-09-13, Vincent: "yes please")

### R33 — the outcome is asked for when the council has met

"Prospera should ask once, timed to the review-council date, instead of waiting to be told." An NIH notice's
receipt cycles carry the Guide's "Advisory Council" month per due date; an application submitted on a day went
in for the first due date on or after it, so its council is that cycle's (`lib/outreach/council.ts`). A
submitted match's next step reads "Outcome after council, May 2027" until the council month ends, then
"Record the outcome — council met May 2027", urgent — on the board's In progress row and, being urgent, on
Today's Follow up. It keeps asking until an outcome is recorded; it never emails. A notice without a council
month (22 of the pilot team's 31; 512 notices carry Guide cycles) reads "Record the outcome" as before, so the
ask is timed where the notice says when, and honest where it does not.

### R34 — candidates compared side by side, from what the rows already show

"Side-by-side comparison of two or three candidates on a limited-submission notice." A "Compare candidates"
button in the Review header (list mode, two or more rows) opens a drawer with up to three candidates as
columns and twelve rows: Prospera's verdict, the three verdict chips, what is on file, the reason, the catch,
career stage, the checklist as counts, the cited evidence, prior contact, the decision
(`lib/review/compare.ts`, pure). Every cell comes from the Review row, so the comparison cannot claim more
than the row does. Confirm and Watch sit at the foot of each column and are the list's own verbs; Dismiss
stays in the list because it needs a reason. On a limited submission the button leads ("Compare · limited
submission", primary; Focus mode secondary) and the drawer's line says how many UCSF may put forward. The
brief tied the comparison to limited submissions; it is offered on any notice with two candidates, because
the question "which one" is not only a limited-submission question.

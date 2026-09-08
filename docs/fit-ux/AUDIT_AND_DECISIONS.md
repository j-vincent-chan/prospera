# Fit UX review — audit, decisions, and branch package

Read-only review of the Prospera repo (`Prospera/prospera`). **The original folder was not modified.**
No files created, edited, renamed or deleted there; no branch switched; no dependencies installed; no
migrations run; no databases touched. All design work lives in this separate project.

Implementation workspace, when you want the code change: `~/work/prospera-fit-ux` (fresh clone),
branch `design/fit-ux-review`.

**Illustrative data.** Investigator and community names are real UCSF/ImmunoX directory entries from
`immunox_members_pilot_*.csv`. Every verdict, rationale, quote, component score and count in the mockups is
illustrative and is labelled as such in the file's header bar. Component values were chosen to sit correctly
against the real floors in `src/lib/fit/taxonomy.json` — see §6.

## Files

| File | What it is |
|---|---|
| `Fit — Current.dc.html` | Today's four fit surfaces, recreated from the repo: investigator list, opportunity aside, Outreach recipients, evidence view |
| `fit-redesign-a-inline.dc.html` | The redesign. Four tabs — Investigator → funding, Opportunity → PIs, Outreach recipients, Empty & degraded — plus a strategist / PI viewer toggle |

---

## 1. What was reviewed

| Surface | Source read |
|---|---|
| Investigator → funding | `src/components/fit/fit-opportunities.tsx`, `src/app/(app)/investigators/[id]/page.tsx` |
| Opportunity → PIs | `src/app/(app)/opportunities/[id]/page.tsx`, `src/lib/funding-opportunities/notice-fit.ts` |
| Acting on matches | `src/components/outreach/{outreach-workspace,recipients-tab,evidence-view,component-bars}.tsx`, `src/lib/outreach/stages.ts` |
| Shared vocabulary | `src/components/fit/{tier-pill,evidence-chips}.tsx`, `src/lib/fit/{tier-display,explain-view}.ts` |
| Model constants | `src/lib/fit/taxonomy.json` (tiers, floors, gates, thin-evidence and confidence caps) |
| Admin inspectors | `src/app/(app)/{investigators,opportunities}/[id]/fit/page.tsx` |
| Chrome and tokens | `src/components/layout/app-shell*.tsx`, `src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/{pill,button}.tsx` |

Scope is UI/UX. The gated fit model, its thresholds and `taxonomy.json` are untouched.

## 2. Main problems

1. **Three explanation systems for one judgment.** The same pair reads as tier pill + rationale + evidence
   chips on the investigator page; tier pill + bulleted reasons with per-bullet source chips + evidence chips +
   coverage dots + freshness + history in the recipients row; and rationale + eight numeric component bars +
   a four-cell checklist + evidence groups in the evidence view. Nothing says which is authoritative.
2. **The interface explains the model, not the decision.** "a tier is a set of floors, not a score", "Poor is
   hidden, never deleted", "Teal clears the Moderate floor, amber the Exploratory floor". Correct, and not what
   a strategist needs while scanning — 50–90 words per row before anything actionable.
3. **The disqualifying constraint is not where the eye lands.** A human-participants requirement that decides
   the outcome arrives as bullet three, or as one red "Conflict" cell in a 2×2 grid. Eligibility exclusions are
   only reachable through "Show 6 excluded by eligibility" or "Why not?".
4. **Strength and confidence are visually fused, then verbally separated.** A filled teal pill reads as
   endorsement; microcopy then explains that coverage is separate and three 6px dots carry it. A pair resting
   on 14 papers and no award history looks like one resting on 48 papers and two R01s.
5. **Inspector numbers on a decision surface.** `S 62.4`, eight components to two decimals, floor tooltips —
   while runway, a real decision input, is prose inside the rationale ("runway 96 days").
6. **No comparison, and navigation loses your place.** Both directions are single stacked lists; the evidence
   view replaces the list, so comparing three candidates is open, read, back, open, read.
7. **Repetition.** "refreshed nightly" three times on one screen; evidence chips repeated between row and
   detail; a source chip on every bullet; the notice title in header and rows.
8. **Paradigm divergence is stated but not shown.** The distinction the brief cares most about — shared disease
   keywords versus a different research approach — is one sentence in the same 12px grey as everything else.

## 3. Design decisions

**Kept:** the flat bordered card system, group→row rhythm, tokens, evidence quoting with verified-source links,
the "Inferred" marker, flag-as-wrong everywhere, dismissal reasons feeding profile corrections, and the rule
that fit describes fit and never merit.

**a. The tier word stays; three verdicts sit beside it and never blend.** Labels keep the engine's vocabulary —
**Strong match / Moderate match / Exploratory** — plus two states the engine cannot express as a tier:
**Can't assess** (notice text incomplete) and **Ruled out** (a gate failed; shown, not hidden). What changes is
that the pill no longer carries the judgment alone:

- **Approach** — "Same approach · basic discovery" vs "Different approach · basic discovery vs implementation".
  The paradigm axis promoted to a named comparison, so shared keywords can never carry a row.
- **Eligibility** — Eligible / Not eligible · reason / Eligibility unverified. Always visible, never behind a click.
- **Evidence** — "Well evidenced · 48 papers, 2 awards" / "Well evidenced, but preclinical only" / "Thin · 14
  papers, RePORTER not linked". Confidence in words, not dots.

No score, no tier tooltip, no component numbers on the decision surface.

**b. Four fixed slots per row, in the brief's order.** Title and mechanism → one-sentence reason → one-sentence
caveat coloured by severity → next action. Deadline and runway get their own column.

**c. A coherent progression, not accordions.** Row summary → "Why, and what it rests on" (why you are seeing
this, what would have to be true, 2–3 evidence items) → "All evidence and components →" for the full audit.
Nothing disqualifying lives inside a disclosure.

**d. The deep view mirrors the row.** Verdict recap → why → what would have to be true → **approach side by
side** (what the notice funds vs what the evidence shows, divergences coloured) → **eligibility · who may
apply** and **notice requirements · what the application must contain**, as two separate tables, each rule with
its verified quote → the items → and last, collapsed, **Engine internals**: the eight components with their real
floors from `taxonomy.json`, S, caps and the stage-8 marker, labelled as inputs to the verdicts rather than a
second opinion on them.

**e. Eligibility and requirements are different tables.** Human subjects, clinical-trial allowance and required
designs are *requirements* assessed against the evidence (Met / Not met / Unknown); career stage, institution
and prior support are *eligibility* (Met / Fails / Unknown). Merging them is what makes a row read as blocked
when it is merely unwritable, and vice versa.

**f. Ruled-out is visible and inspectable.** One line: "Show 1 ruled out (eligibility)", opening into the same
row shape with the block as the caveat, so a wrong exclusion is catchable.

**g. Comparison and place-keeping.** Select 2–3 rows → Compare shows them side by side on the same slots, in
list order, each removable; closing returns to the list with filter and selection intact.

**h. The PI's own view (D7) is the same list, minus strategist tooling.** Strong and Moderate only, no
ruled-out, no multi-select or compare, and provenance phrased for the subject. The toggle in the header bar
switches between the two readings. **The row carries no action button in the PI view** — Outreach is the
office's internal queue and a PI cannot add themselves to it, and `FitOpportunities` has no per-row action for
the investigator audience today either. That leaves the brief's fourth question — what should I do next? —
unanswered for a PI, deliberately: it needs a real mechanism (request a consult, flag interest to the
strategist who owns the community) rather than a button that goes nowhere. Worth deciding before the pilot.

**i. Empty and degraded states keep the list's shape.** No profile yet · nothing clears the bar · notice
changed after assessment · directory too thin to assess. Each says what happened and what would change it; the
"nothing clears the bar" state is written as an answer, not a gap.

**j. Provenance once,** in the card footer, not three times per screen.

**k. Same components in both directions,** and in the workspace: only the subject and the action verb change.

**l. The workspace comes out of the 880px slide-over.** `OutreachWorkspace` renders in a `SlideOver` (width
880) over the board; that width is part of why the recipients tab feels cramped. The redesign puts it on the
page at full width, keeping the real header treatment (stage · owner label line, 18px title, meta line with
**Full notice →**), the real tab names (Recipients / Message / Notes & activity) and the real footer actions
(Skip suggestions · Park · Compose outreach · *n* people, *n* communities). Reversible if you want the
slide-over kept.

## 4. Model limitations found while designing

These are engine or data issues surfaced by the UI work, not UI problems. Flagged separately per the brief.

1. **A required-design gap makes Moderate unreachable, which the current UI hides.** `tiers.moderate` allows one
   missed floor but `gap_not_in: ["P","U","D_required"]`. So the human-participants case — notice requires
   consented participants, evidence is entirely preclinical — is **Exploratory**, not Moderate. Two of my own
   illustrative rows were wrong until I read the floors. If a strategist's intuition is "this is nearly there",
   the engine's answer is the opposite, and today's row does not say so.
2. **Notice completeness is admin-only.** `sources.complete` / `partial` are shown on `/opportunities/[id]/fit`
   but nowhere a strategist looks, so a notice whose Part 2 never parsed can produce a confident-looking row.
   The "Can't assess" label makes the state visible; the underlying signal still needs to reach the list query.
3. **Identity review exists for publications only.** `reviewIdentityAction` takes `kind: "publication"`, so
   "Not this person" cannot be offered on grants or trials even though both carry identity risk.
4. **Thin evidence caps the score but not the presentation.** `thin_evidence.cap 0.30` and
   `confidence_caps.low_profile_confidence_max_tier` fire silently; nothing in the row says the assessment
   rests on two items until you open the evidence view.

## 5. Branch package

Branch `design/fit-ux-review` in a clone outside the original folder.

**PR 1 — `src/lib/fit/verdicts.ts` (new, pure).** Map one `FitResultListRow` (+ the notice and profile records
the surface already loads) to the row's view model:

| Verdict | Derived from |
|---|---|
| `label` | `tier`, plus `eligibility.state === "fail"` → Ruled out, notice `sources.complete === false` → Can't assess |
| `approach` | `best_pair.investigator` vs the notice's paradigm list; family equality → "Same approach", cross-family → "Different approach · X vs Y" |
| `eligibility` | the notice profile's eligibility facts only — career stage, institution, prior support |
| `requirements` | materials/design axes: `human_required`, required design groups, non-responsive list |
| `evidence` | `components.T` provenance + item counts by kind + `thin_evidence` and confidence caps |
| `reason` | first clause of `rationale`, with cited ids resolved (`explain-view.rationaleView`) |
| `caveat` | the binding constraint: failed gate → its rule; unmet required design → that requirement; else the missed floor from `caps` |
| `action` | label → verb map (Add to outreach / See what's missing / Keep as a lead / Read the notice / Dismiss) |

Unit-test against `src/lib/fit/__fixtures__/adversarial-cases.json` — those cases are exactly the rows that
must not read as reassuring. Assert that no adversarial case produces an empty caveat.

**PR 2 — `src/components/fit/verdict-row.tsx` (new).** Row + inline disclosure. Replaces `TierPill` +
`EvidenceChips` on decision surfaces; both keep working for the admin inspectors.

**PR 3 — rewire the three surfaces** onto it: `fit-opportunities.tsx`, the opportunity page's "Suggested
recipients" aside, and `recipients-tab.tsx`'s `SuggestionRow`. Audience (D7) already resolves in
`fitAudienceFor`; the PI view is `selectable = false` plus the existing group filter.

**PR 4 — the deep view.** `evidence-view.tsx` becomes the audit layer: recap, approach side-by-side, the two
rule tables, items, and `ComponentBars` moved inside a collapsed "Engine internals" block. No new route.

**PR 5 — states.** Empty, unbuilt, stale-notice and thin-directory states from §3i.

Flag: reuse `teams.fit_engine`, or add `teams.fit_ui` if you want to A/B the surfaces.

**Verify before claiming:** `npm test` green, `npx tsc --noEmit` clean, adversarial fixtures pass, and one
manual pass per surface at 1366px — the app's minimum width — since the row grid is the tightest new layout.

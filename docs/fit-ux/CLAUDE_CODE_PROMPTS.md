# Claude Code prompts — Fit UX redesign

Five prompts, in order. Each is a PR. Run them one at a time; each ends with a check you can read before
starting the next. Paste a prompt as-is — they assume Claude Code is started in the **clone**, not the
original folder.

Before prompt 1, set the workspace up yourself:

```bash
git clone <prospera-remote> ~/work/prospera-fit-ux
cd ~/work/prospera-fit-ux
git checkout -b design/fit-ux-review
npm install
```

Put `README.md`, `AUDIT_AND_DECISIONS.md` and both `.dc.html` files somewhere Claude Code can read them —
`docs/fit-ux/` inside the clone is fine — and adjust the paths below if you put them elsewhere.

---

## Prompt 1 — the verdict model (pure, tested)

```
Read docs/fit-ux/AUDIT_AND_DECISIONS.md and docs/fit-ux/README.md first; they are the design brief for this
work. Then read src/lib/fit/{types.ts,results.ts,explain-view.ts,taxonomy.json,tier-display.ts} and
src/lib/outreach/types.ts.

Create src/lib/fit/verdicts.ts. Pure — no Supabase, no fetch, no model calls, matching the convention in
CLAUDE.md that everything under src/lib/fit/engine takes profiles in and returns results out.

It maps one FitResultListRow plus the notice profile and investigator profile the surface already loads into
one view model per pair:

  type FitVerdicts = {
    label: "strong" | "moderate" | "exploratory" | "cannot_assess" | "ruled_out"
    approach:    { text: string; tone: "ok" | "caution" | "blocking" }
    eligibility: { text: string; tone: "ok" | "caution" | "blocking" }
    evidence:    { text: string; tone: "ok" | "caution" | "blocking" }
    reason: string      // one sentence
    caveat: { text: string; tone: "quiet" | "caution" | "blocking" }   // never empty
    action: { label: string; kind: "primary" | "secondary" | "quiet" }
  }

Rules, in this order:
- label is the row's tier, except: eligibility gate failed -> "ruled_out"; the notice profile is incomplete
  (sources.complete === false / partial) -> "cannot_assess" regardless of tier.
- approach compares the pair's paradigm families: same family -> "Same approach · <family>"; different ->
  "Different approach · <investigator family> vs <notice family>", tone blocking. Never say "same" on the
  basis of shared topic terms alone — topic never gates (see the Terms section of CLAUDE.md).
- eligibility uses ONLY who-may-apply facts: career stage, institution, prior support. Human subjects,
  required designs and clinical-trial allowance are NOT eligibility; they belong to requirements.
- evidence combines item counts by kind with taxonomy.json's thin_evidence and confidence caps, and says in
  words what is thin: "Thin · 14 papers, RePORTER not linked".
- reason is the first clause of the rationale with cited evidence ids resolved to titles. Reuse
  explain-view.rationaleView; do not reimplement id resolution.
- caveat is the single binding constraint, chosen in this precedence: failed gate -> its rule; unmet required
  design -> that requirement; else the floor named in caps; else the nearest-to-floor component. If nothing
  binds, say so plainly ("No blocking constraint") rather than leaving it empty.

Write src/lib/fit/verdicts.test.ts covering every case in src/lib/fit/__fixtures__/adversarial-cases.json.
Assert for every fixture: caveat.text is non-empty; a pair whose paradigm families differ never gets
approach.tone "ok"; a pair that fails a gate is labelled ruled_out; and a pair missing a required design
group is never labelled moderate (tiers.moderate.gap_not_in includes D_required — this is the case that
matters most).

Run npm test and npx tsc --noEmit. Report the fixture cases where the caveat you generate reads worst, with
the text, so I can rewrite the wording.
```

## Prompt 2 — the row component

```
Read docs/fit-ux/README.md §"Screens / views" 1 and open docs/fit-ux/fit-redesign-a-inline.dc.html in a
browser for reference. Read src/components/fit/{fit-opportunities,tier-pill,evidence-chips}.tsx and
src/components/ui/{pill,button}.tsx.

Create src/components/fit/verdict-row.tsx: a server component rendering one FitVerdicts row, plus a small
client wrapper for the disclosure. Follow the README's grid, type scale and tone rules exactly, using existing
Tailwind tokens — no arbitrary hex values, no new colours. Where the design needs a square-cornered tier
label, add tier-*-square variants to the Pill variant union rather than styling at the call site; the comment
at the top of pill.tsx says a new colour combination has to be added there.

The disclosure holds: why you are seeing this, what would have to be true, and 2-3 evidence items, then
"All evidence and components →" and "This is wrong…". Nothing disqualifying may live inside it — blocks and
unknowns are already on the row.

Do not build the list, the filters or the compare view yet. Add a Storybook-less render test or a simple
fixture page under src/app/(app)/admin/ if you need to eyeball it, and delete it before the PR.
```

## Prompt 3 — rewire the three surfaces

```
Read docs/fit-ux/README.md §"Screens / views" 1-3. Put verdict-row.tsx behind:
  1. src/components/fit/fit-opportunities.tsx (investigator page)
  2. the "Suggested recipients" aside in src/app/(app)/opportunities/[id]/page.tsx — use the stacked
     variant described in the README; the 340px aside cannot take the four-column row
  3. SuggestionRow in src/components/outreach/recipients-tab.tsx

Add the card header (title, data-derived filter chips, compare affordance) and the single-line card footer
(ruled-out toggle, provenance stated once). Counts on the filter chips must be computed from the rows, never
hardcoded.

Keep every existing behaviour: add, dismiss with reasons, the wrong-type dismissal that proposes a profile
correction, restore, bulk select, regenerate, options, profile edit, community tagging. Keep TierPill and
EvidenceChips working for the two admin /fit inspectors — this PR must not touch them.

Audience: fitAudienceFor already returns "investigator" for a PI on their own page. In that view: Strong and
Moderate only, no checkboxes, no compare, no bulk actions, no ruled-out toggle, and no per-row action button.
The last one is deliberate — see AUDIT_AND_DECISIONS.md §3h — do not invent a PI-facing action.

In recipients-tab.tsx also collapse the opportunity-profile facet grid to the one-line summary described in
the README, with the full editor unchanged behind "Edit what counts as a match", and put communities on the
same row grammar as people.

Run npm test and npx tsc --noEmit. Then list every string you removed from the UI, so I can check nothing
load-bearing went with the clutter.
```

## Prompt 4 — the audit view

```
Read docs/fit-ux/README.md §"Screens / views" 4. Rework src/components/outreach/evidence-view.tsx into the
audit layer, in this order: provenance strip, header, three-column verdict recap, why + what would have to be
true, approach side-by-side, the two rule tables, the items, and last a collapsed <details> holding
ComponentBars, S, caps and the stage-8 marker.

Three things this PR must get right:
- The two rule tables stay separate. "Eligibility · who may apply" is career stage, institution, prior
  support. "Notice requirements · what the application must contain" is human subjects, required designs,
  clinical-trial allowance, assessed against the evidence. The opportunity fit inspector already carries
  human_required on the materials axis; follow that split.
- "Not this person" renders only on publications. reviewIdentityAction takes kind: "publication"; offering it
  on a grant, a notice quote or a sync record is meaningless.
- The floors printed beside each component come from taxonomy.json at render time. Never type a threshold
  into a component — CLAUDE.md is explicit about this.

Keep the flag-as-wrong and dismissal affordances. No new route: this replaces the list in place and returns
to it with filter and selection intact.
```

## Prompt 5 — states, then the sweep

```
Read docs/fit-ux/README.md §"Screens / views" 5 and implement the four states with the copy from the
prototype: no profile built; profile built but nothing clears the bar; notice reissued after the assessment
(amber banner + Reassess); directory too thin to assess. Each keeps the card's shape.

Then a sweep across all four surfaces:
- Every fit surface reads the same verdict model; no surface computes its own wording.
- "refreshed nightly" and equivalent provenance appear once per card, not per row.
- No score, tier tooltip or component number outside the collapsed internals block and the admin inspectors.
- One primary action per view.

Finally, check the new surfaces at 1366px (the app's min-w-page) as well as at a wide viewport — the row grid
is the tightest new layout — and run npm test, npx tsc --noEmit and the adversarial fixtures.

Write the PR description: what changed per file, what was removed, what is behind the flag, and anything in
AUDIT_AND_DECISIONS.md §4 (model limitations) that this work surfaced but did not fix.
```

---

## Notes for whoever runs these

- **Prompt 1 is the load-bearing one.** If the verdict model is right, the components are ordinary. Do not let
  it be skipped or folded into prompt 2.
- The four items in `AUDIT_AND_DECISIONS.md` §4 are engine or data issues, not UI. They are out of scope for
  these five PRs; §4.2 (notice completeness is admin-only) is the one that will most limit how honest the
  "Can't assess" state can be.
- Flag: reuse `teams.fit_engine`, or add `teams.fit_ui` if you want the old and new surfaces side by side
  during the pilot.

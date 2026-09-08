# Fit UX redesign — implementation decisions and corrections to the brief

Working notes for the five PRs. Read alongside `README.md` and `AUDIT_AND_DECISIONS.md`; where this file
and the brief disagree, **this file wins** — every entry below was verified against the code on
`origin/main` at `b16ba6e`.

Baseline before this branch: `npx tsc --noEmit` clean, `npm test` 131 files / 1628 passed / 2 skipped.

## Corrections to the brief

The brief was written from a read-only review and is right about the shape of the problem. Five statements
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

## Standing constraints for every PR

- `TierPill` and `EvidenceChips` keep working unchanged for the two admin `/fit` inspectors.
- No numeric threshold typed into a component; floors are read from `taxonomy.json` at render time.
- No engine, `taxonomy.json` or threshold changes. No migrations, no backfills, no database writes.
- `npx tsc --noEmit` clean and `npm test` green before each commit, against the baseline above.

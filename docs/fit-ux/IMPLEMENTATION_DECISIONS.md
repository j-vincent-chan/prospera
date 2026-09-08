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

## Standing constraints for every PR

- `TierPill` and `EvidenceChips` keep working unchanged for the two admin `/fit` inspectors.
- No numeric threshold typed into a component; floors are read from `taxonomy.json` at render time.
- No engine, `taxonomy.json` or threshold changes. No migrations, no backfills, no database writes.
- `npx tsc --noEmit` clean and `npm test` green before each commit, against the baseline above.

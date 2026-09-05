# Prospera — working notes for Claude Code

Prospera is a UCSF research-development app: funding notices (Simpler.Grants.gov + NIH Guide) in Supabase, an investigator directory enriched from PubMed / NIH RePORTER / ClinicalTrials.gov / ORCID / UCSF Profiles / biosketches, and an Outreach workflow strategists use to connect the two. Next.js 14 App Router, TypeScript (strict), Tailwind, Supabase (Postgres + pgvector, Auth, RLS), Zod, Vitest, Vercel cron.

## Current focus: the fit engine

We are replacing cosine-similarity matching with a structured, gated fit model. Read these before touching matching code:

1. `docs/MATCHING_REDESIGN.md` — the full design spec (what and why). §7–§10 define the pipeline, scoring and tiers; §16 defines where LLM judgment is allowed.
2. `docs/fit-engine/IMPLEMENTATION_PLAN.md` — the PR-by-PR plan with acceptance criteria. Work one PR at a time, in order.
3. `docs/fit-engine/DECISIONS.md` — open decisions; stop and ask when a task depends on one that is still open.
4. `src/lib/fit/taxonomy.json` and `src/lib/fit/signal-mapping.json` — the canonical taxonomy, matrices, floors and rule mappings. Code imports these; never hard-code a threshold that lives here.
5. `src/lib/fit/__fixtures__/adversarial-cases.json` — the regression suite every engine change must keep green.

## Codebase map (matching-relevant)

| Area | Where | Notes |
|---|---|---|
| Current suggestion engine (to be superseded) | `src/lib/outreach/suggest.ts`, `rank-opportunities.ts`, `embeddings.ts`, `profile.ts` | Keep working behind the feature flag until Phase 2 exit criteria are met. `SIM` thresholds and `GENERIC_WORDS` are what we are replacing. |
| Legacy tag engine (to be retired) | `src/lib/quick-match/*`, `loadPiInvestigatorMatches` in `src/lib/funding-opportunities/funding-opportunity-peek.ts` | Feeds "Best fit in your directory" on the opportunity page. |
| Ingest | `src/lib/community/pubmed-ingest.ts`, `reporter-ingest.ts`, `clinicaltrials-ingest.ts`; `src/lib/ingestion/nih-guide/*`; `src/lib/investigators/refresh-sources.ts` | RePORTER and CT.gov store full records in `raw_json`. PubMed stores no MeSH/abstract yet. Guide HTML is parsed for Key Dates and discarded. |
| Cron | `src/app/api/cron/*/route.ts`, schedule in `vercel.json` | `authorizeCronRequest` + `createServiceRoleClient`; `maxDuration` 300; log to `sync_job_logs`. Batch with limits and resume — Supabase statement timeouts bite on large vector upserts (see `upsertWithRetry`). |
| Server actions | `src/app/actions/*.ts` | Zod-validated; return `{ ok, ... }` result objects. |
| Schema | `supabase/migrations/*.sql` | Timestamp-named, applied manually in order (SQL Editor or `supabase db push`). Write migrations; never apply them from a script. RLS: `authenticated` has full access on app tables (MVP). |
| Scripts | `scripts/*.ts` via `tsx`, `dotenv` on `.env.local`, service-role client | Pattern: `scripts/backfill-nih-guide.ts`. Add an `npm run` alias in `package.json`. |
| Tests | `src/**/*.test.ts`, `npm test` | Pure functions get unit tests with fixtures; see `src/lib/outreach/suggest.test.ts`. |

## Conventions

- Keep scoring pure. Everything under `src/lib/fit/engine/` takes profiles in and returns results out — no Supabase, no `fetch`, no model calls. Orchestration lives in `src/lib/fit/service.ts` and cron routes.
- Cache anything expensive by content hash (`contentHash` in `src/lib/outreach/embeddings.ts`), the way embeddings already are.
- LLM calls: constrained JSON output, `temperature: 0`, model name from env (`FIT_MODEL_CLASSIFY`, `FIT_MODEL_EXTRACT`, `FIT_MODEL_JUDGE`), never in a page render path. Every LLM output that cites evidence must cite an ID that exists in the input; drop claims that do not.
- Never send investigator or notice data anywhere other than the configured OpenAI-compatible endpoint already in use.
- Feature flag: `teams.fit_engine` (`'legacy' | 'fit-v1'`). New surfaces read the flag; the legacy path stays intact until Phase 2 exit.
- Migrations add columns with `IF NOT EXISTS`; backfills are idempotent scripts, resumable by primary key.
- Do not touch `.env.local`, `.vercel`, or production data. Do not run backfills without being asked.
- Commit style: `fit(0.2): capture MeSH, publication types and abstracts` — scope is the PR number from the plan. One PR per plan item; run `npm test` and `npx tsc --noEmit` before proposing a commit.
- Stacked PRs: never `--delete-branch` a branch that is another open PR's base; check `gh pr list --base <branch>` first. `--delete-branch` also aborts remote deletion when a worktree holds the branch locally — remove the worktree first, then confirm with `git ls-remote --heads origin <branch>`.

## Verify before you claim

- `npm test` green, `npx tsc --noEmit` clean.
- Adversarial fixtures pass (`src/lib/fit/**/*.test.ts`).
- For ingest changes: a dry-run script output on ≥ 20 real rows, printed, not asserted.
- For LLM prompt changes: run the prompt on the fixture items in `docs/fit-engine/prompts/` and paste the outputs into the PR description.

## Terms

- **Paradigm / unit / design / materials / objective** — the five structured axes (spec §4). **Topic** is separate and never gates.
- **Gate** — a multiplicative factor (E, P, U, D) that can cap the tier. **Floor** — a per-component minimum a tier requires (spec §10).
- **Item profile** — the axis vector for one publication / grant / trial / statement. **Fit profile** — the aggregated investigator or notice record (spec §5–§6).
- **Blind pass / skeptic / reconciler** — the three LLM roles in stage 8 (spec §16). The model never emits a score; it proposes corrections to inputs.

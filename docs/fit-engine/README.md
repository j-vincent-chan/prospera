# Fit engine — handoff package

Everything Claude Code (or a person) needs to implement the matching redesign described in `docs/MATCHING_REDESIGN.md`.

| File | What it is | Who reads it |
|---|---|---|
| `/CLAUDE.md` | Repo operating notes: conventions, codebase map, guardrails | Claude Code, first |
| `../MATCHING_REDESIGN.md` | The design spec — what and why (also published as the *Prospera Fit Architecture* artifact) | Everyone, once |
| `IMPLEMENTATION_PLAN.md` | PR-by-PR work order with acceptance criteria, human checkpoints and paste-ready kickoff prompts | Claude Code, every session |
| `DECISIONS.md` | Open decisions that block specific PRs; answers get recorded here | Vincent, then Claude Code |
| `queries/inventory.sql` | Baseline data-volume queries (PR 0.1) | Whoever runs PR 0.1 |
| `prompts/*.md` | The five LLM prompt specs with schemas, validation rules and fixtures: item classifier, notice extractor, blind pass, skeptic, reconciler | Claude Code in PR 1.3, 1.5, 3.1 |
| `../../src/lib/fit/taxonomy.json` | Canonical taxonomy, compatibility matrices, floors, weights — the only place thresholds live | Code imports it |
| `../../src/lib/fit/signal-mapping.json` | Rule-classifier table (spec Appendix B as data) | Code imports it |
| `../../src/lib/fit/__fixtures__/adversarial-cases.json` | Regression suite: nine adversarial pairs + forbidden family cells | Tests import it |

## Order of operations

1. Answer `DECISIONS.md` D1–D3 (pilot scope, models, governance). Five minutes.
2. Run PR 0.1 (inventory). Read `INVENTORY.md`. Confirm the two raw-row field checks came back true — the Phase 0 backfills depend on them.
3. Phase 0 PRs 0.2–0.7 in order. No behavior changes; safe to merge continuously.
4. Phase 1 PRs 1.1–1.6. Stop at the spot-check checkpoint.
5. Phase 2 PRs 2.1–2.4. Stop at the gold-set checkpoint; flip `teams.fit_engine` for the pilot team only when METRICS.md shows the win.
6. Phase 3 PRs 3.1–3.3.

## What the engine must keep true

- A topical match can never overcome a paradigm mismatch (gates are multiplicative; §8).
- Strong requires every floor at once (§10) and blind-pass agreement (§16).
- The model never emits a score; it corrects inputs, and the score is recomputed (§16).
- Every tier shown carries a rationale that cites evidence that exists.
- Thresholds live in `taxonomy.json`; changing one is a recorded decision, not a code edit.

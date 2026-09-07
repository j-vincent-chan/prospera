/**
 * Fit engine · PR 3.1 · stage 8: blind pass, skeptic, reconciler.
 *
 *   npm run fit:judge -- --dry-run --limit 1                                  # the first investigator in judge order; the model IS called; nothing written
 *   npm run fit:judge -- --dry-run --limit 1 --no-model                       # the selection and the masked Call A prompt of each pair; no model call
 *   npm run fit:judge -- --dry-run --investigator <uuid> [--top 15] [--scout 10] [--variants 2] [--budget 150]
 *   npm run fit:judge -- --dry-run --notice RFA-DK-27-136 [--top 15]          # the mirror: the roster's top pairs for one notice
 *   npm run fit:judge -- --write [--limit N] [--cursor <uuid>] [--investigator <uuid>]... [--budget N] [--force]   # the coordinator's nightly from a terminal
 *   npm run fit:judge -- --fixtures [--case <id>]... [--variants 1] [--budget 12]                                  # the nine §13 fixture pairs against the real model (no database)
 *
 * The dry run loads the corpus and the investigator through the PR 2.2 service,
 * ranks in memory, selects the top pairs and the near-miss scout set, runs the
 * three passes (unless --no-model) and prints per pair the tier before and
 * after, the reconciliation row, the blind and skeptic verdicts and the
 * corrections — writing no adjudication, no result row and no correction.
 * `--write` is the nightly's code path (fit_adjudications, fit_results,
 * fit_corrections, the fit_judged_at stamp) with a long time budget.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildCallAPrompt, pairMask } from "../src/lib/fit/judge/blind";
import { loadBlindPassFixtures, runBlindPassFixture } from "../src/lib/fit/judge/fixtures";
import { maskLeaks } from "../src/lib/fit/judge/mask";
import { judgeModelName, openaiJudge } from "../src/lib/fit/judge/model";
import { judgePairs, refreshFitJudge, supabaseJudgeStore, type JudgePairsResult } from "../src/lib/fit/judge/service";
import { ModelBudget } from "../src/lib/fit/profile/model-budget";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const opt = (name: string) => opts(name)[0];
const num = (name: string) => (opt(name) !== undefined ? Number(opt(name)) : undefined);
const DRY_RUN = flag("--dry-run");
const WRITE = flag("--write");
const FIXTURES = flag("--fixtures");
const NO_MODEL = flag("--no-model");
const JSON_OUT = flag("--json");
const FORCE = flag("--force");
const INVESTIGATORS = opts("--investigator").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
const NOTICE = opt("--notice")?.trim().toUpperCase() ?? null;
const CASES = opts("--case");
const LIMIT = num("--limit");
const TOP = num("--top");
const SCOUT = num("--scout");
const VARIANTS: 1 | 2 | undefined = num("--variants") === 1 ? 1 : num("--variants") === 2 ? 2 : undefined;
const BUDGET = num("--budget");
const CURSOR = opt("--cursor") ?? null;

if ([DRY_RUN, WRITE, FIXTURES].filter(Boolean).length !== 1) {
  console.error("usage: fit:judge -- --dry-run [--investigator <uuid>]... [--notice <number>] [--limit N] [--top N] [--scout N] [--variants 1|2] [--budget N] [--no-model] [--json] | --write [--limit N] [--cursor <uuid>] [--investigator <uuid>]... [--budget N] [--top N] [--scout N] [--variants 1|2] [--force] | --fixtures [--case <id>]... [--variants 1|2] [--budget N] [--json]");
  process.exit(1);
}

const log = (line: string) => console.error(line);

function printPairs(r: JudgePairsResult, showPrompt: boolean) {
  console.log(`\n## ${r.subject.name ?? r.subject.investigator_id ?? r.subject.opportunity_id} — ${r.selected} selected, ${r.judged} judged, ${r.cached} cached, ${r.unusable} unusable, ${r.budget_stopped} budget-stopped, ${r.errors} errors; ${r.calls} calls; corrections auto ${r.corrections.auto}, provisional ${r.corrections.provisional}, dropped ${r.corrections.dropped}; ${r.durationMs} ms`);
  for (const p of r.pairs) {
    console.log(`  ${p.line}`);
    if (showPrompt && p.inputs) {
      const mask = pairMask(p.inputs);
      const prompt = buildCallAPrompt(p.inputs, mask);
      const leaks = maskLeaks(prompt, mask);
      console.log(`    evidence ${p.inputs.evidence.map((e) => `${e.id} (${e.kind}${e.similarity !== null ? ` ${e.similarity.toFixed(2)}` : ""})`).join(", ")}`);
      console.log(`    mask ${mask.length} terms; leaks ${leaks.length ? leaks.join(", ") : "none"}`);
      console.log(prompt.split("\n").map((l) => `    | ${l}`).join("\n"));
    }
  }
  for (const c of r.changes) console.log(`  change ${c.number}: ${c.before} → ${c.after} [${c.row}]`);
}

async function withDb(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function dryRun(): Promise<void> {
  const db = await withDb();
  const store = supabaseJudgeStore(db, { log });
  const now = new Date();
  const modelName = judgeModelName();
  const model = NO_MODEL ? async () => "{}" : openaiJudge();
  const budget = new ModelBudget(NO_MODEL ? 0 : (BUDGET ?? 150));
  const corpus = await store.fit.loadCorpus(now);
  console.error(`corpus: ${corpus.notices.length} open notices with a fit profile; model ${modelName}; budget ${budget.remaining} calls${NO_MODEL ? "; NO MODEL" : ""}`);
  console.log(`# fit:judge — dry run — taxonomy ${TAXONOMY_VERSION} — ${now.toISOString()}`);
  const out: JudgePairsResult[] = [];
  const common = { top: TOP, scout: SCOUT, variants: VARIANTS, budget, dryRun: true, force: FORCE, noModel: NO_MODEL, model, modelName, corpus, now: () => now, log };
  if (NOTICE) {
    const notice = corpus.notices.find((n) => (n.profile.number ?? n.facts.opportunity_number ?? "").toUpperCase() === NOTICE || n.profile.opportunity_id === NOTICE.toLowerCase());
    if (!notice) {
      console.error(`notice ${NOTICE} is not in the open corpus with a fit profile`);
      process.exit(2);
    }
    const r = await judgePairs(store, { ...common, opportunityId: notice.profile.opportunity_id });
    printPairs(r, NO_MODEL);
    out.push(r);
  } else {
    const roster = await store.loadJudgeRoster();
    console.error(`roster: ${roster.length} investigators with a profile (${roster.filter((x) => x.fit_judged_at === null).length} never judged), judge order`);
    const ids = INVESTIGATORS.length ? INVESTIGATORS : roster.map((x) => x.investigator_id).slice(0, LIMIT ?? roster.length);
    for (const id of ids) {
      const r = await judgePairs(store, { ...common, investigatorId: id });
      printPairs(r, NO_MODEL);
      out.push(r);
      if (r.budgetExhausted) {
        console.error("model budget exhausted");
        break;
      }
    }
  }
  if (JSON_OUT) console.log(JSON.stringify({ generated_at: now.toISOString(), taxonomy_version: TAXONOMY_VERSION, model: modelName, runs: out.map((r) => ({ ...r, pairs: r.pairs.map(({ inputs: _i, ...p }) => (void _i, p)) })) }, null, 2));
}

async function write(): Promise<void> {
  const db = await withDb();
  const store = supabaseJudgeStore(db, { log });
  const r = await refreshFitJudge(store, { limit: LIMIT, cursor: CURSOR, investigatorIds: INVESTIGATORS.length ? INVESTIGATORS : undefined, maxModelCalls: BUDGET, top: TOP, scout: SCOUT, variants: VARIANTS, force: FORCE, timeBudgetMs: 6 * 3_600_000, log });
  for (const line of r.investigators) console.log(line.line);
  console.log(JSON.stringify({ outcome: r.outcome, taken: r.taken, judged_pairs: r.judged_pairs, cached_pairs: r.cached_pairs, unusable_pairs: r.unusable_pairs, errors: r.errors, calls: r.calls, budget: r.budget, corrections: r.corrections, tier_changes: r.tier_changes, next_cursor: r.next_cursor, durationMs: r.durationMs, skipped: r.skipped }, null, 2));
  if (r.outcome === "error" || r.skipped) process.exit(3);
  if (r.outcome === "partial") process.exit(2);
}

async function fixtures(): Promise<void> {
  const all = loadBlindPassFixtures();
  const cases = CASES.length ? all.filter((c) => CASES.includes(c.id)) : all;
  const unknown = CASES.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) {
    console.error(`unknown case id(s): ${unknown.join(", ")}; known: ${all.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  const modelName = judgeModelName();
  const model = NO_MODEL ? async () => "{}" : openaiJudge();
  const budget = new ModelBudget(BUDGET ?? 12);
  const variants = VARIANTS ?? 1;
  console.log(`# fit:judge — fixtures — ${cases.length} case(s), ${variants} variant(s), budget ${budget.remaining} calls, model ${modelName} — ${new Date().toISOString()}`);
  const runs = [];
  for (const c of cases) {
    if (budget.exhausted) {
      console.log(`\n## ${c.id}: not run — budget spent`);
      continue;
    }
    const r = await runBlindPassFixture(c, { model, modelName, variants, takeCall: () => budget.take(), log });
    runs.push(r);
    console.log(`\n## ${c.id} — ${c.title}`);
    console.log(`  expected ${r.expected.join(" or ")}; verdict ${r.verdict ?? "absent"} — ${r.exact ? "exact" : r.within ? "within one tier" : "OFF BY TWO OR MORE"}; ${r.calls} calls`);
    for (const v of r.variants) {
      const b = r.blind.variants.find((x) => x.variant === v.variant)!;
      console.log(`  variant ${v.variant}: raw ${v.verdict_raw ?? "—"} → ${v.verdict ?? "absent"}${v.lowered.length ? ` (${v.lowered.join("; ")})` : ""}${b.dropped.length ? `; dropped ${b.dropped.length}: ${b.dropped.slice(0, 3).join(" | ")}` : ""}`);
      if (b.a) console.log(`    A: paradigm_fit ${b.a.paradigm_fit}, unit_fit ${b.a.unit_fit}, investigator ${b.a.investigator_paradigm.dominant.join("/")}, notice requires ${b.a.notice_paradigm.required.join("/")}, unmet designs ${b.a.design.unmet_required.join(", ") || "none"}`);
      if (b.b) console.log(`    B: topic ${b.b.topic_fit}; gap: ${b.b.biggest_gap}; counter-case gate-level ${b.b.counter_case_is_gate_level}; rationale: ${b.b.rationale}`);
    }
  }
  const within = runs.filter((r) => r.within).length;
  const exact = runs.filter((r) => r.exact).length;
  console.log(`\n${runs.length} run: ${exact} exact, ${within} within one tier, ${runs.length - within} off; ${budget.used} model calls`);
  if (JSON_OUT) console.log(JSON.stringify({ model: modelName, variants, runs: runs.map(({ blind: _b, ...r }) => (void _b, r)) }, null, 2));
}

(DRY_RUN ? dryRun() : WRITE ? write() : fixtures()).catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});

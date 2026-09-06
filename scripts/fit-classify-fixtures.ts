/**
 * Fit engine · PR 1.3 · the item classifier on the six prompt-spec fixtures.
 *
 *   npm run fit:classify-fixtures -- --dry-run          # print the prompts; call nothing
 *   npm run fit:classify-fixtures                       # six model calls, then a cached re-run of item 1; nothing written
 *   npm run fit:classify-fixtures -- --only 2,4         # a subset (fixture numbers)
 *
 * Runs docs/fit-engine/prompts/item-classifier.md's six fixture items
 * (src/lib/fit/__fixtures__/item-classifier-fixtures.json) through
 * classifyItem against the real endpoint — OPENAI_API_KEY from .env.local,
 * model from FIT_MODEL_CLASSIFY (default gpt-4o-mini) — and prints the
 * model's output beside the spec's expectation with one agreement line per
 * axis. The cache is in memory: the database is never read or written. The
 * rule classifier is `noRules` until PR 1.2 lands, so every axis here is
 * the model's. Hard cap of 12 model calls.
 */
import { config } from "dotenv";
import { buildPrompt, classifyItemWithoutRules, classifyModelName, InMemoryItemProfileCache, openaiModel, type ModelFn } from "../src/lib/fit/classify";
import { checkAxes, FIXTURE_THRESHOLDS, fixtureItem, formatAxisCheck, ITEM_CLASSIFIER_FIXTURES, type ItemClassifierFixture } from "../src/lib/fit/classify/fixtures";
import { AXES, type Axis } from "../src/lib/fit/classify/contracts";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";

config({ path: ".env.local", quiet: true });

const MAX_CALLS = 12;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const ONLY = new Set(
  (opt("--only") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
);

const fixtures = ITEM_CLASSIFIER_FIXTURES.filter((f) => ONLY.size === 0 || ONLY.has(f.n));
if (fixtures.length === 0) {
  console.error("--only matched no fixture (numbers 1–6)");
  process.exit(1);
}

const line = (s = "", width = 100) => console.log(s.padEnd(width, "─"));

function expectationText(f: ItemClassifierFixture, axis: Axis): string {
  const e = f.expect[axis] ?? {};
  const parts: string[] = [];
  for (const [id, min] of Object.entries(e.min ?? {})) parts.push(`${id} ≥ ${min}`);
  for (const id of e.present ?? []) parts.push(id);
  if (e.any?.length) parts.push(`any of ${e.any.join(" / ")}`);
  for (const id of f.expect.absent?.[axis] ?? []) parts.push(`no ${id}`);
  return parts.length ? parts.join(", ") : "—";
}

const showAxis = (values: Record<string, number> | undefined) => {
  const entries = Object.entries(values ?? {}).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([id, p]) => `${id} ${p.toFixed(2)}`).join(", ") : "(empty)";
};

async function main() {
  const modelName = classifyModelName();
  console.log(`fit:classify-fixtures · ${DRY_RUN ? "DRY RUN (no model calls)" : "real run"} · model ${modelName} · taxonomy ${TAXONOMY_VERSION} · ${new Date().toISOString()}`);
  console.log(`present ≥ ${FIXTURE_THRESHOLDS.present_min}, absent ≤ ${FIXTURE_THRESHOLDS.absent_max}; rules: none (PR 1.2 not merged — every axis below is the model's)`);

  if (DRY_RUN) {
    for (const f of fixtures) {
      line(`── fixture ${f.n} · ${f.kind} · ${f.id} `);
      const { system, user } = buildPrompt({ kind: f.kind, title: f.title, text: f.text, year: f.year, mesh_names: f.mesh_names });
      if (f === fixtures[0]) {
        console.log("[system]");
        console.log(system);
        console.log();
      }
      console.log("[user]");
      console.log(user);
      console.log();
    }
    console.log(`${fixtures.length} prompt(s) printed; 0 model calls.`);
    return;
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY missing in .env.local");
    process.exit(1);
  }

  let calls = 0;
  const real = openaiModel();
  const counted: ModelFn = async (req) => {
    calls += 1;
    if (calls > MAX_CALLS) throw new Error(`model call cap of ${MAX_CALLS} reached`);
    return real(req);
  };
  const cache = new InMemoryItemProfileCache();

  let axesExpected = 0;
  let axesAgreed = 0;
  let itemsAgreed = 0;
  const started = Date.now();

  for (const f of fixtures) {
    line(`── fixture ${f.n} · ${f.kind} · ${f.id} `);
    const t0 = Date.now();
    const out = await classifyItemWithoutRules(fixtureItem(f), { model: counted, modelName, cache });
    const ms = Date.now() - t0;
    const p = out.profile;
    console.log(`${out.model_reason}; cache ${out.cache}; ${ms} ms; confidence ${out.llm?.confidence}${out.llm?.halved ? " (values halved)" : ""}`);
    const axes = { paradigm: p.paradigm, unit: p.unit, design: p.design, materials: p.materials, objective: p.objective } as Record<Axis, Record<string, number>>;
    for (const axis of AXES) {
      console.log(`  ${axis.padEnd(9)} model:  ${showAxis(axes[axis])}`);
      console.log(`  ${"".padEnd(9)} expect: ${expectationText(f, axis)}`);
    }
    console.log(`  topic_terms: ${p.topic.terms.join("; ") || "(none)"}`);
    for (const axis of AXES) if (p.justification[axis]) console.log(`  justification.${axis}: ${p.justification[axis]}`);
    if (out.llm?.dropped.length) console.log(`  dropped: ${out.llm.dropped.join(" | ")}`);
    const checks = checkAxes(axes, f.expect);
    let itemOk = true;
    for (const c of checks) {
      console.log(`  ${formatAxisCheck(c)}`);
      if (!c.expected) continue;
      axesExpected += 1;
      if (c.ok) axesAgreed += 1;
      else itemOk = false;
    }
    if (itemOk) itemsAgreed += 1;
    console.log(`  agreement: ${itemOk ? "ALL AXES AGREE" : "DISAGREEMENT on " + checks.filter((c) => c.expected && !c.ok).map((c) => c.axis).join(", ")}`);
  }

  line("── cache check ");
  const first = fixtures[0]!;
  const callsBefore = calls;
  const again = await classifyItemWithoutRules(fixtureItem(first), { model: counted, modelName, cache });
  console.log(`fixture ${first.n} re-run: cache ${again.cache}, model_called ${again.model_called}, model calls before ${callsBefore} → after ${calls}`);

  line("── summary ");
  console.log(`items fully agreeing with the spec: ${itemsAgreed}/${fixtures.length}; axes agreeing: ${axesAgreed}/${axesExpected}; model calls: ${calls} (cap ${MAX_CALLS}); ${Date.now() - started} ms; cache rows: ${cache.rows.size}, writes: ${cache.writes}; database: untouched`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});

/**
 * Fit engine · Phase 4 · §12's recalibration: fit the §10 floors and the §4
 * family / level matrices to the adjudicated labels, report the METRICS
 * before and after, and write a PROPOSED `taxonomy.json` diff for review.
 *
 *   npm run fit:recalibrate                                   # dry run over the gold labels
 *   npm run fit:recalibrate -- --labels-csv labels.csv        # labels from a CSV (fills in pairs without a fit_labels row)
 *   npm run fit:recalibrate -- --min-labels 25                # refuse below this many adjudicated labels (default 50)
 *   npm run fit:recalibrate -- --out-dir /tmp --date 2026-09-07 --json
 *   npm run fit:recalibrate -- --max-evaluations 400 --max-cycles 4 --no-write
 *
 * NEVER AUTO-APPLY. The script reads `taxonomy.json`, never writes it: the
 * proposal is a markdown file and a unified diff under
 * `docs/fit-engine/recalibration/`, applied by a person after review (spec
 * §12; plan Phase 4; CLAUDE.md: a threshold change is a spec change).
 *
 * Read-only besides those two files: no model call, no embedding call, no
 * database write. It loads the corpus and the labels the way
 * `scripts/fit-metrics.ts` does (the same loaders, the same legacy rule over
 * stored vectors, the same `goldset/metrics.ts` maths), scores every pair
 * once under the shipped taxonomy, searches (`recalibrate/search.ts`) by
 * re-running `scorePair` under the recalibration override
 * (`recalibrate/override.ts` — production values are restored after every
 * evaluation), and reports.
 *
 * Below `--min-labels` it prints the before-METRICS and stops without
 * writing anything: with no labels there is nothing to fit, which is the
 * state today (D4 — the labelers are the critical path).
 *
 * The §13 adversarial cases are ALWAYS in the fit. The nine cases of
 * `engine/fixtures.ts` are scored from the fixture instead of the database
 * and carry their expected tier as the label in EVERY run, whether or not a
 * label file names them: they are spec, not labels, so the search may not
 * trade one away, they do not count towards `--min-labels`, and a fixture
 * tier beats a CSV row that disagrees with it. The proposal prints a §13
 * pass/fail table, so a proposal that breaks a case says so on its face
 * rather than only turning `npm test` red after the reviewer has decided.
 *
 * Other fixture pairs: a `--labels-csv` row whose `investigator_id` is
 * `fixture:<case id>` and is not one of the nine is scored from the fixture
 * too, with the CSV's tier as its label. A run whose labels come from a CSV
 * with no `fit_labels` behind them is marked FIXTURE RUN in the proposal and
 * is never a calibration.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ENGINE_VERSION, scorePair } from "../src/lib/fit/engine";
import { forbiddenCellPairs, loadAdversarialCases } from "../src/lib/fit/engine/fixtures";
import { LABEL_SLOTS, parseCsv } from "../src/lib/fit/goldset/csv";
import { forbiddenCellKeys, investigatorFamily, noticeFamily, type FamilySlot } from "../src/lib/fit/goldset/families";
import { adjudicate, assignSlots, latestByLabeler, slotLabelsFor, type Slot } from "../src/lib/fit/goldset/labels";
import { legacyRanks, legacyScorePair, legacyToFitTier } from "../src/lib/fit/goldset/legacy";
import { loadEvidenceVectors, loadGoldLabels, loadLabelerIdentities, loadLegacyCandidates } from "../src/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG } from "../src/lib/fit/goldset/manifest";
import { computeMetrics, isStructuralWrongType, type MetricPair } from "../src/lib/fit/goldset/metrics";
import { parseGoldLabel } from "../src/lib/fit/goldset/reasons";
import { STRATA, STRATUM_LABEL, pairKey, type Stratum } from "../src/lib/fit/goldset/stratify";
import { syntheticInvestigators, syntheticScoreContext } from "../src/lib/fit/goldset/synthetic";
import { proposedPatch } from "../src/lib/fit/recalibrate/patch";
import { overridesFor, recalibrationParameters, shippedVector, type ParameterVector } from "../src/lib/fit/recalibrate/parameters";
import { withTaxonomyOverrides } from "../src/lib/fit/recalibrate/override";
import { patchPath, proposalPath, renderConsole, renderProposal, RECALIBRATION_DIR, type AdversarialCheck, type RecalibrationInput, type StratumLabels } from "../src/lib/fit/recalibrate/report";
import { minLabelsDecision, search, type FittedPair, type TierAssignment } from "../src/lib/fit/recalibrate/search";
import { buildScoreContext, supabaseFitStore } from "../src/lib/fit/service";
import { TAXONOMY_VERSION, TIER_IDS } from "../src/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile, ScoreContext, Tier } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const TAXONOMY_PATH = "src/lib/fit/taxonomy.json";
const FIXTURE_PREFIX = "fixture:";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))[0];
const numberOpt = (name: string, fallback: number): number => {
  const raw = opt(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${raw}`);
  return n;
};

if (flag("--apply") || flag("--write")) {
  console.error("fit:recalibrate never applies a proposal: it writes a patch for review (spec §12, plan Phase 4). Apply it by hand with `git apply` after reading it.");
  process.exit(2);
}

const LABELS_CSV = opt("--labels-csv");
const MIN_LABELS = numberOpt("--min-labels", 50);
const OUT_DIR = opt("--out-dir") ?? RECALIBRATION_DIR;
const DATE = opt("--date") ?? new Date().toISOString().slice(0, 10);
const JSON_OUT = flag("--json");
const NO_WRITE = flag("--no-write");
const MAX_EVALUATIONS = numberOpt("--max-evaluations", 1500);
const MAX_CYCLES = numberOpt("--max-cycles", 8);
const LABELERS = { a: opt("--labeler-a") ?? LABELER_CONFIG.a, b: opt("--labeler-b") ?? LABELER_CONFIG.b, adjudicator: opt("--adjudicator") ?? LABELER_CONFIG.adjudicator };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
const log = (line: string) => console.error(line);

type PairLabel = MetricPair["label"];

/** One scoreable pair: the profiles and context stay in memory so the search can re-score them under every candidate vector. */
type ScoreablePair = {
  id: string;
  investigator_id: string;
  opportunity_id: string;
  stratum: Stratum | "extra";
  source: string;
  /** No stored vector: a synthetic (gold-set) or fixture pair, which the legacy engine never sees. */
  synthetic: boolean;
  /** One of the nine §13 adversarial cases: in every fit as spec, and never counted as a strategist label. */
  spec_case: string | null;
  inputs: { inv: InvestigatorFitProfile; opp: OpportunityFitProfile; ctx: ScoreContext } | null;
  investigator_family: FamilySlot;
  notice_family: FamilySlot;
  clinical_trial: string;
  forbidden: boolean;
  legacy: MetricPair["legacy"];
  label: PairLabel;
};

const fixtureCaseOf = (id: string): string | null => (id.startsWith(FIXTURE_PREFIX) ? id.slice(FIXTURE_PREFIX.length) : null);

/** Every labeled row of a gold-set CSV, adjudicated the same way the database rows are (the adjudicator's column, else A = B). */
function labelsFromCsv(file: string): Map<string, PairLabel> {
  const parsed = parseCsv(readFileSync(file, "utf8"));
  for (const e of parsed.errors) log(`labels-csv: ${e}`);
  const out = new Map<string, PairLabel>();
  for (const row of parsed.rows) {
    if (!row.investigator_id || !row.opportunity_id) continue;
    const labels: Record<Slot, { tier: Tier; reason: string | null; axis_reason: string | null } | null> = { a: null, b: null, adjudicator: null };
    for (const k of LABEL_SLOTS) {
      const tier = row[`tier_${k}`];
      if (!tier) continue;
      const p = parseGoldLabel({ tier, reason: row[`reason_${k}`], axis_reason: row[`axis_reason_${k}`] });
      if (!p.ok) {
        log(`labels-csv: ${row.pair_id} ${k}: ${p.error} — ignored`);
        continue;
      }
      labels[k === "adj" ? "adjudicator" : k] = p.value;
    }
    const adj = adjudicate(labels);
    if (adj.status === "unlabeled") continue;
    out.set(pairKey(row.investigator_id, row.opportunity_id), { tier: adj.tier, status: adj.status, reason: adj.reason, axis_reason: adj.axis_reason });
  }
  return out;
}

const emptyTiers = (): Record<string, number> => Object.fromEntries([...TIER_IDS, "unscored"].map((t) => [t, 0]));

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const notes: string[] = [];
  log(`fit:recalibrate — gold set ${GOLDSET_MANIFEST.version} — ${nowIso} — dry run (taxonomy.json is never written)`);

  // 1 · labels: the database (PR 2.4's loader and adjudication), and a CSV where one is given.
  const gold = await loadGoldLabels(supabase);
  if (gold.error) throw new Error(gold.error);
  if (!gold.available) notes.push("`fit_labels` is not on the database (apply supabase/migrations/20260916100000_fit_labels.sql); no labels were read from it.");
  const identities = await loadLabelerIdentities(supabase, [...gold.rows.map((r) => r.labeler), LABELERS.a, LABELERS.b, LABELERS.adjudicator]);
  const assignment = assignSlots({ a: LABELERS.a, b: LABELERS.b, adjudicator: LABELERS.adjudicator }, identities, gold.rows);
  const latest = latestByLabeler(gold.rows);
  const csvLabels = LABELS_CSV ? labelsFromCsv(LABELS_CSV) : new Map<string, PairLabel>();
  log(`labels: ${gold.rows.length} gold rows over ${latest.size} pairs; slots a ${assignment.slots.a ?? "—"}, b ${assignment.slots.b ?? "—"}, adjudicator ${assignment.slots.adjudicator ?? "—"} (${assignment.mode})${LABELS_CSV ? `; ${csvLabels.size} labeled pair(s) in ${LABELS_CSV}` : ""}`);

  // The nine §13 cases are SPEC, not labels: their expected tier is the label,
  // in every run, and it wins over anything a CSV says about the same pair.
  const adversarialCases = loadAdversarialCases();
  const fixtures = new Map(adversarialCases.map((c) => [`${FIXTURE_PREFIX}${c.id}`, c]));
  const specKeyOf = (caseId: string): string => pairKey(`${FIXTURE_PREFIX}${caseId}`, `${FIXTURE_PREFIX}${caseId}`);
  const specLabels = new Map(adversarialCases.map((c) => [specKeyOf(c.id), c.expect.tier as Tier]));

  const labelFor = (inv: string, opp: string): PairLabel => {
    const k = pairKey(inv, opp);
    const spec = specLabels.get(k);
    if (spec) return { tier: spec, status: "agreed", reason: null, axis_reason: null };
    const byLabeler = latest.get(k);
    if (byLabeler) {
      const adj = adjudicate(slotLabelsFor(byLabeler, assignment.slots as Record<Slot, string | null>));
      if (adj.tier) return { tier: adj.tier, status: adj.status, reason: adj.reason, axis_reason: adj.axis_reason };
    }
    return csvLabels.get(k) ?? { tier: null, status: "unlabeled", reason: null, axis_reason: null };
  };

  // 2 · the pairs: the gold set, the nine §13 cases, plus any other fixture pair the CSV names.
  type SetPair = { id: string; investigator_id: string; opportunity_id: string; stratum: Stratum | "extra"; synthetic: boolean; source: string; spec_case: string | null };
  const set: SetPair[] = GOLDSET_MANIFEST.pairs.map((p) => ({ id: p.id, investigator_id: p.investigator_id, opportunity_id: p.opportunity_id, stratum: p.stratum, synthetic: p.synthetic, source: p.at_export.source, spec_case: null }));
  adversarialCases.forEach((c, i) => {
    const key = `${FIXTURE_PREFIX}${c.id}`;
    set.push({ id: `x${String(i + 1).padStart(3, "0")}`, investigator_id: key, opportunity_id: key, stratum: "extra", synthetic: true, source: `fixture:${c.id}`, spec_case: c.id });
  });
  notes.push(
    `The ${adversarialCases.length} §13 adversarial cases (\`src/lib/fit/__fixtures__/adversarial-cases.json\`) are in this fit at their expected tiers, as they are in every run: they are spec, not labels, so they constrain the search whether or not a label file names them, and they are excluded from the \`--min-labels\` count. See the §13 table below — a FAIL there is a reason to reject the proposal.`
  );
  const inSet = new Set(set.map((p) => pairKey(p.investigator_id, p.opportunity_id)));
  const disagreeing = Array.from(csvLabels).flatMap(([k, l]) => (specLabels.has(k) && l.tier !== specLabels.get(k) ? [`${k} (CSV ${l.tier}, fixture expects ${specLabels.get(k)})`] : []));
  if (disagreeing.length) notes.push(`\`--labels-csv\` disagrees with the fixture's expected tier on ${disagreeing.length} §13 case(s); the fixture wins: ${disagreeing.join("; ")}.`);
  let n = 0;
  for (const k of Array.from(new Set(csvLabels.keys())).filter((k) => k.startsWith(FIXTURE_PREFIX) && !inSet.has(k)).sort()) {
    const [inv, opp] = k.split("|");
    n += 1;
    set.push({ id: `f${String(n).padStart(3, "0")}`, investigator_id: inv!, opportunity_id: opp!, stratum: "extra", synthetic: true, source: `fixture:${fixtureCaseOf(inv!) ?? "?"}`, spec_case: null });
  }
  if (n) notes.push(`${n} further fixture pair(s) named by \`--labels-csv\` are scored from \`engine/fixtures.ts\` with the CSV's tier as the label.`);

  // 3 · the corpus, the candidate set and one scoring of every pair.
  const store = supabaseFitStore(supabase, { log });
  const corpus = await store.loadCorpus(now);
  const noticeById = new Map(corpus.notices.map((x) => [x.profile.opportunity_id, x]));
  const candidates = await loadLegacyCandidates(supabase, corpus.today);
  const candidateList = Array.from(candidates, ([id, vector]) => ({ id, vector }));
  log(`corpus: ${corpus.notices.length} open notices with a fit profile (${corpus.with_vector} embedded), IDF ${corpus.idf.rows.length} codes; legacy candidates ${candidates.size}`);
  const investigatorIds = Array.from(new Set(set.filter((p) => !p.synthetic).map((p) => p.investigator_id))).sort();
  const evidence = await loadEvidenceVectors(supabase, investigatorIds);
  const synthetic = new Map(syntheticInvestigators().map((s) => [s.id, s]));
  const forbidden = forbiddenCellKeys(forbiddenCellPairs());

  const pairs: ScoreablePair[] = [];
  const bySetInvestigator = new Map<string, SetPair[]>();
  for (const p of set) (bySetInvestigator.get(p.investigator_id) ?? bySetInvestigator.set(p.investigator_id, []).get(p.investigator_id)!).push(p);
  let done = 0;
  for (const invId of investigatorIds) {
    const inv = await store.loadInvestigator(invId);
    const items = evidence.get(invId) ?? [];
    const ranks = legacyRanks(inv?.docVector ?? null, candidateList);
    for (const p of bySetInvestigator.get(invId) ?? []) {
      const notice = noticeById.get(p.opportunity_id) ?? null;
      const legacy = legacyScorePair(inv?.docVector ?? null, candidates.get(p.opportunity_id) ?? null, items, ranks.get(p.opportunity_id) ?? null);
      const invFam = inv ? investigatorFamily(inv.profile).family : "none";
      const notFam = notice ? noticeFamily(notice.profile).family : "none";
      pairs.push({
        id: p.id,
        investigator_id: p.investigator_id,
        opportunity_id: p.opportunity_id,
        stratum: p.stratum,
        source: p.source,
        synthetic: false,
        spec_case: null,
        inputs: inv && notice ? { inv: inv.profile, opp: notice.profile, ctx: buildScoreContext(inv, notice, corpus, nowIso) } : null,
        investigator_family: invFam,
        notice_family: notFam,
        clinical_trial: notice?.profile.mechanism.clinical_trial ?? "unknown",
        forbidden: forbidden.has(`${invFam}->${notFam}`),
        legacy: { tier: legacy.tier, similarity: legacy.similarity, rank: legacy.rank },
        label: labelFor(p.investigator_id, p.opportunity_id),
      });
    }
    done += 1;
    if (done % 25 === 0) log(`  ${done} / ${investigatorIds.length} investigators`);
  }
  for (const p of set.filter((x) => x.synthetic)) {
    const fixture = fixtures.get(p.investigator_id);
    const s = synthetic.get(p.investigator_id);
    const notice = noticeById.get(p.opportunity_id) ?? null;
    const inputs = fixture
      ? { inv: fixture.investigator, opp: fixture.opportunity, ctx: fixture.ctx }
      : s && notice
        ? { inv: s.profile, opp: notice.profile, ctx: syntheticScoreContext(s.ctx, notice, nowIso) }
        : null;
    if (!inputs) log(`  ${p.id} ${p.investigator_id} → ${p.opportunity_id}: no fixture case or notice profile; unscored`);
    const invFam = inputs ? investigatorFamily(inputs.inv).family : "none";
    const notFam = inputs ? noticeFamily(inputs.opp).family : "none";
    pairs.push({
      id: p.id,
      investigator_id: p.investigator_id,
      opportunity_id: p.opportunity_id,
      stratum: p.stratum,
      source: p.source,
      synthetic: true,
      spec_case: p.spec_case,
      inputs,
      investigator_family: invFam,
      notice_family: notFam,
      clinical_trial: inputs?.opp.mechanism.clinical_trial ?? "unknown",
      forbidden: forbidden.has(`${invFam}->${notFam}`),
      legacy: { tier: "dropped", similarity: null, rank: null },
      label: labelFor(p.investigator_id, p.opportunity_id),
    });
  }
  pairs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 4 · scoring under a parameter vector; the search calls this thousands of times.
  const params = recalibrationParameters(forbiddenCellPairs());
  const shipped = shippedVector(params);
  const scoreAll = (): Map<string, { tier: Tier; score: number; caps: string[] } | null> => {
    const out = new Map<string, { tier: Tier; score: number; caps: string[] } | null>();
    for (const p of pairs) {
      if (!p.inputs) {
        out.set(p.id, null);
        continue;
      }
      const r = scorePair(p.inputs.inv, p.inputs.opp, p.inputs.ctx);
      out.set(p.id, { tier: r.tier, score: r.score, caps: [...r.caps] });
    }
    return out;
  };
  const scoreUnder = (values: ParameterVector) => withTaxonomyOverrides(overridesFor(params, values), scoreAll);

  const t0 = Date.now();
  const beforeScores = scoreAll();
  log(`scored ${pairs.length} pairs in ${Date.now() - t0} ms per evaluation; ${params.length} parameters`);

  const metricPairs = (scores: ReadonlyMap<string, { tier: Tier; score: number; caps: string[] } | null>): MetricPair[] =>
    pairs.map((p) => ({
      id: p.id,
      investigator_id: p.investigator_id,
      opportunity_id: p.opportunity_id,
      stratum: p.stratum,
      forbidden: p.forbidden,
      synthetic: p.synthetic,
      source: p.source,
      investigator_family: p.investigator_family as MetricPair["investigator_family"],
      notice_family: p.notice_family as MetricPair["notice_family"],
      clinical_trial: p.clinical_trial,
      fit_v1: scores.get(p.id) ?? null,
      legacy: p.legacy,
      label: p.label,
    }));

  // `grid` is what makes the 30 % rule's PRIMARY reading available in the
  // proposal, exactly as `scripts/fit-metrics.ts` passes it: the set's own
  // Strong/Strong ratio is the secondary one, and this fit does not chase it.
  const metricsOptions = (generated: string) => ({
    forbidden,
    generated_at: generated,
    goldset_version: GOLDSET_MANIFEST.version,
    seed: GOLDSET_MANIFEST.seed,
    taxonomy_version: TAXONOMY_VERSION,
    engine_version: ENGINE_VERSION,
    source: "goldset" as const,
    grid: { legacy: GOLDSET_MANIFEST.legacy_grid, fit_results: GOLDSET_MANIFEST.fit_results_grid },
    notes: [] as string[],
  });
  const before = computeMetrics(metricPairs(beforeScores), metricsOptions(nowIso));

  // The §13 cases carry a label in every run, so they are excluded here: the
  // spec's "≥ 50 new tier labels" counts strategist judgments, not fixtures.
  const labeled = pairs.filter((p) => p.label.tier !== null && !p.spec_case).length;
  const decision = minLabelsDecision(labeled, MIN_LABELS);
  log(`${decision.message} (${pairs.filter((p) => p.spec_case).length} §13 spec case(s) are in the fit and not counted here)`);

  const byStratum: StratumLabels[] = [...STRATA, "extra"].flatMap((s) => {
    const group = pairs.filter((p) => p.stratum === s);
    if (!group.length) return [];
    const tiers = emptyTiers();
    for (const p of group) if (p.label.tier) tiers[p.label.tier] = (tiers[p.label.tier] ?? 0) + 1;
    return [{ stratum: s, label: (STRATUM_LABEL as Record<string, string>)[s] ?? s, pairs: group.length, labeled: group.filter((p) => p.label.tier !== null).length, tiers }];
  });

  const fitted: FittedPair[] = pairs.map((p) => ({
    id: p.id,
    label: p.label.tier,
    forbidden: p.forbidden,
    wrong_type: isStructuralWrongType({ investigator_family: p.investigator_family as MetricPair["investigator_family"], notice_family: p.notice_family as MetricPair["notice_family"], clinical_trial: p.clinical_trial }),
    legacy: p.synthetic ? null : legacyToFitTier(p.legacy.tier),
  }));
  // The §13 cases are in every run, so they no longer say anything about where
  // the LABELS came from: a fixture run is one whose labels are a CSV's.
  const fixtureRun = LABELS_CSV !== undefined && latest.size === 0;

  const adversarialOf = (afterScores: ReadonlyMap<string, { tier: Tier } | null> | null): AdversarialCheck[] =>
    pairs.flatMap((p) => {
      if (!p.spec_case) return [];
      const c = fixtures.get(p.investigator_id);
      return [
        {
          id: p.spec_case,
          title: c?.title ?? p.spec_case,
          pair_id: p.id,
          expected: p.label.tier,
          before: beforeScores.get(p.id)?.tier ?? null,
          after: afterScores ? (afterScores.get(p.id)?.tier ?? null) : null,
        },
      ];
    });

  let input: RecalibrationInput = {
    generated_at: nowIso,
    date: DATE,
    taxonomy_version: TAXONOMY_VERSION,
    engine_version: ENGINE_VERSION,
    goldset_version: GOLDSET_MANIFEST.version,
    label_source: LABELS_CSV ? `\`fit_labels\` (${latest.size} pair(s)) and \`${LABELS_CSV}\` (${csvLabels.size} pair(s))` : "`fit_labels` (source `gold`, adjudicated)",
    min_labels: MIN_LABELS,
    decision,
    fixture_run: fixtureRun,
    parameters: params,
    search: null,
    values: null,
    metrics: { before, after: null },
    labels_by_stratum: byStratum,
    adversarial: adversarialOf(null),
    patch: null,
    notes,
  };

  if (decision.fit) {
    // 5 · the fit.
    const evaluate = (values: ParameterVector): TierAssignment => {
      const scores = scoreUnder(values);
      return new Map(Array.from(scores, ([id, r]) => [id, r?.tier ?? null]));
    };
    const result = search(params, fitted, evaluate, { max_cycles: MAX_CYCLES, max_evaluations: MAX_EVALUATIONS });
    log(`search: ${result.evaluations} evaluations, ${result.cycles} cycle(s), objective ${result.before.objective.toFixed(2)} → ${result.after.objective.toFixed(2)}, ${result.deltas.length} parameter(s) moved${result.capped ? " (evaluation cap)" : result.converged ? " (converged)" : " (cycle cap)"}`);
    const afterScores = scoreUnder(result.values);
    const after = computeMetrics(metricPairs(afterScores), metricsOptions(nowIso));
    const patch = result.deltas.length
      ? (() => {
          const text = readFileSync(TAXONOMY_PATH, "utf8");
          const { diff, verification } = proposedPatch(text, result.deltas, TAXONOMY_PATH);
          return { diff, verification, path: patchPath(DATE, OUT_DIR), taxonomy_path: TAXONOMY_PATH };
        })()
      : null;
    input = { ...input, search: result, values: result.values, metrics: { before, after }, adversarial: adversarialOf(afterScores), patch };
    const broken = input.adversarial.filter((c) => c.after !== c.expected);
    if (broken.length) notes.push(`**This proposal breaks ${broken.length} of the ${input.adversarial.length} §13 adversarial cases** (${broken.map((c) => `\`${c.id}\` expects ${c.expected}, gets ${c.after ?? "unscored"}`).join("; ")}). Reject it, or amend the fixture first — that is a spec decision, and \`npm test\` will fail until one or the other happens.`);
    if (!patch) notes.push("The search moved nothing, so there is no patch to review.");
  } else {
    notes.push(`Nothing was fitted and nothing was written: ${decision.message}. Spec §12 recalibrates "whenever ≥ 50 new tier labels accumulate"; D4 (who labels the gold set) is still open.`);
  }

  // 6 · the report.
  const consoleReport = renderConsole(input);
  if (decision.fit && !NO_WRITE) {
    const proposal = proposalPath(DATE, OUT_DIR);
    mkdirSync(dirname(proposal), { recursive: true });
    writeFileSync(proposal, renderProposal(input));
    if (input.patch) writeFileSync(input.patch.path, input.patch.diff);
    log(`wrote ${proposal}${input.patch ? ` and ${input.patch.path}` : ""}`);
  }
  console.log(consoleReport);
  if (!decision.fit) {
    console.log("");
    console.log(renderProposal(input));
  }
  if (JSON_OUT) console.log(JSON.stringify({ shipped, values: input.values, search: input.search, before, after: input.metrics.after }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});

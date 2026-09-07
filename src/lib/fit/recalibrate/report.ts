/**
 * The recalibration proposal (plan Phase 4: "report before/after METRICS;
 * never auto-apply — writes a proposed `taxonomy.json` diff for review").
 *
 * One markdown file per run under `docs/fit-engine/recalibration/`, beside
 * the `.patch`: what was fitted and on which labels, the parameter set and
 * its ranges, the parameters the search moved, the METRICS the spec cares
 * about before and after (recomputed with `goldset/metrics.ts`, not
 * re-derived here), agreement per tier, labels per stratum, the objective
 * trace step by step, and the diff itself with the three checks it passed.
 *
 * The document is written to be read by a person who will decide whether to
 * apply the patch by hand: nothing in this repository applies it, and the
 * script that writes this file never touches `taxonomy.json`.
 *
 * Pure: formatting only.
 */
import { TARGETS, type EngineId, type MetricsReport } from "@/lib/fit/goldset/metrics";
import { TIER_LABEL_GOLD } from "@/lib/fit/goldset/reasons";
import type { PatchVerification } from "@/lib/fit/recalibrate/patch";
import type { ParameterVector, RecalibrationParameter } from "@/lib/fit/recalibrate/parameters";
import { deltas as parameterDeltas } from "@/lib/fit/recalibrate/parameters";
import type { MinLabelsDecision, SearchResult } from "@/lib/fit/recalibrate/search";
import { marginalAgreementRule, OBJECTIVE_WEIGHTS } from "@/lib/fit/recalibrate/search";
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

export const RECALIBRATION_DIR = "docs/fit-engine/recalibration";

export const proposalPath = (date: string, dir = RECALIBRATION_DIR): string => `${dir}/${date}-proposal.md`;
export const patchPath = (date: string, dir = RECALIBRATION_DIR): string => `${dir}/${date}-taxonomy.patch`;

export type StratumLabels = { stratum: string; label: string; pairs: number; labeled: number; tiers: Record<string, number> };

/** One §13 adversarial case under the shipped values and under the proposal. The cases are in every fit — they are spec, not labels. */
export type AdversarialCheck = { id: string; title: string; pair_id: string; expected: Tier | null; before: Tier | null; after: Tier | null };

export type RecalibrationInput = {
  generated_at: string;
  /** The date the file names are built from (UTC). */
  date: string;
  taxonomy_version: string;
  engine_version: string;
  goldset_version: string;
  /** Where the labels came from: the database, a CSV, or both. */
  label_source: string;
  min_labels: number;
  decision: MinLabelsDecision;
  /** A run on constructed labels — never a calibration. */
  fixture_run: boolean;
  parameters: readonly RecalibrationParameter[];
  /** Null when the run refused to fit (below `--min-labels`). */
  search: SearchResult | null;
  values: ParameterVector | null;
  metrics: { before: MetricsReport; after: MetricsReport | null };
  labels_by_stratum: readonly StratumLabels[];
  /** The nine §13 adversarial cases, folded into every fit at their expected tiers. */
  adversarial: readonly AdversarialCheck[];
  patch: { diff: string; verification: PatchVerification; path: string; taxonomy_path: string } | null;
  notes: readonly string[];
};

const count = (params: readonly RecalibrationParameter[], kind: string): number => params.filter((p) => p.kind === kind).length;

const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(1)} %`);
const num2 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const signed = (n: number): string => `${n > 0 ? "+" : ""}${num2(n)}`;

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

const tierLabel = (t: string): string => (TIER_LABEL_GOLD as Record<string, string>)[t] ?? t;

/** fit-v1's tier counts in a metrics report, the synthetic row folded in (a recalibration run scores every pair). */
function distributionRow(r: MetricsReport): Record<string, number> {
  const d = r.distribution;
  const out: Record<string, number> = {};
  for (const t of [...TIER_IDS, "unscored"] as const) out[t] = (d.fit_v1[t] ?? 0) + (d.synthetic[t] ?? 0);
  return out;
}

const precisionOf = (r: MetricsReport, engine: EngineId, tier: Tier) => r.tier_precision[engine].find((row) => row.tier === tier)!;

function beforeAfter(before: MetricsReport, after: MetricsReport | null, label: string, read: (r: MetricsReport) => string): string[] {
  return [label, read(before), after ? read(after) : "—"];
}

/** The METRICS the spec's §14 checkpoint reads, before and after. */
function metricsComparison(before: MetricsReport, after: MetricsReport | null): string {
  const rows: string[][] = [];
  const d = (r: MetricsReport) => distributionRow(r);
  for (const t of TIER_IDS) rows.push(beforeAfter(before, after, `fit-v1 pairs at ${tierLabel(t)}`, (r) => String(d(r)[t] ?? 0)));
  for (const t of ["strong", "moderate"] as const) {
    rows.push(
      beforeAfter(before, after, `Tier precision · ${tierLabel(t)} (target ≥ ${pct(t === "strong" ? TARGETS.strong_precision : TARGETS.moderate_precision)})`, (r) => {
        const p = precisionOf(r, "fit_v1", t);
        return `${p.agree} / ${p.labeled} (${pct(p.rate)})`;
      })
    );
  }
  rows.push(beforeAfter(before, after, `Wrong-type rate · structural (target ≤ ${pct(TARGETS.wrong_type_rate)})`, (r) => `${r.wrong_type.structural.fit_v1.wrong} / ${r.wrong_type.structural.fit_v1.shown} (${pct(r.wrong_type.structural.fit_v1.rate)})`));
  rows.push(beforeAfter(before, after, "Wrong-type rate · labeled", (r) => `${r.wrong_type.labeled.fit_v1.wrong} / ${r.wrong_type.labeled.fit_v1.shown} (${pct(r.wrong_type.labeled.fit_v1.rate)})`));
  rows.push(beforeAfter(before, after, `Recall · labeled Strong in Strong / Moderate (target ≥ ${pct(TARGETS.recall_strong)})`, (r) => `${r.recall.fit_v1.labeled_strong.recommended} / ${r.recall.fit_v1.labeled_strong.pairs} (${pct(r.recall.fit_v1.labeled_strong.rate)})`));
  const ratioCell = (s: { fit_v1_strong: number; legacy_strong: number; ratio: number | null } | null): string => (s === null ? "— (no grid tallies in this run)" : `${s.fit_v1_strong} / ${s.legacy_strong} = ${s.ratio === null ? "—" : s.ratio.toFixed(2)}`);
  // The grid row is the manifest's stored tally, not a re-score: it cannot move with a proposal, and saying so is the point of printing it beside the set's own ratio.
  rows.push([`Strong-list ratio — **grid, the PRIMARY reading** (rule ≥ ${TARGETS.strong_list_ratio_min})`, ratioCell(before.strong_ratio_grid), "not re-scored — re-run `npm run fit:metrics` after applying"]);
  rows.push(beforeAfter(before, after, "Strong-list ratio — the set (SECONDARY: the set over-samples what legacy shows)", (r) => ratioCell(r.strong_ratio)));
  rows.push(beforeAfter(before, after, "Forbidden-cell mass shown", (r) => String(r.confusion.recommended.fit_v1.forbidden_mass)));
  rows.push(beforeAfter(before, after, "Precision@5 per investigator (mean)", (r) => pct(r.precision_at_k.fit_v1.mean)));
  return table(["metric (fit-v1)", "before", "after"], rows);
}

/** Legacy's own numbers, unchanged by a recalibration — the comparison the §14 checkpoint is against. */
function legacyRow(before: MetricsReport): string {
  const p = precisionOf(before, "legacy", "strong");
  const m = precisionOf(before, "legacy", "moderate");
  return table(
    ["metric (legacy, unchanged by this fit)", "value"],
    [
      ["Pairs at Strong / Potential", `${p.system} / ${m.system}`],
      ["Tier precision · Strong", `${p.agree} / ${p.labeled} (${pct(p.rate)})`],
      ["Tier precision · Potential", `${m.agree} / ${m.labeled} (${pct(m.rate)})`],
      ["Wrong-type rate · structural", `${before.wrong_type.structural.legacy.wrong} / ${before.wrong_type.structural.legacy.shown} (${pct(before.wrong_type.structural.legacy.rate)})`],
      ["Forbidden-cell mass shown", String(before.confusion.recommended.legacy.forbidden_mass)],
    ]
  );
}

function parameterTable(params: readonly RecalibrationParameter[]): string {
  return table(
    ["parameter", "taxonomy path", "current", "range", "step"],
    params.map((p) => [`\`${p.id}\`${p.forbidden ? " ·  forbidden cell" : ""}`, `\`${p.paths.join("\`, \`")}\``, num2(p.current), `${num2(p.min)} – ${num2(p.max)}`, String(p.step)])
  );
}

function deltaTable(params: readonly RecalibrationParameter[], values: ParameterVector): string {
  const ds = parameterDeltas(params, values);
  if (!ds.length) return "_The search moved nothing: the shipped values are already a local optimum of the objective on these labels._";
  return table(
    ["parameter", "taxonomy path", "from", "to", "Δ"],
    ds.map((d) => [`\`${d.parameter.id}\` — ${d.parameter.label}`, `\`${d.parameter.paths.join("\`, \`")}\``, num2(d.from), num2(d.to), signed(d.to - d.from)])
  );
}

function traceTable(search: SearchResult): string {
  return table(
    ["step", "cycle", "parameter", "from", "to", "objective", "evaluations", "note"],
    search.trace.map((t) => [String(t.step), String(t.cycle), t.parameter ? `\`${t.parameter}\`` : "—", t.from === null ? "—" : num2(t.from), t.to === null ? "—" : num2(t.to), t.objective.toFixed(2), String(t.evaluations), t.note])
  );
}

function objectiveTable(search: SearchResult): string {
  const b = search.before;
  const a = search.after;
  const row = (label: string, read: (o: typeof b) => string) => [label, read(b), read(a), read(a) === read(b) ? "—" : `${read(b)} → ${read(a)}`];
  const delta = (label: string, read: (o: typeof b) => number) => [label, num2(read(b)), num2(read(a)), signed(read(a) - read(b))];
  return table(
    ["objective term", "before", "after", "Δ"],
    [
      delta("**Objective**", (o) => o.objective),
      delta("net = agreeing − disagreeing recommendations", (o) => o.net),
      row(`Strong · agree / labeled (pairs shown) — agrees when ${b.agreement.strong.rule}`, (o) => `${o.agreement.strong.agree} / ${o.agreement.strong.labeled} (${o.agreement.strong.shown})`),
      row(`Moderate · agree / labeled (pairs shown) — agrees when ${b.agreement.moderate.rule}`, (o) => `${o.agreement.moderate.agree} / ${o.agreement.moderate.labeled} (${o.agreement.moderate.shown})`),
      delta(`Penalty · tier-precision targets (×${OBJECTIVE_WEIGHTS.target_shortfall} per labeled pair at the tier)`, (o) => -o.penalties.targets),
      delta(`Penalty · forbidden-cell mass change (×${OBJECTIVE_WEIGHTS.forbidden_mass_change})`, (o) => -o.penalties.forbidden),
      delta(`Penalty · structural wrong-type mass added (×${OBJECTIVE_WEIGHTS.wrong_type_mass_increase})`, (o) => -o.penalties.wrong_type),
      delta("Forbidden-cell mass shown", (o) => o.forbidden_mass),
      delta("Structural wrong-type mass shown", (o) => o.wrong_type_mass),
      row("_Strong list · fit-v1 / legacy over the set (reported, NOT priced)_", (o) => (o.strong_list.applicable ? `${o.strong_list.fit_v1} / ${o.strong_list.legacy} (${o.strong_list.ratio!.toFixed(2)})` : `${o.strong_list.fit_v1} / — (legacy has no Strong pair in scope)`)),
    ]
  );
}

const tierCell = (t: Tier | null): string => (t === null ? "unscored" : tierLabel(t));

/** The §13 adversarial cases, which are in every fit whether or not a label file names them. */
function adversarialTable(rows: readonly AdversarialCheck[], fitted: boolean): string {
  if (!rows.length) return "_No adversarial case could be scored in this run._";
  return table(
    ["§13 case", "expects", "before", "after", "verdict"],
    rows.map((r) => [
      `\`${r.id}\` — ${r.title}`,
      tierCell(r.expected),
      `${tierCell(r.before)}${r.before === r.expected ? "" : " ✗"}`,
      fitted ? `${tierCell(r.after)}${r.after === r.expected ? "" : " ✗"}` : "—",
      (fitted ? r.after : r.before) === r.expected ? "PASS" : "**FAIL**",
    ])
  );
}

function strataTable(rows: readonly StratumLabels[]): string {
  return table(
    ["stratum", "pairs", "labeled", ...TIER_IDS.map(tierLabel)],
    rows.map((r) => [r.label, String(r.pairs), String(r.labeled), ...TIER_IDS.map((t) => String(r.tiers[t] ?? 0))])
  );
}

/** Pure. The proposal markdown. */
export function renderProposal(r: RecalibrationInput): string {
  const lines: string[] = [];
  const fitted = r.search !== null && r.values !== null;
  lines.push(`# Fit engine — recalibration proposal (${r.date})`);
  lines.push("");
  if (r.fixture_run) {
    lines.push(`> **Fixture run — not a calibration.** The labels behind this proposal are constructed, not strategist judgments; it exists to exercise the search and the patch. Nothing in it may be applied to \`taxonomy.json\`.`);
    lines.push("");
  }
  lines.push(
    `Generated ${r.generated_at} by \`scripts/fit-recalibrate.ts\` (dry run — this script never edits \`taxonomy.json\`, makes no model call and writes nothing to the database). Spec §12 "Periodically, globally": recalibrate the §10 floors and the §4 family / level matrices against the label set until ≥ ${pct(TARGETS.strong_precision)} of Strong and ≥ ${pct(TARGETS.moderate_precision)} of Moderate labels agree with the strategist. Taxonomy \`${r.taxonomy_version}\`, engine \`${r.engine_version}\`, gold set ${r.goldset_version}.`
  );
  lines.push("");
  lines.push(`Labels: ${r.decision.message}. Source: ${r.label_source}.`);
  for (const n of r.notes) lines.push("", `> ${n}`);

  lines.push("", "## Parameter set", "");
  lines.push(
    `${r.parameters.length} parameters, every one a number already in \`taxonomy.json\` and marked there as a prior: ${count(r.parameters, "floor")} tier floors (§10), ${count(r.parameters, "family_cell")} off-diagonal family-matrix cells and ${count(r.parameters, "unit_cell")} unit level-compat cells (§4, symmetric — one parameter writes both cells), and the paradigm gate. Held fixed: \`paradigm.gates.exploratory_below\` (it caps a pair at Exploratory before any Moderate floor is read, so a Moderate P floor under 0.45 is inert), \`within_family\`, the matrix diagonals, \`tiers.*.T_specific_depth\` (a MeSH tree depth), \`design.score\`, \`compose.*\` and the confidence caps.`
  );
  lines.push("");
  lines.push(parameterTable(r.parameters));

  lines.push("", "## Proposed changes", "");
  if (!fitted) lines.push(`_No fit was run: ${r.decision.message}._`);
  else lines.push(deltaTable(r.parameters, r.values!));

  lines.push("", "## §13 adversarial cases", "");
  lines.push(
    `The nine cases of \`src/lib/fit/__fixtures__/adversarial-cases.json\` are in EVERY fit at their expected tiers, whether or not a label file names them: they are spec, not labels (\`npm test\` is the same regression suite, but a proposal that breaks a case has to say so on its face, before the reviewer decides). A **FAIL** row is a reason to reject the proposal outright.`
  );
  lines.push("");
  lines.push(adversarialTable(r.adversarial, fitted));

  if (r.search) {
    lines.push("", "## Objective", "");
    lines.push(
      `Coordinate descent, one parameter at a time, cycling until a whole cycle improves nothing. ${r.search.evaluations} evaluations over ${r.search.cycles} cycle(s); ${r.search.capped ? "**stopped at the evaluation cap**" : r.search.converged ? "converged" : "stopped at the cycle cap"}. The objective counts pairs — agreeing minus disagreeing recommendations, Strong agreeing only on a Strong label so that a Moderate → Strong promotion is not free — with §14's tier-precision targets (×${OBJECTIVE_WEIGHTS.target_shortfall} per point of shortfall PER labeled pair at the tier, so they bind at any set size: the search takes a block of pairs into Strong only when more than ${pct(marginalAgreementRule(TARGETS.strong_precision))} of it agrees, into Moderate only over ${pct(marginalAgreementRule(TARGETS.moderate_precision))}), any change in the forbidden-cell mass and any ADDITION to the structural wrong-type mass as penalties in pair-equivalents. §14's Strong-list rule and its recall floor are **reported, not priced** — read them in the METRICS table below.`
    );
    lines.push("");
    lines.push(`**Read the Δ column before the objective.** A gain that is mostly a penalty falling is not agreement bought; it is a constraint being relaxed.`);
    lines.push("");
    lines.push(objectiveTable(r.search));
    lines.push("", "### Trace", "");
    lines.push(traceTable(r.search));
  }

  lines.push("", "## METRICS before and after", "");
  lines.push(`Both columns are computed by \`goldset/metrics.ts\` — the same code \`npm run fit:metrics\` writes \`docs/fit-engine/METRICS.md\` with — over the same pairs, the "after" column with the proposed values injected through the recalibration override (production is untouched).`);
  lines.push("");
  lines.push(metricsComparison(r.metrics.before, r.metrics.after));
  lines.push("");
  lines.push(legacyRow(r.metrics.before));

  lines.push("", "## Labels per stratum", "");
  lines.push(strataTable(r.labels_by_stratum));

  lines.push("", "## The patch", "");
  if (!r.patch) lines.push("_Nothing to patch._");
  else {
    lines.push(
      `\`${r.patch.path}\` — a TEXTUAL substitution over \`${r.patch.taxonomy_path}\`: only the numbers named above change, every comment and every other character is byte-identical, and the line count is unchanged. Verified: the patched file parses, ${r.patch.verification.paths} path(s) hold the proposed values, and the diff applied back to the original reproduces it exactly.`
    );
    lines.push("");
    lines.push("```diff");
    lines.push(r.patch.diff.replace(/\n$/, ""));
    lines.push("```");
    lines.push("");
    lines.push(`Apply by hand after review — \`git apply ${r.patch.path}\` — then re-run \`npm test\` (the adversarial fixtures are the regression suite for exactly this change) and \`npm run fit:metrics\`, and record the decision in \`docs/fit-engine/DECISIONS.md\`. Nothing applies it automatically: a change to the matrices or the floors is a spec change (CLAUDE.md: "when it proposes changing a fixture or a threshold, that is a spec change").`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Pure. The short version the script prints to stdout. */
export function renderConsole(r: RecalibrationInput): string {
  const lines: string[] = [];
  lines.push(`# fit:recalibrate — ${r.generated_at}${r.fixture_run ? " — FIXTURE RUN (constructed labels, not a calibration)" : ""}`);
  lines.push(r.decision.message);
  const b = distributionRow(r.metrics.before);
  lines.push(`before: strong ${b.strong} / moderate ${b.moderate} / exploratory ${b.exploratory} / poor ${b.poor} / unscored ${b.unscored}`);
  if (r.metrics.after) {
    const a = distributionRow(r.metrics.after);
    lines.push(`after:  strong ${a.strong} / moderate ${a.moderate} / exploratory ${a.exploratory} / poor ${a.poor} / unscored ${a.unscored}`);
  }
  if (r.search && r.values) {
    const ds = parameterDeltas(r.parameters, r.values);
    lines.push(`objective ${r.search.before.objective.toFixed(2)} → ${r.search.after.objective.toFixed(2)} in ${r.search.evaluations} evaluations, ${r.search.cycles} cycle(s)${r.search.capped ? " (evaluation cap)" : r.search.converged ? " (converged)" : " (cycle cap)"}`);
    lines.push(`moved ${ds.length} of ${r.parameters.length} parameters: ${ds.length ? ds.map((d) => `${d.parameter.id} ${num2(d.from)}→${num2(d.to)}`).join(", ") : "none"}`);
    const strong = r.search.after.agreement.strong;
    const moderate = r.search.after.agreement.moderate;
    const b = r.search.before;
    const a = r.search.after;
    lines.push(`agreement after — Strong ${strong.agree}/${strong.labeled} (${pct(strong.rate)}, ${strong.rule}), Moderate ${moderate.agree}/${moderate.labeled} (${pct(moderate.rate)}, ${moderate.rule}); Strong-list over the set ${a.strong_list.fit_v1}/${a.strong_list.legacy} (reported, not priced); forbidden mass ${a.forbidden_mass} (baseline ${a.forbidden_baseline}); wrong-type mass ${a.wrong_type_mass} (baseline ${a.wrong_type_baseline})`);
    lines.push(
      `objective decomposition — net ${signed(a.net - b.net)} (${b.net} → ${a.net}), targets ${signed(b.penalties.targets - a.penalties.targets)}, forbidden ${signed(b.penalties.forbidden - a.penalties.forbidden)}, wrong-type ${signed(b.penalties.wrong_type - a.penalties.wrong_type)}`
    );
  }
  const failures = r.adversarial.filter((c) => (r.search ? c.after : c.before) !== c.expected);
  lines.push(`§13 adversarial cases: ${r.adversarial.length - failures.length} / ${r.adversarial.length} pass${failures.length ? ` — FAILS: ${failures.map((c) => c.id).join(", ")}` : ""}`);
  if (r.patch) lines.push(`wrote ${r.patch.path} (${r.patch.verification.paths} verified path(s)) — never applied automatically`);
  return lines.join("\n");
}

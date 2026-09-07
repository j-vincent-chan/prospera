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
import { OBJECTIVE_WEIGHTS } from "@/lib/fit/recalibrate/search";
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

export const RECALIBRATION_DIR = "docs/fit-engine/recalibration";

export const proposalPath = (date: string, dir = RECALIBRATION_DIR): string => `${dir}/${date}-proposal.md`;
export const patchPath = (date: string, dir = RECALIBRATION_DIR): string => `${dir}/${date}-taxonomy.patch`;

export type StratumLabels = { stratum: string; label: string; pairs: number; labeled: number; tiers: Record<string, number> };

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
  rows.push(beforeAfter(before, after, `Strong-list ratio over the set (rule ≥ ${TARGETS.strong_list_ratio_min})`, (r) => `${r.strong_ratio.fit_v1_strong} / ${r.strong_ratio.legacy_strong} = ${r.strong_ratio.ratio === null ? "—" : r.strong_ratio.ratio.toFixed(2)}`));
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
  const row = (label: string, read: (o: typeof b) => string) => [label, read(b), read(a)];
  return table(
    ["objective term", "before", "after"],
    [
      row("Objective", (o) => o.objective.toFixed(2)),
      row("net = agreeing − disagreeing recommendations", (o) => String(o.net)),
      row("Strong · agree / labeled (pairs shown)", (o) => `${o.agreement.strong.agree} / ${o.agreement.strong.labeled} (${o.agreement.strong.shown})`),
      row("Moderate · agree / labeled (pairs shown)", (o) => `${o.agreement.moderate.agree} / ${o.agreement.moderate.labeled} (${o.agreement.moderate.shown})`),
      row(`Penalty · tier-precision targets (×${OBJECTIVE_WEIGHTS.target_shortfall})`, (o) => o.penalties.targets.toFixed(2)),
      row(`Penalty · Strong-list ratio (×${OBJECTIVE_WEIGHTS.strong_list_shortfall})`, (o) => o.penalties.strong_list.toFixed(2)),
      row(`Penalty · forbidden-cell mass change (×${OBJECTIVE_WEIGHTS.forbidden_mass_change})`, (o) => o.penalties.forbidden.toFixed(2)),
      row("Strong list · fit-v1 / legacy (ratio)", (o) => (o.strong_list.applicable ? `${o.strong_list.fit_v1} / ${o.strong_list.legacy} (${o.strong_list.ratio!.toFixed(2)})` : `${o.strong_list.fit_v1} / — (legacy has no Strong pair in scope)`)),
      row("Forbidden-cell mass shown", (o) => String(o.forbidden_mass)),
    ]
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

  if (r.search) {
    lines.push("", "## Objective", "");
    lines.push(
      `Coordinate descent, one parameter at a time, cycling until a whole cycle improves nothing. ${r.search.evaluations} evaluations over ${r.search.cycles} cycle(s); ${r.search.capped ? "**stopped at the evaluation cap**" : r.search.converged ? "converged" : "stopped at the cycle cap"}. The objective counts pairs — agreeing minus disagreeing recommendations — with §14's targets, the 30 % Strong-list rule and the forbidden-cell mass as penalties in pair-equivalents.`
    );
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
    lines.push(`agreement after — Strong ${strong.agree}/${strong.labeled} (${pct(strong.rate)}), Moderate ${moderate.agree}/${moderate.labeled} (${pct(moderate.rate)}); Strong-list ${r.search.after.strong_list.fit_v1}/${r.search.after.strong_list.legacy}; forbidden mass ${r.search.after.forbidden_mass} (baseline ${r.search.after.forbidden_baseline})`);
  }
  if (r.patch) lines.push(`wrote ${r.patch.path} (${r.patch.verification.paths} verified path(s)) — never applied automatically`);
  return lines.join("\n");
}

/**
 * Aggregations behind scripts/fit-rules-report.ts (plan § PR 1.2): what the
 * rule classifier does over the roster's evidence — per-rule fire counts,
 * per-axis coverage by item kind, the categories the rules reach most, the
 * refine keys that applied, and the study-section / division keys the tables
 * do not know. Pure and unit-tested; the script only reads rows and prints.
 */
import type { NormalizedItem, NormalizedItemKind } from "@/lib/fit/classify/normalize";
import { AXES, RULE_IDS, type Axis, type RuleClassification, type SignalMapping, type TableMiss } from "@/lib/fit/classify/rules";
import signalMapping from "@/lib/fit/signal-mapping.json";

export type RuleRun = { item: NormalizedItem; result: RuleClassification };

/** A row that could not be normalized or evaluated — an unknown MeSH UI, a bad table entry. Listed, never swallowed. */
export type RuleRunFailure = { id: string; kind: NormalizedItemKind; error: string };

export type KindCount = { total: number; fired: number };

export type RuleCount = { id: string; source: string; count: number; byKind: Partial<Record<NormalizedItemKind, number>> };

export type CategoryStat = {
  id: string;
  /** Items where the category is at (or tied at) the top of its axis. */
  dominant: number;
  /** Items where the rules assigned it at all. */
  assigned: number;
  /** Mean probability over the items where it was assigned. */
  meanP: number;
};

export type UnknownKey = { table: TableMiss["table"]; key: string; count: number; examples: string[] };

export type RulesReportSummary = {
  items: Partial<Record<NormalizedItemKind, KindCount>>;
  /** Every rule in mapping order, zeros included — a rule that never fires is the finding. */
  rules: RuleCount[];
  /** Per axis, per kind: items where the axis is in `firedAxes`. */
  axes: Record<Axis, Partial<Record<NormalizedItemKind, KindCount>>>;
  /** Per axis, sorted by dominant count, then assigned. */
  categories: Record<Axis, CategoryStat[]>;
  refines: Array<{ key: string; count: number }>;
  unknownTableKeys: UnknownKey[];
  failures: RuleRunFailure[];
};

const KIND_ORDER: NormalizedItemKind[] = ["publication", "grant", "trial", "biosketch_statement", "biosketch_contribution", "profiles_narrative", "self_declared", "directory"];

function bump<K extends string>(map: Partial<Record<K, KindCount>>, key: K, fired: boolean): void {
  const c = (map[key] ??= { total: 0, fired: 0 });
  c.total += 1;
  if (fired) c.fired += 1;
}

/** The panel / division label an unknown key came with, for seeding the table by hand. */
function exampleLabel(item: NormalizedItem, table: TableMiss["table"]): string | null {
  const s = item.signals;
  if (table === "study_sections") {
    const name = typeof s.study_section === "string" ? s.study_section : null;
    const code = typeof s.study_section_code === "string" ? s.study_section_code : null;
    return name ? `${name}${code ? ` [${code}]` : ""}` : code;
  }
  return typeof s.program_division === "string" ? s.program_division : null;
}

export function summarizeRuleRuns(runs: RuleRun[], failures: RuleRunFailure[] = [], mapping: SignalMapping = signalMapping as unknown as SignalMapping): RulesReportSummary {
  const items: RulesReportSummary["items"] = {};
  const ruleCounts = new Map<string, RuleCount>(mapping.rules.map((r) => [r.id, { id: r.id, source: r.source, count: 0, byKind: {} }]));
  const axes = Object.fromEntries(AXES.map((a) => [a, {}])) as RulesReportSummary["axes"];
  const cats = Object.fromEntries(AXES.map((a) => [a, new Map<string, { dominant: number; assigned: number; sum: number }>()])) as Record<
    Axis,
    Map<string, { dominant: number; assigned: number; sum: number }>
  >;
  const refines = new Map<string, number>();
  const unknown = new Map<string, UnknownKey>();

  for (const { item, result } of runs) {
    bump(items, item.kind, result.fired.length > 0);
    for (const f of result.fired) {
      const rc = ruleCounts.get(f.ruleId);
      if (!rc) throw new Error(`fired rule ${f.ruleId} is not in the mapping`);
      rc.count += 1;
      rc.byKind[item.kind] = (rc.byKind[item.kind] ?? 0) + 1;
    }
    for (const axis of AXES) {
      bump(axes[axis], item.kind, result.firedAxes.includes(axis));
      const values = result.axes[axis];
      if (!values) continue;
      const max = Math.max(...Object.values(values));
      for (const [id, p] of Object.entries(values)) {
        const c = cats[axis].get(id) ?? { dominant: 0, assigned: 0, sum: 0 };
        c.assigned += 1;
        c.sum += p;
        if (p >= max - 1e-9) c.dominant += 1;
        cats[axis].set(id, c);
      }
    }
    for (const key of result.refinedBy) refines.set(key, (refines.get(key) ?? 0) + 1);
    for (const miss of result.unknownTableKeys ?? []) {
      const k = `${miss.table}|${miss.key}`;
      const u = unknown.get(k) ?? { table: miss.table, key: miss.key, count: 0, examples: [] };
      u.count += 1;
      const label = exampleLabel(item, miss.table);
      if (label && !u.examples.includes(label) && u.examples.length < 3) u.examples.push(label);
      unknown.set(k, u);
    }
  }

  const categories = Object.fromEntries(
    AXES.map((axis) => [
      axis,
      [...cats[axis].entries()]
        .map(([id, c]) => ({ id, dominant: c.dominant, assigned: c.assigned, meanP: c.assigned ? c.sum / c.assigned : 0 }))
        .sort((a, b) => b.dominant - a.dominant || b.assigned - a.assigned || a.id.localeCompare(b.id)),
    ])
  ) as RulesReportSummary["categories"];

  return {
    items,
    rules: RULE_IDS.map((id) => ruleCounts.get(id)!).filter(Boolean),
    axes,
    categories,
    refines: [...refines.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    unknownTableKeys: [...unknown.values()].sort((a, b) => a.table.localeCompare(b.table) || b.count - a.count || a.key.localeCompare(b.key)),
    failures,
  };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

export function formatRulesReport(s: RulesReportSummary, opts: { topCategories?: number } = {}): string {
  const top = opts.topCategories ?? 8;
  const out: string[] = [];
  const kinds = KIND_ORDER.filter((k) => s.items[k]);

  out.push("## Items");
  out.push("| kind | items | ≥ 1 rule fired | share |", "|---|---:|---:|---:|");
  for (const k of kinds) {
    const c = s.items[k]!;
    out.push(`| ${k} | ${c.total} | ${c.fired} | ${pct(c.fired, c.total)} |`);
  }
  const total = kinds.reduce((n, k) => n + s.items[k]!.total, 0);
  const fired = kinds.reduce((n, k) => n + s.items[k]!.fired, 0);
  out.push(`| **all** | ${total} | ${fired} | ${pct(fired, total)} |`);

  out.push("", "## Per-axis coverage (items with the axis decided by rules)");
  out.push(`| axis | ${kinds.join(" | ")} |`, `|---|${kinds.map(() => "---:").join("|")}|`);
  for (const axis of AXES) {
    out.push(`| ${axis} | ${kinds.map((k) => {
      const c = s.axes[axis][k];
      return c ? `${c.fired} (${pct(c.fired, c.total)})` : "—";
    }).join(" | ")} |`);
  }

  out.push("", "## Rules (mapping order; zero means the rule never fired on this corpus)");
  out.push("| rule | source | fired | by kind |", "|---|---|---:|---|");
  for (const r of s.rules) {
    const byKind = Object.entries(r.byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    out.push(`| ${r.id} | ${r.source} | ${r.count} | ${byKind} |`);
  }
  const dark = s.rules.filter((r) => r.count === 0).map((r) => r.id);
  out.push("", `Rules that never fired: ${dark.length} of ${s.rules.length}${dark.length ? ` — ${dark.join(", ")}` : ""}`);

  out.push("", `## Top categories per axis (dominant = at the top of the axis on that item; top ${top})`);
  for (const axis of AXES) {
    const list = s.categories[axis].slice(0, top);
    out.push("", `### ${axis}`);
    if (!list.length) {
      out.push("(nothing assigned)");
      continue;
    }
    out.push("| category | dominant | assigned | mean p |", "|---|---:|---:|---:|");
    for (const c of list) out.push(`| ${c.id} | ${c.dominant} | ${c.assigned} | ${c.meanP.toFixed(2)} |`);
  }

  out.push("", "## Refine keys applied");
  if (!s.refines.length) out.push("(none)");
  for (const r of s.refines) out.push(`- ${r.key}: ${r.count}`);

  out.push("", "## Unknown table keys (assign nothing; seed the table or leave deliberately absent)");
  if (!s.unknownTableKeys.length) out.push("(none)");
  for (const u of s.unknownTableKeys) out.push(`- ${u.table} · ${u.key}: ${u.count}${u.examples.length ? ` — ${u.examples.join(" · ")}` : ""}`);

  out.push("", "## Rows that failed to normalize or evaluate");
  if (!s.failures.length) out.push("(none)");
  for (const f of s.failures) out.push(`- ${f.id} (${f.kind}): ${f.error}`);

  return out.join("\n");
}

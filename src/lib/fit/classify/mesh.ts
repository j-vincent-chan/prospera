/**
 * MeSH descriptor resolution for the rule classifier (PR 0.2).
 *
 * Pure: an index is built from `mesh_descriptors` rows (or a fixture subset)
 * and every lookup runs against it. Names in `signal-mapping.json` are
 * resolved here and MUST fail loudly when one does not exist in the vocabulary
 * — a typo or a retired descriptor would otherwise mean the rule silently
 * never fires and the item degrades to the LLM with no signal that it did.
 */
import signalMapping from "@/lib/fit/signal-mapping.json";

export type MeshDescriptorRow = {
  ui: string;
  name: string;
  tree_numbers: string[];
  is_check_tag: boolean;
};

export type MeshIndex = {
  byUi: Map<string, MeshDescriptorRow>;
  byName: Map<string, MeshDescriptorRow>;
  /** Lower-cased name → canonical name, for "did you mean" hints only. */
  byFoldedName: Map<string, string>;
  /** Every tree number in the index, for prefix-existence checks. */
  treeNumbers: string[];
};

export class MeshUnknownDescriptorError extends Error {
  constructor(
    public readonly value: string,
    public readonly suggestion: string | null
  ) {
    super(
      `Unknown MeSH descriptor: ${JSON.stringify(value)}` +
        (suggestion ? ` (did you mean ${JSON.stringify(suggestion)}?)` : "") +
        ". Names in signal-mapping.json must match the NLM descriptor file exactly."
    );
    this.name = "MeshUnknownDescriptorError";
  }
}

export function buildMeshIndex(rows: MeshDescriptorRow[]): MeshIndex {
  const byUi = new Map<string, MeshDescriptorRow>();
  const byName = new Map<string, MeshDescriptorRow>();
  const byFoldedName = new Map<string, string>();
  const treeNumbers: string[] = [];
  for (const row of rows) {
    byUi.set(row.ui, row);
    byName.set(row.name, row);
    byFoldedName.set(row.name.toLowerCase(), row.name);
    treeNumbers.push(...row.tree_numbers);
  }
  return { byUi, byName, byFoldedName, treeNumbers };
}

const UI_PATTERN = /^D\d{6,9}$/;

/** Exact descriptor name or UI → row. Throws `MeshUnknownDescriptorError` otherwise. */
export function resolveDescriptor(index: MeshIndex, nameOrUi: string): MeshDescriptorRow {
  const key = nameOrUi.trim();
  const row = UI_PATTERN.test(key) ? index.byUi.get(key) : index.byName.get(key);
  if (row) return row;
  throw new MeshUnknownDescriptorError(nameOrUi, index.byFoldedName.get(key.toLowerCase()) ?? null);
}

export function tryResolveDescriptor(index: MeshIndex, nameOrUi: string): MeshDescriptorRow | null {
  try {
    return resolveDescriptor(index, nameOrUi);
  } catch (e) {
    if (e instanceof MeshUnknownDescriptorError) return null;
    throw e;
  }
}

export function treeNumbers(index: MeshIndex, ui: string): string[] {
  return resolveDescriptor(index, ui).tree_numbers;
}

/**
 * `B01.050` is under `B01` and under `B01.050`, not under `B01.05` or `B010`.
 * A bare category letter (`V`, `B`) matches every tree in that category —
 * tree numbers are `V03.175…`, the letter is not a dotted segment.
 */
export function treeNumberIsUnder(treeNumber: string, prefix: string): boolean {
  if (/^[A-Z]$/.test(prefix)) return treeNumber.startsWith(prefix);
  return treeNumber === prefix || treeNumber.startsWith(`${prefix}.`);
}

export function isUnder(index: MeshIndex, ui: string, prefix: string): boolean {
  return treeNumbers(index, ui).some((t) => treeNumberIsUnder(t, prefix));
}

/** True when at least one descriptor in the index sits at or under `prefix`. */
export function treePrefixExists(index: MeshIndex, prefix: string): boolean {
  return index.treeNumbers.some((t) => treeNumberIsUnder(t, prefix));
}

// ---------------------------------------------------------------------------
// Triangle of biomedicine (Weber 2013)
// ---------------------------------------------------------------------------

/**
 * D12: a single descriptor is matched by UI (stable across releases); a prefix
 * is used only where a whole subtree is meant. Tree numbers are positional and
 * NLM renumbers them between annual releases, so every prefix here is a dated
 * assertion that `validateSignalMapping` re-checks on each descriptor reload.
 */
export type TriangleConfig = {
  /** Descriptor UIs that mean "human study" on their own — Humans, D006801. */
  human_uis: string[];
  /** Subtrees that mean human — M01 persons. */
  human_trees: string[];
  animal_trees_except_human: string[];
  cell_molecular_trees: string[];
};

export const TRIANGLE_CLASSES = ["A", "C", "H", "AC", "AH", "CH", "ACH"] as const;
export type TriangleClass = (typeof TRIANGLE_CLASSES)[number];

function triangleConfigFromMapping(): TriangleConfig {
  const t = signalMapping.triangle_of_biomedicine;
  return {
    human_uis: t.human_uis,
    human_trees: t.human_trees,
    animal_trees_except_human: t.animal_trees_except_human,
    cell_molecular_trees: t.cell_molecular_trees,
  };
}

/**
 * A / C / H vertices a paper's descriptors touch, concatenated in that order
 * (`AH` = animal + human, the translational bridge). Null when none apply.
 * Unknown UIs throw — every UI here comes from a MeshHeadingList, so an
 * unknown one means the descriptor table is stale.
 */
export function triangleClass(
  index: MeshIndex,
  uis: string[],
  config: TriangleConfig = triangleConfigFromMapping()
): TriangleClass | null {
  let animal = false;
  let cell = false;
  let human = false;
  for (const ui of uis) {
    const trees = treeNumbers(index, ui);
    const uiIsHuman = config.human_uis.includes(ui);
    if (uiIsHuman) human = true;
    for (const tree of trees) {
      const isHuman = uiIsHuman || config.human_trees.some((p) => treeNumberIsUnder(tree, p));
      if (isHuman) human = true;
      else if (config.animal_trees_except_human.some((p) => treeNumberIsUnder(tree, p))) animal = true;
      if (config.cell_molecular_trees.some((p) => treeNumberIsUnder(tree, p))) cell = true;
    }
  }
  const cls = `${animal ? "A" : ""}${cell ? "C" : ""}${human ? "H" : ""}`;
  return cls ? (cls as TriangleClass) : null;
}

// ---------------------------------------------------------------------------
// signal-mapping.json validation
// ---------------------------------------------------------------------------

export type SignalMappingProblem = {
  /** Which clause the value came from. */
  kind: "mesh" | "check_tag" | "pubtype" | "mesh_tree" | "triangle_tree" | "triangle_ui" | "triangle_class";
  value: string;
  /** Rule ids that would go dark, or `triangle_of_biomedicine.<key>`. */
  rules: string[];
  message: string;
  suggestion?: string;
};

export type SignalMappingValidation = {
  ok: boolean;
  /** Values that do not resolve. Any entry here fails the check. */
  unmatched: SignalMappingProblem[];
  /** Values that resolve but not to what the clause type implies. */
  warnings: SignalMappingProblem[];
  counts: { mesh: number; check_tag: number; pubtype: number; mesh_tree: number; triangle_tree: number; triangle_ui: number };
};

type RuleLike = { id: string; when?: Record<string, unknown>; not?: Record<string, unknown> };
type MappingLike = {
  rules: RuleLike[];
  triangle_of_biomedicine: Record<string, unknown>;
};

const MESH_KEYS = new Set(["mesh", "mesh_any", "mesh_all", "mesh_any_2", "mesh_major", "mesh_major_any"]);

function stringValues(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/** Every (clause key, value, rule id) triple in `when`, `not`, and the `not` nested inside `when`. */
function* clauseValues(rule: RuleLike): Generator<{ key: string; value: string }> {
  const sources: Array<Record<string, unknown> | undefined> = [rule.when, rule.not];
  const nested = rule.when?.not;
  if (nested && typeof nested === "object") sources.push(nested as Record<string, unknown>);
  for (const src of sources) {
    if (!src) continue;
    for (const [key, raw] of Object.entries(src)) {
      if (key === "not") continue;
      for (const value of stringValues(raw)) yield { key, value };
    }
  }
}

/**
 * Check every MeSH-derived value in the mapping against the index: descriptor
 * names (`mesh*`, `check_tag*`, `pubtype*`), tree prefixes (`mesh_tree_under*`
 * and `triangle_of_biomedicine`), and triangle class names. Pure; the loader
 * script runs it after loading the table and a unit test runs it against the
 * fixture subset.
 */
export function validateSignalMapping(
  index: MeshIndex,
  mapping: MappingLike = signalMapping as unknown as MappingLike
): SignalMappingValidation {
  const unmatched: SignalMappingProblem[] = [];
  const warnings: SignalMappingProblem[] = [];
  const seen = new Map<string, SignalMappingProblem>();
  const counts = { mesh: 0, check_tag: 0, pubtype: 0, mesh_tree: 0, triangle_tree: 0, triangle_ui: 0 };
  const counted = new Set<string>();

  const record = (list: SignalMappingProblem[], p: Omit<SignalMappingProblem, "rules"> & { rule: string }) => {
    const id = `${list === unmatched ? "U" : "W"}:${p.kind}:${p.value}`;
    const existing = seen.get(id);
    if (existing) {
      if (!existing.rules.includes(p.rule)) existing.rules.push(p.rule);
      return;
    }
    const entry: SignalMappingProblem = { kind: p.kind, value: p.value, rules: [p.rule], message: p.message };
    if (p.suggestion) entry.suggestion = p.suggestion;
    seen.set(id, entry);
    list.push(entry);
  };

  const suggestionFor = (value: string) => index.byFoldedName.get(value.trim().toLowerCase()) ?? undefined;

  for (const rule of mapping.rules) {
    for (const { key, value } of clauseValues(rule)) {
      if (MESH_KEYS.has(key) || key.startsWith("check_tag") || key.startsWith("pubtype")) {
        const kind: SignalMappingProblem["kind"] = MESH_KEYS.has(key) ? "mesh" : key.startsWith("check_tag") ? "check_tag" : "pubtype";
        const countKey = `${kind}:${value}`;
        if (!counted.has(countKey)) {
          counted.add(countKey);
          counts[kind] += 1;
        }
        const row = tryResolveDescriptor(index, value);
        if (!row) {
          record(unmatched, { kind, value, rule: rule.id, message: "not a MeSH descriptor name", suggestion: suggestionFor(value) });
          continue;
        }
        if (kind === "check_tag" && !row.is_check_tag) {
          record(warnings, {
            kind,
            value,
            rule: rule.id,
            message: `resolves to ${row.ui} but is not a MeSH check tag; a check_tag clause must match it by name in MeshHeadingList`,
          });
        }
        if (kind === "pubtype" && !row.tree_numbers.some((t) => treeNumberIsUnder(t, "V"))) {
          record(warnings, { kind, value, rule: rule.id, message: `resolves to ${row.ui} but is not a publication type (tree V)` });
        }
      } else if (key.startsWith("mesh_tree")) {
        if (!counted.has(`mesh_tree:${value}`)) {
          counted.add(`mesh_tree:${value}`);
          counts.mesh_tree += 1;
        }
        if (!treePrefixExists(index, value)) {
          record(unmatched, { kind: "mesh_tree", value, rule: rule.id, message: "no descriptor has a tree number under this prefix" });
        }
      } else if (key.startsWith("triangle_class")) {
        if (!(TRIANGLE_CLASSES as readonly string[]).includes(value)) {
          record(unmatched, { kind: "triangle_class", value, rule: rule.id, message: `not one of ${TRIANGLE_CLASSES.join(", ")}` });
        }
      }
    }
  }

  for (const [key, raw] of Object.entries(mapping.triangle_of_biomedicine)) {
    if (key.startsWith("_")) continue;
    if (key.endsWith("_uis")) {
      for (const ui of stringValues(raw)) {
        counts.triangle_ui += 1;
        if (!index.byUi.has(ui)) {
          record(unmatched, { kind: "triangle_ui", value: ui, rule: `triangle_of_biomedicine.${key}`, message: "not a descriptor UI in the vocabulary" });
        }
      }
      continue;
    }
    for (const prefix of stringValues(raw)) {
      counts.triangle_tree += 1;
      if (!treePrefixExists(index, prefix)) {
        record(unmatched, {
          kind: "triangle_tree",
          value: prefix,
          rule: `triangle_of_biomedicine.${key}`,
          message: "no descriptor has a tree number under this prefix (renumbered or retired)",
        });
      }
    }
  }

  return { ok: unmatched.length === 0, unmatched, warnings, counts };
}

/** Human-readable report for the loader's exit message and the PR body. */
export function formatSignalMappingValidation(v: SignalMappingValidation): string {
  const lines: string[] = [];
  const c = v.counts;
  lines.push(
    `signal-mapping.json: ${c.mesh} MeSH names, ${c.check_tag} check tags, ${c.pubtype} publication types, ${c.mesh_tree} mesh_tree prefixes, ${c.triangle_ui} triangle UIs, ${c.triangle_tree} triangle prefixes`
  );
  if (v.unmatched.length) {
    lines.push(`UNMATCHED (${v.unmatched.length}) — these rules never fire:`);
    for (const p of v.unmatched) {
      lines.push(`  ✗ [${p.kind}] ${JSON.stringify(p.value)} — ${p.message}${p.suggestion ? ` (did you mean ${JSON.stringify(p.suggestion)}?)` : ""}; rules: ${p.rules.join(", ")}`);
    }
  } else {
    lines.push("all names and prefixes resolve");
  }
  for (const p of v.warnings) {
    lines.push(`  ⚠ [${p.kind}] ${JSON.stringify(p.value)} — ${p.message}; rules: ${p.rules.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Corpus distribution for INVENTORY.md § 11 (fit 0.2c). Pure aggregations over
 * investigator_publications rows after the PR 0.2 MeSH backfill: the share of
 * rows with any MeSH, the triangle-of-biomedicine class per row and per
 * investigator, the most common descriptors, the check-tag and
 * publication-type mix, author position. Rows in, numbers out — the script
 * pages the table and prints. This is the first empirical look at whether the
 * ImmunoX evidence base is shaped the way taxonomy.json assumes, and the input
 * to PR 1.2's rule calibration.
 */
import type { MeshFetchState } from "@/lib/community/pubmed-mesh-backfill";
import { PUBMED_AUTHOR_POSITION_METHODS, PUBMED_AUTHOR_POSITIONS, type PubmedMeshHeading } from "@/lib/community/pubmed-record";
import { treeNumberIsUnder, triangleClass, TRIANGLE_CLASSES, type MeshIndex, type TriangleClass } from "@/lib/fit/classify/mesh";
import signalMapping from "@/lib/fit/signal-mapping.json";

/** The columns --report pages from investigator_publications. Never the abstract. */
export type CorpusRow = {
  pmid: string;
  investigator_id: string;
  identity_status: string;
  mesh: PubmedMeshHeading[];
  publication_types: string[];
  mesh_fetch_outcome: MeshFetchState;
  author_position: string | null;
  author_position_method: string | null;
};

export const isVerified = (r: CorpusRow): boolean => r.identity_status === "verified";
export const hasMesh = (r: CorpusRow): boolean => r.mesh.length > 0;
/** The backfill has looked at the row: any outcome but `pending`. */
export const isStamped = (r: CorpusRow): boolean => r.mesh_fetch_outcome !== "pending";

export function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `a` before `b`: larger count first, then name, then id — so a tie is deterministic. */
function byCountThenName(a: { rows: number; name: string; id?: string }, b: { rows: number; name: string; id?: string }): number {
  if (a.rows !== b.rows) return b.rows - a.rows;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return (a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// signal-mapping.json values the rules key on
// ---------------------------------------------------------------------------

type RuleLike = { id: string; when?: Record<string, unknown>; not?: Record<string, unknown> };
type MappingLike = { rules: RuleLike[] };

/** Distinct string values of every clause whose key starts with `prefix`, across `when`, `not`, and `when.not`; sorted. */
export function mappingClauseValues(prefix: string, mapping: MappingLike = signalMapping as unknown as MappingLike): string[] {
  const out = new Set<string>();
  const visit = (src: Record<string, unknown> | undefined) => {
    if (!src) return;
    for (const [key, raw] of Object.entries(src)) {
      if (key === "not" && raw && typeof raw === "object") {
        visit(raw as Record<string, unknown>);
        continue;
      }
      if (!key.startsWith(prefix)) continue;
      for (const v of Array.isArray(raw) ? raw : [raw]) if (typeof v === "string") out.add(v);
    }
  };
  for (const rule of mapping.rules) {
    visit(rule.when);
    visit(rule.not);
  }
  return Array.from(out).sort();
}

/** The publication types PR 1.2's human study-design rules key on (`pubtype*` clauses). */
export function humanStudyDesignPubTypes(mapping?: MappingLike): string[] {
  return mappingClauseValues("pubtype", mapping);
}

/** The descriptor names the rules match as check tags (`check_tag*` clauses) — includes B01 species that are not NLM check tags. */
export function ruleCheckTagNames(mapping?: MappingLike): string[] {
  return mappingClauseValues("check_tag", mapping);
}

// ---------------------------------------------------------------------------
// 1. Share of rows with any MeSH
// ---------------------------------------------------------------------------

export type MeshCoverage = { rows: number; stamped: number; withMesh: number };

export function meshCoverage(rows: CorpusRow[]): MeshCoverage {
  let stamped = 0;
  let withMesh = 0;
  for (const r of rows) {
    if (isStamped(r)) stamped += 1;
    if (hasMesh(r)) withMesh += 1;
  }
  return { rows: rows.length, stamped, withMesh };
}

// ---------------------------------------------------------------------------
// 2. Triangle of biomedicine, per row and per investigator
// ---------------------------------------------------------------------------

export type TriangleBucket = TriangleClass | "none";
export const TRIANGLE_BUCKETS: readonly TriangleBucket[] = [...TRIANGLE_CLASSES, "none"];

function emptyBuckets(): Record<TriangleBucket, number> {
  const out = {} as Record<TriangleBucket, number>;
  for (const b of TRIANGLE_BUCKETS) out[b] = 0;
  return out;
}

export const isHTouching = (b: TriangleBucket): boolean => b !== "none" && b.includes("H");

export type RowTriangle = {
  cls: TriangleBucket;
  unknownUis: string[];
  /** A known UI sits under a `triangle_of_biomedicine.human_trees` prefix (M01 persons: Adult, Child, …) — a human-participant signal the bare Humans tag is not, since PubMed also stamps Humans on human cell-line work. */
  persons: boolean;
};

const HUMAN_TREES: readonly string[] = signalMapping.triangle_of_biomedicine.human_trees;

/**
 * `triangleClass` over the UIs the index knows. A UI the descriptor table does
 * not have (retired or renumbered since the load) is returned, not thrown —
 * the report must finish and print how many it skipped.
 */
export function rowTriangleClass(index: MeshIndex, uis: string[]): RowTriangle {
  const known: string[] = [];
  const unknownUis: string[] = [];
  for (const ui of uis) (index.byUi.has(ui) ? known : unknownUis).push(ui);
  const persons = known.some((ui) => index.byUi.get(ui)!.tree_numbers.some((t) => HUMAN_TREES.some((p) => treeNumberIsUnder(t, p))));
  return { cls: triangleClass(index, known) ?? "none", unknownUis, persons };
}

export type TriangleTally = {
  rows: number;
  counts: Record<TriangleBucket, number>;
  hTouching: number;
  /** H-touching rows with an M01 persons descriptor. The rest touch H only through the Humans tag. */
  hViaPersons: number;
  unknownUiOccurrences: number;
  /** Distinct unknown UIs, sorted. */
  unknownUis: string[];
};

export function tallyTriangle(index: MeshIndex, rows: CorpusRow[]): TriangleTally {
  const counts = emptyBuckets();
  const unknown = new Set<string>();
  let unknownUiOccurrences = 0;
  let hTouching = 0;
  let hViaPersons = 0;
  for (const r of rows) {
    const { cls, unknownUis, persons } = rowTriangleClass(
      index,
      r.mesh.map((m) => m.ui)
    );
    counts[cls] += 1;
    if (isHTouching(cls)) {
      hTouching += 1;
      if (persons) hViaPersons += 1;
    }
    unknownUiOccurrences += unknownUis.length;
    for (const ui of unknownUis) unknown.add(ui);
  }
  return { rows: rows.length, counts, hTouching, hViaPersons, unknownUiOccurrences, unknownUis: Array.from(unknown).sort() };
}

export type InvestigatorTriangle = {
  investigator_id: string;
  rows: number;
  counts: Record<TriangleBucket, number>;
  /** Most frequent class; a tie goes to the earlier class in TRIANGLE_BUCKETS order. */
  modal: TriangleBucket;
  hTouchingShare: number;
};

/** One entry per investigator with at least one row, sorted by id. Pass the rows that have MeSH. */
export function investigatorTriangles(index: MeshIndex, rows: CorpusRow[]): InvestigatorTriangle[] {
  const byInv = new Map<string, Record<TriangleBucket, number>>();
  for (const r of rows) {
    const counts = byInv.get(r.investigator_id) ?? emptyBuckets();
    counts[rowTriangleClass(index, r.mesh.map((m) => m.ui)).cls] += 1;
    byInv.set(r.investigator_id, counts);
  }
  return Array.from(byInv.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([investigator_id, counts]) => {
      const n = TRIANGLE_BUCKETS.reduce((s, b) => s + counts[b], 0);
      let modal: TriangleBucket = TRIANGLE_BUCKETS[0];
      for (const b of TRIANGLE_BUCKETS) if (counts[b] > counts[modal]) modal = b;
      const h = TRIANGLE_BUCKETS.filter(isHTouching).reduce((s, b) => s + counts[b], 0);
      return { investigator_id, rows: n, counts, modal, hTouchingShare: n ? h / n : 0 };
    });
}

export type ModalClassSummary = { modal: TriangleBucket; investigators: number; medianRows: number | null; medianHTouchingShare: number | null };
export const H_TOUCHING_BANDS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "< 10%", min: 0, max: 0.1 },
  { label: "10–33%", min: 0.1, max: 1 / 3 },
  { label: "33–67%", min: 1 / 3, max: 2 / 3 },
  { label: "≥ 67%", min: 2 / 3, max: Infinity },
];

export type InvestigatorTriangleSummary = {
  investigators: number;
  byModalClass: ModalClassSummary[];
  medianHTouchingShare: number | null;
  hTouchingBands: Array<{ label: string; investigators: number }>;
};

export function summarizeInvestigatorTriangles(list: InvestigatorTriangle[]): InvestigatorTriangleSummary {
  const byModalClass = TRIANGLE_BUCKETS.map((modal) => {
    const group = list.filter((i) => i.modal === modal);
    return {
      modal,
      investigators: group.length,
      medianRows: median(group.map((i) => i.rows)),
      medianHTouchingShare: median(group.map((i) => i.hTouchingShare)),
    };
  });
  const hTouchingBands = H_TOUCHING_BANDS.map((b) => ({
    label: b.label,
    investigators: list.filter((i) => i.hTouchingShare >= b.min && i.hTouchingShare < b.max).length,
  }));
  return { investigators: list.length, byModalClass, medianHTouchingShare: median(list.map((i) => i.hTouchingShare)), hTouchingBands };
}

// ---------------------------------------------------------------------------
// 3. Most common descriptors
// ---------------------------------------------------------------------------

export type DescriptorCount = { ui: string; name: string; rows: number; share: number };

/** Descriptors by the number of rows carrying them (once per row), largest first, ties by name. */
export function topDescriptors(rows: CorpusRow[], n: number, opts: { majorOnly?: boolean } = {}): DescriptorCount[] {
  const counts = new Map<string, { name: string; rows: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const m of r.mesh) {
      if (opts.majorOnly && !m.major) continue;
      if (seen.has(m.ui)) continue;
      seen.add(m.ui);
      const entry = counts.get(m.ui) ?? { name: m.name, rows: 0 };
      entry.rows += 1;
      counts.set(m.ui, entry);
    }
  }
  return Array.from(counts.entries())
    .map(([ui, { name, rows: c }]) => ({ id: ui, ui, name, rows: c }))
    .sort(byCountThenName)
    .slice(0, n)
    .map(({ ui, name, rows: c }) => ({ ui, name, rows: c, share: rows.length ? c / rows.length : 0 }));
}

// ---------------------------------------------------------------------------
// 4. Check tags
// ---------------------------------------------------------------------------

export const CORE_CHECK_TAGS: readonly string[] = ["Humans", "Animals", "Mice", "Rats", "Female", "Male"];

/** The six core tags first, then any other name the rules match as a check tag. */
export function checkTagNamesToReport(mapping?: MappingLike): string[] {
  const extra = ruleCheckTagNames(mapping).filter((n) => !CORE_CHECK_TAGS.includes(n));
  return [...CORE_CHECK_TAGS, ...extra];
}

export type CheckTagMix = {
  rows: number;
  byName: Array<{ name: string; rows: number }>;
  split: { humansOnly: number; animalsOnly: number; both: number; neither: number };
};

export function checkTagMix(rows: CorpusRow[], names: string[] = checkTagNamesToReport()): CheckTagMix {
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  const split = { humansOnly: 0, animalsOnly: 0, both: 0, neither: 0 };
  for (const r of rows) {
    const present = new Set(r.mesh.map((m) => m.name));
    for (const n of names) if (present.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
    const h = present.has("Humans");
    const a = present.has("Animals");
    if (h && a) split.both += 1;
    else if (h) split.humansOnly += 1;
    else if (a) split.animalsOnly += 1;
    else split.neither += 1;
  }
  return { rows: rows.length, byName: names.map((name) => ({ name, rows: counts.get(name) ?? 0 })), split };
}

// ---------------------------------------------------------------------------
// 5. Publication types
// ---------------------------------------------------------------------------

export type PubTypeCount = { type: string; rows: number; share: number };

/** Every publication type in the rows, by row count, ties by name. */
export function pubTypeMix(rows: CorpusRow[]): PubTypeCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.publication_types)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([type, c]) => ({ name: type, rows: c }))
    .sort(byCountThenName)
    .map(({ name, rows: c }) => ({ type: name, rows: c, share: rows.length ? c / rows.length : 0 }));
}

export type HumanStudyDesignLine = { types: string[]; rows: number; share: number; investigators: number };

/** Rows carrying any of the human study-design types, and how many investigators have at least one. */
export function humanStudyDesignLine(rows: CorpusRow[], types: string[] = humanStudyDesignPubTypes()): HumanStudyDesignLine {
  const wanted = new Set(types);
  const investigators = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (!r.publication_types.some((t) => wanted.has(t))) continue;
    n += 1;
    investigators.add(r.investigator_id);
  }
  return { types, rows: n, share: rows.length ? n / rows.length : 0, investigators: investigators.size };
}

// ---------------------------------------------------------------------------
// 6. Author position × method
// ---------------------------------------------------------------------------

export const NULL_LABEL = "(null)";
export const AUTHOR_POSITION_ORDER: readonly string[] = [...PUBMED_AUTHOR_POSITIONS, NULL_LABEL];
export const AUTHOR_METHOD_ORDER: readonly string[] = [...PUBMED_AUTHOR_POSITION_METHODS, NULL_LABEL];

export type AuthorPositionMix = {
  rows: number;
  /** One line per position, in AUTHOR_POSITION_ORDER, with the count per method. */
  positions: Array<{ position: string; byMethod: Record<string, number>; total: number }>;
  methods: Record<string, number>;
};

/** Over the rows given (the caller passes stamped ones); a null column is counted under `(null)`. */
export function authorPositionMix(rows: CorpusRow[]): AuthorPositionMix {
  const positions = AUTHOR_POSITION_ORDER.map((position) => {
    const byMethod: Record<string, number> = {};
    for (const m of AUTHOR_METHOD_ORDER) byMethod[m] = 0;
    return { position, byMethod, total: 0 };
  });
  const methods: Record<string, number> = {};
  for (const m of AUTHOR_METHOD_ORDER) methods[m] = 0;
  const byPosition = new Map(positions.map((p) => [p.position, p]));
  for (const r of rows) {
    const position = r.author_position ?? NULL_LABEL;
    const method = r.author_position_method ?? NULL_LABEL;
    const line = byPosition.get(position) ?? byPosition.get(NULL_LABEL)!;
    const m = method in line.byMethod ? method : NULL_LABEL;
    line.byMethod[m] += 1;
    line.total += 1;
    methods[m] += 1;
  }
  return { rows: rows.length, positions, methods };
}

// ---------------------------------------------------------------------------
// Bundle and markdown
// ---------------------------------------------------------------------------

export const TOP_DESCRIPTORS = 30;

export type CorpusDistribution = {
  all: MeshCoverage;
  verified: MeshCoverage;
  verifiedInvestigators: number;
  descriptorsInIndex: number;
  triangle: TriangleTally;
  investigatorTriangle: InvestigatorTriangleSummary;
  topDescriptors: DescriptorCount[];
  topMajorDescriptors: DescriptorCount[];
  checkTags: CheckTagMix;
  pubTypes: PubTypeCount[];
  humanStudyDesign: HumanStudyDesignLine;
  authorPosition: AuthorPositionMix;
};

/**
 * Everything § 11 prints, from every row of the table. Corpus figures are over
 * verified rows; triangle, descriptor and check-tag figures over the verified
 * rows that have MeSH; author position over verified rows the backfill stamped.
 */
export function computeCorpusDistribution(index: MeshIndex, rows: CorpusRow[], top: number = TOP_DESCRIPTORS): CorpusDistribution {
  const verified = rows.filter(isVerified);
  const indexed = verified.filter(hasMesh);
  const stamped = verified.filter(isStamped);
  return {
    all: meshCoverage(rows),
    verified: meshCoverage(verified),
    verifiedInvestigators: new Set(verified.map((r) => r.investigator_id)).size,
    descriptorsInIndex: index.byUi.size,
    triangle: tallyTriangle(index, indexed),
    investigatorTriangle: summarizeInvestigatorTriangles(investigatorTriangles(index, indexed)),
    topDescriptors: topDescriptors(indexed, top),
    topMajorDescriptors: topDescriptors(indexed, top, { majorOnly: true }),
    checkTags: checkTagMix(indexed),
    pubTypes: pubTypeMix(verified),
    humanStudyDesign: humanStudyDesignLine(verified),
    authorPosition: authorPositionMix(stamped),
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function formatCorpusDistribution(d: CorpusDistribution): string {
  const v = d.verified;
  const t = d.triangle;
  const it = d.investigatorTriangle;
  const lines: string[] = [];

  lines.push(
    "### 11a. Rows with any MeSH",
    "",
    "| rows | all | stamped (outcome ≠ pending) | with MeSH | with MeSH / all | with MeSH / stamped |",
    "|---|---|---|---|---|---|",
    `| every row | ${d.all.rows} | ${d.all.stamped} | ${d.all.withMesh} | ${pct(d.all.withMesh, d.all.rows)} | ${pct(d.all.withMesh, d.all.stamped)} |`,
    `| verified rows | ${v.rows} | ${v.stamped} | ${v.withMesh} | ${pct(v.withMesh, v.rows)} | ${pct(v.withMesh, v.stamped)} |`,
    "",
    `The corpus figures below are over the ${v.rows} verified rows (${d.verifiedInvestigators} investigators). Triangle, descriptor and check-tag figures are over the ${v.withMesh} verified rows with MeSH; publication types over all verified rows; author position over the ${v.stamped} stamped verified rows. The descriptor index held ${d.descriptorsInIndex} descriptors.`,
    ""
  );

  lines.push(
    "### 11b. Triangle of biomedicine, per row",
    "",
    "`triangleClass` over each row's MeSH UIs (A animal, C cell/molecular, H human; compound classes are translational bridges; none = no vertex touched).",
    "",
    "| class | rows | share |",
    "|---|---|---|",
    ...TRIANGLE_BUCKETS.map((b) => `| ${b} | ${t.counts[b]} | ${pct(t.counts[b], t.rows)} |`),
    `| (rows with MeSH) | ${t.rows} | |`,
    "",
    `H-touching rows (H, AH, CH, ACH): ${t.hTouching} (${pct(t.hTouching, t.rows)}) — of which ${t.hViaPersons} (${pct(t.hViaPersons, t.rows)}) carry an M01 persons descriptor (Adult, Child, …: a human-participant signal) and ${t.hTouching - t.hViaPersons} (${pct(t.hTouching - t.hViaPersons, t.rows)}) touch H only through the Humans tag, which PubMed also puts on human cell-line work. Unknown UIs skipped (not in \`mesh_descriptors\`): ${t.unknownUiOccurrences} occurrence${t.unknownUiOccurrences === 1 ? "" : "s"} over ${t.unknownUis.length} distinct UI${t.unknownUis.length === 1 ? "" : "s"}${t.unknownUis.length ? ` (${t.unknownUis.slice(0, 10).join(", ")}${t.unknownUis.length > 10 ? ", …" : ""})` : ""}.`,
    ""
  );

  lines.push(
    "### 11c. Triangle of biomedicine, per investigator",
    "",
    `Each investigator's modal class over their rows with MeSH (a tie goes to the earlier class in the order above) and the share of those rows that are H-touching. ${it.investigators} investigators with at least one row with MeSH.`,
    "",
    "| modal class | investigators | median rows with MeSH | median H-touching share |",
    "|---|---|---|---|",
    ...it.byModalClass.map(
      (m) => `| ${m.modal} | ${m.investigators} | ${m.medianRows ?? "—"} | ${m.medianHTouchingShare == null ? "—" : pct(m.medianHTouchingShare, 1)} |`
    ),
    "",
    `Median H-touching share across investigators: ${it.medianHTouchingShare == null ? "—" : pct(it.medianHTouchingShare, 1)}. Investigators by H-touching share: ${it.hTouchingBands.map((b) => `${b.label}: ${b.investigators}`).join(" · ")}.`,
    ""
  );

  const descriptorTable = (title: string, list: DescriptorCount[]) => {
    lines.push(title, "", "| # | descriptor | UI | rows | share |", "|---|---|---|---|---|");
    list.forEach((x, i) => lines.push(`| ${i + 1} | ${cell(x.name)} | ${x.ui} | ${x.rows} | ${pct(x.share, 1)} |`));
    lines.push("");
  };
  descriptorTable(`### 11d. ${d.topDescriptors.length} most common descriptors (share of rows with MeSH)`, d.topDescriptors);
  descriptorTable(`### 11e. ${d.topMajorDescriptors.length} most common major-topic descriptors (share of rows with MeSH)`, d.topMajorDescriptors);

  const c = d.checkTags;
  lines.push(
    "### 11f. Check tags",
    "",
    "Matched by descriptor name in the row's MeSH, the way PR 1.2's `check_tag*` clauses will match them.",
    "",
    "| check tag | rows | share |",
    "|---|---|---|",
    ...c.byName.map((x) => `| ${cell(x.name)} | ${x.rows} | ${pct(x.rows, c.rows)} |`),
    "",
    `Humans / Animals split: Humans only ${c.split.humansOnly} (${pct(c.split.humansOnly, c.rows)}) · Animals only ${c.split.animalsOnly} (${pct(c.split.animalsOnly, c.rows)}) · both ${c.split.both} (${pct(c.split.both, c.rows)}) · neither ${c.split.neither} (${pct(c.split.neither, c.rows)}).`,
    ""
  );

  const h = d.humanStudyDesign;
  lines.push(
    "### 11g. Publication types",
    "",
    `Every publication type over the ${v.rows} verified rows (a row can carry several).`,
    "",
    "| publication type | rows | share |",
    "|---|---|---|",
    ...d.pubTypes.map((x) => `| ${cell(x.type)} | ${x.rows} | ${pct(x.share, 1)} |`),
    "",
    `Human study-design publication types — the ${h.types.length} \`pubtype*\` values in signal-mapping.json (${h.types.join("; ")}): ${h.rows} rows with any of them (${pct(h.share, 1)} of verified rows); ${h.investigators} of ${d.verifiedInvestigators} investigators with ≥ 1.`,
    ""
  );

  const a = d.authorPosition;
  lines.push(
    "### 11h. Author position × method",
    "",
    `Over the ${a.rows} stamped verified rows. Method is how the author entry was found: orcid on the entry, name (strict name + UCSF, else name only), absent = not located.`,
    "",
    `| author_position | ${AUTHOR_METHOD_ORDER.join(" | ")} | total |`,
    `|---|${AUTHOR_METHOD_ORDER.map(() => "---|").join("")}---|`,
    ...a.positions.map((p) => `| ${p.position} | ${AUTHOR_METHOD_ORDER.map((m) => p.byMethod[m]).join(" | ")} | ${p.total} |`),
    `| (all) | ${AUTHOR_METHOD_ORDER.map((m) => a.methods[m]).join(" | ")} | ${a.rows} |`,
    ""
  );

  return lines.join("\n");
}

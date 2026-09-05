/**
 * Self-declared axes (PR 0.7): the "How do you do research?" grid, the
 * materials checklist, aspirations and do-not-suggest, plus the intake-sheet
 * derivation the import wizard uses. Pure — no Supabase, no fetch. The
 * onboarding step, the edit sheet, the import mapping and the server actions
 * all share these definitions and schemas.
 *
 * Keys are the taxonomy's own: paradigm family ids from
 * taxonomy.json › paradigm.families and materials kinds from
 * taxonomy.json › materials.kinds, so what an investigator declares lands on
 * the same axes the classifier scores (signal-mapping.json › self_declared_*,
 * reliability aggregation.reliability.self_declared_current).
 */
import { z } from "zod";
import { normalizeCsvHeader } from "@/lib/csv/normalize-csv-header";
import signalMapping from "@/lib/fit/signal-mapping.json";
import taxonomy from "@/lib/fit/taxonomy.json";

// ---------------------------------------------------------------------------
// Paradigm families — the seven rows of the grid (D5: plan wording)
// ---------------------------------------------------------------------------

export type ParadigmFamily = keyof typeof taxonomy.paradigm.families;

export const PARADIGM_FAMILY_KEYS = Object.keys(taxonomy.paradigm.families) as ParadigmFamily[];

/**
 * One row per family, in taxonomy order. Labels are the D5 wording from the
 * plan; hints paraphrase the spec §4 one-line definitions.
 */
export const SELF_DECLARED_FAMILY_ROWS: ReadonlyArray<{ family: ParadigmFamily; label: string; hint: string }> = [
  { family: "discovery", label: "Discovery/mechanistic", hint: "Fundamental questions; how a pathway, gene or cell type produces a phenotype" },
  { family: "preclinical", label: "Preclinical/animal", hint: "Interventions and hypotheses tested in model systems before humans" },
  { family: "translational", label: "Translational human biology", hint: "Human tissue, blood or cells; first-in-human and mechanistic studies in people" },
  { family: "clinical", label: "Clinical (patients, trials)", hint: "Patients as participants: observational studies, procedures, registered trials" },
  { family: "population", label: "Population/epidemiology", hint: "Incidence, risk factors, genetic and social determinants at population scale" },
  { family: "health_systems", label: "Health systems/implementation", hint: "Delivery, access, quality, comparative effectiveness, implementation" },
  { family: "cross_cutting", label: "Computational/methods", hint: "Modeling, machine learning, bioinformatics; new assays, instruments and measures" },
];

/**
 * The schema stores a 0–3 rating per family (plan § PR 0.7). The UI exposes
 * three points — Not my work / Some / Core — and leaves 2 unused so Core
 * stays at the top of the scale and a "Substantial" step can be added later
 * without remapping stored values.
 */
export const SELF_DECLARED_RATINGS: ReadonlyArray<{ value: SelfDeclaredRating; label: string }> = [
  { value: 0, label: "Not my work" },
  { value: 1, label: "Some" },
  { value: 3, label: "Core" },
];

export type SelfDeclaredRating = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Materials — the checklist, keyed by taxonomy.json › materials.kinds
// ---------------------------------------------------------------------------

export type MaterialsGroup = keyof typeof taxonomy.materials.kinds;

/** Labels for every kind in taxonomy.materials.kinds; self-declared.test.ts asserts the two sets match. */
export const MATERIALS_LABEL = {
  cell_lines: "Cell lines",
  primary_cells_nonhuman: "Primary cells (non-human)",
  organoids_ipsc: "Organoids / iPSC-derived",
  animal_mouse: "Mouse",
  animal_rat: "Rat",
  animal_zebrafish: "Zebrafish",
  animal_nhp: "Non-human primate",
  animal_other: "Other animal models",
  human_tissue_biopsy: "Human tissue / biopsies",
  human_blood_fluids: "Human blood / fluids (plasma, serum, CSF, …)",
  human_primary_cells: "Human primary cells",
  biobank_specimens: "Biobank specimens",
  enrolled_participants: "Enrolled participants",
  patients_under_care: "Patients under my care",
  ehr: "EHR data",
  claims_administrative: "Claims / administrative data",
  registries_surveillance: "Registries / surveillance data",
  surveys: "Surveys",
  cohort_biobank_datasets: "Cohort / biobank datasets",
  genomic_datasets: "Genomic datasets",
  imaging_datasets: "Imaging datasets",
  digital_wearable: "Digital / wearable data",
  published_literature: "Published literature / meta-data",
  simulated_data: "Simulated data",
} as const;

export type MaterialsKind = keyof typeof MATERIALS_LABEL;

export const MATERIALS_GROUP_LABEL: Record<MaterialsGroup, string> = {
  non_human: "Non-human",
  human_biological: "Human biological",
  human_participants: "Human participants",
  human_data: "Human data",
  other: "Other",
};

export const MATERIALS_GROUPS: ReadonlyArray<{ key: MaterialsGroup; label: string; kinds: MaterialsKind[] }> = (
  Object.keys(taxonomy.materials.kinds) as MaterialsGroup[]
).map((key) => ({ key, label: MATERIALS_GROUP_LABEL[key], kinds: taxonomy.materials.kinds[key] as MaterialsKind[] }));

/** Every kind in taxonomy order. */
export const MATERIALS_KINDS: MaterialsKind[] = MATERIALS_GROUPS.flatMap((g) => g.kinds);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const familyKey = z.enum(PARADIGM_FAMILY_KEYS);
const rating = z.number().int().min(0).max(3);

export const materialsKindSchema = z.enum(Object.keys(MATERIALS_LABEL) as MaterialsKind[]);

/** investigators.self_declared_axes. NULL in the column means "never answered"; a family absent from `paradigm` was left unrated. */
export const selfDeclaredAxesSchema = z.object({
  paradigm: z.partialRecord(familyKey, rating),
  materials: z.array(materialsKindSchema),
  capabilities: z.array(z.string().trim().min(1).max(80)),
  updated_at: z.iso.datetime(),
});

export type SelfDeclaredAxes = z.infer<typeof selfDeclaredAxesSchema>;

export const ASPIRATIONS_MAX = 20;
export const ASPIRATION_MAX_LENGTH = 300;

/** What the onboarding step and the edit sheet submit. */
export const selfDeclaredInputSchema = z.object({
  paradigm: z.partialRecord(familyKey, rating).default({}),
  materials: z.array(materialsKindSchema).max(MATERIALS_KINDS.length).default([]),
  aspirations: z.array(z.string().trim().min(1).max(ASPIRATION_MAX_LENGTH)).max(ASPIRATIONS_MAX).default([]),
  do_not_suggest: z.array(familyKey).default([]),
});

export type SelfDeclaredInput = z.input<typeof selfDeclaredInputSchema>;
export type SelfDeclaredInputParsed = z.output<typeof selfDeclaredInputSchema>;

/** The stored JSON, or null when the column is empty or does not parse (a scorer never throws on a bad row). */
export function readSelfDeclaredAxes(value: unknown): SelfDeclaredAxes | null {
  if (value == null) return null;
  const parsed = selfDeclaredAxesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Column builders
// ---------------------------------------------------------------------------

function orderedParadigm(input: Partial<Record<ParadigmFamily, number>>): SelfDeclaredAxes["paradigm"] {
  const out: SelfDeclaredAxes["paradigm"] = {};
  for (const family of PARADIGM_FAMILY_KEYS) {
    const v = input[family];
    if (typeof v === "number") out[family] = v;
  }
  return out;
}

export function orderedMaterials(kinds: Iterable<MaterialsKind>): MaterialsKind[] {
  const set = new Set(kinds);
  return MATERIALS_KINDS.filter((k) => set.has(k));
}

function orderedFamilies(families: Iterable<ParadigmFamily>): ParadigmFamily[] {
  const set = new Set(families);
  return PARADIGM_FAMILY_KEYS.filter((f) => set.has(f));
}

function sameParadigm(a: SelfDeclaredAxes["paradigm"], b: SelfDeclaredAxes["paradigm"]): boolean {
  return PARADIGM_FAMILY_KEYS.every((f) => a[f] === b[f]);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function dedupeText(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export type SelfDeclaredColumns = {
  self_declared_axes: SelfDeclaredAxes | null;
  aspirations: string[];
  do_not_suggest: ParadigmFamily[];
};

/**
 * The investigators columns for one submission. `updated_at` moves only when
 * the ratings or materials actually change, so an unrelated edit of the sheet
 * does not restamp the self-report; capabilities (no UI yet) are carried over.
 * Everything cleared → NULL, which is what `self_declared_present` keys on.
 */
export function buildSelfDeclaredColumns(input: SelfDeclaredInputParsed, previous: SelfDeclaredAxes | null, now: string): SelfDeclaredColumns {
  const paradigm = orderedParadigm(input.paradigm);
  const materials = orderedMaterials(input.materials);
  const capabilities = previous?.capabilities ?? [];
  let axes: SelfDeclaredAxes | null;
  if (!Object.keys(paradigm).length && !materials.length && !capabilities.length) axes = null;
  else if (previous && sameParadigm(previous.paradigm, paradigm) && sameList(previous.materials, materials)) axes = previous;
  else axes = { paradigm, materials, capabilities, updated_at: now };
  return { self_declared_axes: axes, aspirations: dedupeText(input.aspirations), do_not_suggest: orderedFamilies(input.do_not_suggest) };
}

/** Import path: add materials the intake sheet implies without touching ratings; unchanged input returns `previous` as is. */
export function mergeImportedMaterials(previous: SelfDeclaredAxes | null, materials: MaterialsKind[], now: string): SelfDeclaredAxes | null {
  const have = new Set(previous?.materials ?? []);
  const add = orderedMaterials(materials).filter((m) => !have.has(m));
  if (!add.length) return previous;
  return {
    paradigm: previous?.paradigm ?? {},
    materials: orderedMaterials([...(previous?.materials ?? []), ...add]),
    capabilities: previous?.capabilities ?? [],
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Aspirations — "Directions I'm moving toward", one per line
// ---------------------------------------------------------------------------

export function parseAspirations(text: string | null | undefined): string[] {
  const parts = String(text ?? "")
    .split(/\r?\n|;/)
    .map((s) => s.trim().slice(0, ASPIRATION_MAX_LENGTH));
  return dedupeText(parts).slice(0, ASPIRATIONS_MAX);
}

export function formatAspirations(list: readonly string[] | null | undefined): string {
  return (list ?? []).join("\n");
}

// ---------------------------------------------------------------------------
// Intake sheet — "Clinical Samples" / "Biobanks" free text → materials
// ---------------------------------------------------------------------------

type IntakeRule = { id: string; when: { intake_field?: string; affirmative?: boolean }; assign?: { materials?: Record<string, number> } };

/**
 * The signal-mapping rules keyed on an intake field (`self_declared_clinical_samples`,
 * `self_declared_biobank`), with the field name normalized the way the import
 * wizard normalizes CSV headers ("Clinical Samples" → clinical_samples).
 */
export const INTAKE_MATERIAL_RULES: ReadonlyArray<{ id: string; field: string; materials: MaterialsKind[] }> = (signalMapping.rules as IntakeRule[])
  .filter((r) => typeof r.when?.intake_field === "string" && r.when.affirmative === true)
  .map((r) => ({
    id: r.id,
    field: normalizeCsvHeader(r.when.intake_field!),
    materials: orderedMaterials(Object.keys(r.assign?.materials ?? {}) as MaterialsKind[]),
  }));

/** Answers that open with a yes. */
const YES_LEAD = /^(yes|yep|yeah|yup|absolutely|definitely|of course|sure)\b/;
/** Answers that open with a no, N/A, "not …" or a dash. */
const NO_LEAD = /^(no\b|none\b|n\/?a\b|nope\b|not\b|nothing\b|never\b|nil\b|--|-$|i wish\b|unfortunately\b)/;
/** Wishes and plans, not current practice — aspiration, never a material. */
const HEDGE_LEAD = /^((i|we)('m| am| are|'re)? ?(hoping|interested|looking|planning|would (like|love)|want)|possibly|maybe|perhaps|planned|planning|hoping|hope to|would be|in the future|eventually|potentially)\b/;
/** A negation anywhere that says the samples are not in hand. */
const NEGATED = /\b(not central|not (currently|at (this|the present) time)|do(es)? not have|don't have|no (current )?access|unable to (obtain|get|access)|not (a )?(pressing|priority)|not (in )?use)\b/;
/** Generic sample talk: enough to call an answer affirmative, not enough to name a kind. */
const GENERIC_SAMPLE = /\b(samples?|specimens?|cohorts?)\b/;

/**
 * Words that name a materials kind. Order matters only for readability;
 * every kind named in the text is returned. Organ nouns count as tissue
 * ("human lung", "skin"); bank/repository/cohort nouns as biobank specimens.
 */
const MATERIAL_TERMS: ReadonlyArray<{ kind: MaterialsKind; re: RegExp }> = [
  {
    kind: "human_blood_fluids",
    re: /\b(blood|pbmcs?|plasma|serum|sera|csf|cerebrospinal|fluids?|aspirates?|urine|stool|feces|fecal|swabs?|bal|lavage|ascites|sputum|saliva|bone marrow|cord blood|leukocytes?|neutrophils?|lymphocytes?)\b/,
  },
  {
    kind: "human_tissue_biopsy",
    re: /\b(tissues?|biops(y|ies)|tumou?rs?|specimens?|ffpe|formalin|paraffin|explants?|resections?|surgical|lungs?|liver|skin|brain|spleens?|lymph(oid)? ?(nodes?|tissues?)|placent(a|al)|synovi(al|um)|glioblastoma|fetal|organoids?|tissue-infiltrating|tils?)\b/,
  },
  {
    kind: "human_primary_cells",
    re: /\bprimary (human )?(cells?|t-?cells?|b-?cells?|macrophages?|neutrophils?|fibroblasts?|hepatocytes?|epithelial|alveolar)\b/,
  },
  {
    kind: "biobank_specimens",
    re: /\b(bio-?banks?|bio-?banking|bio-?repositor(y|ies)|tissue banks?|specimen banks?|blood banks?|banked|repositor(y|ies)|cohorts?)\b/,
  },
];

function normalizeAnswer(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is a free-text intake answer a "yes"? Leading yes wins; leading no / N/A /
 * "not …", a wish or plan, or a negation anywhere ("do not have", "unable to
 * obtain") is a no; anything else is a yes only when it names samples or a
 * material. Conservative on purpose — the person can tick the box in the
 * edit sheet; a wrong material is worse than a missing one.
 */
export function isAffirmative(text: string | null | undefined): boolean {
  const t = normalizeAnswer(text);
  if (!t) return false;
  if (YES_LEAD.test(t)) return true;
  if (NO_LEAD.test(t) || HEDGE_LEAD.test(t) || NEGATED.test(t)) return false;
  return GENERIC_SAMPLE.test(t) || MATERIAL_TERMS.some((m) => m.re.test(t));
}

/** The materials kinds a free-text answer names, in taxonomy order (no affirmativeness check). */
export function mineMaterials(text: string | null | undefined): MaterialsKind[] {
  const t = normalizeAnswer(text);
  if (!t) return [];
  return orderedMaterials(MATERIAL_TERMS.filter((m) => m.re.test(t)).map((m) => m.kind));
}

/**
 * Materials implied by the intake sheet, per signal-mapping's intake rules.
 * For each rule whose field is affirmative: the kinds the text names, plus
 * the rule's own kinds unless the text already named one of them — so
 * "Yes, plasma and CSF" gives blood/fluids only, a bare "yes" gives both of
 * the clinical-samples kinds, and a biobank answer naming a lung bank gives
 * tissue and biobank specimens. `fields` is keyed by normalized header.
 */
export function intakeMaterials(fields: Record<string, string | null | undefined>): MaterialsKind[] {
  const out = new Set<MaterialsKind>();
  for (const rule of INTAKE_MATERIAL_RULES) {
    const text = fields[rule.field];
    if (!isAffirmative(text)) continue;
    const named = mineMaterials(text);
    for (const k of named) out.add(k);
    if (!named.some((k) => rule.materials.includes(k))) for (const k of rule.materials) out.add(k);
  }
  return orderedMaterials(out);
}

// ---------------------------------------------------------------------------
// Degrees — "MD, PhD" ⇄ ["MD", "PhD"]
// ---------------------------------------------------------------------------

export const DEGREES_MAX = 10;
export const DEGREE_MAX_LENGTH = 40;

export function parseDegrees(text: string | null | undefined): string[] {
  const parts = String(text ?? "")
    .split(/[,;/]/)
    .map((s) => s.trim().replace(/\.+$/, "").slice(0, DEGREE_MAX_LENGTH));
  return dedupeText(parts).slice(0, DEGREES_MAX);
}

export function formatDegrees(list: readonly string[] | null | undefined): string {
  return (list ?? []).join(", ");
}

// ---------------------------------------------------------------------------
// Form value — what the onboarding step and the edit sheet hold in state
// ---------------------------------------------------------------------------

export type SelfDeclaredFormValue = {
  paradigm: Partial<Record<ParadigmFamily, SelfDeclaredRating>>;
  materials: MaterialsKind[];
  /** The textarea as typed; one direction per line. */
  aspirations: string;
  do_not_suggest: ParadigmFamily[];
};

export const EMPTY_SELF_DECLARED_FORM: SelfDeclaredFormValue = { paradigm: {}, materials: [], aspirations: "", do_not_suggest: [] };

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** From the investigators row (or any object carrying those columns) to the form; tolerant of missing or malformed columns. */
export function selfDeclaredFormFromRow(row: { self_declared_axes?: unknown; aspirations?: unknown; do_not_suggest?: unknown }): SelfDeclaredFormValue {
  const axes = readSelfDeclaredAxes(row.self_declared_axes);
  const families = new Set<string>(PARADIGM_FAMILY_KEYS);
  return {
    paradigm: (axes?.paradigm ?? {}) as SelfDeclaredFormValue["paradigm"],
    materials: axes?.materials ?? [],
    aspirations: formatAspirations(stringList(row.aspirations)),
    do_not_suggest: stringList(row.do_not_suggest).filter((f): f is ParadigmFamily => families.has(f)),
  };
}

/** From the form to what the server action validates. */
export function selfDeclaredFormToInput(v: SelfDeclaredFormValue): SelfDeclaredInput {
  return { paradigm: v.paradigm, materials: v.materials, aspirations: parseAspirations(v.aspirations), do_not_suggest: v.do_not_suggest };
}

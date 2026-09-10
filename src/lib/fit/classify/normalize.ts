/**
 * Normalized evidence items for the classifiers (plan § PR 1.2; spec §5
 * "Item classification"). One stored row — a verified publication, a
 * RePORTER award, a registered trial, a biosketch statement or contribution,
 * a UCSF Profiles record, the investigator's self-declared axes — becomes one
 * `NormalizedItem`: the prose the LLM classifier reads, the MeSH headings and
 * publication types the rule classifier keys on, and every other structured
 * field the rules read under `signals`, keyed by the clause-name family in
 * src/lib/fit/signal-mapping.json (`study_type`, `phases`, `activity_code`,
 * `rcdc_categories`, `sra_designator_code`, `title_series`, …).
 *
 * Pure: no Supabase, no fetch, no model. Nulls keep their meaning — a grant's
 * `rcdc_categories` is NULL when RePORTER has no categories and never `[]`
 * (PR 0.4), and `signals.rcdc_categories` carries that null through so the
 * rule evaluator can treat both alike deliberately. A MeSH UI the descriptor
 * index does not know throws `MeshUnknownDescriptorError` — a stale descriptor
 * table must fail loudly, never silently drop a heading (PR 0.2, D12).
 *
 * This module is the contract PR 1.3 (LLM classifier) imports:
 * `NormalizedItem`, `NormalizedItemKind`, and the `normalize*` builders.
 */
import { normalizeCsvHeader } from "@/lib/csv/normalize-csv-header";
import { resolveDescriptor, type MeshIndex } from "@/lib/fit/classify/mesh";
import { readSelfDeclaredAxes, type SelfDeclaredAxes } from "@/lib/fit/self-declared";
import signalMapping from "@/lib/fit/signal-mapping.json";

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export type NormalizedItemKind =
  | "publication"
  | "grant"
  | "trial"
  | "biosketch_statement"
  | "biosketch_contribution"
  | "profiles_narrative"
  | "self_declared"
  /** The directory row itself (department, division, rank, degrees) at `directory_metadata` reliability — PR 1.4 `collectItems`; carries no text, so the model never sees it. */
  | "directory";

/** One MeSH heading as PR 0.2 stores it on `investigator_publications.mesh`. */
export type NormalizedMeshHeading = { ui: string; name: string; major: boolean; qualifiers: string[] };

export type NormalizedItem = {
  /** Stable evidence ref: `publication:<investigator_id>:<pmid>`, `grant:<row id>`, `trial:<investigator_id>:<nct_id>`, `biosketch:<investigator_id>:statement`, `biosketch:<investigator_id>:contribution:<n>`, `profiles:<investigator_id>`, `self_declared:<investigator_id>`. */
  id: string;
  kind: NormalizedItemKind;
  title: string | null;
  /** Abstract / statement / narrative, at most `TEXT_MAX_CHARS`; `signals.text_truncated` is true when it was cut. */
  text: string | null;
  year: number | null;
  /** Evidence-role id from taxonomy `aggregation.role`: author_position → first_last_corresponding / middle_author / unknown, investigator_role → trial_pi / sub_investigator / unknown (maps in signal-mapping.json, D18), contact_pi for grants, else null. The raw values stay in `signals`. */
  role: string | null;
  mesh: NormalizedMeshHeading[];
  publication_types: string[];
  /** Every other structured field the rules read, keyed by clause-name family. */
  signals: Record<string, unknown>;
};

/** The prompt spec's input cap (docs/fit-engine/prompts/item-classifier.md: "≤ 6,000 chars"). */
export const TEXT_MAX_CHARS = 6000;

// ---------------------------------------------------------------------------
// Row shapes — the columns each builder reads (see the PR 0.2 / 0.3 / 0.4 / 0.7 migrations)
// ---------------------------------------------------------------------------

export type PublicationRow = {
  investigator_id: string;
  pmid: string;
  title?: string | null;
  publication_date?: string | null;
  /** `investigator_publications.mesh` JSONB: `[{ui, name, major, qualifiers}]`. */
  mesh?: unknown;
  publication_types?: string[] | null;
  abstract?: string | null;
  author_position?: string | null;
  author_position_method?: string | null;
  identity_method?: string | null;
  identity_status?: string | null;
  mesh_fetch_outcome?: string | null;
};

export type GrantRow = {
  id: string;
  investigator_id?: string | null;
  project_num?: string | null;
  project_title?: string | null;
  fiscal_year?: number | null;
  activity_code?: string | null;
  /** NULL = RePORTER has no categories (never `[]`); carried through as null. */
  rcdc_categories?: string[] | null;
  study_section?: string | null;
  study_section_code?: string | null;
  is_contact_pi?: boolean | null;
  abstract?: string | null;
  phr_text?: string | null;
  identity_status?: string | null;
  /** The stored projects API v2 record; only `full_study_section.sra_designator_code` (and `project_title` when the column is empty) are read. */
  raw_json?: unknown;
};

export type TrialRow = {
  investigator_id: string;
  nct_id: string;
  title?: string | null;
  start_date?: string | null;
  brief_summary?: string | null;
  study_type?: string | null;
  phases?: string[] | null;
  primary_purpose?: string | null;
  allocation?: string | null;
  intervention_model?: string | null;
  observational_model?: string | null;
  time_perspective?: string | null;
  enrollment?: number | null;
  intervention_types?: string[] | null;
  investigator_role?: string | null;
  identity_status?: string | null;
};

/** The `investigator_sources` row for `source = 'biosketch'`. */
export type BiosketchSourceRow = {
  investigator_id: string;
  document_date?: string | null;
  personal_statement?: string | null;
  contributions?: unknown;
};

/** The `investigator_sources` row for `source = 'profiles'`; the narrative and keywords live in `meta`. */
export type ProfilesSourceRow = {
  investigator_id: string;
  last_refreshed_at?: string | null;
  meta?: unknown;
};

/** The `investigators` columns the profiles and self-declared builders read. */
export type InvestigatorRow = {
  id: string;
  full_name?: string | null;
  home_department?: string | null;
  division?: string | null;
  rank?: string | null;
  title_series?: string | null;
  degrees?: string[] | null;
  self_declared_axes?: unknown;
  aspirations?: string[] | null;
  do_not_suggest?: string[] | null;
  /** Intake answers (`clinical_samples`, `biobanks`, `primary_research_area`, …) as the import wizard stores them. */
  raw_profile_json?: unknown;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s || null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

function yearOf(date: string | null | undefined): number | null {
  const m = /^(\d{4})/.exec(String(date ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

/** Truncate to `TEXT_MAX_CHARS`, preferring the last whitespace inside the final 200 characters so a word is not cut. */
export function truncateText(text: string | null | undefined): { text: string | null; truncated: boolean; chars: number } {
  const t = String(text ?? "").trim();
  if (!t) return { text: null, truncated: false, chars: 0 };
  if (t.length <= TEXT_MAX_CHARS) return { text: t, truncated: false, chars: t.length };
  const head = t.slice(0, TEXT_MAX_CHARS);
  const cut = head.search(/\s\S*$/);
  const at = cut >= TEXT_MAX_CHARS - 200 ? cut : TEXT_MAX_CHARS;
  return { text: head.slice(0, at).trimEnd(), truncated: true, chars: t.length };
}

function textSignals(t: { truncated: boolean; chars: number }): Record<string, unknown> {
  return { text_truncated: t.truncated, text_chars: t.chars };
}

/**
 * The stored MeSH JSONB → headings, every UI checked against the descriptor
 * index. Throws `MeshUnknownDescriptorError` for a UI the index does not
 * carry: a heading on a stored row that the current descriptor file does not
 * know means the table is stale (or the row is corrupt), and a silent drop
 * would make the rules go dark for that paper.
 */
/** Evidence-role id (taxonomy `aggregation.role`) for a stored `author_position` / `investigator_role`, via the maps in signal-mapping.json (D18); null when unmapped. */
function evidenceRole(map: Record<string, string>, raw: unknown): string | null {
  const key = typeof raw === "string" ? raw.trim() : "";
  return key ? (map[key] ?? null) : null;
}
const AUTHOR_POSITION_ROLE = signalMapping.author_position as Record<string, string>;
const INVESTIGATOR_ROLE = (signalMapping as { investigator_role: Record<string, string> }).investigator_role;

export function normalizeMeshHeadings(value: unknown, index: MeshIndex): NormalizedMeshHeading[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`mesh must be a JSON array of headings; got ${typeof value}`);
  const out: NormalizedMeshHeading[] = [];
  for (const raw of value) {
    const h = asObject(raw);
    const ui = str(h?.ui);
    if (!ui) throw new Error(`mesh heading without a ui: ${JSON.stringify(raw)}`);
    const row = resolveDescriptor(index, ui);
    out.push({
      ui: row.ui,
      name: str(h?.name) ?? row.name,
      major: h?.major === true,
      qualifiers: stringList(h?.qualifiers),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * A verified publication row. `investigator` names whose evidence this is (the
 * row's own `investigator_id` must agree when present). `ctx.mesh` validates
 * every heading UI.
 */
export function normalizePublication(row: PublicationRow, investigator: { id: string }, ctx: { mesh: MeshIndex }): NormalizedItem {
  if (row.investigator_id && row.investigator_id !== investigator.id) {
    throw new Error(`publication ${row.pmid} belongs to investigator ${row.investigator_id}, not ${investigator.id}`);
  }
  const t = truncateText(row.abstract);
  return {
    id: `publication:${investigator.id}:${row.pmid}`,
    kind: "publication",
    title: str(row.title),
    text: t.text,
    year: yearOf(row.publication_date),
    role: evidenceRole(AUTHOR_POSITION_ROLE, row.author_position),
    mesh: normalizeMeshHeadings(row.mesh, ctx.mesh),
    publication_types: stringList(row.publication_types),
    signals: {
      author_position: str(row.author_position),
      pmid: row.pmid,
      author_position_method: str(row.author_position_method),
      identity_method: str(row.identity_method),
      mesh_fetch_outcome: str(row.mesh_fetch_outcome),
      ...textSignals(t),
    },
  };
}

/** `raw_json.full_study_section.sra_designator_code` — the only place a Special Emphasis Panel's topical designator lives (PR 0.4 follow-up). */
export function sraDesignatorCode(rawJson: unknown): string | null {
  const fss = asObject(asObject(rawJson)?.full_study_section);
  return str(fss?.sra_designator_code)?.toUpperCase() ?? null;
}

/**
 * A RePORTER award row. Text is the abstract, with the public health relevance
 * statement appended as its own paragraph when there is one. `rcdc_categories`
 * stays NULL when RePORTER has none (never `[]`).
 */
export function normalizeGrant(row: GrantRow): NormalizedItem {
  const raw = asObject(row.raw_json);
  const abstract = str(row.abstract);
  const phr = str(row.phr_text);
  const t = truncateText([abstract, phr ? `Public health relevance: ${phr}` : null].filter(Boolean).join("\n\n"));
  // RePORTER's flag separates the contact PI from every other named PI entry; it does not say
  // which of those are multi-PI, so a false lands on `unknown` (0.6) rather than asserting mpi (0.8).
  const role = row.is_contact_pi === true ? "contact_pi" : null;
  return {
    id: `grant:${row.id}`,
    kind: "grant",
    title: str(row.project_title) ?? str(raw?.project_title) ?? null,
    text: t.text,
    year: typeof row.fiscal_year === "number" ? row.fiscal_year : null,
    role,
    mesh: [],
    publication_types: [],
    signals: {
      investigator_id: row.investigator_id ?? null,
      project_num: str(row.project_num),
      activity_code: str(row.activity_code)?.toUpperCase() ?? null,
      rcdc_categories: row.rcdc_categories == null ? null : stringList(row.rcdc_categories),
      /** Alias read by PR 1.3's topic extraction. */
      rcdc: row.rcdc_categories == null ? null : stringList(row.rcdc_categories),
      study_section: str(row.study_section),
      study_section_code: str(row.study_section_code)?.toUpperCase() ?? null,
      sra_designator_code: sraDesignatorCode(row.raw_json),
      is_contact_pi: row.is_contact_pi ?? null,
      ...textSignals(t),
    },
  };
}

/** A registered trial row (PR 0.3 design columns). `phases` is stored literally — `["NA"]` is a real value; `phases_informative` says whether it carries design information. */
export function normalizeTrial(row: TrialRow): NormalizedItem {
  const t = truncateText(row.brief_summary);
  const phases = stringList(row.phases);
  return {
    id: `trial:${row.investigator_id}:${row.nct_id}`,
    kind: "trial",
    title: str(row.title),
    text: t.text,
    year: yearOf(row.start_date),
    role: evidenceRole(INVESTIGATOR_ROLE, row.investigator_role),
    mesh: [],
    publication_types: [],
    signals: {
      nct_id: row.nct_id,
      study_type: str(row.study_type),
      phases,
      phases_informative: phases.some((p) => p !== "NA"),
      primary_purpose: str(row.primary_purpose),
      allocation: str(row.allocation),
      intervention_model: str(row.intervention_model),
      observational_model: str(row.observational_model),
      time_perspective: str(row.time_perspective),
      enrollment: typeof row.enrollment === "number" ? row.enrollment : null,
      intervention_types: stringList(row.intervention_types),
      investigator_role: str(row.investigator_role),
      ...textSignals(t),
    },
  };
}

/**
 * A biosketch source row → the personal statement plus one item per
 * contribution to science (`{title, summary}`), in stored order. Rows with no
 * statement and no contributions yield nothing.
 */
export function normalizeBiosketch(row: BiosketchSourceRow): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  const year = yearOf(row.document_date);
  const statement = truncateText(row.personal_statement);
  if (statement.text) {
    out.push({
      id: `biosketch:${row.investigator_id}:statement`,
      kind: "biosketch_statement",
      title: null,
      text: statement.text,
      year,
      role: null,
      mesh: [],
      publication_types: [],
      signals: { document_date: str(row.document_date), ...textSignals(statement) },
    });
  }
  const contributions = Array.isArray(row.contributions) ? row.contributions : [];
  contributions.forEach((raw, i) => {
    const c = asObject(raw);
    const t = truncateText(str(c?.summary));
    if (!t.text) return;
    out.push({
      id: `biosketch:${row.investigator_id}:contribution:${i + 1}`,
      kind: "biosketch_contribution",
      title: str(c?.title),
      text: t.text,
      year,
      role: null,
      mesh: [],
      publication_types: [],
      signals: { document_date: str(row.document_date), contribution_index: i + 1, ...textSignals(t) },
    });
  });
  return out;
}

/**
 * The UCSF Profiles record plus the directory's clinical-role priors. The
 * item exists even when Profiles has no narrative (text null) so the
 * `title_series_any` and `department_match` rules — profiles / directory
 * priors at their own reliability, not the self-report's — have an item to
 * fire on. `source` is null when the investigator has no profiles row.
 */
export function normalizeProfiles(source: ProfilesSourceRow | null, investigator: InvestigatorRow): NormalizedItem {
  const meta = asObject(source?.meta);
  const t = truncateText(str(meta?.narrative));
  return {
    id: `profiles:${investigator.id}`,
    kind: "profiles_narrative",
    title: str(meta?.title),
    text: t.text,
    year: yearOf(source?.last_refreshed_at),
    role: null,
    mesh: [],
    publication_types: [],
    signals: {
      title_series: str(investigator.title_series),
      department: str(investigator.home_department),
      division: str(investigator.division),
      rank: str(investigator.rank),
      degrees: stringList(investigator.degrees),
      profiles_department: str(meta?.department),
      profiles_titles: stringList(meta?.titles),
      keywords: stringList(meta?.keywords),
      freetext_keywords: stringList(meta?.freetext_keywords),
      ...textSignals(t),
    },
  };
}

/**
 * The directory row as its own item (spec §5 "Directory metadata": department,
 * division, rank — priors for A at reliability 0.3, below the Profiles
 * record's 0.6). `signals.source` names the reliability key so PR 1.3's
 * `evidenceSourceOf` weights it as `directory_metadata`. It carries the
 * columns the `department_match` rule reads; `title_series` stays on the
 * Profiles item (its rule is a Profiles prior in the spec's table). No text:
 * the model is never called for it.
 */
export function normalizeDirectory(investigator: InvestigatorRow): NormalizedItem {
  return {
    id: `directory:${investigator.id}`,
    kind: "directory",
    title: null,
    text: null,
    year: null,
    role: null,
    mesh: [],
    publication_types: [],
    signals: {
      source: "directory_metadata",
      department: str(investigator.home_department),
      division: str(investigator.division),
      rank: str(investigator.rank),
      degrees: stringList(investigator.degrees),
      text_truncated: false,
      text_chars: 0,
    },
  };
}

/** The intake-sheet fields the `intake_field` rules read, normalized the way the import wizard normalizes headers ("Clinical Samples" → clinical_samples). */
export const INTAKE_FIELDS: readonly string[] = Array.from(
  new Set(
    (signalMapping.rules as Array<{ when?: { intake_field?: unknown } }>)
      .map((r) => r.when?.intake_field)
      .filter((f): f is string => typeof f === "string")
      .map(normalizeCsvHeader)
  )
);

/**
 * What the investigator says about how they work: the stored self-declared
 * axes (D5 shape; null until answered), the raw intake answers the import
 * wizard keeps on `raw_profile_json`, and the research-focus text. Aspirations
 * ride in `signals`, never in `text` — they are directions, not current
 * practice, and PR 1.4 classifies them separately.
 */
export function normalizeSelfDeclared(investigator: InvestigatorRow): NormalizedItem {
  const raw = asObject(investigator.raw_profile_json) ?? {};
  const axes: SelfDeclaredAxes | null = readSelfDeclaredAxes(investigator.self_declared_axes);
  const intake: Record<string, string | null> = {};
  for (const field of INTAKE_FIELDS) {
    const direct = str(raw[field]);
    const fromHeader = Object.entries(raw).find(([k]) => normalizeCsvHeader(k) === field)?.[1];
    intake[field] = direct ?? str(fromHeader);
  }
  const t = truncateText(str(raw.primary_research_area) ?? str(raw.research_focus));
  return {
    id: `self_declared:${investigator.id}`,
    kind: "self_declared",
    title: null,
    text: t.text,
    year: yearOf(axes?.updated_at ?? null),
    role: null,
    mesh: [],
    publication_types: [],
    signals: {
      self_declared_axes: axes,
      intake,
      aspirations: stringList(investigator.aspirations),
      do_not_suggest: stringList(investigator.do_not_suggest),
      ...textSignals(t),
    },
  };
}

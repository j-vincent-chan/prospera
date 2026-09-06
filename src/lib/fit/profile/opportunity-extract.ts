/**
 * Notice extractor (plan § PR 1.5; docs/fit-engine/prompts/notice-extractor.md;
 * spec §6 "Full FOA text, by section"). Reads the sectioned Guide text in three
 * section groups, one model call per group (or per ≤ 30,000-character chunk of
 * a group), and validates each reply in code:
 *
 *  - only the fields listed for the group are taken (group 1: what kind of
 *    research; group 2: non-responsive / prohibited / award information;
 *    group 3: eligibility and team); anything else is logged and ignored;
 *  - every evidence quote must appear verbatim (whitespace-normalized,
 *    typographic quotes and dashes folded) in the provided sections; a quote
 *    that does not verify is dropped and logged; an elided quote ("A ... B",
 *    with any inside `...` / `…`) is rejected outright (D22); when a quote
 *    verifies in a section other than the one cited, the section is corrected
 *    and logged;
 *  - a non-empty field is kept only when a verified quote covers it (the
 *    quote's `field` is the entry's path or an ancestor of it) — an unquoted
 *    claim is dropped, the log saying whether no evidence entry named the
 *    field or its quote failed; verbatim lists (`non_responsive`,
 *    `eligibility.investigator_rules`, `clinical_trial_text`) are their own
 *    quotes and verify item by item;
 *  - `prior_overrides` are kept only when their quote verifies; opportunity.ts
 *    applies them to the overlays;
 *  - ids must be in the taxonomy vocabulary (PR 1.1 guards); weights are
 *    clamped to [0, 1]; confidence outside the vocabulary becomes medium.
 *
 * Pure apart from the injected `ModelFn` (JSON mode, temperature 0, model
 * from FIT_MODEL_EXTRACT — D2 default `gpt-4o`, the strongest approved model
 * on the endpoint `outreach/profile.ts` already uses; `max_tokens` 4,000 —
 * D22). Cached in `fit_notice_extractions` by the content hash of the
 * taxonomy version and the exact prompt (system + user), so a prompt edit
 * re-extracts (D22). A chunk skipped for budget or time, or an unusable
 * reply, leaves the build incomplete (`GroupRun.skipped` / `usable`), which
 * opportunity.ts records in `sources.complete` and re-queues.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { openaiModel, VOCABULARY_PROMPT, type ModelFn, type Prompt } from "@/lib/fit/classify/llm";
import { ModelBudget } from "@/lib/fit/profile/model-budget";
import { isConfidence, isDesignId, isMaterialsKind, isObjectiveId, isParadigmCategory, isUnitLevel, TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type { Confidence } from "@/lib/fit/types";
import { contentHash } from "@/lib/outreach/embeddings";

// ---------------------------------------------------------------------------
// Model selection (D2, D3)
// ---------------------------------------------------------------------------

/** D2 default taken: the strongest approved model on the endpoint already in use. */
export const DEFAULT_EXTRACT_MODEL = "gpt-4o";

/** `FIT_MODEL_EXTRACT`, else the D2 default. */
export function extractModelName(env: Record<string, string | undefined> = process.env): string {
  const name = env.FIT_MODEL_EXTRACT?.trim();
  return name ? name : DEFAULT_EXTRACT_MODEL;
}

/** Group replies carry evidence arrays and quotes; the classifier's 2,500 is not enough (D22). */
export const EXTRACT_MAX_TOKENS = 4_000;

/**
 * The runtime extractor: the shared OpenAI-compatible endpoint with a larger
 * output ceiling. Pass `client` to share one OpenAI instance with the exemplar
 * classifier (`resolveModelFns` in opportunity.ts does).
 */
export function openaiExtractor(opts: { client?: OpenAI; apiKey?: string } = {}): ModelFn {
  return openaiModel({ ...opts, maxTokens: EXTRACT_MAX_TOKENS });
}

// ---------------------------------------------------------------------------
// Sections and groups (notice-extractor.md › Chunking)
// ---------------------------------------------------------------------------

/** One block of the notice's text, as PR 0.5 stores it in `funding_opportunities.guide_sections`. */
export type NoticeSection = { part: 1 | 2; section: string; heading: string; text: string };

export type SectionGroupId = 1 | 2 | 3;
export const SECTION_GROUP_IDS: readonly SectionGroupId[] = [1, 2, 3];

/** "≤ 30,000 chars per group (split further if needed)". */
export const MAX_GROUP_CHARS = 30_000;
/** "a verbatim quote (≤ 240 chars)" — longer quotes still verify but are logged. */
export const MAX_QUOTE_CHARS = 240;

/** The pseudo-section a synopsis-only notice is read as. */
export const SYNOPSIS_SECTION = "synopsis";

/** Section I sub-headings that carry the non-responsive list (group 2). */
export const NON_RESPONSIVE_HEADING = /non-?respons|not respons|will not be reviewed|out of scope/i;
/** Section I sub-headings about team and partnership expectations (also read by group 3). */
export const TEAM_HEADING = /\b(?:teams?|collaborat\w*|consorti\w*|partner\w*|leadership|structure|multiple PDs?|multi-?PI)\b/i;
/** Section IV items read by group 2. */
export const HUMAN_SUBJECTS_HEADING = /Human Subjects|Clinical Trial/i;
const PURPOSE_HEADING = /Funding Opportunity Purpose/i;

/** "Part 2 · Section I · Research Objectives" — what the model is asked to cite and what verification maps back. */
export function sectionLabel(s: NoticeSection): string {
  if (s.section === SYNOPSIS_SECTION) return "Synopsis";
  if (s.part === 1) return `Part 1 · Overview · ${s.heading}`;
  return `Part 2 · Section ${s.section} · ${s.heading}`;
}

/** A Simpler synopsis (or any single text) as the one section of a text-only notice. */
export function synopsisSections(description: string | null | undefined): NoticeSection[] {
  const text = (description ?? "").trim();
  return text ? [{ part: 1, section: SYNOPSIS_SECTION, heading: "Synopsis", text }] : [];
}

/**
 * The three section groups of the prompt spec. Group 1: Part 1 Purpose +
 * Section I (minus the non-responsive sub-sections). Group 2: Section I
 * non-responsive + Section II + Section IV clinical-trial / human-subjects
 * items. Group 3: Section III (all items, III.3 included) + Section VII +
 * Section I team / collaboration language. A synopsis is group 1 only.
 */
export function groupSections(sections: NoticeSection[]): Record<SectionGroupId, NoticeSection[]> {
  const groups: Record<SectionGroupId, NoticeSection[]> = { 1: [], 2: [], 3: [] };
  for (const s of sections) {
    if (s.section === SYNOPSIS_SECTION) {
      groups[1].push(s);
      continue;
    }
    if (s.part === 1) {
      if (PURPOSE_HEADING.test(s.heading)) groups[1].push(s);
      continue;
    }
    if (s.section === "I") {
      if (NON_RESPONSIVE_HEADING.test(s.heading)) groups[2].push(s);
      else groups[1].push(s);
      if (TEAM_HEADING.test(s.heading)) groups[3].push(s);
      continue;
    }
    if (s.section === "II") groups[2].push(s);
    else if (s.section.startsWith("III")) groups[3].push(s);
    else if (s.section.startsWith("IV") && HUMAN_SUBJECTS_HEADING.test(s.heading)) groups[2].push(s);
    else if (s.section === "VII") groups[3].push(s);
  }
  return groups;
}

/** Split one over-long section at line boundaries into pieces of at most `max` chars, same heading. */
function splitSection(s: NoticeSection, max: number): NoticeSection[] {
  if (s.text.length <= max) return [s];
  const pieces: NoticeSection[] = [];
  let buf = "";
  for (const line of s.text.split("\n")) {
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > max && buf) {
      pieces.push({ ...s, text: buf });
      buf = line;
    } else buf = candidate;
    while (buf.length > max) {
      pieces.push({ ...s, text: buf.slice(0, max) });
      buf = buf.slice(max);
    }
  }
  if (buf) pieces.push({ ...s, text: buf });
  return pieces;
}

/** Pack sections in order into chunks of at most `max` chars; a section longer than `max` is split at line boundaries. */
export function chunkSections(sections: NoticeSection[], max: number = MAX_GROUP_CHARS): NoticeSection[][] {
  const chunks: NoticeSection[][] = [];
  let current: NoticeSection[] = [];
  let size = 0;
  for (const s of sections.flatMap((x) => splitSection(x, max))) {
    if (current.length && size + s.text.length > max) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += s.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Prompt (notice-extractor.md › System prompt, User template)
// ---------------------------------------------------------------------------

export const EXTRACTOR_SYSTEM_PROMPT = `You read NIH and foundation funding announcements for a university research-development office and describe what kind of research the program will fund — not what topic, primarily, but what PARADIGM, at what UNIT OF ANALYSIS, with what STUDY DESIGNS and MATERIALS, toward what OBJECTIVE — plus the investigator-level eligibility rules and team expectations.

Be literal. Every non-empty field must carry a verbatim quote (≤ 240 chars) and the section heading it came from. Distinguish REQUIRED (the notice says applications must / are expected to), ALLOWED (may / encouraged / examples include) and EXCLUDED or PROHIBITED (non-responsive / not allowed / will not be reviewed). When the notice is silent, leave the field empty — do not fill from the title or from general knowledge of the mechanism. The priors you are given came from the activity code and title designation; keep them unless the text explicitly contradicts them, and if it does, say so in \`prior_overrides\` with the quote.

Use only the fixed vocabulary below.
${VOCABULARY_PROMPT}

For \`topic\`, list the notice's DISTINGUISHING scientific terms — what would separate a responsive application from a non-responsive one. Never include generic words (mechanisms, novel, translational, biomedical, health, disease, clinical, data).`;

const EVIDENCE_SCHEMA = ` "evidence": [ { "field": "paradigm.required", "quote": "...", "section": "Part 2 · Section I · Research Objectives" }, ... ],
 "prior_overrides": [ { "field": "...", "from": ..., "to": ..., "quote": "...", "section": "..." } ],
 "confidence": "high" | "medium" | "low"    // low when the text is a synopsis only
}`;

/** The `Return JSON:` block per group — pasted verbatim into notice-extractor.md (a test pins them). */
export const GROUP_SCHEMAS: Record<SectionGroupId, string> = {
  1: `Return JSON:
{
 "paradigm": { "required_any": {<category>: weight},  // any-of, D14
    "required": {cat: weight}, "allowed": {cat: weight}, "excluded": {cat: weight} },
 "unit": { "required": [levels], "allowed": [levels] },
 "design": { "required_any": [designs], "required_any_2": [designs] | null, "allowed": [designs], "prohibited": [designs] },
 "materials": { "expected": [kinds], "human_required": true|false|null },
 "population": string | null,          // required study population, if any ("adults with T2D", "children under 5 in LMICs")
 "objective": {cat: weight},
 "topic": { "distinguishing_terms": string[], "diseases": string[], "biological_processes": string[] },
${EVIDENCE_SCHEMA}`,
  2: `Return JSON (this group fills only these fields):
{
 "paradigm": { "excluded": {cat: weight} },
 "design": { "prohibited": [designs] },
 "non_responsive": string[],            // verbatim items from the non-responsive list
 "mechanism": { "ceiling_direct_per_year": number | null, "period_years": number | null, "budget_notes": string | null },
 "clinical_trial_text": string | null,  // verbatim clinical-trial sentence from Section II or IV
${EVIDENCE_SCHEMA}`,
  3: `Return JSON (this group fills only these fields):
{
 "eligibility": { "investigator_rules": string[], "esi_only": boolean, "new_investigator_only": boolean, "clinician_required": boolean, "degree_required": string | null, "independent_appointment_required": boolean, "citizenship_rule": string | null },   // investigator_rules: verbatim
 "team": { "multi_pi_allowed": boolean | null, "consortium_required": boolean | null, "required_partners": string[] },
${EVIDENCE_SCHEMA}`,
};

/**
 * Added to the user message (in the spec's template since the fix pass): on
 * the first real run gpt-4o abbreviated most quotes with a trailing "..." or
 * paraphrased them, and every such claim was dropped by verification; on the
 * validator's run the dominant loss was categories listed without any
 * evidence entry at all (18 of 23 group-1 entries on RFA-DA-26-055), hence
 * the second sentence.
 */
export const QUOTE_REMINDER = `Every quote in "evidence" and "prior_overrides" must be copied character for character from the sections above (no paraphrase, no shortening with "..."); a quote that is not found verbatim is discarded together with the claim it supports. Cite the "## " heading line as the section. Every non-empty field needs its own evidence entry with a verbatim quote; a field without one is discarded.`;

/** The header line inputs of the user template. */
export type NoticeHeader = {
  number: string | null;
  title: string;
  agency: string | null;
  activity_code: string | null;
  activity_title: string | null;
  clinical_trial_designation: string | null;
  issuing_ic: string | null;
  program_division: string | null;
};

/** The priors line: the overlays as the spec lists them, plus the D14 any-of sets when non-empty. */
export type ExtractorPriors = {
  paradigm_required: Record<string, number>;
  paradigm_required_any?: Record<string, number>;
  paradigm_allowed: Record<string, number>;
  paradigm_excluded: Record<string, number>;
  unit_required: string[];
  unit_required_any?: string[];
  design_required_any: string[];
  design_prohibited: string[];
  materials_required: string[];
  materials_required_any?: string[];
};

export type GroupInput = {
  header: NoticeHeader;
  priors: ExtractorPriors;
  group: SectionGroupId;
  /** 1-based chunk index within the group and the chunk count. */
  chunk: number;
  of: number;
  sections: NoticeSection[];
};

const show = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "(unknown)");

export function buildExtractorUserPrompt(input: GroupInput): string {
  const h = input.header;
  const lines = [
    `Notice ${show(h.number)} · ${show(h.agency)} · ${h.title.trim()}`,
    `Activity code: ${show(h.activity_code)} (${show(h.activity_title)}) · Clinical trial: ${show(h.clinical_trial_designation)} · IC: ${show(h.issuing_ic)} · Division: ${show(h.program_division)}`,
    `Priors from code: ${JSON.stringify(input.priors)}`,
    `Section group: ${input.group}${input.of > 1 ? ` (chunk ${input.chunk} of ${input.of})` : ""}`,
    "",
    "Sections:",
  ];
  for (const s of input.sections) lines.push(`## ${sectionLabel(s)}`, s.text, "");
  lines.push(QUOTE_REMINDER, "", GROUP_SCHEMAS[input.group]);
  return lines.join("\n");
}

export function buildExtractorPrompt(input: GroupInput): Prompt {
  return { system: EXTRACTOR_SYSTEM_PROMPT, user: buildExtractorUserPrompt(input) };
}

/**
 * `fit_notice_extractions.content_hash`: sha1 of the taxonomy version, the
 * system prompt and the user prompt, newline-joined (D22). The prompt carries
 * the header, the priors, the group and chunk position, the sections, the
 * quote reminder and the group's return schema — so a notice version is
 * extracted once per taxonomy version and prompt, and any prompt edit
 * (reminder, schema, header line) re-extracts instead of serving a reply
 * produced by an older prompt.
 */
export function extractionCacheKey(input: GroupInput): string {
  const prompt = buildExtractorPrompt(input);
  return contentHash([TAXONOMY_VERSION, prompt.system, prompt.user].join("\n"));
}

/** `section_group` as stored: "1", or "1/2" for the second chunk of group 1. */
export function sectionGroupTag(input: Pick<GroupInput, "group" | "chunk" | "of">): string {
  return input.of > 1 ? `${input.group}/${input.chunk}` : String(input.group);
}

// ---------------------------------------------------------------------------
// Quote verification (notice-extractor.md › Validation)
// ---------------------------------------------------------------------------

/** Collapse whitespace and fold typographic quotes and dashes so a model's re-typed quote still matches. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type QuoteCheck = { ok: true; section: string; corrected: boolean } | { ok: false; reason: string };

/** The model's elision marker inside or at the ends of a quote: "A ... B", "A…", "...B". */
const ELLIPSIS = /\s*(?:\.\s*\.\s*\.|…)\s*/;

/**
 * The quote split at its elision markers, markers removed, empty pieces
 * dropped. One fragment = a verbatim quote (a marker at either end is only
 * decoration); two or more = an elided quote, which D22 rejects — the words
 * the marker hides could reverse the claim.
 */
export function quoteFragments(quote: string): string[] {
  return normalizeForMatch(quote)
    .split(ELLIPSIS)
    .map((f) => f.trim())
    .filter(Boolean);
}

function sectionMatchesCitation(s: NoticeSection, cited: string): boolean {
  const c = normalizeForMatch(cited).toLowerCase();
  if (!c) return false;
  const label = normalizeForMatch(sectionLabel(s)).toLowerCase();
  const heading = normalizeForMatch(s.heading).toLowerCase();
  return label === c || heading === c || c.endsWith(heading) || c.includes(heading) || label.includes(c);
}

/** The rejection reason for an elided quote, in the log and the tests. */
export const ELIDED_QUOTE_REASON = 'elided quote ("..."); not verbatim';

/**
 * Pure. The quote must be a whitespace-normalized substring of a provided
 * section. An elided quote (an elision marker with text on both sides) is
 * rejected outright (D22). The cited section is tried first; any other
 * section verifies with `corrected: true`. Nothing verifies against an empty
 * quote.
 */
export function verifyQuote(quote: string, cited: string | null, sections: NoticeSection[]): QuoteCheck {
  const fragments = quoteFragments(quote);
  if (!fragments.length) return { ok: false, reason: "empty quote" };
  if (fragments.length > 1) return { ok: false, reason: ELIDED_QUOTE_REASON };
  const needle = fragments[0]!;
  const contains = (s: NoticeSection) => normalizeForMatch(s.text).includes(needle);
  const citedSections = cited ? sections.filter((s) => sectionMatchesCitation(s, cited)) : [];
  const inCited = citedSections.find(contains);
  if (inCited) return { ok: true, section: sectionLabel(inCited), corrected: false };
  const elsewhere = sections.find(contains);
  if (elsewhere) return { ok: true, section: sectionLabel(elsewhere), corrected: true };
  return { ok: false, reason: cited ? `not found in "${cited}" or any other provided section` : "not found in any provided section" };
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export type EvidenceQuote = { field: string; quote: string; section: string };
export type PriorOverride = { field: string; from: unknown; to: unknown; quote: string; section: string };

export type GroupEligibility = {
  investigator_rules: string[];
  esi_only: boolean;
  new_investigator_only: boolean;
  clinician_required: boolean;
  degree_required: string | null;
  independent_appointment_required: boolean;
  citizenship_rule: string | null;
};

export type GroupTeam = { multi_pi_allowed: boolean | null; consortium_required: boolean | null; required_partners: string[] };

/** What one group contributed, validated and quote-verified. Fields the group does not fill are empty. */
export type GroupOutput = {
  paradigm: { required: Record<string, number>; required_any: Record<string, number>; allowed: Record<string, number>; excluded: Record<string, number> };
  unit: { required: string[]; allowed: string[] };
  design: { required_any: string[]; required_any_2: string[]; allowed: string[]; prohibited: string[] };
  materials: { expected: string[]; human_required: boolean | null };
  population: string | null;
  objective: Record<string, number>;
  topic: { distinguishing_terms: string[]; diseases: string[]; biological_processes: string[] };
  non_responsive: string[];
  mechanism: { ceiling_direct_per_year: number | null; period_years: number | null; budget_notes: string | null };
  clinical_trial_text: string | null;
  eligibility: GroupEligibility;
  team: GroupTeam;
  /** Verified quotes only, sections corrected where needed. */
  evidence: EvidenceQuote[];
  /** Verified overrides only; applied to the overlays by opportunity.ts. */
  prior_overrides: PriorOverride[];
  /** Null when the reply carried none (treated as medium by the merge when text was read). */
  confidence: Confidence | null;
};

export function emptyGroupOutput(): GroupOutput {
  return {
    paradigm: { required: {}, required_any: {}, allowed: {}, excluded: {} },
    unit: { required: [], allowed: [] },
    design: { required_any: [], required_any_2: [], allowed: [], prohibited: [] },
    materials: { expected: [], human_required: null },
    population: null,
    objective: {},
    topic: { distinguishing_terms: [], diseases: [], biological_processes: [] },
    non_responsive: [],
    mechanism: { ceiling_direct_per_year: null, period_years: null, budget_notes: null },
    clinical_trial_text: null,
    eligibility: { investigator_rules: [], esi_only: false, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null },
    team: { multi_pi_allowed: null, consortium_required: null, required_partners: [] },
    evidence: [],
    prior_overrides: [],
    confidence: null,
  };
}

/** The fields each group fills (notice-extractor.md › Chunking: "Each chunk fills only the fields listed for it"). */
export const GROUP_FIELDS: Record<SectionGroupId, readonly string[]> = {
  1: ["paradigm.required_any", "paradigm.required", "paradigm.allowed", "paradigm.excluded", "unit.required", "unit.allowed", "design.required_any", "design.required_any_2", "design.allowed", "design.prohibited", "materials.expected", "materials.human_required", "population", "objective", "topic"],
  2: ["paradigm.excluded", "design.prohibited", "non_responsive", "mechanism", "clinical_trial_text"],
  3: ["eligibility", "team"],
};

const COMMON_KEYS = new Set(["evidence", "prior_overrides", "confidence"]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const fmt = (v: unknown) => {
  const s = typeof v === "number" || v === undefined ? String(v) : (JSON.stringify(v) ?? String(v));
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

function at(raw: Record<string, unknown>, path: string): unknown {
  let cur: unknown = raw;
  for (const key of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

const AXIS_GUARD: Record<string, (id: string) => boolean> = {
  paradigm: isParadigmCategory,
  unit: isUnitLevel,
  design: isDesignId,
  materials: isMaterialsKind,
  objective: isObjectiveId,
};

/** The evidence field names the model may use, normalized to profile paths (`paradigm_required.x` → `paradigm.required.x`). */
export function normalizeFieldPath(field: string): string {
  return field
    .trim()
    .replace(/^(paradigm|unit|design|materials)_(required_any_2|required_any|required|allowed|excluded|prohibited|expected)/, "$1.$2")
    .replace(/\[(\w+)\]/g, ".$1")
    .replace(/\s+/g, "");
}

type Verified = {
  evidence: EvidenceQuote[];
  /** Fields of the verified quotes. */
  fields: Set<string>;
  /** Fields of every evidence entry the model wrote, verified or not — tells "no evidence entry" from "its quote failed". */
  cited: Set<string>;
};

const coversPath = (fields: Set<string>, path: string): boolean => {
  for (const f of fields) {
    if (f === path || path.startsWith(`${f}.`)) return true;
  }
  return false;
};

/** True when a verified quote's field is `path` or an ancestor of it. */
function covered(v: Verified, path: string): boolean {
  return coversPath(v.fields, path);
}

/** The log line for a claim no verified quote covers: the model wrote no evidence entry for it, or wrote one whose quote failed. */
export function uncoveredReason(v: Pick<Verified, "cited">, path: string): string {
  return coversPath(v.cited, path) ? "no verified quote (evidence quote failed)" : "no verified quote (no evidence entry)";
}

function weightMap(axis: string, path: string, value: unknown, v: Verified, dropped: string[]): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    dropped.push(`${path}: not an object (${fmt(value)})`);
    return {};
  }
  const out: Record<string, number> = {};
  for (const [id, w] of Object.entries(value)) {
    if (!AXIS_GUARD[axis]!(id)) {
      dropped.push(`${path}.${id}: unknown id`);
      continue;
    }
    if (typeof w !== "number" || !Number.isFinite(w)) {
      dropped.push(`${path}.${id}: not a number (${fmt(w)})`);
      continue;
    }
    let p = w;
    if (p > 1) {
      dropped.push(`${path}.${id}: clamped ${w} to 1`);
      p = 1;
    } else if (p < 0) {
      dropped.push(`${path}.${id}: clamped ${w} to 0`);
      p = 0;
    }
    if (p === 0) continue;
    if (!covered(v, `${path}.${id}`)) {
      dropped.push(`${path}.${id}: ${uncoveredReason(v, `${path}.${id}`)}`);
      continue;
    }
    out[id] = p;
  }
  return out;
}

function idList(axis: string, path: string, value: unknown, v: Verified, dropped: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    dropped.push(`${path}: not an array (${fmt(value)})`);
    return [];
  }
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== "string") {
      dropped.push(`${path}: dropped ${fmt(id)}`);
      continue;
    }
    const key = id.trim();
    if (!AXIS_GUARD[axis]!(key)) {
      dropped.push(`${path}.${key}: unknown id`);
      continue;
    }
    if (out.includes(key)) continue;
    if (!covered(v, `${path}.${key}`)) {
      dropped.push(`${path}.${key}: ${uncoveredReason(v, `${path}.${key}`)}`);
      continue;
    }
    out.push(key);
  }
  return out;
}

function stringList(path: string, value: unknown, dropped: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    dropped.push(`${path}: not an array (${fmt(value)})`);
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of value) {
    if (typeof s !== "string" || !s.trim()) {
      dropped.push(`${path}: dropped ${fmt(s)}`);
      continue;
    }
    const t = s.trim();
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Items that are their own quotes: kept when the item verifies against the sections. */
function verbatimList(path: string, value: unknown, sections: NoticeSection[], dropped: string[]): string[] {
  const out: string[] = [];
  for (const item of stringList(path, value, dropped)) {
    const check = verifyQuote(item, null, sections);
    if (!check.ok) {
      dropped.push(`${path}: ${fmt(item)} ${check.reason}`);
      continue;
    }
    out.push(item);
  }
  return out;
}

function verbatimString(path: string, value: unknown, sections: NoticeSection[], dropped: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    dropped.push(`${path}: not a string (${fmt(value)})`);
    return null;
  }
  const check = verifyQuote(value, null, sections);
  if (!check.ok) {
    dropped.push(`${path}: ${fmt(value)} ${check.reason}`);
    return null;
  }
  return value.trim();
}

function quotedString(path: string, value: unknown, v: Verified, dropped: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    dropped.push(`${path}: not a string (${fmt(value)})`);
    return null;
  }
  const s = value.trim();
  if (!s) return null;
  if (!covered(v, path)) {
    dropped.push(`${path}: ${uncoveredReason(v, path)}`);
    return null;
  }
  return s;
}

function quotedNumber(path: string, value: unknown, v: Verified, dropped: string[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    dropped.push(`${path}: not a number (${fmt(value)})`);
    return null;
  }
  if (!covered(v, path)) {
    dropped.push(`${path}: ${uncoveredReason(v, path)}`);
    return null;
  }
  return value;
}

/** A claim-bearing boolean: `true` needs a quote; `false` is the default and needs none; anything else is the default. */
function claimFlag(path: string, value: unknown, v: Verified, dropped: string[]): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value !== true) {
    dropped.push(`${path}: not a boolean (${fmt(value)})`);
    return false;
  }
  if (!covered(v, path)) {
    dropped.push(`${path}: ${uncoveredReason(v, path)}`);
    return false;
  }
  return true;
}

/** A tri-state boolean where both true and false are claims. */
function claimTriState(path: string, value: unknown, v: Verified, dropped: string[]): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    dropped.push(`${path}: not a boolean (${fmt(value)})`);
    return null;
  }
  if (!covered(v, path)) {
    dropped.push(`${path}: ${uncoveredReason(v, path)}`);
    return null;
  }
  return value;
}

function verifyEvidence(raw: unknown, sections: NoticeSection[], dropped: string[]): Verified {
  const v: Verified = { evidence: [], fields: new Set(), cited: new Set() };
  if (raw === undefined || raw === null) return v;
  if (!Array.isArray(raw)) {
    dropped.push(`evidence: not an array (${fmt(raw)})`);
    return v;
  }
  for (const e of raw) {
    if (!isRecord(e) || typeof e.field !== "string" || typeof e.quote !== "string") {
      dropped.push(`evidence: malformed entry ${fmt(e)}`);
      continue;
    }
    const field = normalizeFieldPath(e.field);
    v.cited.add(field);
    const cited = typeof e.section === "string" ? e.section : null;
    const check = verifyQuote(e.quote, cited, sections);
    if (!check.ok) {
      dropped.push(`evidence ${field}: quote ${fmt(e.quote)} ${check.reason}; claim dropped`);
      continue;
    }
    if (check.corrected) dropped.push(`evidence ${field}: section corrected from "${cited ?? "(none)"}" to "${check.section}"`);
    if (e.quote.length > MAX_QUOTE_CHARS) dropped.push(`evidence ${field}: quote is ${e.quote.length} chars (> ${MAX_QUOTE_CHARS}); kept`);
    v.evidence.push({ field, quote: e.quote.trim(), section: check.section });
    v.fields.add(field);
  }
  return v;
}

function verifyOverrides(raw: unknown, sections: NoticeSection[], dropped: string[]): PriorOverride[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    dropped.push(`prior_overrides: not an array (${fmt(raw)})`);
    return [];
  }
  const out: PriorOverride[] = [];
  for (const o of raw) {
    if (!isRecord(o) || typeof o.field !== "string" || typeof o.quote !== "string") {
      dropped.push(`prior_overrides: malformed entry ${fmt(o)}`);
      continue;
    }
    const field = normalizeFieldPath(o.field);
    const cited = typeof o.section === "string" ? o.section : null;
    const check = verifyQuote(o.quote, cited, sections);
    if (!check.ok) {
      dropped.push(`prior_override ${field}: quote ${fmt(o.quote)} ${check.reason}; override dropped`);
      continue;
    }
    if (check.corrected) dropped.push(`prior_override ${field}: section corrected from "${cited ?? "(none)"}" to "${check.section}"`);
    out.push({ field, from: o.from ?? null, to: o.to ?? null, quote: o.quote.trim(), section: check.section });
  }
  return out;
}

/**
 * Pure. Validate one group's parsed reply against the sections it was given.
 * Every removal or change is a line in `dropped`.
 */
export function validateGroupOutput(raw: unknown, group: SectionGroupId, sections: NoticeSection[]): { output: GroupOutput; dropped: string[] } {
  const dropped: string[] = [];
  const output = emptyGroupOutput();
  if (!isRecord(raw)) {
    dropped.push(`output: not a JSON object (${fmt(raw)})`);
    return { output, dropped };
  }
  const fields = GROUP_FIELDS[group];
  const topLevel = new Set(fields.map((f) => f.split(".")[0]!));
  for (const key of Object.keys(raw)) {
    if (COMMON_KEYS.has(key) || topLevel.has(key)) continue;
    dropped.push(`${key}: ignored (group ${group} does not fill it)`);
  }
  for (const [axis, sub] of Object.entries(raw)) {
    if (!isRecord(sub) || !topLevel.has(axis) || fields.includes(axis)) continue;
    for (const key of Object.keys(sub)) {
      if (!fields.includes(`${axis}.${key}`)) dropped.push(`${axis}.${key}: ignored (group ${group} does not fill it)`);
    }
  }

  const v = verifyEvidence(raw.evidence, sections, dropped);
  output.evidence = v.evidence;
  output.prior_overrides = verifyOverrides(raw.prior_overrides, sections, dropped);

  const has = (f: string) => fields.includes(f);
  if (has("paradigm.required_any")) output.paradigm.required_any = weightMap("paradigm", "paradigm.required_any", at(raw, "paradigm.required_any"), v, dropped);
  if (has("paradigm.required")) output.paradigm.required = weightMap("paradigm", "paradigm.required", at(raw, "paradigm.required"), v, dropped);
  if (has("paradigm.allowed")) output.paradigm.allowed = weightMap("paradigm", "paradigm.allowed", at(raw, "paradigm.allowed"), v, dropped);
  if (has("paradigm.excluded")) output.paradigm.excluded = weightMap("paradigm", "paradigm.excluded", at(raw, "paradigm.excluded"), v, dropped);
  if (has("unit.required")) output.unit.required = idList("unit", "unit.required", at(raw, "unit.required"), v, dropped);
  if (has("unit.allowed")) output.unit.allowed = idList("unit", "unit.allowed", at(raw, "unit.allowed"), v, dropped);
  if (has("design.required_any")) output.design.required_any = idList("design", "design.required_any", at(raw, "design.required_any"), v, dropped);
  if (has("design.required_any_2")) output.design.required_any_2 = idList("design", "design.required_any_2", at(raw, "design.required_any_2"), v, dropped);
  if (has("design.allowed")) output.design.allowed = idList("design", "design.allowed", at(raw, "design.allowed"), v, dropped);
  if (has("design.prohibited")) output.design.prohibited = idList("design", "design.prohibited", at(raw, "design.prohibited"), v, dropped);
  if (has("materials.expected")) output.materials.expected = idList("materials", "materials.expected", at(raw, "materials.expected"), v, dropped);
  if (has("materials.human_required")) output.materials.human_required = claimTriState("materials.human_required", at(raw, "materials.human_required"), v, dropped);
  if (has("population")) output.population = quotedString("population", raw.population, v, dropped);
  if (has("objective")) output.objective = weightMap("objective", "objective", raw.objective, v, dropped);
  if (has("topic")) {
    const t = isRecord(raw.topic) ? raw.topic : {};
    if (raw.topic !== undefined && !isRecord(raw.topic)) dropped.push(`topic: not an object (${fmt(raw.topic)})`);
    output.topic = {
      distinguishing_terms: stringList("topic.distinguishing_terms", t.distinguishing_terms, dropped),
      diseases: stringList("topic.diseases", t.diseases, dropped),
      biological_processes: stringList("topic.biological_processes", t.biological_processes, dropped),
    };
  }
  if (has("non_responsive")) output.non_responsive = verbatimList("non_responsive", raw.non_responsive, sections, dropped);
  if (has("mechanism")) {
    if (raw.mechanism !== undefined && raw.mechanism !== null && !isRecord(raw.mechanism)) dropped.push(`mechanism: not an object (${fmt(raw.mechanism)})`);
    output.mechanism = {
      ceiling_direct_per_year: quotedNumber("mechanism.ceiling_direct_per_year", at(raw, "mechanism.ceiling_direct_per_year"), v, dropped),
      period_years: quotedNumber("mechanism.period_years", at(raw, "mechanism.period_years"), v, dropped),
      budget_notes: quotedString("mechanism.budget_notes", at(raw, "mechanism.budget_notes"), v, dropped),
    };
  }
  if (has("clinical_trial_text")) output.clinical_trial_text = verbatimString("clinical_trial_text", raw.clinical_trial_text, sections, dropped);
  if (has("eligibility")) {
    if (raw.eligibility !== undefined && raw.eligibility !== null && !isRecord(raw.eligibility)) dropped.push(`eligibility: not an object (${fmt(raw.eligibility)})`);
    output.eligibility = {
      investigator_rules: verbatimList("eligibility.investigator_rules", at(raw, "eligibility.investigator_rules"), sections, dropped),
      esi_only: claimFlag("eligibility.esi_only", at(raw, "eligibility.esi_only"), v, dropped),
      new_investigator_only: claimFlag("eligibility.new_investigator_only", at(raw, "eligibility.new_investigator_only"), v, dropped),
      clinician_required: claimFlag("eligibility.clinician_required", at(raw, "eligibility.clinician_required"), v, dropped),
      degree_required: quotedString("eligibility.degree_required", at(raw, "eligibility.degree_required"), v, dropped),
      independent_appointment_required: claimFlag("eligibility.independent_appointment_required", at(raw, "eligibility.independent_appointment_required"), v, dropped),
      citizenship_rule: quotedString("eligibility.citizenship_rule", at(raw, "eligibility.citizenship_rule"), v, dropped),
    };
  }
  if (has("team")) {
    if (raw.team !== undefined && raw.team !== null && !isRecord(raw.team)) dropped.push(`team: not an object (${fmt(raw.team)})`);
    const partners = stringList("team.required_partners", at(raw, "team.required_partners"), dropped);
    if (partners.length && !covered(v, "team.required_partners")) dropped.push(`team.required_partners: ${uncoveredReason(v, "team.required_partners")}`);
    output.team = {
      multi_pi_allowed: claimTriState("team.multi_pi_allowed", at(raw, "team.multi_pi_allowed"), v, dropped),
      consortium_required: claimTriState("team.consortium_required", at(raw, "team.consortium_required"), v, dropped),
      required_partners: covered(v, "team.required_partners") ? partners : [],
    };
  }
  const c = raw.confidence;
  if (c === undefined || c === null) output.confidence = null;
  else if (typeof c === "string" && isConfidence(c)) output.confidence = c;
  else {
    dropped.push(`confidence: ${fmt(c)}; treated as medium`);
    output.confidence = "medium";
  }
  return { output, dropped };
}

// ---------------------------------------------------------------------------
// The call and the cache
// ---------------------------------------------------------------------------

/** One group (chunk) extraction — the `fit_notice_extractions.output` JSON. */
export type GroupExtraction = {
  group: SectionGroupId;
  chunk: number;
  of: number;
  model: string;
  /** The parsed reply (or the unparseable string), for audit. */
  raw: unknown;
  /** False when the reply did not parse or was cut off; never cached or reused. */
  usable: boolean;
  output: GroupOutput;
  dropped: string[];
};

/** One row of `fit_notice_extractions`. */
export type CachedExtraction = {
  content_hash: string;
  opportunity_id: string | null;
  section_group: string;
  taxonomy_version: string;
  output: GroupExtraction;
  model: string | null;
  created_at: string;
};

export type NoticeExtractionCache = {
  get(contentHash: string): Promise<CachedExtraction | null>;
  set(row: CachedExtraction): Promise<void>;
};

/** Map-backed cache for tests and dry runs. */
export class InMemoryNoticeExtractionCache implements NoticeExtractionCache {
  readonly rows = new Map<string, CachedExtraction>();
  reads = 0;
  writes = 0;

  async get(contentHash: string): Promise<CachedExtraction | null> {
    this.reads += 1;
    return this.rows.get(contentHash) ?? null;
  }

  async set(row: CachedExtraction): Promise<void> {
    this.writes += 1;
    this.rows.set(row.content_hash, row);
  }
}

const CACHE_COLUMNS = "content_hash, opportunity_id, section_group, taxonomy_version, output, model, created_at";

/** `fit_notice_extractions`-backed cache; errors propagate (a failing cache must not look like a miss). */
export function supabaseNoticeExtractionCache(db: SupabaseClient): NoticeExtractionCache {
  return {
    async get(contentHash) {
      const { data, error } = await db.from("fit_notice_extractions").select(CACHE_COLUMNS).eq("content_hash", contentHash).maybeSingle();
      if (error) throw new Error(`fit_notice_extractions read failed: ${error.message}`);
      return (data as CachedExtraction | null) ?? null;
    },
    async set(row) {
      const { error } = await db.from("fit_notice_extractions").upsert(row, { onConflict: "content_hash" });
      if (error) throw new Error(`fit_notice_extractions write failed: ${error.message}`);
    },
  };
}

export type ExtractGroupOptions = {
  /** Defaults to `openaiExtractor()`. Inject a stub in tests. */
  model?: ModelFn;
  /** Defaults to `extractModelName()`. */
  modelName?: string;
};

/**
 * Build the prompt, call the model once, parse and validate. Throws only when
 * the model function throws; a malformed or truncated reply comes back with
 * empty fields, the reason in `dropped`, and `usable: false`.
 */
export async function extractGroup(input: GroupInput, opts: ExtractGroupOptions = {}): Promise<GroupExtraction> {
  const model = opts.modelName ?? extractModelName();
  const call = opts.model ?? openaiExtractor();
  const reply = await call({ ...buildExtractorPrompt(input), model });
  const content = typeof reply === "string" ? reply : reply.content;
  const truncated = typeof reply !== "string" && reply.finish_reason === "length" ? "output: truncated by max_tokens (finish_reason length)" : null;
  const base = { group: input.group, chunk: input.chunk, of: input.of, model };
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    return { ...base, raw: content, usable: false, output: emptyGroupOutput(), dropped: [...(truncated ? [truncated] : []), `output: not valid JSON (${e instanceof Error ? e.message : String(e)})`] };
  }
  const { output, dropped } = validateGroupOutput(raw, input.group, input.sections);
  if (truncated) dropped.unshift(truncated);
  return { ...base, raw, usable: !truncated, output, dropped };
}

/** The counter shared by every model call of one run (extractor and exemplar classifier): PR 1.4's class, re-exported so `opportunity.ts` callers keep their import. */
export { ModelBudget };

/** `GroupRun.skipped` when the shared model budget ran out before the chunk. */
export const SKIPPED_BUDGET = "model budget spent";
/** `GroupRun.skipped` when the run's deadline passed before the chunk (D22). */
export const SKIPPED_TIME = "time budget";

export type ExtractSectionsDeps = ExtractGroupOptions & {
  cache?: NoticeExtractionCache;
  budget?: ModelBudget;
  /** Epoch ms; past it no model call is made and the chunk is `skipped: "time budget"` (cache hits still count). */
  deadline?: number;
  opportunityId?: string | null;
  now?: () => Date;
};

export type GroupRun = {
  group: SectionGroupId;
  chunk: number;
  of: number;
  chars: number;
  cache: "hit" | "miss" | "disabled";
  model_called: boolean;
  /** Set when the chunk was neither cached nor called: `SKIPPED_BUDGET` or `SKIPPED_TIME`. The build is then incomplete. */
  skipped: string | null;
  extraction: GroupExtraction | null;
};

/**
 * The three groups of one notice: group → chunks → cache → deadline → model
 * (within the budget) → validate. Usable replies are cached; an unusable one
 * is returned but never written, so the next run calls again (the 1.3
 * validator's rule).
 */
export async function extractWithModel(sections: NoticeSection[], header: NoticeHeader, priors: ExtractorPriors, deps: ExtractSectionsDeps = {}): Promise<GroupRun[]> {
  const groups = groupSections(sections);
  const runs: GroupRun[] = [];
  for (const group of SECTION_GROUP_IDS) {
    const chunks = chunkSections(groups[group]);
    if (!chunks.length) continue;
    for (let i = 0; i < chunks.length; i += 1) {
      const input: GroupInput = { header, priors, group, chunk: i + 1, of: chunks.length, sections: chunks[i]! };
      const chars = input.sections.reduce((a, s) => a + s.text.length, 0);
      const key = extractionCacheKey(input);
      const cached = deps.cache ? await deps.cache.get(key) : null;
      if (cached?.output && cached.output.usable !== false) {
        runs.push({ group, chunk: input.chunk, of: input.of, chars, cache: "hit", model_called: false, skipped: null, extraction: cached.output });
        continue;
      }
      const cacheState = deps.cache ? "miss" : "disabled";
      if (deps.deadline !== undefined && Date.now() > deps.deadline) {
        runs.push({ group, chunk: input.chunk, of: input.of, chars, cache: cacheState, model_called: false, skipped: SKIPPED_TIME, extraction: null });
        continue;
      }
      if (deps.budget && !deps.budget.take()) {
        runs.push({ group, chunk: input.chunk, of: input.of, chars, cache: cacheState, model_called: false, skipped: SKIPPED_BUDGET, extraction: null });
        continue;
      }
      const extraction = await extractGroup(input, { model: deps.model, modelName: deps.modelName });
      if (deps.cache && extraction.usable) {
        await deps.cache.set({
          content_hash: key,
          opportunity_id: deps.opportunityId ?? null,
          section_group: sectionGroupTag(input),
          taxonomy_version: TAXONOMY_VERSION,
          output: extraction,
          model: extraction.model,
          created_at: (deps.now ?? (() => new Date()))().toISOString(),
        });
      }
      runs.push({ group, chunk: input.chunk, of: input.of, chars, cache: cacheState, model_called: true, skipped: null, extraction });
    }
  }
  return runs;
}

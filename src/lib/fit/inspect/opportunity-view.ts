/**
 * Opportunity profile view model for `/opportunities/[id]/fit` (plan § PR
 * 1.6). Pure: takes the stored `opportunity_fit_profiles` row, returns what
 * the page renders. No Supabase, no fetch.
 *
 * What a reviewer needs to see (spec §6): required / required_any / allowed /
 * excluded per axis with, for every entry, where it came from — the verified
 * quote on its own path, the list's quote (marked inherited), a deterministic
 * overlay, or the D21 exemplar blend — design prohibited, materials expected,
 * human_required, the mechanism, eligibility and team fields, needs_review,
 * confidence, and the sources (text source, exemplar counts, blend weights,
 * complete / incomplete, the per-group extraction log, overlays, merge and
 * blend logs).
 *
 * The merge's per-entry `origin` map is not stored, so the overlay and
 * exemplar sets are recomputed from the stored log lines (`overlays_applied`,
 * `blend_log`, `overrides_applied`) and the taxonomy tables, matching the
 * exact formats `deterministicOverlays` / `mergeExtractions` / `blend` write.
 */
import type { Axis } from "@/lib/fit/classify/contracts";
import { DEFAULT_RULE_TABLES, familyPriorBlock } from "@/lib/fit/classify/rules";
import type { OpportunityFitProfileRow, ProfileSources } from "@/lib/fit/profile/opportunity";
import { activityCodePrior, clinicalTrialOverlay, type ClinicalTrialOverlay } from "@/lib/fit/taxonomy";
import type { Confidence, NoticeQuote, OpportunityFitProfile } from "@/lib/fit/types";
import { axisDescription, axisLabel, categoryDisplay, sortedWeights, type InspectAxis } from "@/lib/fit/inspect/labels";

export type QuoteView = { field: string; section: string; quote: string };

/** A quote as an entry carries it: `inherited` when it is the list's quote (`paradigm.required`), not the entry's own (`paradigm.required.clinical_trials`). */
export type EntryQuoteView = QuoteView & { inherited: boolean };

/**
 * Why an entry is on its list:
 *  - `text` — the extractor claimed it with a verified quote on its own path, or (`quote.inherited`) on the list;
 *  - `overlay` — a deterministic overlay set it (clinical-trial designation, activity-code prior, program division);
 *  - `exemplar` — the D21 blend added it from the funded exemplars; no Guide quote exists for it;
 *  - `unquoted` — nothing in the stored row says where it came from.
 */
export type EntryOrigin = "text" | "overlay" | "exemplar" | "unquoted";

export type OverlayRef = {
  source: "designation" | "activity_code" | "division";
  /** The designation entry (`required`, `not_allowed`), the activity code (`K08`) or the program-division key. */
  detail: string;
};

export type NoticeEntryView = {
  id: string;
  label: string;
  group: string | null;
  known: boolean;
  /** Weight for the weighted lists (paradigm, objective); null for the list axes. */
  weight: number | null;
  /** The verified quote on this entry's own path, else the list's quote marked `inherited`; null for an exemplar-added entry and when there is none. */
  quote: EntryQuoteView | null;
  origin: EntryOrigin;
  /** The overlay that set the entry, whatever `origin` says (an own-path quote can confirm an overlay entry). */
  overlay: OverlayRef | null;
  /** The one-line marker the page shows beside the entry ("overlay: activity code K08", "no verified quote", …). */
  marker: string;
};

export type NoticeListView = {
  /** `paradigm.required`, `design.prohibited`, … — the provenance path prefix. */
  path: string;
  label: string;
  /** How the engine reads the list, one line. */
  semantics: string;
  entries: NoticeEntryView[];
  /** The quote on the list path itself (`provenance["paradigm.required_any"]`), no ancestor walk; it stays after the merge folded the set. */
  listQuote: QuoteView | null;
  /** Merge-log lines that dropped an entry from this list ("clinical_trials: in paradigm.required, dropped from paradigm.required_any"). */
  mergeNotes: string[];
};

export type NoticeAxisView = {
  axis: Axis;
  label: string;
  description: string;
  lists: NoticeListView[];
  /** Every category id present on the axis, for the axis-level flag form. */
  categories: Array<{ id: string; label: string }>;
  /** `materials.human_required` for the materials axis. */
  human_required: boolean | null;
};

export type FactRow = { label: string; value: string; quote: QuoteView | null };

export type OpportunityProfileView = {
  opportunity_id: string;
  number: string;
  taxonomy_version: string;
  computed_at: string;
  confidence: Confidence;
  needs_review: boolean;
  partial: { reasons: string[]; message: string } | null;
  mechanism: FactRow[];
  eligibility: FactRow[];
  team: FactRow[];
  population: string | null;
  axes: NoticeAxisView[];
  topic: { terms: string[]; rcdc: string[]; mesh: string[]; free_text: string | null };
  non_responsive: string[];
  /** Every provenance quote, by field path. */
  quotes: QuoteView[];
  sources: {
    facts: Array<{ label: string; value: string }>;
    complete: boolean;
    incomplete: string[];
    groups: Array<{ label: string; cache: string; model_called: boolean; skipped: string | null; usable: boolean | null; chars: number; dropped: string[] }>;
    overlays_applied: string[];
    overlay_notes: string[];
    overrides_applied: string[];
    merge_log: string[];
    blend_log: string[];
  };
};

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(String).join("; ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};
const money = (n: number | null | undefined): string => (typeof n === "number" ? `$${new Intl.NumberFormat("en-US").format(Math.round(n))} / yr` : "—");

/** Pure. The quote on `path` or its nearest ancestor (`paradigm.required.clinical_trials` ← `paradigm.required` ← `paradigm`). */
export function quoteFor(provenance: Record<string, NoticeQuote> | null | undefined, path: string): QuoteView | null {
  if (!provenance || typeof provenance !== "object") return null;
  const parts = path.split(".");
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join(".");
    const q = provenance[key];
    if (q && typeof q === "object" && typeof q.quote === "string") return { field: key, section: typeof q.section === "string" ? q.section : "", quote: q.quote };
  }
  return null;
}

/** Pure. The quote stored on exactly `path` — no ancestor walk. */
export function exactQuote(provenance: Record<string, NoticeQuote> | null | undefined, path: string): QuoteView | null {
  if (!provenance || typeof provenance !== "object") return null;
  const q = provenance[path];
  return q && typeof q === "object" && typeof q.quote === "string" ? { field: path, section: typeof q.section === "string" ? q.section : "", quote: q.quote } : null;
}

/** Pure. Every provenance entry as a row, sorted by field path. */
export function allQuotes(provenance: Record<string, NoticeQuote> | null | undefined): QuoteView[] {
  if (!provenance || typeof provenance !== "object") return [];
  return Object.entries(provenance)
    .filter((e): e is [string, NoticeQuote] => Boolean(e[1]) && typeof e[1] === "object" && typeof e[1].quote === "string")
    .map(([field, q]) => ({ field, section: typeof q.section === "string" ? q.section : "", quote: q.quote }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Pure. The entries the D21 blend added from the exemplars, as entry paths:
 * `paradigm.allowed += c w (exemplar share s)` and the list-axis gains
 * `unit.allowed += L1 (…)`, `design.allowed += …`, `materials.expected += …`.
 * A `paradigm.allowed.c: a → b` line (an existing entry raised) is not an add.
 */
export function exemplarAdded(blendLog: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of blendLog) {
    const m = /^(paradigm\.allowed|unit\.allowed|design\.allowed|materials\.expected) \+= (\S+) /.exec(line);
    if (m) out.add(`${m[1]}.${m[2]}`);
  }
  return out;
}

const OVERLAY_PATHS: ReadonlyArray<[keyof ClinicalTrialOverlay, string]> = [
  ["paradigm_required", "paradigm.required"],
  ["paradigm_required_any", "paradigm.required_any"],
  ["paradigm_excluded", "paradigm.excluded"],
  ["unit_required", "unit.required"],
  ["unit_required_any", "unit.required_any"],
  ["design_required_any", "design.required_any"],
  ["design_prohibited", "design.prohibited"],
  ["materials_required", "materials.required"],
  ["materials_required_any", "materials.required_any"],
];

/**
 * Pure. Entry path → the overlay that set it, recomputed from the stored log
 * lines the way `deterministicOverlays` writes them (the merge's `origin`
 * map is not stored): `<rule> → clinical_trial_designation.<entry>` through
 * `clinicalTrialOverlay(entry)`, the blend's `paradigm.required.<c>:
 * designation prior …` lines, `<rule> → activity_code_priors.<code>` (with or
 * without ` (neutral)`) through `activityCodePrior(code)`, and
 * `notice_program_division → program-divisions.<key>` through the division
 * table's family prior. Designation first, then the activity code, then the
 * division — the first to set an entry wins, as in the overlays. A verified
 * override that removed the entry (`<path>: removed (…)`) or replaced the
 * list (`<list>: prior list → […]`) takes it out again. An unknown entry,
 * code or key is skipped, never thrown.
 */
export function overlayOrigins(sources: Pick<Partial<ProfileSources>, "overlays_applied" | "blend_log" | "overrides_applied"> | null | undefined): Map<string, OverlayRef> {
  const out = new Map<string, OverlayRef>();
  const set = (path: string, ref: OverlayRef) => {
    if (!out.has(path)) out.set(path, ref);
  };
  const applied = strList(sources?.overlays_applied);
  let designation: string | null = null;
  for (const line of applied) {
    const m = /^\S+ → clinical_trial_designation\.(\S+)$/.exec(line);
    if (!m) continue;
    designation ??= m[1]!;
    let o: Readonly<ClinicalTrialOverlay>;
    try {
      o = clinicalTrialOverlay(m[1]!);
    } catch {
      continue;
    }
    const ref: OverlayRef = { source: "designation", detail: m[1]! };
    for (const [key, path] of OVERLAY_PATHS) {
      const v = o[key];
      for (const id of Array.isArray(v) ? v : Object.keys(v ?? {})) set(`${path}.${id}`, ref);
    }
  }
  for (const line of strList(sources?.blend_log)) {
    const m = /^paradigm\.required\.(\S+): designation prior /.exec(line);
    if (m) set(`paradigm.required.${m[1]}`, { source: "designation", detail: designation ?? "required" });
  }
  for (const line of applied) {
    const m = /^\S+ → activity_code_priors\.(\S+?)(?: \(neutral\))?$/.exec(line);
    if (!m) continue;
    const code = m[1]!;
    const prior = activityCodePrior(code);
    if (!prior) continue;
    const ref: OverlayRef = { source: "activity_code", detail: code };
    for (const c of Object.keys(prior.r ?? {})) set(`paradigm.required.${c}`, ref);
    for (const c of Object.keys(prior.a ?? {})) set(`paradigm.allowed.${c}`, ref);
    if (prior.objective) set(`objective.${prior.objective}`, ref);
    if (prior.career) set("objective.training_capacity", ref);
  }
  for (const line of applied) {
    const m = /^notice_program_division → program-divisions\.(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const entries = DEFAULT_RULE_TABLES.programDivisions.entries;
    if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
    let block: ReturnType<typeof familyPriorBlock>;
    try {
      block = familyPriorBlock(entries[key]!, `inspector ← program-divisions.${key}`);
    } catch {
      continue;
    }
    for (const c of Object.keys(block.paradigm ?? {})) set(`paradigm.allowed.${c}`, { source: "division", detail: key });
  }
  for (const line of strList(sources?.overrides_applied)) {
    const removed = /^(\S+): removed \(/.exec(line);
    if (removed) {
      out.delete(removed[1]!);
      continue;
    }
    const list = /^(\S+): prior list → /.exec(line);
    if (list) for (const key of Array.from(out.keys())) if (key.startsWith(`${list[1]}.`)) out.delete(key);
  }
  return out;
}

/** "clinical-trial designation required" / "activity code K08" / "program division DEM". Pure. */
export function overlayLabel(ref: OverlayRef): string {
  switch (ref.source) {
    case "designation":
      return `clinical-trial designation ${ref.detail.replaceAll("_", " ")}`;
    case "activity_code":
      return `activity code ${ref.detail}`;
    default:
      return `program division ${ref.detail}`;
  }
}

/** The marker the page shows beside an entry; never empty, so a quote is never the only signal. Pure. */
export function entryMarker(e: Pick<NoticeEntryView, "origin" | "overlay" | "quote">): string {
  switch (e.origin) {
    case "exemplar":
      return "exemplar prior (D21), no Guide quote";
    case "overlay":
      return `overlay: ${e.overlay ? overlayLabel(e.overlay) : "deterministic"}`;
    case "text":
      if (e.quote?.inherited) return "quote is for the whole list";
      return e.overlay ? `verified quote · also overlay: ${overlayLabel(e.overlay)}` : "verified quote";
    default:
      return "no verified quote";
  }
}

type EntryContext = {
  prov: OpportunityFitProfile["provenance"] | null | undefined;
  exemplar: ReadonlySet<string>;
  overlay: ReadonlyMap<string, OverlayRef>;
  mergeLog: readonly string[];
  /** The exemplar blend ran (weight > 0 and at least one informative exemplar): `objective` blends over the union without a log line. */
  blended: boolean;
};

/**
 * Pure. One entry with its origin. Precedence: an exemplar-added entry is
 * `exemplar` with no quote (nothing in the Guide was ever claimed for it); an
 * own-path quote is `text`; an overlay entry is `overlay` (it carries the
 * list's quote, marked inherited, when there is one); a list-level quote
 * alone is `text` + inherited; otherwise `unquoted`.
 *
 * `objective` has no `+=` blend line: `blendMap` takes the union silently.
 * An objective entry with no quote on its path or the list and no overlay
 * can only be the exemplars' (a text claim needs a verified quote, D22; the
 * activity-code prior is in the overlay set; the blend is skipped at weight
 * 0), so it is `exemplar` when the blend ran. One carrying only the list's
 * quote cannot be told from a text claim and stays `text` + inherited.
 */
function entryView(axis: InspectAxis, path: string, id: string, weight: number | null, ctx: EntryContext): NoticeEntryView {
  const d = categoryDisplay(axis, id);
  const entryPath = `${path}.${id}`;
  const base = { id, label: d.label, group: d.group, known: d.known, weight };
  const overlay = ctx.overlay.get(entryPath) ?? null;
  const finish = (quote: EntryQuoteView | null, origin: EntryOrigin): NoticeEntryView => ({ ...base, quote, origin, overlay, marker: entryMarker({ quote, origin, overlay }) });
  if (ctx.exemplar.has(entryPath)) return finish(null, "exemplar");
  const own = exactQuote(ctx.prov, entryPath);
  if (own) return finish({ ...own, inherited: false }, "text");
  const list = exactQuote(ctx.prov, path);
  const inherited = list ? { ...list, inherited: true } : null;
  if (overlay) return finish(inherited, "overlay");
  if (!inherited && path === "objective" && ctx.blended) return finish(null, "exemplar");
  return finish(inherited, inherited ? "text" : "unquoted");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function listView(axis: InspectAxis, path: string, label: string, semantics: string, entries: NoticeEntryView[], ctx: EntryContext): NoticeListView {
  const dropped = new RegExp(`dropped from ${escapeRe(path)}(?![\\w.])`);
  return { path, label, semantics, entries, listQuote: exactQuote(ctx.prov, path), mergeNotes: ctx.mergeLog.filter((l) => dropped.test(l)) };
}

function weighted(axis: InspectAxis, path: string, label: string, semantics: string, weights: Record<string, number | undefined> | null | undefined, ctx: EntryContext): NoticeListView {
  return listView(
    axis,
    path,
    label,
    semantics,
    sortedWeights(weights).map(({ id, weight }) => entryView(axis, path, id, weight, ctx)),
    ctx,
  );
}

function listed(axis: InspectAxis, path: string, label: string, semantics: string, ids: unknown, ctx: EntryContext): NoticeListView {
  return listView(
    axis,
    path,
    label,
    semantics,
    strList(ids).map((id) => entryView(axis, path, id, null, ctx)),
    ctx,
  );
}

const categoriesOf = (lists: NoticeListView[]): Array<{ id: string; label: string }> => {
  const seen = new Map<string, string>();
  for (const l of lists) for (const e of l.entries) if (!seen.has(e.id)) seen.set(e.id, e.label);
  return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
};

/** Pure. The stored row → the page's view. Missing optional fields render as empty, never throw. */
export function opportunityProfileView(row: OpportunityFitProfileRow): OpportunityProfileView {
  const p = row.profile;
  const prov = p.provenance ?? {};
  const s = (row.sources ?? {}) as Partial<ProfileSources>;
  const mech = p.mechanism ?? ({} as OpportunityFitProfile["mechanism"]);
  const paradigm = p.paradigm ?? ({ required: {}, required_any: {}, allowed: {}, excluded: {} } as OpportunityFitProfile["paradigm"]);
  const unit = p.unit ?? ({ required: [], required_any: [], allowed: [] } as OpportunityFitProfile["unit"]);
  const design = p.design ?? ({ required_any: [], required_any_2: [], allowed: [], prohibited: [] } as OpportunityFitProfile["design"]);
  const materials = p.materials ?? ({ expected: [], required: [], required_any: [], human_required: null } as OpportunityFitProfile["materials"]);
  const elig = p.eligibility ?? ({} as OpportunityFitProfile["eligibility"]);
  const team = p.team ?? ({} as OpportunityFitProfile["team"]);
  const ctx: EntryContext = {
    prov,
    exemplar: exemplarAdded(strList(s.blend_log)),
    overlay: overlayOrigins(s),
    mergeLog: strList(s.merge_log),
    blended: (s.blend?.exemplar ?? 0) > 0 && (s.exemplars_informative ?? 0) > 0,
  };

  const paradigmLists = [
    weighted("paradigm", "paradigm.required", "Required", "Weighted mean of support over these; the paradigm gate (stage 2).", paradigm.required, ctx),
    weighted("paradigm", "paradigm.required_any", "Required — any of", "Any one satisfies it; support is the max over the set (D14).", paradigm.required_any, ctx),
    weighted("paradigm", "paradigm.allowed", "Allowed", "Compatible but not required; exemplar-only categories land here (D21).", paradigm.allowed, ctx),
    weighted("paradigm", "paradigm.excluded", "Excluded", "A dominant excluded paradigm caps the tier at Poor.", paradigm.excluded, ctx),
  ];
  const unitLists = [
    listed("unit", "unit.required", "Required (all of)", "Every level here must be supported.", unit.required, ctx),
    listed("unit", "unit.required_any", "Required — any of", "Any one level satisfies it.", unit.required_any, ctx),
    listed("unit", "unit.allowed", "Allowed", "Compatible levels.", unit.allowed, ctx),
  ];
  const designLists = [
    listed("design", "design.required_any", "Required — any of", "Any one design in the group satisfies it; all groups must be met.", design.required_any, ctx),
    listed("design", "design.required_any_2", "Required — any of (second group)", "A second any-of group, when the notice has one.", design.required_any_2, ctx),
    listed("design", "design.allowed", "Allowed", "Compatible designs.", design.allowed, ctx),
    listed("design", "design.prohibited", "Prohibited", "Penalized when it is the investigator's dominant design.", design.prohibited, ctx),
  ];
  const materialsLists = [
    listed("materials", "materials.required", "Required", "Every kind here must be supported.", materials.required, ctx),
    listed("materials", "materials.required_any", "Required — any of", "Any one kind satisfies it.", materials.required_any, ctx),
    listed("materials", "materials.expected", "Expected", "What the program expects applicants to work with.", materials.expected, ctx),
  ];
  const objectiveLists = [weighted("objective", "objective", "Objective weights", "Scored as relevance; never gates. Blends text and exemplars over the union (D21); the blend logs no objective adds, so an entry with only the list's quote may be the exemplars'.", p.objective, ctx)];

  const axes: NoticeAxisView[] = [
    { axis: "paradigm", label: axisLabel("paradigm"), description: axisDescription("paradigm"), lists: paradigmLists, categories: categoriesOf(paradigmLists), human_required: null },
    { axis: "unit", label: axisLabel("unit"), description: axisDescription("unit"), lists: unitLists, categories: categoriesOf(unitLists), human_required: null },
    { axis: "design", label: axisLabel("design"), description: axisDescription("design"), lists: designLists, categories: categoriesOf(designLists), human_required: null },
    { axis: "materials", label: axisLabel("materials"), description: axisDescription("materials"), lists: materialsLists, categories: categoriesOf(materialsLists), human_required: typeof materials.human_required === "boolean" ? materials.human_required : null },
    { axis: "objective", label: axisLabel("objective"), description: axisDescription("objective"), lists: objectiveLists, categories: categoriesOf(objectiveLists), human_required: null },
  ];

  const incomplete = strList(s.incomplete);
  const complete = s.complete !== false;
  const blend = s.blend ?? null;

  return {
    opportunity_id: row.opportunity_id,
    number: p.number ?? "",
    taxonomy_version: row.taxonomy_version,
    computed_at: row.computed_at,
    confidence: row.confidence ?? p.confidence ?? "low",
    needs_review: Boolean(p.needs_review),
    partial: complete
      ? null
      : {
          reasons: incomplete,
          message: `This build is incomplete: ${incomplete.length ? incomplete.join("; ") : "a chunk was skipped, a reply was unusable or an exemplar was budget-skipped"}. The nightly run re-queues the notice (D22); what is shown is the overlays plus whatever was read.`,
        },
    mechanism: [
      { label: "Activity code", value: fmt(mech.activity_code), quote: null },
      { label: "Clinical trial designation", value: fmt(mech.clinical_trial).replaceAll("_", " "), quote: quoteFor(prov, "clinical_trial_text") },
      { label: "BESH", value: fmt(Boolean(mech.besh)), quote: null },
      { label: "Ceiling (direct, per year)", value: money(mech.ceiling_direct_per_year), quote: quoteFor(prov, "mechanism.ceiling_direct_per_year") ?? quoteFor(prov, "mechanism.budget_notes") },
      { label: "Period (years)", value: fmt(mech.period_years), quote: quoteFor(prov, "mechanism.period_years") },
      { label: "Issuing IC", value: fmt(mech.issuing_ic), quote: null },
      { label: "Program division", value: fmt(mech.program_division), quote: null },
    ],
    eligibility: [
      { label: "ESI only", value: fmt(Boolean(elig.esi_only)), quote: quoteFor(prov, "eligibility.esi_only") },
      { label: "New investigator only", value: fmt(Boolean(elig.new_investigator_only)), quote: quoteFor(prov, "eligibility.new_investigator_only") },
      { label: "Clinician required", value: fmt(Boolean(elig.clinician_required)), quote: quoteFor(prov, "eligibility.clinician_required") },
      { label: "Degree required", value: fmt(elig.degree_required), quote: quoteFor(prov, "eligibility.degree_required") },
      { label: "Independent appointment required", value: fmt(Boolean(elig.independent_appointment_required)), quote: quoteFor(prov, "eligibility.independent_appointment_required") },
      { label: "Citizenship rule", value: fmt(elig.citizenship_rule), quote: quoteFor(prov, "eligibility.citizenship_rule") },
      { label: "Investigator rules (verbatim)", value: fmt(strList(elig.investigator_rules)), quote: quoteFor(prov, "eligibility.investigator_rules") },
    ],
    team: [
      { label: "Multi-PI allowed", value: team.multi_pi_allowed === null || team.multi_pi_allowed === undefined ? "not stated" : fmt(team.multi_pi_allowed), quote: quoteFor(prov, "team.multi_pi_allowed") },
      { label: "Consortium required", value: team.consortium_required === null || team.consortium_required === undefined ? "not stated" : fmt(team.consortium_required), quote: quoteFor(prov, "team.consortium_required") },
      { label: "Required partners", value: fmt(strList(team.required_partners)), quote: quoteFor(prov, "team.required_partners") },
    ],
    population: typeof p.population === "string" && p.population ? p.population : null,
    axes,
    topic: {
      terms: strList(p.topic?.terms),
      rcdc: strList(p.topic?.rcdc),
      mesh: strList(p.topic?.mesh),
      free_text: typeof p.topic?.free_text === "string" && p.topic.free_text ? p.topic.free_text : null,
    },
    non_responsive: strList(p.non_responsive),
    quotes: allQuotes(prov),
    sources: {
      facts: [
        { label: "Text read", value: fmt(s.text ?? p.sources?.text).replaceAll("_", " ") },
        { label: "Guide source", value: fmt(s.guide_source) },
        { label: "Sections · characters", value: s.sections === undefined ? "—" : `${s.sections} · ${new Intl.NumberFormat("en-US").format(s.chars ?? 0)}` },
        { label: "Exemplars (rows · classified · informative)", value: `${fmt(s.exemplar_count ?? p.sources?.exemplar_count ?? 0)} · ${fmt(s.exemplars_classified ?? "—")} · ${fmt(s.exemplars_informative ?? "—")}` },
        { label: "Blend (text · exemplar, n)", value: blend ? `${blend.text} · ${blend.exemplar} (n = ${blend.n})` : "—" },
        { label: "Extractor model", value: fmt(s.extract_model) },
        { label: "Exemplar model calls", value: fmt(s.exemplar_model_calls ?? 0) },
        { label: "Guide page hash", value: row.guide_html_hash ? row.guide_html_hash.slice(0, 12) : "— (built without Guide text)" },
      ],
      complete,
      incomplete,
      groups: (Array.isArray(s.groups) ? s.groups : []).map((g) => ({
        label: `Group ${g.group}${g.of > 1 ? ` · chunk ${g.chunk} of ${g.of}` : ""}`,
        cache: g.cache,
        model_called: Boolean(g.model_called),
        skipped: g.skipped ?? null,
        usable: g.usable ?? null,
        chars: g.chars ?? 0,
        dropped: strList(g.dropped),
      })),
      overlays_applied: strList(s.overlays_applied),
      overlay_notes: strList(s.overlay_notes),
      overrides_applied: strList(s.overrides_applied),
      merge_log: strList(s.merge_log),
      blend_log: strList(s.blend_log),
    },
  };
}

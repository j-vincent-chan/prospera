/**
 * Opportunity profile view model for `/opportunities/[id]/fit` (plan § PR
 * 1.6). Pure: takes the stored `opportunity_fit_profiles` row, returns what
 * the page renders. No Supabase, no fetch.
 *
 * What a reviewer needs to see (spec §6): required / required_any / allowed /
 * excluded per axis with the quote behind each (provenance is keyed by field
 * path; an entry's quote is the one on its own path or the nearest ancestor),
 * design prohibited, materials expected, human_required, the mechanism,
 * eligibility and team fields, needs_review, confidence, and the sources
 * (text source, exemplar counts, blend weights, complete / incomplete, the
 * per-group extraction log, overlays, merge and blend logs).
 */
import type { Axis } from "@/lib/fit/classify/contracts";
import type { OpportunityFitProfileRow, ProfileSources } from "@/lib/fit/profile/opportunity";
import type { Confidence, NoticeQuote, OpportunityFitProfile } from "@/lib/fit/types";
import { axisDescription, axisLabel, categoryDisplay, sortedWeights, type InspectAxis } from "@/lib/fit/inspect/labels";

export type QuoteView = { field: string; section: string; quote: string };

export type NoticeEntryView = {
  id: string;
  label: string;
  group: string | null;
  known: boolean;
  /** Weight for the weighted lists (paradigm, objective); null for the list axes. */
  weight: number | null;
  /** The verified quote on this entry's path or its nearest ancestor, if any. */
  quote: QuoteView | null;
};

export type NoticeListView = {
  /** `paradigm.required`, `design.prohibited`, … — the provenance path prefix. */
  path: string;
  label: string;
  /** How the engine reads the list, one line. */
  semantics: string;
  entries: NoticeEntryView[];
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

/** Pure. Every provenance entry as a row, sorted by field path. */
export function allQuotes(provenance: Record<string, NoticeQuote> | null | undefined): QuoteView[] {
  if (!provenance || typeof provenance !== "object") return [];
  return Object.entries(provenance)
    .filter((e): e is [string, NoticeQuote] => Boolean(e[1]) && typeof e[1] === "object" && typeof e[1].quote === "string")
    .map(([field, q]) => ({ field, section: typeof q.section === "string" ? q.section : "", quote: q.quote }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

function weighted(axis: InspectAxis, path: string, label: string, semantics: string, weights: Record<string, number | undefined> | null | undefined, provenance: OpportunityFitProfile["provenance"]): NoticeListView {
  return {
    path,
    label,
    semantics,
    entries: sortedWeights(weights).map(({ id, weight }) => {
      const d = categoryDisplay(axis, id);
      return { id, label: d.label, group: d.group, known: d.known, weight, quote: quoteFor(provenance, `${path}.${id}`) };
    }),
  };
}

function listed(axis: InspectAxis, path: string, label: string, semantics: string, ids: unknown, provenance: OpportunityFitProfile["provenance"]): NoticeListView {
  return {
    path,
    label,
    semantics,
    entries: strList(ids).map((id) => {
      const d = categoryDisplay(axis, id);
      return { id, label: d.label, group: d.group, known: d.known, weight: null, quote: quoteFor(provenance, `${path}.${id}`) };
    }),
  };
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

  const paradigmLists = [
    weighted("paradigm", "paradigm.required", "Required", "Weighted mean of support over these; the paradigm gate (stage 2).", paradigm.required, prov),
    weighted("paradigm", "paradigm.required_any", "Required — any of", "Any one satisfies it; support is the max over the set (D14).", paradigm.required_any, prov),
    weighted("paradigm", "paradigm.allowed", "Allowed", "Compatible but not required; exemplar-only categories land here (D21).", paradigm.allowed, prov),
    weighted("paradigm", "paradigm.excluded", "Excluded", "A dominant excluded paradigm caps the tier at Poor.", paradigm.excluded, prov),
  ];
  const unitLists = [
    listed("unit", "unit.required", "Required (all of)", "Every level here must be supported.", unit.required, prov),
    listed("unit", "unit.required_any", "Required — any of", "Any one level satisfies it.", unit.required_any, prov),
    listed("unit", "unit.allowed", "Allowed", "Compatible levels.", unit.allowed, prov),
  ];
  const designLists = [
    listed("design", "design.required_any", "Required — any of", "Any one design in the group satisfies it; all groups must be met.", design.required_any, prov),
    listed("design", "design.required_any_2", "Required — any of (second group)", "A second any-of group, when the notice has one.", design.required_any_2, prov),
    listed("design", "design.allowed", "Allowed", "Compatible designs.", design.allowed, prov),
    listed("design", "design.prohibited", "Prohibited", "Penalized when it is the investigator's dominant design.", design.prohibited, prov),
  ];
  const materialsLists = [
    listed("materials", "materials.required", "Required", "Every kind here must be supported.", materials.required, prov),
    listed("materials", "materials.required_any", "Required — any of", "Any one kind satisfies it.", materials.required_any, prov),
    listed("materials", "materials.expected", "Expected", "What the program expects applicants to work with.", materials.expected, prov),
  ];
  const objectiveLists = [weighted("objective", "objective", "Objective weights", "Scored as relevance; never gates.", p.objective, prov)];

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

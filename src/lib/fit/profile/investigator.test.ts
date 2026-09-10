/**
 * PR 1.4 · investigator fit profile: the aggregation math with fixtures (the
 * plan's 80/20 split, the thin-evidence cap, the recency half-life, recent vs
 * career, per-axis confidence by source origin, provenance top-n with the id
 * tie-break, a cross_cutting item), the modelBudget: 0 classification path
 * (with the deadline and an unusable reply), characteristics, aspirations,
 * the due predicate and its tiers, the cursor, the report, the builder and
 * the nightly sync over a fake Supabase client, the refresh hook, the MeSH
 * loader and the taxonomy accessors this PR added. No network, no database.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { InMemoryItemProfileCache, type ModelFn, type NormalizedItem } from "@/lib/fit/classify";
import type { CachedItemProfile } from "@/lib/fit/classify/cache";
import type { LlmClassification } from "@/lib/fit/classify/llm";
import { buildMeshIndex, resolveDescriptor, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import { loadMeshIndex, MESH_RANGE, resetMeshIndexCache } from "@/lib/fit/classify/mesh-db";
import { normalizeProfiles } from "@/lib/fit/classify/normalize";
import { DEFAULT_RULE_TABLES, type EvaluateContext } from "@/lib/fit/classify/rules";
import {
  aggregate,
  aggregateWithDiagnostics,
  aspirationCategoriesByLabel,
  aspirationCategoriesFromProfile,
  aspirationItemsOf,
  buildInvestigatorFitProfile,
  careerStageOf,
  characteristicsFrom,
  classifyWithBudget,
  clinicalRoleOf,
  confidenceAtLeast,
  CONFIDENCE_ORDER,
  confidenceFrom,
  coreProjectNumber,
  distinctOrigins,
  dominantParadigm,
  itemWeight,
  ModelBudget,
  profileRow,
  recencyWeight,
  roleFactor,
  splitDirectorySignals,
} from "@/lib/fit/profile/investigator";
import { rebuildFitProfileAfterRefresh } from "@/lib/fit/profile/refresh-hook";
import { formatProfileReport, summarizeProfile, summarizeRoster } from "@/lib/fit/profile/report";
import { compareDue, dueAfterCursor, profilesDue, profileSyncOutcome, syncInvestigatorFitProfiles } from "@/lib/fit/profile/sync";
import { confidenceThresholds, EVIDENCE_SOURCE_IDS, priorSources, provenanceTop, r01EquivalentCodes, recency, reliability, roleWeight, saturationExponent, sourceOrigin, TAXONOMY_VERSION, TaxonomyError, thinEvidence } from "@/lib/fit/taxonomy";
import type { EvidenceRole, EvidenceSource, InvestigatorFitProfile, ItemKind, ItemProfile } from "@/lib/fit/types";

const NOW = new Date("2026-09-05T12:00:00Z");
const INV = "00000000-0000-4000-8000-000000000001";
const index = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);
const rulesCtx: EvaluateContext = { mesh: index, tables: DEFAULT_RULE_TABLES };

// ---------------------------------------------------------------------------
// Fixture items
// ---------------------------------------------------------------------------

type ItemOpts = Partial<Omit<ItemProfile, "id">> & { id: string };

/** A rules-decided publication by a first author, this year, unless overridden; every axis it carries is marked decided. */
function item(opts: ItemOpts): ItemProfile {
  const axes = { paradigm: opts.paradigm ?? {}, unit: opts.unit ?? {}, design: opts.design ?? {}, materials: opts.materials ?? {}, objective: opts.objective ?? {} };
  const decided_by = opts.decided_by ?? Object.fromEntries((Object.keys(axes) as Array<keyof typeof axes>).filter((a) => Object.keys(axes[a]).length > 0).map((a) => [a, "rules" as const]));
  return {
    kind: "publication" as ItemKind,
    source: "pubmed_verified" as EvidenceSource,
    year: NOW.getUTCFullYear(),
    role: "first_last_corresponding" as EvidenceRole,
    taxonomy_version: TAXONOMY_VERSION,
    topic: { mesh: [], mesh_major: [], rcdc: [], terms: [] },
    confidence: "high",
    rules_fired: [],
    justification: {},
    ...opts,
    ...axes,
    decided_by,
  };
}

const pubs = (n: number, prefix: string, over: Partial<ItemProfile>) => Array.from({ length: n }, (_, i) => item({ id: `${prefix}${i + 1}`, ...over }));

// ---------------------------------------------------------------------------
// Aggregation math
// ---------------------------------------------------------------------------

describe("aggregate — the plan's 80/20 split", () => {
  it("turns an 80/20 evidence split into share^0.6 ≈ 0.87 / 0.38 (from taxonomy aggregation.saturation_exponent)", () => {
    // Ten first-author verified publications from this year, equal weight: eight
    // clinical_trials at 1.0, two translational at 1.0 → shares 0.8 and 0.2.
    const items = [...pubs(8, "ct", { paradigm: { clinical_trials: 1 } }), ...pubs(2, "tr", { paradigm: { translational: 1 } })];
    const p = aggregate(items, NOW);
    const sat = saturationExponent();
    expect(sat).toBe(0.6);
    // 0.8^0.6 = e^(0.6·ln 0.8) = 0.87469…; 0.2^0.6 = e^(0.6·ln 0.2) = 0.38073…
    expect(p.paradigm.career.clinical_trials).toBeCloseTo(Math.pow(0.8, sat), 4);
    expect(p.paradigm.career.translational).toBeCloseTo(Math.pow(0.2, sat), 4);
    expect(p.paradigm.career.clinical_trials).toBeCloseTo(0.8747, 3);
    expect(p.paradigm.career.translational).toBeCloseTo(0.3807, 3);
    // Both views agree when every item is recent.
    expect(p.paradigm.recent).toEqual(p.paradigm.career);
    expect(p.taxonomy_version).toBe(TAXONOMY_VERSION);
    expect(p.computed_at).toBe(NOW.toISOString());
  });

  it("weights shares by reliability × role × recency, not by count", () => {
    // One first-author paper (w = 1) against one middle-author paper (w = 0.5).
    const items = [item({ id: "a", paradigm: { epidemiology: 1 } }), item({ id: "b", paradigm: { animal_model: 1 }, role: "middle_author" })];
    const { diagnostics } = aggregateWithDiagnostics(items, NOW);
    const view = diagnostics.axes.paradigm.career;
    expect(view.mass).toBeCloseTo(1.5, 6);
    expect(view.categories.epidemiology!.share).toBeCloseTo(1 / 1.5, 4);
    expect(view.categories.animal_model!.share).toBeCloseTo(0.5 / 1.5, 4);
  });

  it("uses per-axis denominators: an item silent on an axis neither supports nor dilutes it", () => {
    const items = [item({ id: "a", paradigm: { epidemiology: 1 }, unit: { L4: 1 } }), item({ id: "b", paradigm: { epidemiology: 1 } }), item({ id: "c", paradigm: { epidemiology: 1 } })];
    const { profile, diagnostics } = aggregateWithDiagnostics(items, NOW);
    expect(diagnostics.axes.unit.career.items).toBe(1);
    expect(diagnostics.axes.unit.career.categories.L4!.share).toBe(1);
    // …but one item is thin evidence, so the weight is capped.
    expect(profile.unit.L4).toBe(thinEvidence().cap);
    expect(diagnostics.axes.paradigm.career.items).toBe(3);
  });
});

describe("aggregate — thin-evidence cap", () => {
  const thin = thinEvidence();

  it("caps a category supported by a single collaborative paper at thin_evidence.cap", () => {
    const items = [...pubs(3, "ct", { paradigm: { clinical_trials: 1 } }), item({ id: "solo", paradigm: { animal_model: 1 }, role: "middle_author" })];
    const { profile, diagnostics } = aggregateWithDiagnostics(items, NOW);
    const d = diagnostics.axes.paradigm.career.categories.animal_model!;
    expect(d.supporting_items).toBe(1);
    expect(d.capped).toBe(true);
    expect(Math.pow(d.share, saturationExponent())).toBeGreaterThan(thin.cap);
    expect(profile.paradigm.career.animal_model).toBe(thin.cap);
    expect(diagnostics.axes.paradigm.career.categories.clinical_trials!.capped).toBe(false);
  });

  it("lifts the cap at thin_evidence.min_items items, or at thin_evidence.min_grants grant", () => {
    const two = [...pubs(3, "ct", { paradigm: { clinical_trials: 1 } }), ...pubs(thin.min_items, "am", { paradigm: { animal_model: 1 } })];
    expect(aggregateWithDiagnostics(two, NOW).diagnostics.axes.paradigm.career.categories.animal_model!.capped).toBe(false);
    const grant = [...pubs(3, "ct", { paradigm: { clinical_trials: 1 } }), item({ id: "g", kind: "grant", source: "reporter", role: "contact_pi", paradigm: { animal_model: 1 } })];
    const d = aggregateWithDiagnostics(grant, NOW).diagnostics.axes.paradigm.career.categories.animal_model!;
    expect(d.supporting_grants).toBe(thin.min_grants);
    expect(d.capped).toBe(false);
  });

  it("does not let priors (Profiles, directory) lift the cap", () => {
    const items = [
      ...pubs(3, "ct", { paradigm: { clinical_trials: 1 } }),
      item({ id: "p", kind: "profiles_narrative", source: "profiles", role: null, year: null, paradigm: { epidemiology: 0.5 } }),
      item({ id: "d", kind: "directory", source: "directory_metadata", role: null, year: null, paradigm: { epidemiology: 0.5 } }),
    ];
    const d = aggregateWithDiagnostics(items, NOW).diagnostics.axes.paradigm.career.categories.epidemiology!;
    expect(d.supporting_items).toBe(0);
    expect(d.capped).toBe(true);
  });

  it("caps a lone self-declared Core rating, and lifts it once one verified item agrees", () => {
    const self = item({ id: "s", kind: "self_declared", source: "self_declared_current", role: null, paradigm: { clinical_trials: 1, clinical_observational: 1, interventional_clinical: 1 } });
    const alone = aggregateWithDiagnostics([self], NOW).diagnostics.axes.paradigm.career.categories.clinical_trials!;
    expect(alone.capped).toBe(true);
    const withPaper = aggregateWithDiagnostics([self, item({ id: "p", paradigm: { clinical_trials: 0.95 } })], NOW).diagnostics.axes.paradigm.career.categories.clinical_trials!;
    expect(withPaper.supporting_items).toBe(2);
    expect(withPaper.capped).toBe(false);
  });
});

describe("item weight — recency half-life, roles, reliability", () => {
  const r = recency();

  it("halves every half_life_years and never drops below the floor (taxonomy aggregation.recency)", () => {
    expect(recencyWeight(0, "publication")).toBe(1);
    expect(recencyWeight(r.half_life_years, "publication")).toBeCloseTo(0.5, 10);
    expect(recencyWeight(2 * r.half_life_years, "publication")).toBeCloseTo(0.25, 10);
    expect(recencyWeight(100, "publication")).toBe(r.floor);
    const year = NOW.getUTCFullYear();
    expect(itemWeight(item({ id: "a", year: year - r.half_life_years }), NOW).recency).toBeCloseTo(0.5, 10);
    expect(itemWeight(item({ id: "a", year: year + 3 }), NOW).age).toBe(0);
  });

  it("puts an undated publication at the floor and an undated current-state item at 1", () => {
    expect(itemWeight(item({ id: "a", year: null }), NOW).recency).toBe(r.floor);
    expect(itemWeight(item({ id: "s", kind: "self_declared", source: "self_declared_current", role: null, year: null }), NOW).recency).toBe(1);
    expect(itemWeight(item({ id: "b", kind: "biosketch_statement", source: "biosketch", role: null, year: null }), NOW).recent).toBe(true);
    expect(itemWeight(item({ id: "a", year: null }), NOW).recent).toBe(false);
  });

  it("reads role weights from taxonomy aggregation.role; missing roles are unknown on role-bearing kinds and 1 elsewhere", () => {
    expect(roleFactor({ kind: "publication", role: "middle_author" })).toBe(roleWeight("middle_author"));
    expect(roleFactor({ kind: "publication", role: null })).toBe(roleWeight("unknown"));
    expect(roleFactor({ kind: "trial", role: "trial_pi" })).toBe(roleWeight("trial_pi"));
    expect(roleFactor({ kind: "grant", role: "mpi" })).toBe(roleWeight("mpi"));
    expect(roleFactor({ kind: "biosketch_contribution", role: null })).toBe(1);
    expect(roleFactor({ kind: "self_declared", role: null })).toBe(1);
  });

  it("multiplies reliability × role × recency", () => {
    const w = itemWeight(item({ id: "t", kind: "trial", source: "ctgov_listed", role: "sub_investigator", year: NOW.getUTCFullYear() - r.half_life_years }), NOW);
    expect(w.weight).toBeCloseTo(reliability("ctgov_listed") * roleWeight("sub_investigator") * 0.5, 10);
  });
});

describe("aggregate — recent vs career views", () => {
  it("keeps a decade-old animal line in the career view and drops it from the recent view", () => {
    const year = NOW.getUTCFullYear();
    const old = pubs(6, "old", { paradigm: { animal_model: 1 }, year: year - 10 });
    const fresh = pubs(4, "new", { paradigm: { clinical_trials: 1 }, year: year - 1 });
    const { profile, diagnostics } = aggregateWithDiagnostics([...old, ...fresh], NOW);
    expect(profile.paradigm.career.animal_model).toBeGreaterThan(0);
    expect(profile.paradigm.career.clinical_trials).toBeGreaterThan(profile.paradigm.career.animal_model!);
    expect(profile.paradigm.recent.animal_model).toBeUndefined();
    expect(profile.paradigm.recent.clinical_trials).toBe(1);
    expect(diagnostics.recent_items).toBe(4);
    expect(dominantParadigm(profile.paradigm.career)?.category).toBe("clinical_trials");
  });

  it("recent view = items at most recency.recent_view_years old", () => {
    const year = NOW.getUTCFullYear();
    const edge = item({ id: "edge", paradigm: { epidemiology: 1 }, year: year - recency().recent_view_years });
    const past = item({ id: "past", paradigm: { epidemiology: 1 }, year: year - recency().recent_view_years - 1 });
    expect(itemWeight(edge, NOW).recent).toBe(true);
    expect(itemWeight(past, NOW).recent).toBe(false);
  });
});

describe("aggregate — confidence per axis", () => {
  const t = confidenceThresholds();

  it("pins the scale low < medium < high", () => {
    expect(CONFIDENCE_ORDER).toEqual(["low", "medium", "high"]);
    expect(confidenceAtLeast("medium", "low")).toBe(true);
    expect(confidenceAtLeast("low", "medium")).toBe(false);
    expect(confidenceAtLeast("high", "high")).toBe(true);
  });

  it("reads taxonomy aggregation.confidence: mass and distinct sources, both required", () => {
    expect(confidenceFrom(t.high_min_mass, t.high_min_sources)).toBe("high");
    expect(confidenceFrom(t.high_min_mass, t.high_min_sources - 1)).toBe("medium");
    expect(confidenceFrom(t.medium_min_mass, t.medium_min_sources)).toBe("medium");
    expect(confidenceFrom(t.medium_min_mass - 0.01, t.high_min_sources)).toBe("low");
    expect(confidenceFrom(100, 1)).toBe("low");
  });

  it("counts distinct source ORIGINS (taxonomy aggregation.source_origin): both CT.gov roles are one source and a prior never counts", () => {
    const year = NOW.getUTCFullYear();
    const trials = [
      ...Array.from({ length: t.medium_min_mass + 1 }, (_, i) => item({ id: `pi${i}`, kind: "trial", source: "ctgov_pi", role: "trial_pi", paradigm: { clinical_trials: 1 }, year })),
      item({ id: "listed", kind: "trial", source: "ctgov_listed", role: "sub_investigator", paradigm: { clinical_trials: 1 }, year }),
    ];
    const one = aggregateWithDiagnostics(trials, NOW);
    expect(one.diagnostics.axes.paradigm.career.sources.sort()).toEqual(["ctgov_listed", "ctgov_pi"]);
    expect(one.diagnostics.axes.paradigm.career.origins).toEqual(["ctgov"]);
    expect(one.diagnostics.axes.paradigm.career.mass).toBeGreaterThanOrEqual(t.medium_min_mass);
    expect(one.profile.confidence.paradigm).toBe("low");
    // A verified publication is a second origin → medium.
    const two = aggregateWithDiagnostics([...trials, item({ id: "p", paradigm: { clinical_trials: 1 }, year })], NOW);
    expect(two.diagnostics.axes.paradigm.career.origins.sort()).toEqual(["ctgov", "pubmed"]);
    expect(two.profile.confidence.paradigm).toBe("medium");
    // Profiles and the directory are priors: they never make a third source, however much mass there is.
    const priors = [
      item({ id: "prof", kind: "profiles_narrative", source: "profiles", role: null, year: null, paradigm: { clinical_trials: 1 } }),
      item({ id: "dir", kind: "directory", source: "directory_metadata", role: null, year: null, paradigm: { clinical_trials: 1 } }),
    ];
    const three = aggregateWithDiagnostics([...trials, ...Array.from({ length: t.high_min_mass }, (_, i) => item({ id: `p${i}`, paradigm: { clinical_trials: 1 }, year })), ...priors], NOW);
    expect(three.diagnostics.axes.paradigm.career.mass).toBeGreaterThanOrEqual(t.high_min_mass);
    expect(three.diagnostics.axes.paradigm.career.origins.sort()).toEqual(["ctgov", "pubmed"]);
    expect(three.profile.confidence.paradigm).toBe("medium");
    expect(distinctOrigins(["profiles", "directory_metadata"])).toEqual([]);
    expect(distinctOrigins(["ctgov_pi", "ctgov_listed", "reporter", "biosketch"]).sort()).toEqual(["biosketch", "ctgov", "reporter"]);
  });

  it("fills all six keys, per axis from that axis's decided mass and sources", () => {
    const year = NOW.getUTCFullYear();
    const items = [
      ...pubs(t.high_min_mass, "p", { paradigm: { clinical_trials: 1 }, unit: { L3: 1 }, year }),
      item({ id: "g", kind: "grant", source: "reporter", role: "contact_pi", paradigm: { clinical_trials: 1 }, year }),
      item({ id: "t", kind: "trial", source: "ctgov_pi", role: "trial_pi", paradigm: { clinical_trials: 1 }, year }),
    ];
    const p = aggregate(items, NOW);
    expect(Object.keys(p.confidence).sort()).toEqual(["design", "materials", "objective", "paradigm", "topic", "unit"]);
    expect(p.confidence.paradigm).toBe("high");
    // Unit: the same mass but one source.
    expect(p.confidence.unit).toBe("low");
    expect(p.confidence.design).toBe("low");
    expect(p.confidence.topic).toBe("low");
  });

  it("topic confidence counts items carrying MeSH, RCDC or model terms", () => {
    const items = pubs(t.medium_min_mass, "p", { paradigm: { clinical_trials: 1 }, topic: { mesh: ["D006801"], mesh_major: ["D006801"], rcdc: [], terms: [] } });
    items.push(item({ id: "g", kind: "grant", source: "reporter", role: "contact_pi", topic: { mesh: [], mesh_major: [], rcdc: ["Lupus"], terms: [] } }));
    const p = aggregate(items, NOW, { meshTreeNumbers: (ui) => (ui === "D006801" ? ["B01.050.150.900.649.313.988.400.112.400.400"] : null) });
    expect(p.confidence.topic).toBe("medium");
    expect(p.topic.mesh_major).toEqual(["B01.050.150.900.649.313.988.400.112.400.400"]);
    expect(p.topic.rcdc).toEqual(["Lupus"]);
    expect(p.topic.free_text).toBeNull();
  });
});

describe("aggregate — provenance and a cross_cutting item", () => {
  it("keeps the top aggregation.provenance_top item ids per (axis, category), by weight × probability", () => {
    const year = NOW.getUTCFullYear();
    const top = provenanceTop();
    expect(top).toBe(3);
    const items = [
      item({ id: "strong-new", paradigm: { epidemiology: 0.9 }, year }),
      item({ id: "weak-new", paradigm: { epidemiology: 0.3 }, year }),
      item({ id: "strong-old", paradigm: { epidemiology: 0.95 }, year: year - 20 }),
      item({ id: "middle-new", paradigm: { epidemiology: 0.9 }, role: "middle_author", year }),
      item({ id: "other", paradigm: { animal_model: 1 }, design: { animal_in_vivo: 1 }, year }),
    ];
    const p = aggregate(items, NOW);
    const epi = p.provenance.find((x) => x.axis === "paradigm" && x.category === "epidemiology");
    expect(epi?.top_items).toHaveLength(top);
    // 0.9 · 1 > 0.9 · 0.5 > 0.3 · 1 > 0.95 · 0.15
    expect(epi?.top_items).toEqual(["strong-new", "middle-new", "weak-new"]);
    expect(p.provenance.find((x) => x.axis === "design" && x.category === "animal_in_vivo")?.top_items).toEqual(["other"]);
    expect(p.provenance.every((x) => x.top_items.length <= top)).toBe(true);
  });

  it("breaks provenance ties by id, so a rerun over the same evidence is byte-identical", () => {
    const items = [item({ id: "pub:b", paradigm: { epidemiology: 0.8 } }), item({ id: "pub:a", paradigm: { epidemiology: 0.8 } }), item({ id: "pub:c", paradigm: { epidemiology: 0.8 } }), item({ id: "pub:d", paradigm: { epidemiology: 0.8 } })];
    const p = aggregate(items, NOW);
    expect(p.provenance.find((x) => x.axis === "paradigm" && x.category === "epidemiology")?.top_items).toEqual(["pub:a", "pub:b", "pub:c"]);
    expect(aggregate([...items].reverse(), NOW).provenance).toEqual(p.provenance);
  });

  it("aggregates a cross_cutting category like any other (no matrix lookup)", () => {
    const items = [...pubs(3, "c", { paradigm: { computational_data_science: 1 }, unit: { L1: 0.6, L4: 0.6 } }), item({ id: "m", paradigm: { molecular_cellular_mechanistic: 1 } })];
    const p = aggregate(items, NOW);
    expect(p.paradigm.career.computational_data_science).toBeCloseTo(Math.pow(0.75, saturationExponent()), 4);
    const d = dominantParadigm(p.paradigm.career);
    expect(d).toMatchObject({ category: "computational_data_science", family: "cross_cutting" });
  });

  it("stores weights largest first, drops zeros, rounds to 4 decimals", () => {
    const p = aggregate([item({ id: "a", paradigm: { epidemiology: 0.3333333, animal_model: 0.7777777 } })], NOW);
    expect(Object.keys(p.paradigm.career)).toEqual(["animal_model", "epidemiology"]);
    for (const v of Object.values(p.paradigm.career)) expect(String(v).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it("builds the evidence summary from kinds and roles, and takes the context's aspirations, do_not_suggest and characteristics", () => {
    const items = [
      ...pubs(2, "p", { paradigm: { clinical_trials: 1 } }),
      item({ id: "g", kind: "grant", source: "reporter", role: "contact_pi", paradigm: { clinical_trials: 1 } }),
      item({ id: "t1", kind: "trial", source: "ctgov_pi", role: "trial_pi", paradigm: { clinical_trials: 1 } }),
      item({ id: "t2", kind: "trial", source: "ctgov_listed", role: "sub_investigator", paradigm: { clinical_trials: 1 } }),
      item({ id: "b", kind: "biosketch_statement", source: "biosketch", role: null, paradigm: { clinical_trials: 1 } }),
    ];
    const p = aggregate(items, NOW, { investigator_id: INV, aspirations: ["implementation_science", "implementation_science"], do_not_suggest: ["preclinical"], characteristics: { mechanisms_held: ["R01"], trial_pi_count: 1 } });
    expect(p.investigator_id).toBe(INV);
    expect(p.evidence_summary).toEqual({ publications_verified: 2, grants: 1, trials: 2, trials_as_pi: 1, biosketch: "on_file", self_declared: false });
    expect(p.aspirations).toEqual(["implementation_science"]);
    expect(p.do_not_suggest).toEqual(["preclinical"]);
    expect(p.characteristics.mechanisms_held).toEqual(["R01"]);
    expect(p.characteristics.career_stage).toBeNull();
    expect(p.collaborators).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// modelBudget: 0 — rules and cache only
// ---------------------------------------------------------------------------

const PROSE = "We conducted a retrospective cohort study using electronic health records from an integrated health system to estimate the hazard of myocardial infarction by statin adherence.";

function normalized(over: Partial<NormalizedItem> = {}): NormalizedItem {
  return { id: `publication:${INV}:1`, kind: "publication", title: "t", text: PROSE, year: 2024, role: "first_last_corresponding", mesh: [], publication_types: [], signals: {}, ...over };
}

const llmReply = { paradigm: { epidemiology: 0.85 }, unit: { L4: 0.9 }, design: { ehr_analysis: 0.9 }, materials: { ehr: 0.95 }, objective: { etiology_risk_factors: 0.7 }, topic_terms: ["statin adherence"], justification: { paradigm: "cohort" }, confidence: "high" };

const cachedLlm = (over: Partial<LlmClassification> = {}): LlmClassification => ({
  axes: { paradigm: { clinical_observational: 0.8 }, unit: { L4: 0.9 } },
  confidence: "high",
  halved: false,
  topic_terms: ["cached"],
  justification: {},
  dropped: [],
  model: "m",
  raw: {},
  ...over,
});

function stubModel(reply?: unknown): { fn: ModelFn; calls: number } {
  const s = { calls: 0, fn: (async () => "") as ModelFn };
  s.fn = async () => {
    s.calls += 1;
    if (reply === undefined) throw new Error("model must not be called");
    return JSON.stringify(reply);
  };
  return s;
}

describe("classifyWithBudget — modelBudget: 0 never calls the model", () => {
  it("rules-only items need no model and no cache", async () => {
    const cache = new InMemoryItemProfileCache();
    const model = stubModel();
    const r = await classifyWithBudget(normalized({ text: null }), { rulesCtx, cache, budget: new ModelBudget(0), model: model.fn });
    expect(r).toMatchObject({ model_needed: false, model_called: false, model_skipped: false, cache: "disabled" });
    expect(cache.reads).toBe(0);
    expect(model.calls).toBe(0);
  });

  it("skips the model when it is needed, nothing is cached and the budget is 0 — rule-free axes stay empty", async () => {
    const cache = new InMemoryItemProfileCache();
    const model = stubModel();
    const r = await classifyWithBudget(normalized(), { rulesCtx, cache, budget: new ModelBudget(0), model: model.fn });
    expect(r).toMatchObject({ model_needed: true, model_called: false, model_skipped: true, cache: "miss" });
    expect(r.profile.paradigm).toEqual({});
    expect(r.profile.decided_by.paradigm).toBeUndefined();
    expect(model.calls).toBe(0);
    expect(cache.writes).toBe(0);
  });

  it("serves a cached model output without a call, merged under the rules", async () => {
    const cache = new InMemoryItemProfileCache();
    const item = normalized();
    const { itemCacheKey } = await import("@/lib/fit/classify");
    const row: CachedItemProfile = { content_hash: itemCacheKey(item), kind: "publication", ref_id: item.id, taxonomy_version: TAXONOMY_VERSION, rules: null, llm: cachedLlm(), merged: {} as ItemProfile, llm_model: "m", created_at: NOW.toISOString() };
    await cache.set(row);
    const model = stubModel();
    const r = await classifyWithBudget(item, { rulesCtx, cache, budget: new ModelBudget(0), model: model.fn });
    expect(r).toMatchObject({ model_needed: true, model_called: false, model_skipped: false, cache: "hit" });
    expect(r.profile.paradigm).toEqual({ clinical_observational: 0.8 });
    expect(r.profile.decided_by.paradigm).toBe("llm");
    expect(model.calls).toBe(0);
  });

  it("ignores a cached reply marked unusable and, with no budget, skips", async () => {
    const cache = new InMemoryItemProfileCache();
    const item = normalized();
    const { itemCacheKey } = await import("@/lib/fit/classify");
    await cache.set({ content_hash: itemCacheKey(item), kind: "publication", ref_id: item.id, taxonomy_version: TAXONOMY_VERSION, rules: null, llm: cachedLlm({ usable: false }), merged: {} as ItemProfile, llm_model: "m", created_at: NOW.toISOString() });
    const r = await classifyWithBudget(item, { rulesCtx, cache, budget: new ModelBudget(0), model: stubModel().fn });
    expect(r.model_skipped).toBe(true);
  });

  it("past the deadline, skips without spending the budget even when calls are left", async () => {
    const cache = new InMemoryItemProfileCache();
    const model = stubModel();
    const budget = new ModelBudget(5);
    const r = await classifyWithBudget(normalized(), { rulesCtx, cache, budget, model: model.fn, deadline: Date.now() - 1 });
    expect(r).toMatchObject({ model_needed: true, model_called: false, model_skipped: true, model_unusable: false, cache: "miss" });
    expect(r.model_reason).toContain("deadline passed");
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(5);
    expect(model.calls).toBe(0);
    // A far-off deadline changes nothing.
    const ok = await classifyWithBudget(normalized(), { rulesCtx, cache, budget, model: stubModel(llmReply).fn, modelName: "m", deadline: Date.now() + 60_000 });
    expect(ok.model_called).toBe(true);
    expect(budget.used).toBe(1);
  });

  it("a reply that cannot be read counts the call, caches nothing and leaves the item pending", async () => {
    const cache = new InMemoryItemProfileCache();
    const budget = new ModelBudget(2);
    const broken: ModelFn = async () => ({ content: "not json at all", finish_reason: "stop" });
    const r = await classifyWithBudget(normalized(), { rulesCtx, cache, budget, model: broken, modelName: "m" });
    expect(r).toMatchObject({ model_needed: true, model_called: true, model_skipped: true, model_unusable: true });
    expect(r.profile.paradigm).toEqual({});
    expect(cache.writes).toBe(0);
    expect(budget.used).toBe(1);
  });

  it("a model call that throws leaves the item pending with the message, counts the call, and does not throw", async () => {
    const cache = new InMemoryItemProfileCache();
    const budget = new ModelBudget(2);
    const failing: ModelFn = async () => {
      throw new Error("429 rate limited");
    };
    const r = await classifyWithBudget(normalized(), { rulesCtx, cache, budget, model: failing, modelName: "m" });
    expect(r).toMatchObject({ model_needed: true, model_called: true, model_skipped: true, model_unusable: false, cache: "miss" });
    expect(r.model_error).toBe("429 rate limited");
    expect(r.model_reason).toContain("model call failed");
    expect(r.profile.paradigm).toEqual({});
    expect(cache.writes).toBe(0);
    expect(budget.used).toBe(1);
  });

  it("with a budget, calls the model through classifyItem once per item and writes the cache; the budget is shared", async () => {
    const cache = new InMemoryItemProfileCache();
    const model = stubModel(llmReply);
    const budget = new ModelBudget(1);
    const a = await classifyWithBudget(normalized({ id: "a" }), { rulesCtx, cache, budget, model: model.fn, modelName: "m" });
    expect(a).toMatchObject({ model_needed: true, model_called: true, model_skipped: false });
    expect(a.profile.paradigm).toEqual({ epidemiology: 0.85 });
    expect(budget.used).toBe(1);
    expect(budget.exhausted).toBe(true);
    expect(cache.writes).toBe(1);
    const b = await classifyWithBudget(normalized({ id: "b", text: `${PROSE} Different text.` }), { rulesCtx, cache, budget, model: model.fn, modelName: "m" });
    expect(b.model_skipped).toBe(true);
    expect(model.calls).toBe(1);
    // The same text again is a cache hit without a budget.
    const again = await classifyWithBudget(normalized({ id: "a2" }), { rulesCtx, cache, budget, model: model.fn, modelName: "m" });
    expect(again.cache).toBe("hit");
    expect(model.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Characteristics, aspirations, directory split
// ---------------------------------------------------------------------------

describe("characteristicsFrom", () => {
  const inv = { id: INV, rank: "Associate Professor", title_series: "Clinical X", degrees: ["MD", "PhD"] };
  const grants = [
    { id: "g1", project_num: "5R01AI000001-03", fiscal_year: 2026, activity_code: "R01", raw_json: { agency_code: "NIH", project_end_date: "2028-06-30" } },
    { id: "g2", project_num: "4R01AI000001-02", fiscal_year: 2025, activity_code: "R01", raw_json: { agency_code: "NIH", project_end_date: "2028-06-30" } },
    { id: "g3", project_num: "5K23AI000002-05", fiscal_year: 2019, activity_code: "K23", raw_json: { agency_code: "NIH", project_end_date: "2020-06-30" } },
    { id: "g4", project_num: "1U01AI000003-01", fiscal_year: 2026, activity_code: "U01", raw_json: { agency_code: "NIH" } },
  ];
  const trials = [
    { investigator_id: INV, nct_id: "NCT1", investigator_role: "PRINCIPAL_INVESTIGATOR" },
    { investigator_id: INV, nct_id: "NCT2", investigator_role: "LISTED" },
  ];

  it("derives mechanisms held, distinct active awards, ESI, clinical role and career stage", () => {
    const c = characteristicsFrom({ investigator: inv, grants, trials, now: NOW });
    expect(c.mechanisms_held).toEqual(["K23", "R01", "U01"]);
    expect(c.active_awards).toBe(2); // R01AI000001 (two fiscal years, one core) + U01 (fiscal year within a year)
    expect(c.esi).toBe(false);
    expect(c.trial_pi_count).toBe(1);
    expect(c.clinical_role).toBe("md_clinician_investigator");
    expect(c.career_stage).toBe("mid");
    expect(c.degrees).toEqual(["MD", "PhD"]);
    expect(c.title_series).toBe("Clinical X");
  });

  it("only a literal NIH agency_code establishes mechanisms and ESI; the award still counts as active", () => {
    const nonNih = [
      { id: "n1", project_num: "1R01HS000001-01", fiscal_year: 2026, activity_code: "R01", raw_json: { agency_code: "AHRQ", project_end_date: "2028-06-30" } },
      { id: "n2", project_num: "1U01CE000002-01", fiscal_year: 2026, activity_code: "U01", raw_json: { agency_code: "CDC", project_end_date: "2028-06-30" } },
      { id: "n3", project_num: "1R01AI000003-01", fiscal_year: 2026, activity_code: "R01", raw_json: { project_end_date: "2028-06-30" } },
    ];
    const c = characteristicsFrom({ investigator: inv, grants: nonNih, trials: [], now: NOW });
    expect(c.mechanisms_held).toEqual([]);
    expect(c.esi).toBeNull();
    expect(c.active_awards).toBe(3);
  });

  it("counts distinct whole-study trial PI roles; chairs and directors do not lead the study", () => {
    const roles = [
      { investigator_id: INV, nct_id: "NCT1", investigator_role: "PRINCIPAL_INVESTIGATOR" },
      { investigator_id: INV, nct_id: "NCT1", investigator_role: "RESPONSIBLE_PARTY_PI" },
      { investigator_id: INV, nct_id: "NCT2", investigator_role: "STUDY_CHAIR" },
      { investigator_id: INV, nct_id: "NCT3", investigator_role: "STUDY_DIRECTOR" },
      { investigator_id: INV, nct_id: "NCT4", investigator_role: "RESPONSIBLE_PARTY_PI" },
    ];
    expect(characteristicsFrom({ investigator: inv, grants: [], trials: roles, now: NOW }).trial_pi_count).toBe(2);
  });

  it("leaves ESI null without an R01-equivalent and clinical role null without degrees", () => {
    const c = characteristicsFrom({ investigator: { id: INV }, grants: [grants[2]!], trials: [], now: NOW });
    expect(c.esi).toBeNull();
    expect(c.clinical_role).toBeNull();
    expect(c.career_stage).toBeNull();
    expect(c.active_awards).toBe(0);
  });

  it("vocabularies", () => {
    expect(careerStageOf("Assistant Professor")).toBe("early");
    expect(careerStageOf("Professor in Residence")).toBe("senior");
    expect(careerStageOf("Postdoctoral Scholar")).toBe("trainee");
    expect(careerStageOf("Staff")).toBeNull();
    expect(clinicalRoleOf({ degrees: ["M.D."], title_series: "In Residence", trial_pi_count: 0 })).toBe("md_investigator");
    expect(clinicalRoleOf({ degrees: ["MD"], title_series: "In Residence", trial_pi_count: 2 })).toBe("md_clinician_investigator");
    expect(clinicalRoleOf({ degrees: ["PhD"], title_series: null, trial_pi_count: 0 })).toBe("phd_investigator");
    expect(clinicalRoleOf({ degrees: ["MPH"], title_series: null, trial_pi_count: 0 })).toBe("other");
    expect(coreProjectNumber("5R01AI000001-03S1")).toBe("R01AI000001");
    expect(coreProjectNumber(null)).toBeNull();
  });
});

describe("aspirations (D5)", () => {
  it("matches category labels, ids and aliases as whole phrases; a family label maps to its categories", () => {
    expect(aspirationCategoriesByLabel("implementation science")).toEqual(["implementation_science"]);
    expect(aspirationCategoriesByLabel("Moving toward clinical trials of biologics")).toEqual(["clinical_trials"]);
    expect(aspirationCategoriesByLabel("genetic epidemiology and GWAS")).toEqual(["epidemiology", "genetic_epidemiology"]);
    expect(aspirationCategoriesByLabel("population")).toEqual(["epidemiology", "genetic_epidemiology", "population_health", "public_health", "community_based", "behavioral"]);
    expect(aspirationCategoriesByLabel("something else entirely")).toEqual([]);
    expect(aspirationCategoriesByLabel("")).toEqual([]);
  });

  it("takes the top category of a classified aspiration, ties kept", () => {
    expect(aspirationCategoriesFromProfile({ paradigm: { epidemiology: 0.5, health_services: 0.9 } })).toEqual(["health_services"]);
    expect(aspirationCategoriesFromProfile({ paradigm: { epidemiology: 0.9, health_services: 0.9 } })).toEqual(["epidemiology", "health_services"]);
    expect(aspirationCategoriesFromProfile({ paradigm: {} })).toEqual([]);
  });

  it("makes one self-declared-kind item per aspiration, text = the direction", () => {
    const items = aspirationItemsOf({ id: INV, aspirations: ["implementation science", " ", "trials"] });
    expect(items.map((i) => i.id)).toEqual([`aspiration:${INV}:1`, `aspiration:${INV}:2`]);
    expect(items[0]).toMatchObject({ kind: "self_declared", text: "implementation science", signals: { source: "self_declared_current", aspiration: true } });
  });
});

describe("splitDirectorySignals", () => {
  it("moves department and division off the Profiles item, keeping title_series", () => {
    const p = normalizeProfiles(null, { id: INV, title_series: "Clinical X", home_department: "Epidemiology & Biostatistics", division: "Rheumatology" });
    const split = splitDirectorySignals(p);
    expect(split.signals.department).toBeUndefined();
    expect(split.signals.division).toBeUndefined();
    expect(split.signals.title_series).toBe("Clinical X");
    expect(p.signals.department).toBe("Epidemiology & Biostatistics");
  });
});

// ---------------------------------------------------------------------------
// Due predicate
// ---------------------------------------------------------------------------

describe("profilesDue", () => {
  const now = NOW;
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const roster = [
    { id: "b", updated_at: iso(30) },
    { id: "a", updated_at: iso(30) },
    { id: "c", updated_at: iso(30) },
    { id: "d", updated_at: iso(1) },
    { id: "e", updated_at: iso(30) },
    { id: "f", updated_at: iso(30) },
  ];
  const profiles = [
    { investigator_id: "b", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(2) },
    { investigator_id: "c", taxonomy_version: "fit-v0", computed_at: iso(2) },
    { investigator_id: "d", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(2) },
    { investigator_id: "e", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(2) },
    { investigator_id: "f", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(10) },
  ];
  const sources = [
    { investigator_id: "e", last_refreshed_at: iso(1) },
    { investigator_id: "b", last_refreshed_at: iso(5) },
  ];

  it("lists never-built, old-taxonomy, source-refreshed, directory-updated and stale investigators with the reason, by tier then id", () => {
    expect(profilesDue(roster, profiles, sources, { now })).toEqual([
      { id: "a", reason: "no_profile" },
      { id: "c", reason: "taxonomy_version" },
      { id: "d", reason: "investigator_updated" },
      { id: "e", reason: "sources_refreshed" },
      { id: "f", reason: "stale" },
    ]);
  });

  it("force makes everyone due; refreshDays moves the stale line", () => {
    expect(profilesDue(roster, profiles, sources, { now, force: true }).map((d) => d.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(profilesDue(roster, profiles, sources, { now, refreshDays: 1 }).map((d) => d.reason)).toContain("stale");
    expect(profilesDue(roster, profiles, sources, { now, refreshDays: 30 }).find((d) => d.id === "f")).toBeUndefined();
  });

  it("a partial profile (pending_items > 0) is due as `pending`, in the first tier, ahead of a stale row with a smaller id", () => {
    const withPending = [...profiles, { investigator_id: "g", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(1), pending_items: 3 }];
    const due = profilesDue([...roster, { id: "g", updated_at: iso(30) }], withPending, sources, { now });
    expect(due.map((d) => `${d.id}:${d.reason}`)).toEqual(["a:no_profile", "c:taxonomy_version", "g:pending", "d:investigator_updated", "e:sources_refreshed", "f:stale"]);
    // A stale-and-refreshed row is labelled with the more urgent reason.
    const both = profilesDue([{ id: "h", updated_at: iso(30) }], [{ investigator_id: "h", taxonomy_version: TAXONOMY_VERSION, computed_at: iso(10), pending_items: 0 }], [{ investigator_id: "h", last_refreshed_at: iso(1) }], { now });
    expect(both).toEqual([{ id: "h", reason: "sources_refreshed" }]);
    expect(compareDue({ id: "z", reason: "no_profile" }, { id: "a", reason: "stale" })).toBeLessThan(0);
    expect(compareDue({ id: "b", reason: "pending" }, { id: "a", reason: "taxonomy_version" })).toBeGreaterThan(0);
  });

  it("a row computed at the same instant as the newest refresh or the record's update is not due (strictly older only)", () => {
    const at = iso(3);
    const stamps = [{ investigator_id: "s", taxonomy_version: TAXONOMY_VERSION, computed_at: at, pending_items: 0 }];
    expect(profilesDue([{ id: "s", updated_at: at }], stamps, [{ investigator_id: "s", last_refreshed_at: at }], { now })).toEqual([]);
    expect(profilesDue([{ id: "s", updated_at: at }], stamps, [{ investigator_id: "s", last_refreshed_at: new Date(Date.parse(at) + 1).toISOString() }], { now })).toEqual([{ id: "s", reason: "sources_refreshed" }]);
  });

  it("dueAfterCursor resumes after the cursor's position in the ordering, or after its id when it is no longer due", () => {
    const due = [
      { id: "b", reason: "no_profile" as const },
      { id: "c", reason: "pending" as const },
      { id: "a", reason: "stale" as const },
    ];
    expect(dueAfterCursor(due, null)).toEqual(due);
    expect(dueAfterCursor(due, "c").map((d) => d.id)).toEqual(["a"]);
    expect(dueAfterCursor(due, "b").map((d) => d.id)).toEqual(["c", "a"]);
    // A cursor that is no longer due (finished since) restarts from the top: the tiered order puts pending rows first.
    expect(dueAfterCursor(due, "bb")).toEqual(due);
    expect(dueAfterCursor(due, "zz")).toEqual(due);
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("report", () => {
  const year = NOW.getUTCFullYear();
  const clinician = aggregateWithDiagnostics(
    [...pubs(6, "c", { paradigm: { clinical_trials: 1 }, design: { rct: 0.9 } }), ...pubs(2, "t", { paradigm: { translational: 1 }, design: { biospecimen_assay: 0.8 } }), item({ id: "g", kind: "grant", source: "reporter", role: "contact_pi", paradigm: { clinical_trials: 1 } })],
    NOW,
    { investigator_id: "inv-1", aspirations: ["implementation_science"] }
  );
  const mouse = aggregateWithDiagnostics([...pubs(5, "m", { paradigm: { animal_model: 1 }, design: { animal_in_vivo: 1 }, year: year - 12 }), item({ id: "solo", paradigm: { clinical_observational: 1 }, role: "middle_author" })], NOW, { investigator_id: "inv-2" });

  it("summarizes dominant paradigm (career / recent), top designs, evidence counts, confidence and thin evidence", () => {
    const line = summarizeProfile(clinician.profile, { name: "Dr. Clinician", diagnostics: clinician.diagnostics, model: { needed: 3, called: 0, skipped: 3, cache_hits: 0 }, incomplete: true });
    expect(line.dominant_career?.category).toBe("clinical_trials");
    expect(line.dominant_recent?.category).toBe("clinical_trials");
    expect(line.top_designs.map((d) => d.id)).toEqual(["rct", "biospecimen_assay"]);
    expect(line.evidence).toMatchObject({ publications_verified: 8, grants: 1, trials: 0 });
    expect(line.thin).toBe(false);
    expect(line.thin_exact).toBe(true);
    expect(line.item_count).toBe(9);
    expect(line.incomplete).toBe(true);
    expect(line.aspirations).toEqual(["implementation_science"]);
    const solo = summarizeProfile(mouse.profile, { diagnostics: mouse.diagnostics });
    expect(solo.dominant_career?.category).toBe("animal_model");
    expect(solo.dominant_recent?.category).toBe("clinical_observational");
    expect(solo.thin).toBe(false);
    // From a stored profile alone the cap is approximated from provenance.
    const stored = summarizeProfile({ ...mouse.profile, paradigm: { career: { clinical_observational: 0.3 }, recent: {} }, provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: ["solo"] }] });
    expect(stored.thin).toBe(true);
    expect(stored.thin_exact).toBe(false);
  });

  it("roster summary: distributions, moved families, thin share, confidence per axis; prints without crashing, even empty", () => {
    const lines = [summarizeProfile(clinician.profile, { name: "A", diagnostics: clinician.diagnostics }), summarizeProfile(mouse.profile, { name: "B", diagnostics: mouse.diagnostics })];
    const s = summarizeRoster(lines);
    expect(s.investigators).toBe(2);
    expect(s.dominant_career_families.map((d) => d.id)).toEqual(["clinical", "preclinical"]);
    expect(s.dominant_recent_families).toEqual([{ id: "clinical", count: 2, share: 1 }]);
    expect(s.moved_family).toBe(1);
    expect(s.thin).toEqual({ count: 0, share: 0, exact: true });
    expect(s.confidence.paradigm.low + s.confidence.paradigm.medium + s.confidence.paradigm.high).toBe(2);
    const text = formatProfileReport(lines, s);
    expect(text).toContain("A\n  items 9 · career clinical_trials");
    expect(text).toContain("## Roster summary");
    expect(formatProfileReport([])).toContain("investigators 0");
  });
});

// ---------------------------------------------------------------------------
// The builder over a fake Supabase client — modelBudget: 0, nothing written
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Write = { table: string; op: "upsert" | "insert" | "update"; row: Row };
type FakeOptions = {
  /** Return a message to fail a read of `table` carrying these eq filters (per-investigator error isolation). */
  fail?: (table: string, eqs: Array<[string, unknown]>) => string | null;
  /** Observe every `range(from, to)` read (the MeSH loader's parallel ranges). */
  onRange?: (table: string, from: number, to: number) => void;
};

/**
 * The narrowest PostgREST builder the profile modules use: select (incl. a
 * head count) → eq / neq / in / is / gt / or → order → range | maybeSingle |
 * limit | await; insert → select → single; update → eq → await; upsert.
 * A table absent from `tables` answers with PostgREST's missing-table
 * message, the way an unapplied migration does. Writes are recorded, never
 * applied.
 */
function fakeDb(tables: Record<string, Row[]>, writes: Write[] = [], opts: FakeOptions = {}): SupabaseClient {
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const eqs: Array<[string, unknown]> = [];
    let mode: "select" | "count" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const q: Record<string, unknown> = {};
    const apply = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const error = (): { message: string } | null => {
      if (!(table in tables)) return { message: `Could not find the table 'public.${table}' in the schema cache` };
      const injected = opts.fail?.(table, eqs);
      return injected ? { message: injected } : null;
    };
    const result = (): { data: unknown; error: { message: string } | null; count?: number | null } => {
      const err = error();
      if (err) return { data: null, error: err };
      if (mode === "count") return { data: null, error: null, count: apply().length };
      if (mode === "insert") {
        writes.push({ table, op: "insert", row: payload ?? {} });
        return { data: { id: `${table}-${writes.length}`, ...payload }, error: null };
      }
      if (mode === "update") {
        writes.push({ table, op: "update", row: { ...payload, __filters: Object.fromEntries(eqs) } });
        return { data: null, error: null };
      }
      return { data: apply(), error: null };
    };
    q.select = (_cols?: string, o?: { count?: string; head?: boolean }) => ((mode === "select" && o?.count && o?.head && (mode = "count")), q);
    q.insert = (row: Row) => ((mode = "insert"), (payload = row), q);
    q.update = (patch: Row) => ((mode = "update"), (payload = patch), q);
    q.eq = (col: string, v: unknown) => (eqs.push([col, v]), filters.push((r) => r[col] === v), q);
    q.neq = (col: string, v: unknown) => (filters.push((r) => r[col] !== v), q);
    q.in = (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q);
    q.is = (col: string, v: unknown) => (filters.push((r) => (v === null ? r[col] == null : r[col] === v)), q);
    q.gt = (col: string, v: unknown) => (filters.push((r) => String(r[col]) > String(v)), q);
    q.or = () => q;
    q.order = () => q;
    q.limit = async () => result();
    q.range = async (from: number, to: number) => {
      opts.onRange?.(table, from, to);
      const r = result();
      return r.error ? r : { data: (r.data as Row[]).slice(from, to + 1), error: null };
    };
    q.maybeSingle = async () => {
      const r = result();
      return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null };
    };
    q.single = async () => {
      const r = result();
      return r.error ? r : { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
    };
    q.upsert = async (row: Row) => {
      const err = error();
      if (!err) writes.push({ table, op: "upsert", row });
      return { error: err };
    };
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return q;
  };
  return { from: builder } as unknown as SupabaseClient;
}

const heading = (name: string, major = false) => {
  const row = resolveDescriptor(index, name);
  return { ui: row.ui, name: row.name, major, qualifiers: [] };
};

describe("buildInvestigatorFitProfile — fake db, modelBudget: 0", () => {
  const tables: Record<string, Row[]> = {
    investigators: [{ id: INV, full_name: "Ada Example", home_department: "Medicine", division: "Rheumatology", rank: "Professor", title_series: "In Residence", degrees: ["MD"], self_declared_axes: null, aspirations: ["implementation science"], do_not_suggest: ["preclinical"], raw_profile_json: {}, archived_at: null, updated_at: NOW.toISOString() }],
    investigator_publications: [
      { investigator_id: INV, pmid: "1", title: "RCT", publication_date: "2024-03-01", mesh: [heading("Humans"), heading("Adult")], publication_types: ["Randomized Controlled Trial"], abstract: null, author_position: "first", identity_status: "verified" },
      { investigator_id: INV, pmid: "2", title: "RCT 2", publication_date: "2023-03-01", mesh: [heading("Humans"), heading("Adult")], publication_types: ["Randomized Controlled Trial"], abstract: null, author_position: "last", identity_status: "verified" },
      { investigator_id: INV, pmid: "3", title: "prose only", publication_date: "2022-03-01", mesh: [], publication_types: [], abstract: PROSE, author_position: "middle", identity_status: "verified" },
      { investigator_id: INV, pmid: "9", title: "unverified", publication_date: "2022-03-01", mesh: [], publication_types: [], abstract: null, author_position: "first", identity_status: "unverified" },
    ],
    investigator_nih_grants: [
      { id: "g1", investigator_id: INV, project_num: "5R01AI000001-03", project_title: "Grant", fiscal_year: 2026, activity_code: "R01", rcdc_categories: ["Clinical Research"], study_section: null, study_section_code: null, is_contact_pi: true, abstract: null, phr_text: null, identity_status: "verified", is_active: true, raw_json: { agency_code: "NIH", project_end_date: "2028-01-01" } },
      { id: "g2", investigator_id: INV, project_num: "5R01AI000009-01", project_title: "Rejected", fiscal_year: 2020, activity_code: "R01", rcdc_categories: null, is_contact_pi: true, abstract: null, phr_text: null, identity_status: "rejected", is_active: true, raw_json: {} },
    ],
    investigator_clinical_trials: [
      { investigator_id: INV, nct_id: "NCT00000001", title: "Trial", start_date: "2024-01-01", brief_summary: null, study_type: "INTERVENTIONAL", phases: ["PHASE2"], primary_purpose: "TREATMENT", allocation: "RANDOMIZED", intervention_model: "PARALLEL", observational_model: null, time_perspective: null, enrollment: 120, intervention_types: ["DRUG"], investigator_role: "PRINCIPAL_INVESTIGATOR", identity_status: "verified" },
    ],
    investigator_sources: [
      { investigator_id: INV, source: "biosketch", state: "not_requested", last_refreshed_at: null, document_date: null, personal_statement: null, contributions: null, meta: null },
      { investigator_id: INV, source: "profiles", state: "available", last_refreshed_at: "2026-08-01T00:00:00Z", meta: { narrative: null, keywords: ["Lupus"] } },
    ],
    fit_item_profiles: [],
    investigator_relationships: [],
    investigator_fit_profiles: [],
  };

  it("a model call that throws inside the build is counted in model_errors, leaves its item pending, and the profile is still written", async () => {
    const writes: Write[] = [];
    const db = fakeDb(tables, writes);
    const failing: ModelFn = async () => {
      throw new Error("boom");
    };
    const r = await buildInvestigatorFitProfile(db, INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 5, model: failing, modelName: "m", now: () => NOW });
    expect(r.model_needed).toBe(1);
    expect(r.model_called).toBe(1);
    expect(r.model_errors).toBe(1);
    expect(r.model_skipped).toBe(1);
    expect(r.pending_items).toBe(1);
    expect(r.written).toBe(true);
    expect(r.items.find((i) => i.model_error)?.model_error).toBe("boom");
  });

  it("collects verified publications, non-rejected grants, trials, sources, self-declared and directory; classifies with rules and cache only; aggregates; writes the partial profile with pending_items (D20)", async () => {
    const writes: Write[] = [];
    const db = fakeDb(tables, writes);
    const model = stubModel();
    const r = await buildInvestigatorFitProfile(db, INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 0, model: model.fn, now: () => NOW });
    expect(r.name).toBe("Ada Example");
    // 3 verified publications + 1 grant + 1 trial + Profiles + self-declared + directory.
    expect(r.item_count).toBe(8);
    expect(r.items.map((i) => i.profile.kind)).toEqual(["publication", "publication", "publication", "grant", "trial", "profiles_narrative", "self_declared", "directory"]);
    expect(r.items.map((i) => i.profile.source)).toEqual(["pubmed_verified", "pubmed_verified", "pubmed_verified", "reporter", "ctgov_pi", "profiles", "self_declared_current", "directory_metadata"]);
    expect(r.model_needed).toBe(1);
    expect(r.model_skipped).toBe(1);
    expect(r.model_called).toBe(0);
    expect(model.calls).toBe(0);
    expect(r.pending_items).toBe(1);
    expect(r.incomplete).toBe(true);
    // A partial build is written all the same; the row says how much is pending.
    expect(r.written).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "investigator_fit_profiles", op: "upsert", row: { investigator_id: INV, pending_items: 1, item_count: 8 } });
    expect(writes[0]!.row).toEqual(profileRow(r.profile, r.item_count, 1));
    const p = r.profile;
    expect(p.investigator_id).toBe(INV);
    expect(dominantParadigm(p.paradigm.career)?.category).toBe("clinical_trials");
    expect(p.design.rct).toBeGreaterThan(0);
    expect(p.evidence_summary).toEqual({ publications_verified: 3, grants: 1, trials: 1, trials_as_pi: 1, biosketch: "not_requested", self_declared: false });
    expect(p.characteristics).toMatchObject({ career_stage: "senior", esi: false, mechanisms_held: ["R01"], active_awards: 1, clinical_role: "md_clinician_investigator", trial_pi_count: 1, degrees: ["MD"], title_series: "In Residence" });
    expect(p.aspirations).toEqual(["implementation_science"]);
    expect(r.aspirations).toEqual([{ text: "implementation science", categories: ["implementation_science"], via: "label" }]);
    expect(p.do_not_suggest).toEqual(["preclinical"]);
    expect(p.provenance.find((x) => x.axis === "paradigm" && x.category === "clinical_trials")?.top_items).toContain(`publication:${INV}:1`);
    expect(p.topic.mesh_major).toEqual([]);
    expect(Object.keys(p.confidence)).toHaveLength(6);
  });

  it("writes the row with pending_items 0 when the build is complete; write: false writes nothing", async () => {
    const writes: Write[] = [];
    const complete = { ...tables, investigator_publications: tables.investigator_publications!.filter((r) => r.pmid !== "3") };
    const r = await buildInvestigatorFitProfile(fakeDb(complete, writes), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 0, model: stubModel().fn, now: () => NOW });
    expect(r.incomplete).toBe(false);
    expect(r.pending_items).toBe(0);
    expect(r.written).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe("investigator_fit_profiles");
    expect(writes[0]!.row).toEqual(profileRow(r.profile, r.item_count));
    expect(writes[0]!.row).toMatchObject({ investigator_id: INV, taxonomy_version: TAXONOMY_VERSION, item_count: 7, pending_items: 0, computed_at: NOW.toISOString(), confidence: r.profile.confidence });

    const none: Write[] = [];
    const r2 = await buildInvestigatorFitProfile(fakeDb(tables, none), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 0, model: stubModel().fn, now: () => NOW, write: false });
    expect(r2.pending_items).toBe(1);
    expect(r2.written).toBe(false);
    expect(none).toEqual([]);
  });

  it("with a budget, calls the model for the prose item, caches it, and the build is complete", async () => {
    const writes: Write[] = [];
    const cache = new InMemoryItemProfileCache();
    const model = stubModel(llmReply);
    const r = await buildInvestigatorFitProfile(fakeDb(tables, writes), INV, { mesh: index, cache, modelBudget: 5, model: model.fn, modelName: "m", now: () => NOW, write: false });
    expect(model.calls).toBe(1);
    expect(r.model_called).toBe(1);
    expect(r.incomplete).toBe(false);
    expect(r.pending_items).toBe(0);
    expect(r.written).toBe(false);
    expect(cache.writes).toBe(1);
    expect(r.profile.paradigm.career.epidemiology).toBeGreaterThan(0);
    expect(writes).toEqual([]);
  });

  it("an unusable model reply leaves the item pending: not cached, counted as skipped, pending_items on the written row", async () => {
    const writes: Write[] = [];
    const cache = new InMemoryItemProfileCache();
    let calls = 0;
    const broken: ModelFn = async () => {
      calls += 1;
      return "{ this is not json";
    };
    const r = await buildInvestigatorFitProfile(fakeDb(tables, writes), INV, { mesh: index, cache, modelBudget: 5, model: broken, modelName: "m", now: () => NOW });
    expect(calls).toBe(1);
    expect(r.model_called).toBe(1);
    expect(r.model_unusable).toBe(1);
    expect(r.model_skipped).toBe(1);
    expect(r.pending_items).toBe(1);
    expect(cache.writes).toBe(0);
    expect(r.written).toBe(true);
    expect(writes[0]!.row).toMatchObject({ pending_items: 1 });
  });

  it("classifies items through an order-preserving worker pool: modelConcurrency 4 gives the same items in the same order", async () => {
    const wide = {
      ...tables,
      investigator_publications: [
        ...tables.investigator_publications!,
        { investigator_id: INV, pmid: "4", title: "prose 2", publication_date: "2021-03-01", mesh: [], publication_types: [], abstract: `${PROSE} Second.`, author_position: "middle", identity_status: "verified" },
        { investigator_id: INV, pmid: "5", title: "prose 3", publication_date: "2020-03-01", mesh: [], publication_types: [], abstract: `${PROSE} Third.`, author_position: "middle", identity_status: "verified" },
      ],
    };
    const serial = await buildInvestigatorFitProfile(fakeDb(wide), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 10, model: stubModel(llmReply).fn, modelName: "m", now: () => NOW, write: false, modelConcurrency: 1 });
    const pooled = await buildInvestigatorFitProfile(fakeDb(wide), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 10, model: stubModel(llmReply).fn, modelName: "m", now: () => NOW, write: false, modelConcurrency: 4 });
    expect(pooled.items.map((i) => i.profile.id)).toEqual(serial.items.map((i) => i.profile.id));
    expect(pooled.model_called).toBe(3);
    expect(pooled.profile).toEqual(serial.profile);
  });

  it("fires directory_epi_dept on the directory item only when the department is Epidemiology & Biostatistics", async () => {
    const epi = { ...tables, investigators: [{ ...tables.investigators![0]!, home_department: "Epidemiology & Biostatistics", division: null }] };
    const r = await buildInvestigatorFitProfile(fakeDb(epi), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 0, model: stubModel().fn, now: () => NOW, write: false });
    const byKind = (kind: ItemKind) => r.items.find((i) => i.profile.kind === kind)!.profile;
    expect(byKind("directory").rules_fired).toContain("directory_epi_dept");
    expect(byKind("profiles_narrative").rules_fired).not.toContain("directory_epi_dept");
    expect(r.items.filter((i) => i.profile.rules_fired.includes("directory_epi_dept"))).toHaveLength(1);
    expect(byKind("directory").source).toBe("directory_metadata");
    expect(byKind("directory").paradigm.epidemiology).toBeGreaterThan(0);
    // The prior is in the profile but never lifts the thin-evidence cap on its own.
    expect(r.diagnostics.axes.paradigm.career.categories.epidemiology?.supporting_items).toBe(0);
    expect(r.profile.paradigm.career.epidemiology).toBeLessThanOrEqual(thinEvidence().cap);
  });

  it("the stored profile type round-trips through summarizeProfile", async () => {
    const r = await buildInvestigatorFitProfile(fakeDb(tables, []), INV, { mesh: index, cache: new InMemoryItemProfileCache(), modelBudget: 0, model: stubModel().fn, now: () => NOW, write: false });
    const stored = JSON.parse(JSON.stringify(r.profile)) as InvestigatorFitProfile;
    const line = summarizeProfile(stored, { name: r.name, item_count: r.item_count });
    expect(line.dominant_career?.category).toBe("clinical_trials");
    expect(line.evidence.trials_as_pi).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The nightly sync over the fake client
// ---------------------------------------------------------------------------

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

/** N investigators, each with one rules-decided RCT and `proseEach` model-needed abstracts (distinct texts, so distinct cache keys). */
function rosterTables(ids: string[], opts: { proseEach?: number } = {}): Record<string, Row[]> {
  const prose = opts.proseEach ?? 1;
  return {
    investigators: ids.map((id, i) => ({ id, full_name: `Person ${i + 1}`, home_department: "Medicine", division: null, rank: "Professor", title_series: null, degrees: ["PhD"], self_declared_axes: null, aspirations: [], do_not_suggest: [], raw_profile_json: {}, archived_at: null, updated_at: NOW.toISOString() })),
    investigator_publications: ids.flatMap((id) => [
      { investigator_id: id, pmid: `${id}-rct`, title: "RCT", publication_date: "2024-03-01", mesh: [heading("Humans"), heading("Adult")], publication_types: ["Randomized Controlled Trial"], abstract: null, author_position: "first", identity_status: "verified" },
      ...Array.from({ length: prose }, (_, k) => ({ investigator_id: id, pmid: `${id}-p${k}`, title: `prose ${k}`, publication_date: "2022-03-01", mesh: [], publication_types: [], abstract: `${PROSE} Variant ${id} ${k}.`, author_position: "middle", identity_status: "verified" })),
    ]),
    investigator_nih_grants: [],
    investigator_clinical_trials: [],
    investigator_sources: [],
    fit_item_profiles: [],
    investigator_relationships: [],
    investigator_fit_profiles: [],
    sync_job_logs: [],
  };
}

describe("syncInvestigatorFitProfiles — fake db", () => {
  const base = { mesh: index, now: () => NOW, timeBudgetMs: 60_000 };
  const logsOf = (writes: Write[]) => writes.filter((w) => w.table === "sync_job_logs");
  const details = (w: Write) => w.row.details as Record<string, unknown>;

  it("builds the due investigators in order, writes every profile, and logs start and finish with the outcome", async () => {
    const writes: Write[] = [];
    const model = stubModel(llmReply);
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([B, A]), writes), { ...base, model: model.fn, modelName: "m", maxModelCalls: 10 });
    expect(r).toMatchObject({ due: 2, scanned: 2, written: 2, pending: 0, errors: 0, modelCalls: 2, modelSkipped: 0, budgetExhausted: null, nextCursor: null, outcome: "success" });
    expect(r.investigators.map((o) => [o.investigator_id, o.status, o.reason])).toEqual([
      [A, "written", "no_profile"],
      [B, "written", "no_profile"],
    ]);
    expect(writes.filter((w) => w.table === "investigator_fit_profiles").map((w) => w.row.pending_items)).toEqual([0, 0]);
    expect(writes.filter((w) => w.table === "fit_item_profiles")).toHaveLength(2);
    const logs = logsOf(writes);
    expect(logs.map((w) => w.op)).toEqual(["insert", "update"]);
    expect(logs[0]!.row).toMatchObject({ job_type: "fit_profiles", status: "started" });
    expect(details(logs[0]!)).toMatchObject({ due: 2, model_budget: 10, model_concurrency: 4 });
    expect(logs[1]!.row).toMatchObject({ status: "success" });
    expect(details(logs[1]!)).toMatchObject({ outcome: "success", written: 2 });
    expect(details(logs[1]!).lines).toHaveLength(2);
  });

  it("stops starting investigators once the time budget is spent", async () => {
    const writes: Write[] = [];
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B]), writes), { ...base, timeBudgetMs: -1, model: stubModel().fn, maxModelCalls: 10 });
    expect(r).toMatchObject({ due: 2, scanned: 0, written: 0, budgetExhausted: "time", nextCursor: null });
    expect(writes.filter((w) => w.table === "investigator_fit_profiles")).toHaveLength(0);
    expect(logsOf(writes).map((w) => w.op)).toEqual(["insert", "update"]);
  });

  it("stops starting investigators once the model budget is spent; nextCursor is the last id taken on and a rerun with it resumes after that position", async () => {
    const first = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B, C])), { ...base, model: stubModel(llmReply).fn, modelName: "m", maxModelCalls: 2 });
    expect(first).toMatchObject({ due: 3, scanned: 2, written: 2, pending: 0, modelCalls: 2, budgetExhausted: "model", nextCursor: B, outcome: "success" });
    // The fake never applies writes, so all three are due again: the cursor alone decides where to resume.
    const second = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B, C])), { ...base, cursor: first.nextCursor, model: stubModel(llmReply).fn, modelName: "m", maxModelCalls: 2 });
    expect(second).toMatchObject({ due: 3, scanned: 1, written: 1, budgetExhausted: null, nextCursor: null });
    expect(second.investigators[0]!.investigator_id).toBe(C);
  });

  it("when the budget ran out inside the last investigator, the partial profile is written, the run is partial, and the cursor points before it so it is retried", async () => {
    const writes: Write[] = [];
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B], { proseEach: 2 }), writes), { ...base, model: stubModel(llmReply).fn, modelName: "m", maxModelCalls: 1 });
    expect(r).toMatchObject({ scanned: 1, written: 1, pending: 1, modelCalls: 1, modelSkipped: 1, budgetExhausted: "model", nextCursor: null, outcome: "partial" });
    expect(r.investigators[0]).toMatchObject({ investigator_id: A, status: "written", pending_items: 1 });
    expect(r.investigators[0]!.line).toContain("PENDING 1");
    expect(writes.filter((w) => w.table === "investigator_fit_profiles")[0]!.row).toMatchObject({ investigator_id: A, pending_items: 1 });
    const finish = logsOf(writes).find((w) => w.op === "update")!;
    // sync_job_logs.status is CHECK-constrained to started / success / error: partial is in the details and the message.
    expect(finish.row).toMatchObject({ status: "success" });
    expect(details(finish)).toMatchObject({ outcome: "partial", pending: 1 });
    expect(String(finish.row.message)).toMatch(/^fit_profiles partial:/);
  });

  it("isolates one investigator's failure: the other is built, the error is an outcome line, the run logs; every build failing is an error run", async () => {
    const failA = (table: string, eqs: Array<[string, unknown]>) => (table === "investigator_publications" && eqs.some(([c, v]) => c === "investigator_id" && v === A) ? "connection reset" : null);
    const writes: Write[] = [];
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B]), writes, { fail: failA }), { ...base, model: stubModel(llmReply).fn, modelName: "m", maxModelCalls: 10 });
    expect(r).toMatchObject({ scanned: 2, written: 1, errors: 1, outcome: "success" });
    expect(r.investigators[0]).toMatchObject({ investigator_id: A, status: "error", pending_items: 0 });
    expect(r.investigators[0]!.error).toContain("connection reset");
    expect(r.investigators[1]).toMatchObject({ investigator_id: B, status: "written" });
    expect(logsOf(writes).find((w) => w.op === "update")!.row).toMatchObject({ status: "success" });

    const all: Write[] = [];
    const bad = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B]), all, { fail: (table) => (table === "investigator_publications" ? "down" : null) }), { ...base, model: stubModel().fn, maxModelCalls: 0 });
    expect(bad).toMatchObject({ scanned: 2, written: 0, errors: 2, outcome: "error" });
    expect(logsOf(all).find((w) => w.op === "update")!.row).toMatchObject({ status: "error" });
  });

  it("a dry run builds in memory and writes nothing — no profile, no cache row, no sync_job_logs row — and reports what is pending", async () => {
    const writes: Write[] = [];
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B]), writes), { ...base, dryRun: true, maxModelCalls: 0, model: stubModel().fn });
    expect(r).toMatchObject({ dryRun: true, scanned: 2, written: 0, pending: 2, errors: 0, modelCalls: 0, modelSkipped: 2, outcome: "partial" });
    expect(r.investigators.every((o) => o.status === "dry_run" && o.pending_items === 1)).toBe(true);
    expect(writes).toEqual([]);
  });

  it("before the migration a dry run still works (tableExists false) and a real run refuses", async () => {
    const { investigator_fit_profiles: _omit, ...before } = rosterTables([A]);
    void _omit;
    const r = await syncInvestigatorFitProfiles(fakeDb(before), { ...base, dryRun: true, maxModelCalls: 0, model: stubModel().fn });
    expect(r.tableExists).toBe(false);
    expect(r.scanned).toBe(1);
    await expect(syncInvestigatorFitProfiles(fakeDb(before), { ...base, maxModelCalls: 0, model: stubModel().fn })).rejects.toThrow(/does not exist/);
  });

  it("explicit investigatorIds are taken as requested, in id order, due or not", async () => {
    const r = await syncInvestigatorFitProfiles(fakeDb(rosterTables([A, B, C])), { ...base, investigatorIds: [C, A], maxModelCalls: 0, model: stubModel().fn });
    expect(r.investigators.map((o) => [o.investigator_id, o.reason])).toEqual([
      [A, "requested"],
      [C, "requested"],
    ]);
  });

  it("profileSyncOutcome: error only when nothing was written and something failed; partial when anything is pending", () => {
    expect(profileSyncOutcome({ written: 0, pending: 0, errors: 0, modelSkipped: 0 })).toBe("success");
    expect(profileSyncOutcome({ written: 0, pending: 1, errors: 0, modelSkipped: 0 })).toBe("partial");
    expect(profileSyncOutcome({ written: 3, pending: 0, errors: 0, modelSkipped: 2 })).toBe("partial");
    expect(profileSyncOutcome({ written: 0, pending: 0, errors: 1, modelSkipped: 0 })).toBe("error");
    expect(profileSyncOutcome({ written: 1, pending: 0, errors: 1, modelSkipped: 0 })).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// The refresh hook
// ---------------------------------------------------------------------------

describe("rebuildFitProfileAfterRefresh — the refresh hook (never throws, never the model)", () => {
  const meshRows = fixture.descriptors as Row[];

  it("skips quietly when investigator_fit_profiles is not on the database", async () => {
    resetMeshIndexCache();
    const { investigator_fit_profiles: _omit, ...before } = rosterTables([A]);
    void _omit;
    const writes: Write[] = [];
    const r = await rebuildFitProfileAfterRefresh(fakeDb({ ...before, mesh_descriptors: meshRows }, writes), A);
    expect(r).toMatchObject({ ok: true, skipped: true });
    expect(r.message).toMatch(/^Fit profile: not built/);
    expect(writes).toEqual([]);
  });

  it("skips quietly when fit_item_profiles is absent or the descriptor index is empty", async () => {
    resetMeshIndexCache();
    const { fit_item_profiles: _omit, ...noCache } = rosterTables([A]);
    void _omit;
    const a = await rebuildFitProfileAfterRefresh(fakeDb({ ...noCache, mesh_descriptors: meshRows }), A);
    expect(a).toMatchObject({ ok: true, skipped: true });
    resetMeshIndexCache();
    const b = await rebuildFitProfileAfterRefresh(fakeDb({ ...rosterTables([A]), mesh_descriptors: [] }), A);
    expect(b).toMatchObject({ ok: true, skipped: true });
    expect(b.message).toMatch(/descriptor table is empty/);
  });

  it("rebuilds from rules and cache with modelBudget 0, writes the partial profile, says what awaits the classifier; any other failure is ok: false on this outcome alone", async () => {
    resetMeshIndexCache();
    const writes: Write[] = [];
    const r = await rebuildFitProfileAfterRefresh(fakeDb({ ...rosterTables([A]), mesh_descriptors: meshRows }, writes), A);
    expect(r).toMatchObject({ ok: true, pending_items: 1 });
    expect(r.skipped).toBeUndefined();
    // 1 RCT + 1 prose publication + Profiles + self-declared + directory.
    expect(r.message).toBe("Fit profile: rebuilt from 5 items; 1 item awaits the nightly classifier.");
    expect(writes.filter((w) => w.table === "investigator_fit_profiles")).toHaveLength(1);
    expect(writes.filter((w) => w.table === "fit_item_profiles")).toHaveLength(0);

    resetMeshIndexCache();
    const failing = fakeDb({ ...rosterTables([A]), mesh_descriptors: meshRows }, [], { fail: (table) => (table === "investigator_publications" ? "connection reset" : null) });
    const e = await rebuildFitProfileAfterRefresh(failing, A);
    expect(e).toMatchObject({ ok: false });
    expect(e.message).toMatch(/^Fit profile: .*connection reset/);
    resetMeshIndexCache();
  });
});

// ---------------------------------------------------------------------------
// The MeSH loader
// ---------------------------------------------------------------------------

describe("loadMeshIndex — classify/mesh-db", () => {
  it("counts, fetches 1,000-row ranges in parallel batches, builds the index once per process, forgets on reset, and does not memoize a failure", async () => {
    resetMeshIndexCache();
    const n = 2 * MESH_RANGE + 7;
    const rows: Row[] = Array.from({ length: n }, (_, i) => ({ ui: `D${String(i).padStart(6, "0")}`, name: `Descriptor ${i}`, tree_numbers: [`Z01.${String(i).padStart(6, "0")}`], is_check_tag: false }));
    const ranges: Array<[number, number]> = [];
    const db = fakeDb({ mesh_descriptors: rows }, [], { onRange: (table, from, to) => void (table === "mesh_descriptors" && ranges.push([from, to])) });
    const p = loadMeshIndex(db);
    expect(loadMeshIndex(db)).toBe(p);
    const idx = await p;
    expect(idx.byUi.size).toBe(n);
    expect(ranges).toEqual([
      [0, MESH_RANGE - 1],
      [MESH_RANGE, 2 * MESH_RANGE - 1],
      [2 * MESH_RANGE, 3 * MESH_RANGE - 1],
    ]);
    expect(idx.byUi.get("D002006")?.name).toBe("Descriptor 2006");
    resetMeshIndexCache();
    expect(loadMeshIndex(db)).not.toBe(p);
    resetMeshIndexCache();
    await expect(loadMeshIndex(fakeDb({ mesh_descriptors: [] }))).rejects.toThrow(/mesh_descriptors is empty/);
    await expect(loadMeshIndex(fakeDb({ mesh_descriptors: [] }))).rejects.toThrow(/mesh_descriptors is empty/);
    await expect(loadMeshIndex(fakeDb({}))).rejects.toThrow(/mesh_descriptors count failed/);
    resetMeshIndexCache();
  });
});

// ---------------------------------------------------------------------------
// Taxonomy accessors added for D20, and the report's pending label
// ---------------------------------------------------------------------------

describe("taxonomy accessors (D20)", () => {
  it("priorSources, sourceOrigin, provenanceTop and r01EquivalentCodes read taxonomy.json; an unknown id or the _comment key throws", () => {
    expect(priorSources()).toEqual(["profiles", "directory_metadata"]);
    for (const s of EVIDENCE_SOURCE_IDS) expect(typeof sourceOrigin(s)).toBe("string");
    expect(sourceOrigin("ctgov_pi")).toBe(sourceOrigin("ctgov_listed"));
    expect(sourceOrigin("pubmed_verified")).toBe(sourceOrigin("pubmed_name_only"));
    expect(sourceOrigin("pubmed_verified")).not.toBe(sourceOrigin("reporter"));
    expect(() => sourceOrigin("_comment")).toThrow(TaxonomyError);
    expect(() => sourceOrigin("nope")).toThrow(TaxonomyError);
    expect(provenanceTop()).toBe(3);
    expect(r01EquivalentCodes()).toEqual(expect.arrayContaining(["R01", "U01", "DP2", "R35"]));
    expect(r01EquivalentCodes()).not.toContain("K23");
  });
});

describe("report — the pending label and the thin approximation", () => {
  it("labels a partial profile [PENDING n]; a stored profile's thin approximation counts non-prior provenance ids only", () => {
    const p = aggregate([item({ id: "pub:1", paradigm: { epidemiology: 1 } })], NOW, { investigator_id: "inv" });
    const line = summarizeProfile(p, { name: "P", pending_items: 4 });
    expect(line.pending_items).toBe(4);
    expect(line.incomplete).toBe(true);
    expect(formatProfileReport([line])).toContain("P [PENDING 4]");
    expect(formatProfileReport([line])).toContain("pending (partial profiles) 1");
    expect(summarizeProfile(p, { name: "P" })).toMatchObject({ pending_items: 0, incomplete: false });
    const provenance = (ids: string[]) => [{ axis: "paradigm" as const, category: "epidemiology" as const, top_items: ids }];
    expect(summarizeProfile({ ...p, provenance: provenance(["pub:1", "profiles:inv", "directory:inv"]) }).thin).toBe(true);
    expect(summarizeProfile({ ...p, provenance: provenance(["pub:1", "pub:2", "directory:inv"]) }).thin).toBe(false);
  });
});

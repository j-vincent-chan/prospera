import adversarial from "@/lib/fit/__fixtures__/adversarial-cases.json";
import { describe, expect, it } from "vitest";
import signalMapping from "@/lib/fit/signal-mapping.json";
import taxonomy from "@/lib/fit/taxonomy.json";
import {
  ACTIVITY_CODES_WITH_PRIORS,
  actionabilityParams,
  activityCodePrior,
  categoriesOf,
  categoryCompat,
  categoryLabel,
  CLINICAL_TRIAL_DESIGNATION_IDS,
  clinicalTrialOverlay,
  composeExponents,
  CONFIDENCE_CAP_IDS,
  confidenceCap,
  confidenceThresholds,
  DESIGN_GROUP_IDS,
  DESIGN_IDS,
  designGates,
  designGroupOf,
  designsOf,
  designScoreWeights,
  EVIDENCE_ROLE_IDS,
  EVIDENCE_SOURCE_IDS,
  exceptionNoticeFamilies,
  exemplarBlend,
  EXPLORATORY_EXCEPTION_IDS,
  exploratoryException,
  familyCompat,
  familyLabel,
  familyOf,
  floors,
  isConfidence,
  isDesignId,
  isMaterialsKind,
  isMatrixFamily,
  isObjectiveId,
  isParadigmCategory,
  isParadigmFamily,
  isTier,
  isUnitLevel,
  levelCompat,
  levelOf,
  MATERIALS_GROUP_IDS,
  MATERIALS_KIND_IDS,
  materialsGroupOf,
  materialsOf,
  MATRIX_FAMILY_IDS,
  OBJECTIVE_IDS,
  PARADIGM_CATEGORY_IDS,
  PARADIGM_FAMILY_IDS,
  paradigmGates,
  poorTier,
  readinessRung,
  recency,
  relevanceWeights,
  reliability,
  roleWeight,
  TAXONOMY_VERSION,
  TaxonomyError,
  TIER_IDS,
  trackParams,
  UNIT_IDS,
  UNIT_LEVEL_IDS,
  unitGates,
  unitsOf,
  withinFamily,
} from "@/lib/fit/taxonomy";
import type { Axis, NumericFloorKey, Tier } from "@/lib/fit/types";

const NUMERIC_FLOOR_KEYS: NumericFloorKey[] = ["P", "U", "D", "T", "M", "K", "D_required_group_min", "T_specific_depth", "P_with_aspiration"];

function expectSymmetricUnitMatrix(name: string, order: string[], matrix: number[][]) {
  expect(matrix.length, `${name}: one row per id in order`).toBe(order.length);
  for (let i = 0; i < order.length; i++) {
    expect(matrix[i]!.length, `${name}: row ${order[i]} width`).toBe(order.length);
    expect(matrix[i]![i], `${name}: diagonal ${order[i]}`).toBe(1);
    for (let j = 0; j < order.length; j++) {
      const v = matrix[i]![j]!;
      expect(v >= 0 && v <= 1, `${name}[${order[i]}][${order[j]}] = ${v} outside [0,1]`).toBe(true);
      expect(v, `${name} asymmetric at [${order[i]}][${order[j]}] vs [${order[j]}][${order[i]}]`).toBe(matrix[j]![i]);
    }
  }
}

describe("id unions stay in sync with taxonomy.json", () => {
  it("keyed tables", () => {
    expect(TAXONOMY_VERSION).toBe("fit-v1");
    expect(PARADIGM_FAMILY_IDS).toEqual(Object.keys(taxonomy.paradigm.families));
    expect(PARADIGM_CATEGORY_IDS).toEqual(Object.keys(taxonomy.paradigm.categories));
    expect(UNIT_LEVEL_IDS).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(DESIGN_GROUP_IDS).toEqual(Object.keys(taxonomy.design.groups));
    expect(MATERIALS_GROUP_IDS).toEqual(Object.keys(taxonomy.materials.kinds));
    expect(TIER_IDS).toEqual(["strong", "moderate", "exploratory", "poor"]);
    expect(EVIDENCE_SOURCE_IDS).toEqual(Object.keys(taxonomy.aggregation.reliability));
    expect(EVIDENCE_ROLE_IDS).toEqual(Object.keys(taxonomy.aggregation.role));
    expect(EXPLORATORY_EXCEPTION_IDS).toEqual(["translational_bridge", "biospecimen_bridge"]);
    expect(CONFIDENCE_CAP_IDS).toEqual(["low_profile_confidence", "low_notice_confidence", "eligibility_unknown", "readiness_far", "runway_short"]);
    expect(CLINICAL_TRIAL_DESIGNATION_IDS).toEqual(["required", "besh_required", "optional", "not_allowed"]);
  });

  it("the as-const tuples equal the JSON's array-valued ids, in order (edit both or fail here)", () => {
    expect([...UNIT_IDS]).toEqual(Object.values(taxonomy.unit.levels).flatMap((l) => l.units));
    expect([...DESIGN_IDS]).toEqual(Object.values(taxonomy.design.groups).flat());
    expect([...MATERIALS_KIND_IDS]).toEqual(Object.values(taxonomy.materials.kinds).flat());
    expect([...OBJECTIVE_IDS]).toEqual(taxonomy.objective.categories);
  });

  it("the matrix families are every family except cross_cutting, in family order", () => {
    expect([...MATRIX_FAMILY_IDS]).toEqual(taxonomy.paradigm.family_compat.order);
    expect([...MATRIX_FAMILY_IDS]).toEqual(PARADIGM_FAMILY_IDS.filter((f) => f !== "cross_cutting"));
    expect(isMatrixFamily("cross_cutting")).toBe(false);
    expect(isParadigmFamily("cross_cutting")).toBe(true);
  });

  it("no id is reused across tables that share a namespace", () => {
    const dupes = (ids: readonly string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes(PARADIGM_CATEGORY_IDS)).toEqual([]);
    expect(dupes(UNIT_IDS)).toEqual([]);
    expect(dupes(DESIGN_IDS)).toEqual([]);
    expect(dupes(MATERIALS_KIND_IDS)).toEqual([]);
    expect(dupes(OBJECTIVE_IDS)).toEqual([]);
    // family ids that are also category ids — `preclinical` and `translational` by design; anything new here is a namespace collision to think about
    const collisions = PARADIGM_CATEGORY_IDS.filter((c) => (PARADIGM_FAMILY_IDS as readonly string[]).includes(c));
    expect(collisions).toEqual(["preclinical", "translational"]);
  });
});

describe("paradigm (§4 Axis A)", () => {
  it("every category has exactly one family, and families list exactly their categories", () => {
    for (const cat of PARADIGM_CATEGORY_IDS) {
      const family = familyOf(cat);
      expect(isParadigmFamily(family), `${cat} → ${family}`).toBe(true);
      expect(categoriesOf(family), `${family}.categories must list ${cat}`).toContain(cat);
      expect(categoryLabel(cat).length).toBeGreaterThan(0);
    }
    const listed = PARADIGM_FAMILY_IDS.flatMap((f) => categoriesOf(f));
    expect([...listed].sort()).toEqual([...PARADIGM_CATEGORY_IDS].sort());
    for (const f of PARADIGM_FAMILY_IDS) {
      for (const c of categoriesOf(f)) expect(familyOf(c), `${f} lists ${c} but ${c}.family is ${familyOf(c)}`).toBe(f);
      expect(familyLabel(f).length).toBeGreaterThan(0);
    }
  });

  it("family matrix is square over order, symmetric, unit diagonal, in [0,1]", () => {
    expectSymmetricUnitMatrix("paradigm.family_compat", taxonomy.paradigm.family_compat.order, taxonomy.paradigm.family_compat.matrix);
  });

  it("familyCompat reads the matrix, symmetric, with the spec's values", () => {
    expect(familyCompat("discovery", "population")).toBe(0.05);
    expect(familyCompat("population", "discovery")).toBe(0.05);
    expect(familyCompat("preclinical", "translational")).toBe(0.7);
    expect(familyCompat("clinical", "health_systems")).toBe(0.5);
    expect(familyCompat("translational", "translational")).toBe(1);
    for (const a of MATRIX_FAMILY_IDS) for (const b of MATRIX_FAMILY_IDS) expect(familyCompat(a, b)).toBe(familyCompat(b, a));
  });

  it("categoryCompat: same 1.00, sibling 0.85, cross-family the family matrix; symmetric over every matrix-family pair", () => {
    expect(withinFamily()).toEqual({ same_category: 1, sibling_category: 0.85 });
    expect(categoryCompat("clinical_trials", "clinical_trials")).toBe(1);
    expect(categoryCompat("clinical_trials", "clinical_observational")).toBe(0.85);
    expect(categoryCompat("molecular_cellular_mechanistic", "epidemiology")).toBe(0.05);
    expect(categoryCompat("human_biospecimen", "clinical_trials")).toBe(familyCompat("translational", "clinical"));
    const matrixCategories = PARADIGM_CATEGORY_IDS.filter((c) => isMatrixFamily(familyOf(c)));
    for (const a of matrixCategories) for (const b of matrixCategories) expect(categoryCompat(a, b), `${a} vs ${b}`).toBe(categoryCompat(b, a));
  });

  it("cross_cutting is not in the matrix: compat throws with the sqrt(U·D) hint rather than returning a number", () => {
    expect(() => familyCompat("cross_cutting", "discovery")).toThrow(TaxonomyError);
    expect(() => familyCompat("discovery", "cross_cutting")).toThrow(/cross-cutting paradigms do not gate on their own/);
    expect(() => categoryCompat("bioinformatics", "translational")).toThrow(TaxonomyError);
    expect(() => categoryCompat("bioinformatics", "bioinformatics")).not.toThrow();
    expect(categoryCompat("bioinformatics", "computational_data_science")).toBe(0.85);
  });

  it("paradigm gates: Poor below Exploratory, and they equal the Exploratory P floors (§9 ↔ §10)", () => {
    const g = paradigmGates();
    expect(g.poor_below).toBeLessThan(g.exploratory_below);
    expect(floors("exploratory").P, "tiers.exploratory.P must equal paradigm.gates.poor_below").toBe(g.poor_below);
    expect(floors("exploratory").P_with_aspiration, "tiers.exploratory.P_with_aspiration must equal paradigm.gates.exploratory_below").toBe(g.exploratory_below);
    expect(g.excluded_cap).toBeLessThan(g.poor_below);
  });
});

describe("unit (§4 Axis B)", () => {
  it("every unit sits at exactly one level", () => {
    for (const u of UNIT_IDS) {
      const level = levelOf(u);
      expect(isUnitLevel(level)).toBe(true);
      expect(unitsOf(level)).toContain(u);
    }
    expect(levelOf("whole_animal")).toBe("L2");
    expect(levelOf("human_biospecimen")).toBe("L3");
    expect(levelOf("policy")).toBe("L5");
  });

  it("level matrix is square, symmetric, unit diagonal; spec values", () => {
    expectSymmetricUnitMatrix("unit.level_compat", taxonomy.unit.level_compat.order, taxonomy.unit.level_compat.matrix);
    expect(taxonomy.unit.level_compat.order).toEqual([...UNIT_LEVEL_IDS]);
    expect(levelCompat("L1", "L3")).toBe(0.5);
    expect(levelCompat("L3", "L1")).toBe(0.5);
    expect(levelCompat("L1", "L4")).toBe(0.1);
    expect(levelCompat("L4", "L5")).toBe(0.6);
  });

  it("unit gate equals the Exploratory U floor (§9 ↔ §10)", () => {
    expect(floors("exploratory").U, "tiers.exploratory.U must equal unit.gates.poor_below").toBe(unitGates().poor_below);
  });
});

describe("design (§4 Axis C)", () => {
  it("every design has exactly one group", () => {
    for (const d of DESIGN_IDS) {
      const g = designGroupOf(d);
      expect(DESIGN_GROUP_IDS).toContain(g);
      expect(designsOf(g)).toContain(d);
    }
    expect(designGroupOf("rct")).toBe("interventional");
    expect(designGroupOf("gwas")).toBe("analytical_computational");
    expect(designGroupOf("hybrid_effectiveness_implementation")).toBe("implementation");
  });

  it("score weights sum to 1; gates name a real tier and match the Moderate required-group floor", () => {
    const w = designScoreWeights();
    expect(w.w_required + w.w_allowed + w.w_not_prohibited).toBeCloseTo(1, 10);
    const g = designGates();
    expect(isTier(g.required_unsupported_cap_tier)).toBe(true);
    expect(g.required_unsupported_cap_tier).toBe("exploratory");
    expect(g.prohibited_dominant_share).toBeGreaterThan(0);
    expect(g.prohibited_penalty_factor).toBeLessThan(1);
    expect(floors("moderate").D_required_group_min, "tiers.moderate.D_required_group_min must equal design.gates.required_group_unsupported_below").toBe(g.required_group_unsupported_below);
  });
});

describe("materials (§4 Axis D)", () => {
  it("every kind has exactly one group", () => {
    for (const k of MATERIALS_KIND_IDS) {
      const g = materialsGroupOf(k);
      expect(MATERIALS_GROUP_IDS).toContain(g);
      expect(materialsOf(g)).toContain(k);
    }
    expect(materialsGroupOf("animal_mouse")).toBe("non_human");
    expect(materialsGroupOf("ehr")).toBe("human_data");
  });
});

describe("tiers and floors (§10)", () => {
  it("floors are monotone Strong ≥ Moderate ≥ Exploratory for every numeric floor a lower tier carries", () => {
    const strong = floors("strong");
    const moderate = floors("moderate");
    const exploratory = floors("exploratory");
    for (const key of NUMERIC_FLOOR_KEYS) {
      const e = exploratory[key];
      const m = moderate[key];
      const s = strong[key];
      if (typeof e === "number" && key !== "P_with_aspiration") {
        expect(typeof m, `moderate must carry ${key} because exploratory does`).toBe("number");
        expect(m!, `moderate.${key} ≥ exploratory.${key}`).toBeGreaterThanOrEqual(e);
      }
      if (typeof m === "number") {
        expect(typeof s, `strong must carry ${key} because moderate does`).toBe("number");
        expect(s!, `strong.${key} ≥ moderate.${key}`).toBeGreaterThanOrEqual(m);
      }
    }
    // the aspiration variant of the Exploratory P floor must still sit below Moderate's P
    expect(exploratory.P_with_aspiration!).toBeGreaterThan(exploratory.P);
    expect(exploratory.P_with_aspiration!).toBeLessThanOrEqual(moderate.P);
  });

  it("non-numeric floors carry the spec's literal values", () => {
    expect(floors("strong").E).toBe("pass_no_unknowns");
    expect(floors("moderate").E).toBe("pass");
    expect(floors("exploratory").E).toBe("pass");
    expect(floors("strong").A).toBe("runway_ok_not_in_pipeline");
    expect(floors("strong").stage8).toBe("confirm");
    expect(isConfidence(floors("strong").confidence_min!)).toBe(true);
    expect(floors("strong").gaps_allowed).toBe(0);
    expect(floors("moderate").gaps_allowed).toBe(1);
    expect(floors("moderate").gap_not_in).toEqual(["P", "U", "D_required"]);
    expect(floors("strong").T_specific_depth).toBe(taxonomy.compose.topic.min_specific_depth_for_strong);
  });

  it("every value in a tier row is a known floor key with a value of the expected shape", () => {
    const known = new Set<string>([...NUMERIC_FLOOR_KEYS, "E", "A", "confidence_min", "stage8", "gaps_allowed", "gap_not_in"]);
    for (const tier of ["strong", "moderate", "exploratory"] as const) {
      for (const [key, value] of Object.entries(floors(tier))) {
        expect(known.has(key), `tiers.${tier}.${key} is not a floor key types.ts knows`).toBe(true);
        if ((NUMERIC_FLOOR_KEYS as string[]).includes(key) || key === "gaps_allowed") expect(typeof value, `tiers.${tier}.${key}`).toBe("number");
      }
    }
  });

  it("poor carries no floors: hidden and explainable", () => {
    expect(poorTier()).toEqual({ hidden: true, explain_on_request: true });
    expect(() => floors("poor")).toThrow(TaxonomyError);
    expect(() => floors("poor")).toThrow(/carries no floors/);
  });

  it("every confidence cap names a tier", () => {
    for (const id of CONFIDENCE_CAP_IDS) expect(isTier(confidenceCap(id)), id).toBe(true);
    expect(confidenceCap("eligibility_unknown")).toBe("moderate");
  });

  it("exploratory exceptions expose their thresholds and the notice families they are written for (§9 rows)", () => {
    expect(exploratoryException("translational_bridge")).toEqual({ investigator_translational_min: 0.4, requires_collaborator_in_required_family: true, notice_families: ["clinical"] });
    expect(exploratoryException("biospecimen_bridge").investigator_human_biospecimen_min).toBe(0.4);
    expect(exceptionNoticeFamilies("translational_bridge")).toEqual(["clinical"]);
    expect(exceptionNoticeFamilies("biospecimen_bridge")).toEqual(["discovery", "preclinical"]);
    for (const id of EXPLORATORY_EXCEPTION_IDS) {
      const families = exceptionNoticeFamilies(id);
      expect(families.length, id).toBeGreaterThan(0);
      for (const f of families) expect(isMatrixFamily(f), `${id}: ${f}`).toBe(true);
    }
    expect(() => exceptionNoticeFamilies("_comment")).toThrow(TaxonomyError);
  });

  it("the track ladder rows named by far_above and short_runway_rungs exist, in order", () => {
    const t = trackParams();
    const rows = t.readiness_ladder.length;
    expect(t.far_above.held_below_rung).toBeLessThan(t.far_above.notice_min_rung);
    expect(t.far_above.notice_min_rung).toBeLessThan(rows);
    expect(readinessRung("U01")).toBe(t.far_above.notice_min_rung);
    expect(readinessRung("R01")).toBe(t.far_above.held_below_rung);
    for (const r of actionabilityParams().short_runway_rungs) expect(r >= 0 && r < rows, `short_runway_rungs ${r}`).toBe(true);
    expect(actionabilityParams().short_runway_rungs).toContain(readinessRung("R21"));
    // readiness.unknown alone reaches the Strong K floor (the _comment_readiness note)
    expect(t.weights.readiness * t.readiness.unknown).toBeGreaterThanOrEqual(floors("strong").K!);
  });
});

describe("aggregation and compose (§5, §8)", () => {
  it("reliabilities and roles are in [0,1] and carry the spec's anchors", () => {
    for (const s of EVIDENCE_SOURCE_IDS) expect(reliability(s) >= 0 && reliability(s) <= 1, s).toBe(true);
    for (const r of EVIDENCE_ROLE_IDS) expect(roleWeight(r) >= 0 && roleWeight(r) <= 1, r).toBe(true);
    expect(reliability("pubmed_verified")).toBe(1);
    expect(reliability("pubmed_name_only")).toBe(0);
    expect(reliability("ctgov_listed")).toBe(0.6);
    expect(roleWeight("middle_author")).toBe(0.5);
    expect(recency().recent_view_years).toBe(5);
    const c = confidenceThresholds();
    expect(c.high_min_mass).toBeGreaterThan(c.medium_min_mass);
    expect(c.high_min_sources).toBeGreaterThan(c.medium_min_sources);
  });

  it("relevance weights sum to 1 and the compatibility exponents are those of §8", () => {
    const w = relevanceWeights();
    expect(w.T + w.M + w.O + w.K + w.A).toBeCloseTo(1, 10);
    expect(composeExponents()).toEqual({ P: 1, D: 0.75, U: 0.5 });
  });

  it("exemplar blend is ordered highest threshold first and ends at zero exemplars", () => {
    const blend = exemplarBlend();
    for (let i = 1; i < blend.length; i++) expect(blend[i]!.min_exemplars).toBeLessThan(blend[i - 1]!.min_exemplars);
    expect(blend[blend.length - 1]).toEqual({ min_exemplars: 0, exemplar_weight: 0, list_min_share: 0 });
  });
});

describe("opportunity_profile tables resolve in the taxonomy (§6)", () => {
  it("activity-code priors name real categories and objectives; an unlisted code has no prior", () => {
    expect(ACTIVITY_CODES_WITH_PRIORS).toContain("K23");
    for (const code of ACTIVITY_CODES_WITH_PRIORS) {
      const prior = activityCodePrior(code)!;
      expect(prior).not.toBeNull();
      for (const cat of Object.keys(prior.r ?? {})) expect(isParadigmCategory(cat), `activity_code_priors.${code}.r.${cat}`).toBe(true);
      for (const cat of Object.keys(prior.a ?? {})) expect(isParadigmCategory(cat), `activity_code_priors.${code}.a.${cat}`).toBe(true);
      if (prior.objective !== undefined) expect(isObjectiveId(prior.objective), `activity_code_priors.${code}.objective`).toBe(true);
    }
    expect(activityCodePrior("K23")).toEqual({ r: { clinical_observational: 0.7, clinical_trials: 0.6 } });
    expect(activityCodePrior("R01")).toEqual({});
    expect(activityCodePrior("R56")).toBeNull();
    expect(activityCodePrior("_comment")).toBeNull();
  });

  it("clinical-trial designation overlays name real ids on every axis", () => {
    for (const d of CLINICAL_TRIAL_DESIGNATION_IDS) {
      const o = clinicalTrialOverlay(d);
      for (const cat of Object.keys({ ...o.paradigm_required, ...o.paradigm_required_any, ...o.paradigm_excluded })) expect(isParadigmCategory(cat), `${d}: ${cat}`).toBe(true);
      for (const l of [...(o.unit_required ?? []), ...(o.unit_required_any ?? [])]) expect(isUnitLevel(l), `${d}: ${l}`).toBe(true);
      for (const x of [...(o.design_required_any ?? []), ...(o.design_prohibited ?? [])]) expect(isDesignId(x), `${d}: ${x}`).toBe(true);
      for (const k of [...(o.materials_required ?? []), ...(o.materials_required_any ?? [])]) expect(isMaterialsKind(k), `${d}: ${k}`).toBe(true);
    }
    expect(clinicalTrialOverlay("optional")).toEqual({});
    expect(clinicalTrialOverlay("required").design_required_any).toEqual(["rct", "early_phase_trial", "pragmatic_trial"]);
  });
});

// ---------------------------------------------------------------------------
// signal-mapping.json ↔ taxonomy.json contract (the MeSH check, applied to the taxonomy side)
// ---------------------------------------------------------------------------

type AssignBlock = Partial<Record<Axis, Record<string, number>>>;
type Rule = {
  id: string;
  assign?: AssignBlock;
  refine?: Record<string, Record<string, AssignBlock>>;
  assign_notice?: string;
  assign_from_table?: boolean;
  assign_from_self_declared?: boolean;
  reliability?: number;
};

const RESOLVERS: Record<Axis, (id: string) => boolean> = {
  paradigm: isParadigmCategory,
  unit: isUnitLevel,
  design: isDesignId,
  materials: isMaterialsKind,
  objective: isObjectiveId,
};

function unresolvedIn(block: AssignBlock, where: string): string[] {
  const out: string[] = [];
  for (const [axis, values] of Object.entries(block)) {
    const resolve = RESOLVERS[axis as Axis];
    if (!resolve) {
      out.push(`${where}: ${axis} is not an axis`);
      continue;
    }
    for (const [id, p] of Object.entries(values ?? {})) {
      if (!resolve(id)) out.push(`${where}.${axis}.${id}`);
      if (typeof p !== "number" || p < 0 || p > 1) out.push(`${where}.${axis}.${id} = ${String(p)} is not a probability`);
    }
  }
  return out;
}

describe("signal-mapping.json ↔ taxonomy.json", () => {
  const rules = signalMapping.rules as Rule[];

  it("both files carry the same taxonomy version", () => {
    expect(signalMapping.version).toBe(TAXONOMY_VERSION);
  });

  it("every id in every assign and refine block resolves in the taxonomy (a typo would make the rule assign to nothing)", () => {
    const problems: string[] = [];
    for (const r of rules) {
      if (r.assign) problems.push(...unresolvedIn(r.assign, r.id));
      for (const [signal, byValue] of Object.entries(r.refine ?? {})) {
        for (const [value, block] of Object.entries(byValue)) problems.push(...unresolvedIn(block, `${r.id}.refine.${signal}.${value}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it("every rule assigns something: a block, a taxonomy path, a table, or the self-declared axes", () => {
    for (const r of rules) {
      const ways = [r.assign, r.assign_notice, r.assign_from_table, r.assign_from_self_declared].filter(Boolean).length;
      expect(ways, `${r.id} must assign in exactly one way`).toBe(1);
    }
  });

  it("every assign_notice path points at a table in taxonomy.opportunity_profile", () => {
    const paths = rules.filter((r) => r.assign_notice).map((r) => [r.id, r.assign_notice!] as const);
    expect(paths.length).toBeGreaterThan(0);
    for (const [id, path] of paths) {
      const m = /^taxonomy\.opportunity_profile\.(clinical_trial_designation\.(\w+)|activity_code_priors\[activity_code\])$/.exec(path);
      expect(m, `${id}: ${path}`).not.toBeNull();
      if (m![2]) expect(CLINICAL_TRIAL_DESIGNATION_IDS as readonly string[], `${id}: ${path}`).toContain(m![2]);
    }
  });

  it("the self-declared rule's reliability is the taxonomy's self_declared_current weight", () => {
    const r = rules.find((x) => x.id === "self_declared_axes")!;
    expect(r.reliability).toBe(reliability("self_declared_current"));
  });

  it("author positions map onto aggregation.role keys", () => {
    for (const [position, role] of Object.entries(signalMapping.author_position)) {
      expect(EVIDENCE_ROLE_IDS as readonly string[], `author_position.${position} → ${role}`).toContain(role);
    }
  });
});

// ---------------------------------------------------------------------------
// Loud failure
// ---------------------------------------------------------------------------

describe("unknown ids throw TaxonomyError naming the table and the id", () => {
  const cases: Array<[string, () => unknown, RegExp]> = [
    ["familyOf(design id)", () => familyOf("gwas"), /"gwas" in taxonomy\.json › paradigm\.categories/],
    ["categoriesOf", () => categoriesOf("wet_lab"), /paradigm\.families/],
    ["familyCompat", () => familyCompat("discovery", "Discovery"), /"Discovery" in taxonomy\.json › paradigm\.family_compat\.order/],
    ["categoryCompat", () => categoryCompat("clinical_trials", "trials"), /"trials" in taxonomy\.json › paradigm\.categories/],
    ["levelOf(level id)", () => levelOf("L1"), /"L1" in taxonomy\.json › unit\.levels\[\*\]\.units — that is a level id, not a unit/],
    ["unitsOf", () => unitsOf("L6"), /"L6" in taxonomy\.json › unit\.levels/],
    ["levelCompat", () => levelCompat("L1", "L6"), /unit\.level_compat\.order/],
    ["designGroupOf(category)", () => designGroupOf("clinical_trials"), /"clinical_trials" in taxonomy\.json › design\.groups\[\*\]/],
    ["designGroupOf(group id)", () => designGroupOf("interventional"), /that is a group id, not a design/],
    ["designsOf", () => designsOf("trials"), /design\.groups/],
    ["materialsGroupOf", () => materialsGroupOf("mouse"), /"mouse" in taxonomy\.json › materials\.kinds\[\*\]/],
    ["materialsOf", () => materialsOf("animal"), /materials\.kinds/],
    ["reliability", () => reliability("pubmed"), /"pubmed" in taxonomy\.json › aggregation\.reliability/],
    ["roleWeight", () => roleWeight("first"), /aggregation\.role/],
    ["floors", () => floors("Strong"), /"Strong" in taxonomy\.json › tiers/],
    ["confidenceCap", () => confidenceCap("bogus"), /"bogus_max_tier" in taxonomy\.json › confidence_caps/],
    ["exploratoryException", () => exploratoryException("aspiration"), /exploratory_exceptions/],
    ["exploratoryException(_comment)", () => exploratoryException("_comment"), /"_comment" in taxonomy\.json › exploratory_exceptions/],
    ["clinicalTrialOverlay(unknown)", () => clinicalTrialOverlay("unknown"), /"unknown" in taxonomy\.json › opportunity_profile\.clinical_trial_designation/],
  ];

  for (const [name, fn, message] of cases) {
    it(name, () => {
      expect(fn).toThrow(TaxonomyError);
      expect(fn).toThrow(message);
    });
  }

  it("the error carries the table path and the id as fields", () => {
    let caught: unknown;
    try {
      familyOf("constructor"); // prototype keys are not ids either
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TaxonomyError);
    expect((caught as TaxonomyError).table).toBe("paradigm.categories");
    expect((caught as TaxonomyError).id).toBe("constructor");
    expect((caught as TaxonomyError).name).toBe("TaxonomyError");
  });

  it("type guards reject prototype keys and neighbouring namespaces", () => {
    expect(isParadigmCategory("toString")).toBe(false);
    expect(isParadigmCategory("discovery")).toBe(false); // a family, not a category
    expect(isParadigmCategory("preclinical")).toBe(true); // both, by design
    expect(isUnitLevel("whole_animal")).toBe(false);
    expect(isDesignId("interventional")).toBe(false);
    expect(isMaterialsKind("non_human")).toBe(false);
    const tiers: Tier[] = ["strong", "moderate", "exploratory", "poor"];
    for (const t of tiers) expect(isTier(t)).toBe(true);
    expect(isTier("Strong")).toBe(false);
    expect(isTier("_comment")).toBe(false);
    expect(() => floors("_comment")).toThrow(TaxonomyError);
  });
});

describe("1.1 validator follow-ups", () => {
  it("fixture case 6a's paradigm.required_any keys are paradigm categories (D14)", () => {
    const cases = (adversarial as { cases: Array<{ id: string; opportunity?: { paradigm?: { required_any?: Record<string, number> } } }> }).cases;
    const withAny = cases.filter((c) => c.opportunity?.paradigm?.required_any);
    expect(withAny.length).toBeGreaterThan(0);
    for (const c of withAny) for (const id of Object.keys(c.opportunity!.paradigm!.required_any!)) expect(isParadigmCategory(id), `${c.id}: ${id}`).toBe(true);
  });

  it("signal-mapping has rules to check (the assign-id test must not pass vacuously)", () => {
    expect((signalMapping as { rules: unknown[] }).rules.length).toBeGreaterThan(50);
  });
});

import { describe, expect, it } from "vitest";
import { methods } from "@/lib/fit/engine/methods";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { methodsParams } from "@/lib/fit/taxonomy";
import type { InfrastructureContext } from "@/lib/fit/types";

const P = methodsParams();
const run = (i: Partial<FixtureInvestigator>, o: FixtureOpportunity, infrastructure: InfrastructureContext | null = null) =>
  methods(hydrateInvestigator("i", { paradigm: { recent: {} }, ...i }), hydrateOpportunity("o", o), { ...hydrateContext({ paradigm: { recent: {} } }), infrastructure });

describe("stage 6 · methods and capabilities (§7 stage 6)", () => {
  it("M = share of the notice's capabilities with evidence ≥ evidence_min", () => {
    // Fixture case 4: design group [secondary_data_analysis 0.9, gwas 0.85] met; expected cohort_biobank_datasets 0.85 and genomic_datasets 0.95 met, ehr 0 missing → 3 / 4
    const r = run(
      { design: { secondary_data_analysis: 0.9, gwas: 0.85 }, materials: { genomic_datasets: 0.95, cohort_biobank_datasets: 0.85 } },
      { design: { required_any: ["secondary_data_analysis", "gwas"] }, materials: { expected: ["cohort_biobank_datasets", "genomic_datasets", "ehr"] } }
    );
    expect(r.M).toBe(0.75);
    expect(r.met).toEqual(["secondary_data_analysis | gwas", "cohort_biobank_datasets", "genomic_datasets"]);
    expect(r.missing).toEqual(["ehr"]);
  });

  it("evidence exactly at evidence_min counts; just under does not", () => {
    expect(run({ design: { rct: P.evidence_min } }, { design: { required_any: ["rct"] } }).M).toBe(1);
    expect(run({ design: { rct: P.evidence_min - 0.01 } }, { design: { required_any: ["rct"] } }).M).toBe(0);
  });

  it("required materials count each, required_any once as a set, expected each; a kind listed twice counts once", () => {
    const r = run(
      { materials: { enrolled_participants: 0.9, human_blood_fluids: 0.5 } },
      { materials: { required: ["enrolled_participants"], required_any: ["human_blood_fluids", "human_tissue_biopsy"], expected: ["enrolled_participants", "ehr"] } }
    );
    expect(r.items.map((i) => i.key)).toEqual(["materials:enrolled_participants", "materials:human_blood_fluids|human_tissue_biopsy", "materials:ehr"]);
    expect(r.M).toBeCloseTo(2 / 3, 10);
  });

  it("infrastructure the notice names joins the pool: the investigator's at 1, UCSF's at the institutional credit, the rest at 0", () => {
    const r = run({}, {}, { named: ["Biobank", "animal facility", "data enclave", " "], investigator: ["biobank"], institutional: ["Animal Facility"] });
    expect(r.items.map((i) => i.credit)).toEqual([1, P.institutional_infrastructure_credit, 0]);
    expect(r.M).toBeCloseTo((1 + P.institutional_infrastructure_credit) / 3, 10);
    expect(r.met).toEqual(["Biobank", "animal facility (institutional)"]);
    expect(r.missing).toEqual(["data enclave"]);
  });

  it("a notice that names nothing has no capability gap: M = 1", () => {
    expect(run({}, {})).toEqual({ M: 1, items: [], met: [], missing: [] });
  });
});

import { describe, expect, it } from "vitest";
import { compose } from "@/lib/fit/engine/compose";
import { objective } from "@/lib/fit/engine/objective";
import { hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import { composeExponents, relevanceWeights } from "@/lib/fit/taxonomy";
import type { Components } from "@/lib/fit/types";

const c = (over: Partial<Components>): Components => ({ E: 1, P: 1, U: 1, D: 1, T: 1, M: 1, O: 1, K: 1, A: 1, ...over });

describe("§8 composite S = 100 · C · R", () => {
  it("worked example 1: 0.95 topic, 0.20 paradigm, everything else perfect → S = 19.6", () => {
    const r = compose(c({ T: 0.95, P: 0.2 }));
    expect(r.C).toBeCloseTo(0.2, 10);
    expect(r.R).toBeCloseTo(0.98, 10);
    expect(r.S).toBeCloseTo(19.6, 10);
  });

  it("worked example 2: 0.55 topic, 0.90 paradigm, 0.85 design, 0.80 unit, others 0.7 → C 0.712, R 0.64, S 45.6", () => {
    const e = composeExponents();
    const r = compose(c({ T: 0.55, P: 0.9, D: 0.85, U: 0.8, M: 0.7, O: 0.7, K: 0.7, A: 0.7 }));
    expect(r.C).toBeCloseTo(Math.pow(0.9, e.P) * Math.pow(0.85, e.D) * Math.pow(0.8, e.U), 10);
    expect(r.C).toBeCloseTo(0.7126, 4);
    expect(r.R).toBeCloseTo(0.64, 10);
    expect(r.S).toBeCloseTo(45.6, 1);
  });

  it("E = 0 removes the candidate; the relevance weights are those of the taxonomy", () => {
    expect(compose(c({ E: 0 })).S).toBe(0);
    const w = relevanceWeights();
    expect(compose(c({ T: 0.5, M: 0, O: 0, K: 0, A: 0 })).R).toBeCloseTo(w.T * 0.5, 10);
    expect(compose(c({ P: 0 })).S).toBe(0);
  });
});

describe("objective O (§8 O term)", () => {
  it("weighted mean of the investigator's weight over the notice's objectives; nothing required is 1", () => {
    // Fixture case 4: notice {etiology_risk_factors 0.7, diagnostic_prognostic_prediction 0.6}; investigator etiology 0.6, diagnostic 0.5
    // O = (0.7 · 0.6 + 0.6 · 0.5) / 1.3 = 0.72 / 1.3
    const inv = hydrateInvestigator("i", { paradigm: { recent: {} }, objective: { methods_tool_development: 0.7, etiology_risk_factors: 0.6, diagnostic_prognostic_prediction: 0.5 } });
    const r = objective(inv, hydrateOpportunity("o", { objective: { etiology_risk_factors: 0.7, diagnostic_prognostic_prediction: 0.6 } }));
    expect(r.O).toBeCloseTo(0.72 / 1.3, 10);
    expect(r.terms).toEqual([
      { objective: "etiology_risk_factors", weight: 0.7, support: 0.6 },
      { objective: "diagnostic_prognostic_prediction", weight: 0.6, support: 0.5 },
    ]);
    expect(objective(inv, hydrateOpportunity("o", {}))).toEqual({ O: 1, terms: [], requirement: "none" });
    expect(objective(inv, hydrateOpportunity("o", { objective: { mechanism_discovery: 0.9 } })).O).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { NO_SUBJECT, ONE_SUBJECT, parseSaveGoldLabel } from "@/lib/fit/goldset/save";
import { pairKey } from "@/lib/fit/goldset/stratify";
import { PAIR, SYNTHETIC_PAIR } from "@/lib/fit/goldset/test-fixtures";

const PAIR2: ManifestPair = { ...PAIR, id: "g002", opportunity_id: "8b1c6b5e-4e0d-4c2a-9c7f-2f5f6a1b3c4d", stratum: "current" };
const byKey = new Map([
  [pairKey(PAIR.investigator_id, PAIR.opportunity_id), PAIR],
  [pairKey(SYNTHETIC_PAIR.investigator_id, SYNTHETIC_PAIR.opportunity_id), SYNTHETIC_PAIR],
]);
const label = { tier: "poor", reason: "wrong_research_type", axisReason: "unit:L4" };

describe("goldset/save · parseSaveGoldLabel (the action's validation)", () => {
  it("a real pair: two UUIDs naming a manifest pair and a valid label; the row gets investigator_id and no synthetic_source", () => {
    expect(parseSaveGoldLabel({ investigatorId: "x", opportunityId: PAIR.opportunity_id, tier: "strong" }, byKey)).toEqual({ ok: false, error: "Invalid investigator id." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: "y", tier: "strong" }, byKey)).toEqual({ ok: false, error: "Invalid opportunity id." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: PAIR2.opportunity_id, tier: "strong" }, byKey)).toEqual({ ok: false, error: "This pair is not in the gold set." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: PAIR.opportunity_id, tier: "poor", reason: "wrong_research_type" }, byKey)).toMatchObject({ ok: false, error: expect.stringMatching(/axis sub-reason/) });
    expect(parseSaveGoldLabel({ investigatorId: ` ${PAIR.investigator_id} `, opportunityId: PAIR.opportunity_id, ...label }, byKey)).toMatchObject({
      ok: true,
      value: { tier: "poor", reason: "wrong_research_type", axis_reason: "unit:L4", subject: PAIR.investigator_id, investigator_id: PAIR.investigator_id, synthetic_source: null, opportunity_id: PAIR.opportunity_id, pair: PAIR },
    });
  });

  it("exactly one subject: an investigator id or a synthetic source — never both, never neither", () => {
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, syntheticSource: SYNTHETIC_PAIR.synthetic_source, opportunityId: PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: ONE_SUBJECT });
    expect(parseSaveGoldLabel({ investigatorId: "", syntheticSource: "  ", opportunityId: PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: NO_SUBJECT });
    expect(parseSaveGoldLabel({ opportunityId: PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: NO_SUBJECT });
  });

  it("a synthetic pair: the fixture case as syntheticSource names the manifest pair; the row gets synthetic_source and a null investigator_id", () => {
    expect(parseSaveGoldLabel({ syntheticSource: ` ${SYNTHETIC_PAIR.synthetic_source} `, opportunityId: SYNTHETIC_PAIR.opportunity_id, tier: "poor", reason: "wrong_research_type", axisReason: "paradigm" }, byKey)).toMatchObject({
      ok: true,
      value: { tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm", subject: SYNTHETIC_PAIR.investigator_id, investigator_id: null, synthetic_source: SYNTHETIC_PAIR.synthetic_source, opportunity_id: SYNTHETIC_PAIR.opportunity_id, pair: SYNTHETIC_PAIR },
    });
    expect(parseSaveGoldLabel({ syntheticSource: "9_no_such_case", opportunityId: SYNTHETIC_PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: "This pair is not in the gold set." });
    expect(parseSaveGoldLabel({ syntheticSource: "synthetic:2_cvd_epi_vs_mito_mechanism", opportunityId: SYNTHETIC_PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: "Invalid synthetic source." });
    expect(parseSaveGoldLabel({ investigatorId: SYNTHETIC_PAIR.investigator_id, opportunityId: SYNTHETIC_PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: "A synthetic pair is named by its synthetic source, not by an investigator id." });
    expect(parseSaveGoldLabel({ syntheticSource: SYNTHETIC_PAIR.synthetic_source, opportunityId: PAIR.opportunity_id, ...label }, byKey)).toEqual({ ok: false, error: "This pair is not in the gold set." });
  });
});

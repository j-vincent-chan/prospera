import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBlindPostRules, BLIND_SYSTEM_PROMPT, BLIND_SYSTEM_PROMPT_VARIANT_2, buildCallAPrompt, buildCallBPrompt, CALL_A_RETURN, CALL_B_LEAD, CALL_B_RETURN, CALL_B_RETURN_SCOUT, combineVariants, lowerTier, pairMask, runBlindPass, SCOUT_FIELD, validateCallA, validateCallB, VARIANT_1_FRAMING, VARIANT_2_FRAMING } from "@/lib/fit/judge/blind";
import { maskLeaks } from "@/lib/fit/judge/mask";
import { JUDGE_MAX_TOKENS, type JudgeModelFn, type JudgeModelRequest } from "@/lib/fit/judge/model";
import { CALL_A_OK, callB, EVIDENCE_IDS, judgeInputs, stubModel } from "@/lib/fit/judge/test-fixtures";
import type { BlindCallB, BlindVariantResult } from "@/lib/fit/judge/types";

const spec = readFileSync(path.join(__dirname, "../../../../docs/fit-engine/prompts/blind-pass.md"), "utf8");

/** The first fenced block after the line matching `heading`. */
function blockAfter(heading: RegExp): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  expect(start, `heading ${heading} in the spec`).toBeGreaterThanOrEqual(0);
  const open = lines.findIndex((l, i) => i > start && l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
  return lines.slice(open + 1, close).join("\n");
}

describe("blind-pass.md carries the identical prompt (byte identity)", () => {
  it("the system prompt", () => {
    expect(blockAfter(/^## System prompt/)).toBe(BLIND_SYSTEM_PROMPT);
  });

  it("the Call A template: its header lines and its Return block, verbatim", () => {
    const block = blockAfter(/^## Call A user template/);
    expect(block).toContain(CALL_A_RETURN);
    const prompt = buildCallAPrompt(judgeInputs(), []);
    for (const line of ["EVIDENCE (topic terms masked):", "NOTICE (topic terms masked):", "Section I:", "Non-responsive:"]) {
      expect(block).toContain(line);
      expect(prompt).toContain(line);
    }
    expect(prompt.endsWith(CALL_A_RETURN)).toBe(true);
  });

  it("the Call B template: the lead-in sentence, the section labels and its Return block, verbatim", () => {
    const block = blockAfter(/^## Call B user template/);
    expect(block.startsWith(CALL_B_LEAD)).toBe(true);
    expect(block).toContain(CALL_B_RETURN);
    const prompt = buildCallBPrompt(judgeInputs(), "{}", false);
    for (const line of ["EVIDENCE (unmasked):", "NOTICE (unmasked):", "COLLABORATORS:"]) {
      expect(block).toContain(line);
      expect(prompt).toContain(line);
    }
    expect(prompt.startsWith(`${CALL_B_LEAD}\n{}\n`)).toBe(true);
    expect(prompt.endsWith(CALL_B_RETURN)).toBe(true);
  });

  it("variant 2 is the same prompt with the spec's program-officer framing; the scout field is the spec's, appended after rationale", () => {
    expect(spec).toContain(VARIANT_2_FRAMING);
    expect(BLIND_SYSTEM_PROMPT.startsWith(VARIANT_1_FRAMING)).toBe(true);
    expect(BLIND_SYSTEM_PROMPT_VARIANT_2).toBe(`${VARIANT_2_FRAMING}${BLIND_SYSTEM_PROMPT.slice(VARIANT_1_FRAMING.length)}`);
    expect(spec).toContain(SCOUT_FIELD);
    expect(CALL_B_RETURN_SCOUT).toContain(SCOUT_FIELD);
    expect(CALL_B_RETURN_SCOUT).not.toBe(CALL_B_RETURN);
    expect(buildCallBPrompt(judgeInputs(), "{}", true).endsWith(CALL_B_RETURN_SCOUT)).toBe(true);
  });
});

describe("blind · masking in Call A only", () => {
  it("Call A carries no topic term of either side; Call B carries the unmasked text, eligibility, team and collaborators", () => {
    const inputs = judgeInputs();
    const mask = pairMask(inputs, [{ name: "Lupus Erythematosus, Systemic", tree_numbers: ["C17.300.480", "C20.111.590"], ui: "D008180" }]);
    const a = buildCallAPrompt(inputs, mask);
    expect(maskLeaks(a, mask)).toEqual([]);
    expect(a).not.toMatch(/lupus/i);
    expect(a).not.toMatch(/interferon signature/i);
    expect(a).toContain("randomized phase II trial");
    expect(a).toContain("[PMID:31000001] publication · 2024 · role: first last corresponding");
    expect(a).not.toContain("Multiple PDs/PIs");
    const b = buildCallBPrompt(inputs, JSON.stringify(CALL_A_OK), false);
    expect(b).toMatch(/systemic lupus erythematosus/i);
    expect(b).toContain("Multiple PDs/PIs are not allowed");
    expect(b).toContain("- R. Immunologist:");
    expect(b).toContain(JSON.stringify(CALL_A_OK));
  });
});

describe("blind · validation (spec §16 guardrails 1–2; blind-pass.md post-rule)", () => {
  it("Call A: ids not in the input are dropped and logged, enums checked, a missing paradigm_fit makes the reply unusable", () => {
    const v = validateCallA({ ...CALL_A_OK, investigator_paradigm: { ...CALL_A_OK.investigator_paradigm, evidence_ids: ["PMID:31000001", "PMID:99999999", "[NCT04000001]"] }, unit_fit: "close" }, EVIDENCE_IDS);
    expect(v.usable).toBe(true);
    expect(v.a!.investigator_paradigm.evidence_ids).toEqual(["PMID:31000001", "NCT04000001"]);
    expect(v.dropped).toEqual(expect.arrayContaining([expect.stringContaining("id not in the input (PMID:99999999)"), expect.stringContaining("unit_fit missing or unknown (close)")]));
    expect(v.a!.unit_fit).toBeNull();
    expect(validateCallA({ ...CALL_A_OK, paradigm_fit: "excellent" }, EVIDENCE_IDS).usable).toBe(false);
    expect(validateCallA("nope", EVIDENCE_IDS)).toMatchObject({ a: null, usable: false });
  });

  it("Call B: a missing verdict is unusable; unknown ids dropped; a collaborator outside the list dropped; latent_fit needs the scout and two ids", () => {
    expect(validateCallB(callB("strong", { verdict: "great" }), EVIDENCE_IDS, { scout: false, collaborators: [] })).toMatchObject({ b: null, usable: false });
    const v = validateCallB(callB("moderate", { topic_evidence_ids: ["PMID:31000001", "PMID:1"], collaborator_suggestion: "Dr. Nobody", latent_fit: { found: true, shape: "asset_ownership", explanation: "x", evidence_ids: ["NCT04000001", "PMID:31000001"] } }), EVIDENCE_IDS, { scout: false, collaborators: ["R. Immunologist"] });
    expect(v.usable).toBe(true);
    expect(v.b!.topic_evidence_ids).toEqual(["PMID:31000001"]);
    expect(v.b!.collaborator_suggestion).toBeNull();
    expect(v.b!.latent_fit).toBeNull();
    expect(v.dropped).toEqual(expect.arrayContaining([expect.stringContaining("PMID:1"), expect.stringContaining("collaborator_suggestion: not in COLLABORATORS"), expect.stringContaining("latent_fit: given outside the scout variant")]));
    const scout = validateCallB(callB("poor", { latent_fit: { found: true, shape: "trajectory", explanation: "x", evidence_ids: ["NCT04000001"] } }), EVIDENCE_IDS, { scout: true, collaborators: [] });
    expect(scout.b!.latent_fit).toEqual({ found: false, shape: "trajectory", explanation: "x", evidence_ids: ["NCT04000001"] });
    const found = validateCallB(callB("poor", { latent_fit: { found: true, shape: "team_shape", explanation: "x", evidence_ids: ["NCT04000001", "biosketch:statement"] } }), EVIDENCE_IDS, { scout: true, collaborators: [] });
    expect(found.b!.latent_fit!.found).toBe(true);
    expect(validateCallB(callB("strong", { collaborator_suggestion: "R. Immunologist" }), EVIDENCE_IDS, { scout: false, collaborators: ["R. Immunologist"] }).b!.collaborator_suggestion).toBe("R. Immunologist");
  });

  it("post-rules: a gate-level counter-case lowers one tier; a Strong that contradicts its own design field is rejected to Exploratory; no grounded claim voids the verdict", () => {
    const a = validateCallA(CALL_A_OK, EVIDENCE_IDS).a!;
    const b = (over: Record<string, unknown>) => validateCallB(callB("strong", over), EVIDENCE_IDS, { scout: false, collaborators: [] }).b as BlindCallB;
    expect(applyBlindPostRules(a, b({}), EVIDENCE_IDS)).toEqual({ verdict: "strong", grounded: true, lowered: [] });
    expect(applyBlindPostRules(a, b({ counter_case_is_gate_level: true }), EVIDENCE_IDS)).toMatchObject({ verdict: "moderate", lowered: [expect.stringContaining("counter-case is gate-level")] });
    expect(applyBlindPostRules(a, b({ verdict: "moderate", counter_case_is_gate_level: true }), EVIDENCE_IDS).verdict).toBe("exploratory");
    expect(applyBlindPostRules(a, b({ verdict: "exploratory", counter_case_is_gate_level: true }), EVIDENCE_IDS).verdict).toBe("exploratory");
    const contradicting = { ...a, design: { ...a.design, unmet_required: ["clinical trial"] } };
    expect(applyBlindPostRules(contradicting, b({}), EVIDENCE_IDS)).toMatchObject({ verdict: "exploratory", lowered: [expect.stringContaining("contradicts the structural fields")] });
    expect(applyBlindPostRules({ ...a, paradigm_fit: "incompatible" }, b({}), EVIDENCE_IDS).verdict).toBe("exploratory");
    const bare = { ...a, investigator_paradigm: { ...a.investigator_paradigm, evidence_ids: [] }, design: { ...a.design, evidence_ids: [] } };
    expect(applyBlindPostRules(bare, b({ topic_evidence_ids: [], rationale: "No ids here." }), EVIDENCE_IDS)).toMatchObject({ verdict: null, grounded: false });
    expect(applyBlindPostRules(bare, b({ topic_evidence_ids: [], rationale: "Cites NCT04000001 in prose." }), EVIDENCE_IDS).grounded).toBe(true);
    expect(lowerTier("poor")).toBe("poor");
  });

  it("combining variants: the lower verdict wins; two tiers apart voids the blind signal (R8); one unusable variant leaves the other", () => {
    const variant = (variant: 1 | 2, verdict: "strong" | "moderate" | "exploratory" | "poor" | null, usable = true): BlindVariantResult => ({ variant, a: null, b: null, verdict_raw: verdict, verdict, grounded: verdict !== null, lowered: [], usable, dropped: [], calls: usable ? 2 : 0 });
    expect(combineVariants([variant(1, "strong"), variant(2, "moderate")], false)).toMatchObject({ verdict: "moderate", self_consistent: true, calls: 4 });
    expect(combineVariants([variant(1, "strong"), variant(2, "exploratory")], false)).toMatchObject({ verdict: null, self_consistent: false });
    expect(combineVariants([variant(1, "poor"), variant(2, "strong")], false)).toMatchObject({ verdict: null, self_consistent: false });
    expect(combineVariants([variant(1, "strong"), variant(2, null, false)], false)).toMatchObject({ verdict: "strong", self_consistent: true, calls: 2 });
    expect(combineVariants([variant(1, null, false), variant(2, null, false)], true)).toMatchObject({ verdict: null, self_consistent: true, scout: true, calls: 0 });
  });
});

describe("blind · runBlindPass with a stub model", () => {
  it("makes Call A then Call B per variant with the variant's system prompt and the spec's max_tokens, and combines the verdicts", async () => {
    const { fn, calls } = stubModel({ blind_a: CALL_A_OK, blind_b: (req: JudgeModelRequest) => callB(req.variant === 2 ? "moderate" : "strong") });
    const r = await runBlindPass(judgeInputs(), { model: fn, modelName: "test-model", variants: 2 });
    expect(calls.map((c) => `${c.purpose}${c.variant}`)).toEqual(["blind_a1", "blind_b1", "blind_a2", "blind_b2"]);
    expect(calls[0]).toMatchObject({ system: BLIND_SYSTEM_PROMPT, model: "test-model", maxTokens: JUDGE_MAX_TOKENS.blind_a });
    expect(calls[2]!.system).toBe(BLIND_SYSTEM_PROMPT_VARIANT_2);
    expect(calls[1]!.user).toContain(JSON.stringify(validateCallA(CALL_A_OK, EVIDENCE_IDS).a, null, 1));
    expect(r).toMatchObject({ verdict: "moderate", self_consistent: true, calls: 4, scout: false, evidence_ids: EVIDENCE_IDS });
    expect(r.variants.map((v) => v.verdict)).toEqual(["strong", "moderate"]);
  });

  it("a reply that is not JSON, or is cut off, is unusable and leaves no verdict (never cached); the budget stops calls", async () => {
    const bad = stubModel({ blind_a: "not json", blind_b: callB("strong") });
    const r = await runBlindPass(judgeInputs(), { model: bad.fn, modelName: "m", variants: 1 });
    expect(r.variants[0]).toMatchObject({ usable: false, verdict: null, calls: 1, dropped: [expect.stringContaining("not valid JSON")] });
    expect(r.verdict).toBeNull();
    const cut = { fn: (async (req: JudgeModelRequest) => (req.purpose === "blind_b" ? { content: JSON.stringify(callB("strong")), finish_reason: "length" } : JSON.stringify(CALL_A_OK))) as JudgeModelFn };
    const r2 = await runBlindPass(judgeInputs(), { model: cut.fn, modelName: "m", variants: 1 });
    expect(r2.variants[0]).toMatchObject({ usable: false, verdict: null, dropped: [expect.stringContaining("truncated by max_tokens")] });
    let left = 2;
    const budget = stubModel({ blind_a: CALL_A_OK, blind_b: callB("strong") });
    const r3 = await runBlindPass(judgeInputs(), { model: budget.fn, modelName: "m", variants: 2, takeCall: () => (left > 0 ? (left -= 1, true) : false) });
    expect(budget.calls).toHaveLength(2);
    expect(r3.variants[1]).toMatchObject({ usable: false, calls: 0, dropped: ["call A: not made (model budget spent or past the deadline)"] });
    expect(r3.verdict).toBe("strong");
  });

  it("the scout variant asks Call B for latent_fit and surfaces a finding with two cited ids", async () => {
    const { fn, calls } = stubModel({ blind_a: CALL_A_OK, blind_b: callB("poor", { latent_fit: { found: true, shape: "methodological_transfer", explanation: "Adaptive designs transfer.", evidence_ids: ["NCT04000001", "5R01AR070001"] } }) });
    const r = await runBlindPass(judgeInputs(), { model: fn, modelName: "m", variants: 1, scout: true });
    expect(calls[1]!.user.endsWith(CALL_B_RETURN_SCOUT)).toBe(true);
    expect(r.latent_fit).toEqual({ found: true, shape: "methodological_transfer", explanation: "Adaptive designs transfer.", evidence_ids: ["NCT04000001", "5R01AR070001"] });
    expect(r.scout).toBe(true);
  });
});

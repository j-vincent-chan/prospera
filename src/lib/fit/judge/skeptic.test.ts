import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGE_MAX_TOKENS } from "@/lib/fit/judge/model";
import { buildSkepticPrompt, characteristicsLine, isGateLevelKind, NOTICE_REFS, runSkeptic, SKEPTIC_RETURN, SKEPTIC_SYSTEM_PROMPT, validateSkeptic } from "@/lib/fit/judge/skeptic";
import { EVIDENCE_IDS, judgeInputs, SKEPTIC_NONE, skepticReply, stubModel } from "@/lib/fit/judge/test-fixtures";

const spec = readFileSync(path.join(__dirname, "../../../../docs/fit-engine/prompts/skeptic.md"), "utf8");

function blockAfter(heading: RegExp): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const open = lines.findIndex((l, i) => i > start && l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
  return lines.slice(open + 1, close).join("\n");
}

describe("skeptic.md carries the identical prompt (byte identity)", () => {
  it("the system prompt and the user template's Return block", () => {
    expect(blockAfter(/^## System prompt/)).toBe(SKEPTIC_SYSTEM_PROMPT);
    const block = blockAfter(/^## User template/);
    expect(block).toContain(SKEPTIC_RETURN);
    const prompt = buildSkepticPrompt(judgeInputs());
    for (const line of ["NOTICE: ", "Section I:", "Non-responsive:", "Eligibility (III.3):", "EVIDENCE:", "INVESTIGATOR CHARACTERISTICS:"]) {
      expect(block).toContain(line);
      expect(prompt).toContain(line);
    }
    expect(prompt.startsWith("NOTICE: RFA-AR-27-001 · Novel Therapeutics in Systemic Lupus (R01 Clinical Trial Required) · R01 · clinical trial: required\nSection I:\n")).toBe(true);
    expect(prompt.endsWith(SKEPTIC_RETURN)).toBe(true);
    expect(prompt).not.toContain("Team:");
  });

  it("the characteristics line carries facts only — rank, mechanisms, trial PI count, active awards", () => {
    expect(characteristicsLine(judgeInputs().characteristics)).toBe("INVESTIGATOR CHARACTERISTICS: rank/title Associate Professor (md clinician investigator), mechanisms held K23, R01, U01, trial PI count 4, active awards 2, degrees MD");
    expect(characteristicsLine({ career_stage: null, esi: true, esi_eligible_until: null, mechanisms_held: [], active_awards: 0, clinical_role: null, trial_pi_count: 0, degrees: [], title_series: null })).toBe("INVESTIGATOR CHARACTERISTICS: rank/title unknown, mechanisms held none, trial PI count 0, active awards 0, early-stage investigator");
  });
});

describe("skeptic · validation and post-rules (skeptic.md)", () => {
  it("the kind decides gate_level (the model's boolean is logged when it disagrees); an objection with a verifying id is grounded", () => {
    const v = validateSkeptic(skepticReply("design", { gate_level: false }), EVIDENCE_IDS);
    expect(v.usable).toBe(true);
    expect(v.result).toMatchObject({ objection: "A design problem.", objection_kind: "design", gate_level: true, grounded: true, evidence_ids: ["PMID:31000001"], confidence: "medium" });
    expect(v.result.dropped).toEqual([expect.stringContaining("gate_level false disagrees with the kind design")]);
    expect(validateSkeptic(skepticReply("scale_role"), EVIDENCE_IDS).result).toMatchObject({ gate_level: false, grounded: true });
    expect(validateSkeptic(skepticReply("topic"), EVIDENCE_IDS).result).toMatchObject({ gate_level: false });
    for (const k of ["eligibility", "paradigm", "design", "unit_materials"] as const) expect(isGateLevelKind(k)).toBe(true);
  });

  it("an objection citing no id in the input is ungrounded (ids not in the input are dropped and logged); a notice reference counts", () => {
    const v = validateSkeptic(skepticReply("paradigm", { evidence_ids: ["PMID:1", "grant:none"] }), EVIDENCE_IDS);
    expect(v.result).toMatchObject({ grounded: false, evidence_ids: [] });
    expect(v.result.dropped).toEqual(expect.arrayContaining([expect.stringContaining("id not in the input (PMID:1)"), "objection cites no id in the input; recorded as ungrounded"]));
    const n = validateSkeptic(skepticReply("design", { evidence_ids: ["notice:non_responsive"] }), EVIDENCE_IDS);
    expect(n.result).toMatchObject({ grounded: true, evidence_ids: ["notice:non_responsive"] });
    expect(NOTICE_REFS).toContain("notice:non_responsive");
  });

  it("no objection is a usable reply; a missing objection field or a non-object is unusable; an unknown kind reads as topic", () => {
    expect(validateSkeptic(SKEPTIC_NONE, EVIDENCE_IDS)).toMatchObject({ usable: true, result: { objection: null, objection_kind: null, gate_level: false, grounded: false, usable: true } });
    expect(validateSkeptic({ confidence: "high" }, EVIDENCE_IDS)).toMatchObject({ usable: false });
    expect(validateSkeptic(null, EVIDENCE_IDS)).toMatchObject({ usable: false });
    const unknown = validateSkeptic(skepticReply("vibes"), EVIDENCE_IDS);
    expect(unknown.result).toMatchObject({ objection_kind: "topic", gate_level: false });
    expect(unknown.result.dropped).toEqual(expect.arrayContaining([expect.stringContaining("objection_kind missing or unknown (vibes)")]));
  });

  it("runSkeptic makes one call at the spec's ceiling, and none when the budget is spent", async () => {
    const { fn, calls } = stubModel({ skeptic: skepticReply("design") });
    const r = await runSkeptic(judgeInputs(), { model: fn, modelName: "m" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ purpose: "skeptic", system: SKEPTIC_SYSTEM_PROMPT, maxTokens: JUDGE_MAX_TOKENS.skeptic });
    expect(r).toMatchObject({ objection_kind: "design", gate_level: true, grounded: true, usable: true, calls: 1 });
    expect(await runSkeptic(judgeInputs(), { model: fn, modelName: "m", takeCall: () => false })).toBeNull();
    const bad = stubModel({ skeptic: "not json" });
    expect(await runSkeptic(judgeInputs(), { model: bad.fn, modelName: "m" })).toMatchObject({ usable: false, objection: null, dropped: expect.arrayContaining([expect.stringContaining("not valid JSON")]) });
  });
});

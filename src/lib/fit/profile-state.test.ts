/**
 * What the ranking could not use (PR 3.2b's `profileGaps`, kept in the fit-UX
 * merge and folded into the card footer the branch already draws).
 *
 * `evidenceSources`, `profileState` and #61's `newestComputedAt` are gone with
 * the second provenance surface they fed — see the module header for what says
 * each of those things now.
 */
import { describe, expect, it } from "vitest";
import { isEngineValueText } from "@/lib/fit/decision-text";
import { profileGaps, type ProfileStateRow } from "@/lib/fit/profile-state";

const row = (over: Partial<ProfileStateRow> = {}): ProfileStateRow => ({
  pending_items: 0,
  confidence: { paradigm: "high", unit: "high", design: "high", materials: "high", objective: "high", topic: "high" },
  evidence_summary: { publications_verified: 187, grants: 22, trials: 5, trials_as_pi: 1, biosketch: "on_file", self_declared: true },
  ...over,
});

describe("profile-state · a complete profile has nothing to report", () => {
  it("is empty when every source is on file and every axis is read confidently", () => {
    expect(profileGaps(row())).toEqual([]);
  });
});

describe("profile-state · what it could not use", () => {
  it("names a missing source, a missing self-declaration, a low-confidence axis and the queue", () => {
    expect(profileGaps(row({ evidence_summary: { publications_verified: 187, grants: 0, trials: 0, trials_as_pi: 0, biosketch: "not_requested", self_declared: false } }))).toEqual([
      "no biosketch on file",
      "no self-declared research axes",
      "no NIH awards on file",
    ]);
    expect(profileGaps(row({ pending_items: 12, confidence: { ...row().confidence, design: "low", materials: "low" } }))).toEqual([
      "study design, materials and data read at low confidence",
      "12 items still waiting to be classified",
    ]);
    expect(profileGaps(row({ pending_items: 1 }))).toEqual(["1 item still waiting to be classified"]);
  });

  it("counts a biosketch as usable only once it is on file", () => {
    expect(profileGaps(row({ evidence_summary: { ...row().evidence_summary!, biosketch: "requested" } }))).toContain("no biosketch on file");
    expect(profileGaps(row({ evidence_summary: { ...row().evidence_summary!, biosketch: "available" } }))).not.toContain("no biosketch on file");
    expect(profileGaps(row({ evidence_summary: null }))).toEqual(["no biosketch on file", "no self-declared research axes", "no verified publications", "no NIH awards on file"]);
  });
});

describe("profile-state · the footer never carries an engine value", () => {
  it("every gap is a whole count or a word, so `isEngineValueText` is false on the joined line", () => {
    const gaps = profileGaps(row({ pending_items: 12, confidence: { ...row().confidence, design: "low" }, evidence_summary: { publications_verified: 0, grants: 0, trials: 0, trials_as_pi: 0, biosketch: "not_requested", self_declared: false } }));
    expect(gaps.length).toBe(6);
    expect(isEngineValueText(gaps.join("; "))).toBe(false);
  });
});

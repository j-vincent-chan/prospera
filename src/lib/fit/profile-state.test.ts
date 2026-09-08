/**
 * The profile-state line (PR 3.2b): what the ranking ran on, when it ran, and
 * — the part that changes a decision — what it could not use.
 */
import { describe, expect, it } from "vitest";
import { evidenceSources, newestComputedAt, profileGaps, profileState, type ProfileStateRow } from "@/lib/fit/profile-state";

const row = (over: Partial<ProfileStateRow> = {}): ProfileStateRow => ({
  taxonomy_version: "2026.09",
  item_count: 214,
  pending_items: 0,
  computed_at: "2026-09-05T04:10:00Z",
  confidence: { paradigm: "high", unit: "high", design: "high", materials: "high", objective: "high", topic: "high" },
  evidence_summary: { publications_verified: 187, grants: 22, trials: 5, trials_as_pi: 1, biosketch: "on_file", self_declared: true },
  ...over,
});

describe("profile-state · what the ranking read", () => {
  it("names the evidence kinds behind the count and drops the empty ones", () => {
    expect(evidenceSources({ publications_verified: 187, grants: 22, trials: 5 })).toEqual(["187 verified publications", "22 NIH awards", "5 registered trials"]);
    expect(evidenceSources({ publications_verified: 1, grants: 0, trials: 0 })).toEqual(["1 verified publication"]);
    expect(evidenceSources(null)).toEqual([]);
  });

  it("carries the profile's own timestamp beside the ranking's", () => {
    const s = profileState(row(), "2026-09-06T09:45:00Z");
    expect(s).toMatchObject({ missing: false, itemCount: 214, builtAt: "2026-09-05T04:10:00Z", rankedAt: "2026-09-06T09:45:00Z", taxonomyVersion: "2026.09", gaps: [] });
  });

  it("says so when there is no profile at all", () => {
    expect(profileState(null, null)).toMatchObject({ missing: true, itemCount: null, sources: [], gaps: [] });
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

describe("profile-state · newestComputedAt", () => {
  it("is the newest shown row, and null when nothing is shown", () => {
    expect(newestComputedAt([{ computed_at: "2026-09-01T00:00:00Z" }, { computed_at: "2026-09-06T09:45:00Z" }, { computed_at: null }])).toBe("2026-09-06T09:45:00Z");
    expect(newestComputedAt([])).toBeNull();
    expect(newestComputedAt([{ computed_at: null }])).toBeNull();
  });
});

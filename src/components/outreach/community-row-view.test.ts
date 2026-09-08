/**
 * A community on the row grammar (fit-UX PR 3; README §"Screens / views" 3).
 */
import { describe, expect, it } from "vitest";
import { alignmentChip, communityCaveat, communityChips, communityReason, communityState, COMMUNITY_LABEL_PILL, COMMUNITY_LABEL_TEXT, isCollapsed, isSuggested, type CommunityRowInput } from "@/components/outreach/community-row-view";
import type { CommunityTier } from "@/lib/outreach/types";

const TIERS: CommunityTier[] = ["strong", "potential", "not_suggested", "cant_evaluate", "inactive"];

const community = (over: Partial<CommunityRowInput> = {}): CommunityRowInput => ({
  tier: "strong",
  reason: "11 of 41 members work on neuroimmune signalling.",
  alignment: [],
  memberMatches: 11,
  memberTotal: 41,
  tagged: false,
  dismissed: false,
  evaluatedAt: "2026-09-04",
  ...over,
});

describe("the label", () => {
  it("every tier has a word and a distinct-enough pill; the two maps cover the union", () => {
    for (const t of TIERS) {
      expect(COMMUNITY_LABEL_TEXT[t]).toMatch(/\S/);
      expect(COMMUNITY_LABEL_PILL[t]).toMatch(/^tier-.*-square$/);
    }
    // the two that carry a Tag action are the two the row draws in teal
    expect(COMMUNITY_LABEL_PILL.strong).toBe("tier-strong-square");
    expect(COMMUNITY_LABEL_PILL.potential).toBe("tier-moderate-square");
  });

  it("suggested is exactly the two tiers that produce a Tag action", () => {
    expect(TIERS.filter((tier) => isSuggested({ tier }))).toEqual(["strong", "potential"]);
  });
});

describe("collapsing (README §\"Screens / views\" 3)", () => {
  it("a matching or tagged community keeps the full row", () => {
    expect(isCollapsed(community({ tier: "strong" }))).toBe(false);
    expect(isCollapsed(community({ tier: "potential" }))).toBe(false);
    expect(isCollapsed(community({ tier: "inactive", tagged: true }))).toBe(false);
  });

  it("every other monitored community collapses to one line — including a dismissed match", () => {
    expect(isCollapsed(community({ tier: "not_suggested" }))).toBe(true);
    expect(isCollapsed(community({ tier: "cant_evaluate" }))).toBe(true);
    expect(isCollapsed(community({ tier: "inactive" }))).toBe(true);
    expect(isCollapsed(community({ tier: "strong", dismissed: true }))).toBe(true);
  });
});

describe("communityState", () => {
  it("a person's decision is named, and says whether the run agreed", () => {
    expect(communityState(community({ tagged: true, tier: "strong" }))).toBe("Tagged · also suggested");
    expect(communityState(community({ tagged: true, tier: "not_suggested" }))).toBe("Tagged by you");
    expect(communityState(community({ dismissed: true }))).toBe("Dismissed by you");
  });

  it("nobody has decided: no state, and the label carries the row alone", () => {
    expect(communityState(community())).toBeNull();
  });
});

describe("communityCaveat — only when there is a fact to write", () => {
  it("an unassessable community says so", () => {
    expect(communityCaveat(community({ tier: "cant_evaluate" }))).toMatchObject({ tone: "caution" });
    expect(communityCaveat(community({ tier: "inactive" }))!.text).toMatch(/not assessed/i);
  });

  it("nobody in the group matching is the fact the reason does not carry", () => {
    expect(communityCaveat(community({ tier: "not_suggested", memberMatches: 0, memberTotal: 41 }))!.text).toBe("No one of the 41 members works on what this notice funds.");
  });

  it("a match with members says nothing extra rather than filling the slot", () => {
    expect(communityCaveat(community())).toBeNull();
    expect(communityCaveat(community({ memberTotal: 0, memberMatches: 0 }))).toBeNull();
  });
});

describe("communityReason (L1)", () => {
  it("the evaluation's own sentence when it can be said", () => {
    expect(communityReason(community())).toBe("11 of 41 members work on neuroimmune signalling.");
  });

  it("the counts when it cannot — never a blank slot, and never the engine's numbers", () => {
    expect(communityReason(community({ reason: "Topic 0.30 is below the Exploratory floor 0.35" }))).toBe("11 of 41 members match what this notice funds.");
    expect(communityReason(community({ reason: "", memberTotal: 1, memberMatches: 1 }))).toBe("1 of 1 member matches what this notice funds.");
  });
});

describe("alignmentChip (L1)", () => {
  it("keeps a term as written", () => {
    expect(alignmentChip("neuroimmune signalling")).toBe("neuroimmune signalling");
  });

  it("drops the value half of a checklist value and opens out the id", () => {
    // The live defect: `outreach/suggest.ts` slices a member's checklist value
    // on `", "`, so the first term arrives with the component value on it.
    expect(alignmentChip("0.33 · human_primary_cells")).toBe("human primary cells");
    expect(alignmentChip("62% · rct")).toBe("rct");
  });

  it("drops an absence, which is not something the community aligns on", () => {
    expect(alignmentChip("missing human_primary_cells")).toBeNull();
    expect(alignmentChip("0.33 · missing human_primary_cells")).toBeNull();
  });

  it("drops a term with nothing left after the guard", () => {
    expect(alignmentChip("0.33")).toBeNull();
    expect(alignmentChip("C12.777.419.780")).toBeNull();
    expect(alignmentChip("   ")).toBeNull();
  });
});

describe("communityChips", () => {
  it("what it aligns on, capped, then the member count", () => {
    const chips = communityChips(community({ alignment: ["neuroimmune signalling", "nociception", "chronic pain", "microglia"] }));
    expect(chips.map((c) => c.text)).toEqual(["neuroimmune signalling", "nociception", "chronic pain", "11 of 41 members"]);
    expect(chips.every((c) => c.tone === "ok")).toBe(true);
  });

  it("the cap counts the chips it kept, not the terms it was given (L1)", () => {
    // A dropped term must not eat one of the three slots, or a row whose first
    // three terms are all values shows nothing but the member count.
    const chips = communityChips(community({ alignment: ["0.33", "0.9", "missing rct", "neuroimmune signalling", "nociception", "chronic pain", "microglia"] }));
    expect(chips.map((c) => c.text)).toEqual(["neuroimmune signalling", "nociception", "chronic pain", "11 of 41 members"]);
  });

  it("names a term once, however many members contributed it", () => {
    expect(communityChips(community({ alignment: ["nociception", "Nociception", "0.5 · nociception"] })).map((c) => c.text)).toEqual(["nociception", "11 of 41 members"]);
  });

  it("no members matching is a caution, not a neutral fact", () => {
    expect(communityChips(community({ alignment: [], memberMatches: 0 }))).toEqual([{ text: "0 of 41 members", tone: "caution" }]);
  });

  it("an unevaluated community has no counts to show", () => {
    expect(communityChips(community({ alignment: [], memberTotal: 0, memberMatches: 0 }))).toEqual([]);
  });
});

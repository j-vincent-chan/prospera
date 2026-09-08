/**
 * A community on the row grammar (fit-UX PR 3; README §"Screens / views" 3).
 */
import { describe, expect, it } from "vitest";
import { communityCaveat, communityChips, communityState, COMMUNITY_LABEL_PILL, COMMUNITY_LABEL_TEXT, isCollapsed, isSuggested, type CommunityRowInput } from "@/components/outreach/community-row-view";
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

describe("communityChips", () => {
  it("what it aligns on, capped, then the member count", () => {
    const chips = communityChips(community({ alignment: ["neuroimmune signalling", "nociception", "chronic pain", "microglia"] }));
    expect(chips.map((c) => c.text)).toEqual(["neuroimmune signalling", "nociception", "chronic pain", "11 of 41 members"]);
    expect(chips.every((c) => c.tone === "ok")).toBe(true);
  });

  it("no members matching is a caution, not a neutral fact", () => {
    expect(communityChips(community({ alignment: [], memberMatches: 0 }))).toEqual([{ text: "0 of 41 members", tone: "caution" }]);
  });

  it("an unevaluated community has no counts to show", () => {
    expect(communityChips(community({ alignment: [], memberTotal: 0, memberMatches: 0 }))).toEqual([]);
  });
});

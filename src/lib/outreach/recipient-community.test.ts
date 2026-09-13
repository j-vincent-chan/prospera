import { describe, expect, it } from "vitest";
import { pickCommunity, type CommunityRef } from "@/lib/outreach/recipient-community";

const immunox: CommunityRef = { id: "c1", label: "ImmunoX", strategistId: "s1" };
const diabetes: CommunityRef = { id: "c2", label: "Diabetes Center", strategistId: "s2" };
const ighs: CommunityRef = { id: "c3", label: "IGHS", strategistId: null };

describe("pickCommunity", () => {
  it("prefers the community the sender is strategist for", () => {
    expect(pickCommunity({ memberships: [diabetes, immunox], primaryId: "c2", senderId: "s1" })).toBe("ImmunoX");
  });
  it("falls back to the primary community, then the first by label", () => {
    expect(pickCommunity({ memberships: [diabetes, immunox], primaryId: "c2", senderId: "s9" })).toBe("Diabetes Center");
    expect(pickCommunity({ memberships: [ighs, diabetes], primaryId: null, senderId: null })).toBe("Diabetes Center");
  });
  it("names nothing for a person on no roster", () => {
    expect(pickCommunity({ memberships: [], primaryId: "c1", senderId: "s1" })).toBeNull();
  });
});

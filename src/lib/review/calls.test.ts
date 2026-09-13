/** "Needs your call" / "Disagreements" (`lib/review/calls.ts`): pure, over decision records. */
import { describe, expect, it } from "vitest";
import { callCounts, callLine, disagreement, filterLabel, needsYourCall, passesFilter } from "@/lib/review/calls";
import type { MatchDecision } from "@/lib/review/decisions";

const d = (over: Partial<MatchDecision>): MatchDecision => ({ opportunityId: "o", investigatorId: "p", status: "confirmed", reason: null, scope: "pair", auto: false, resurfaceOn: null, verdictLabel: "strong", decidedBy: "u1", decidedAt: "2026-09-13T00:00:00Z", previous: null, ...over });
const me = { id: "me", isAdmin: false };
const admin = { id: "adm", isAdmin: true };
const names = new Map<string, string | null>([["u1", "D. Reyes"], ["u2", "S. Whitfield"]]);

describe("what counts as a disagreement", () => {
  it("with Prospera: a Strong or Moderate match dismissed, an Exploratory or ruled-out row confirmed", () => {
    expect(disagreement(d({ status: "rejected", verdictLabel: "strong" }))).toBe("with_prospera");
    expect(disagreement(d({ status: "rejected", verdictLabel: "moderate" }))).toBe("with_prospera");
    expect(disagreement(d({ status: "confirmed", verdictLabel: "exploratory" }))).toBe("with_prospera");
    expect(disagreement(d({ status: "confirmed", verdictLabel: "ruled_out" }))).toBe("with_prospera");
    expect(disagreement(d({ status: "confirmed", verdictLabel: "strong" }))).toBeNull();
    expect(disagreement(d({ status: "rejected", verdictLabel: "exploratory" }))).toBeNull();
    expect(disagreement(d({ status: "watch", verdictLabel: "strong" }))).toBeNull();
    expect(disagreement(d({ status: "rejected", verdictLabel: "strong", auto: true }))).toBeNull();
    expect(disagreement(d({ status: "rejected", verdictLabel: null }))).toBeNull();
    expect(disagreement(null)).toBeNull();
  });
  it("between reviewers: a decision that replaced a different teammate's different one, whatever the verdict", () => {
    expect(disagreement(d({ status: "confirmed", verdictLabel: "strong", previous: { status: "rejected", by: "u2", at: null } }))).toBe("between_reviewers");
    expect(disagreement(d({ status: "confirmed", previous: { status: "confirmed", by: "u2", at: null } }))).toBeNull();
    expect(disagreement(d({ status: "rejected", verdictLabel: "strong", decidedBy: "u1", previous: { status: "confirmed", by: "u1", at: null } }))).toBe("with_prospera");
  });
});

describe("whose call it is", () => {
  it("a teammate overwrote your decision", () => {
    const over = d({ status: "confirmed", decidedBy: "u1", previous: { status: "rejected", by: "me", at: null } });
    expect(needsYourCall(over, me)).toBe(true);
    expect(needsYourCall(over, { id: "u1", isAdmin: false })).toBe(false);
    expect(needsYourCall(over, { id: "u2", isAdmin: false })).toBe(false);
  });
  it("an owner or admin adjudicates any disagreement decided by someone else", () => {
    const against = d({ status: "rejected", verdictLabel: "strong", decidedBy: "u1" });
    expect(needsYourCall(against, admin)).toBe(true);
    expect(needsYourCall(against, me)).toBe(false);
    expect(needsYourCall(d({ status: "rejected", verdictLabel: "strong", decidedBy: "adm" }), admin)).toBe(false);
    expect(needsYourCall(d({ status: "confirmed", verdictLabel: "strong", decidedBy: "u1" }), admin)).toBe(false);
  });
  it("filters and counts", () => {
    const rows = [d({ status: "rejected", verdictLabel: "strong", decidedBy: "u1" }), d({ status: "confirmed", decidedBy: "u1", previous: { status: "rejected", by: "me", at: null } }), d({ status: "confirmed", verdictLabel: "strong" }), null];
    expect(rows.map((r) => passesFilter(r, "all", me))).toEqual([true, true, true, true]);
    expect(rows.map((r) => passesFilter(r, "disagreements", me))).toEqual([true, true, false, false]);
    expect(rows.map((r) => passesFilter(r, "calls", me))).toEqual([false, true, false, false]);
    expect(callCounts(rows, me)).toEqual({ calls: 1, disagreements: 2 });
    expect(callCounts(rows, admin)).toEqual({ calls: 2, disagreements: 2 });
    expect(filterLabel("calls", 2)).toBe("Needs your call · 2");
    expect(filterLabel("disagreements", 0)).toBe("Disagreements · 0");
    expect(filterLabel("all", 9)).toBe("Everything");
  });
});

describe("the row's line", () => {
  it("says who did what against what", () => {
    expect(callLine(d({ status: "rejected", verdictLabel: "strong", decidedBy: "u1" }), me, names)).toBe("D. Reyes dismissed a Strong match — against Prospera's verdict.");
    expect(callLine(d({ status: "rejected", verdictLabel: "moderate", decidedBy: "u1" }), admin, names)).toBe("D. Reyes dismissed a Moderate match — against Prospera's verdict — your call.");
    expect(callLine(d({ status: "confirmed", verdictLabel: "exploratory", decidedBy: "me" }), me, names)).toBe("You confirmed an Exploratory lead — against Prospera's verdict.");
    expect(callLine(d({ status: "confirmed", decidedBy: "u1", previous: { status: "rejected", by: "me", at: null } }), me, names)).toBe("D. Reyes confirmed this over your “dismissed” — your call.");
    expect(callLine(d({ status: "rejected", decidedBy: "me", previous: { status: "confirmed", by: "u2", at: null } }), me, names)).toBe("You dismissed this over S. Whitfield's “confirmed”.");
    expect(callLine(d({ status: "confirmed", verdictLabel: "strong" }), me, names)).toBeNull();
  });
});

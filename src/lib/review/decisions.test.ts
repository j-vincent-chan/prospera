/** The match record (`lib/review/decisions.ts`). */
import { describe, expect, it } from "vitest";
import { effectiveDecision, fromDecisionRow, matchKey, type DecisionRow } from "@/lib/review/decisions";

const row = (extra: Partial<DecisionRow> = {}): DecisionRow => ({ opportunity_id: "n", investigator_id: "p", status: "watch", reason: null, scope: "pair", auto: null, resurface_on: null, verdict_label: "moderate", decided_by: "u", decided_at: "2026-09-12T10:00:00Z", ...extra });

describe("fromDecisionRow", () => {
  it("reads a row, and refuses a status outside the vocabulary", () => {
    expect(fromDecisionRow(row({ status: "rejected", reason: " wrong_area ", scope: "notice", auto: true }))).toMatchObject({ status: "rejected", reason: "wrong_area", scope: "notice", auto: true, verdictLabel: "moderate" });
    expect(fromDecisionRow(row({ scope: "elsewhere" }))?.scope).toBeNull();
    expect(fromDecisionRow(row({ status: "maybe" }))).toBeNull();
  });
});

describe("effectiveDecision", () => {
  const today = "2026-09-12";
  it("a watch expires on its return day; everything else stands", () => {
    const watch = fromDecisionRow(row({ resurface_on: "2026-09-12" }))!;
    expect(effectiveDecision(watch, today)).toBeNull();
    expect(effectiveDecision(fromDecisionRow(row({ resurface_on: "2026-09-13" })), today)).not.toBeNull();
    expect(effectiveDecision(fromDecisionRow(row({ resurface_on: null })), today)).not.toBeNull();
    expect(effectiveDecision(fromDecisionRow(row({ status: "rejected", resurface_on: "2026-01-01" })), today)?.status).toBe("rejected");
    expect(effectiveDecision(null, today)).toBeNull();
  });
});

describe("matchKey", () => {
  it("is the pair", () => {
    expect(matchKey("n", "p")).toBe("n:p");
  });
});

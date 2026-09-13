/** The Review decision vocabulary (`lib/review/reasons.ts`). */
import { describe, expect, it } from "vitest";
import { BIOSKETCH_REQUESTED, DECISION_REASONS, isDecisionReason, isReviewReasonId, NOTICE_DISMISSED, reasonTrainsEngine, reasonWords, REVIEW_REASONS, rowVerbs, RULED_OUT_REAFFIRMED, scopeOfReason, statusText, STRENGTH_TAGS } from "@/lib/review/reasons";

describe("the eight reasons", () => {
  it("are the prototype's, in its order, with the two notice-scoped ones leading", () => {
    expect(REVIEW_REASONS.map((r) => r.label)).toEqual(["Wrong type of research", "Opportunity too broad", "Wrong disease area", "Not eligible", "Wrong person", "Already aware", "Already funded here", "Do not contact"]);
    expect(REVIEW_REASONS.map((r) => r.scope)).toEqual(["notice", "notice", "pair", "pair", "pair", "pair", "pair", "person"]);
  });

  it("the hints say the scope: 'clears all N' on the notice, 'saved to the profile' on the person, nothing on a pair", () => {
    const hint = (id: string, n: number) => REVIEW_REASONS.find((r) => r.id === id)!.hint?.(n) ?? null;
    expect(hint("wrong_research_type", 4)).toBe("clears all 4");
    expect(hint("too_broad", 1)).toBe("clears this one");
    expect(hint("do_not_contact", 4)).toBe("saved to the profile");
    expect(hint("wrong_area", 4)).toBeNull();
  });

  it("only fit judgments train the engine; facts about the person do not", () => {
    expect(REVIEW_REASONS.filter((r) => r.trainsEngine).map((r) => r.id)).toEqual(["wrong_research_type", "too_broad", "wrong_area", "not_eligible", "wrong_person"]);
    expect(reasonTrainsEngine("already_funded")).toBe(false);
    expect(reasonTrainsEngine("do_not_contact")).toBe(false);
    expect(reasonTrainsEngine(RULED_OUT_REAFFIRMED)).toBe(true);
    expect(reasonTrainsEngine(NOTICE_DISMISSED)).toBe(false);
    expect(reasonTrainsEngine(null)).toBe(false);
  });

  it("every reason a decision may carry validates, and nothing else", () => {
    for (const r of DECISION_REASONS) expect(isDecisionReason(r)).toBe(true);
    expect(isDecisionReason("not_relevant")).toBe(false);
    expect(isReviewReasonId("science_right")).toBe(false);
    expect(STRENGTH_TAGS.map((t) => t.label)).toEqual(["Science is right", "Timing is right", "Needs the money"]);
  });

  it("scope and words", () => {
    expect(scopeOfReason("wrong_research_type")).toBe("notice");
    expect(scopeOfReason(NOTICE_DISMISSED)).toBe("notice");
    expect(scopeOfReason("do_not_contact")).toBe("person");
    expect(scopeOfReason("already_aware")).toBe("pair");
    expect(scopeOfReason(null)).toBe("pair");
    expect(reasonWords("wrong_area")).toBe("wrong disease area");
    expect(reasonWords(NOTICE_DISMISSED)).toBe("the notice is not worth pursuing");
    expect(reasonWords(RULED_OUT_REAFFIRMED)).toBe("wrong type of research · reaffirmed");
    expect(reasonWords("science_right")).toBe("science is right");
    expect(reasonWords(null)).toBeNull();
  });
});

describe("the row's verbs", () => {
  it("depend on the label", () => {
    expect(rowVerbs("strong").primary).toEqual({ label: "Confirm match", status: "confirmed", reason: null });
    expect(rowVerbs("strong").secondary).toEqual({ label: "Dismiss match", status: null, reason: null });
    expect(rowVerbs("cannot_assess").primary).toEqual({ label: "Request a biosketch", status: "watch", reason: BIOSKETCH_REQUESTED });
    expect(rowVerbs("ruled_out").primary).toEqual({ label: "Keep it ruled out", status: "rejected", reason: RULED_OUT_REAFFIRMED });
    expect(rowVerbs("ruled_out").secondary).toEqual({ label: "Reinstate", status: "confirmed", reason: null });
  });
});

describe("status text", () => {
  const base = { doNotContact: false, teammateActive: false, contact: null };

  it("a decision wins, in its own colour", () => {
    expect(statusText({ ...base, decision: { status: "confirmed", reason: "science_right" } })).toEqual({ text: "Confirmed", tone: "confirmed" });
    expect(statusText({ ...base, decision: { status: "watch", reason: null, resurfaceOn: "2026-10-02" } }, "2026-09-12")).toEqual({ text: "Watching · returns Oct 2", tone: "watching" });
    // Due inside 30 days: no return day, the watch stands until Undo.
    expect(statusText({ ...base, decision: { status: "watch", reason: null, resurfaceOn: null } })).toEqual({ text: "Watching", tone: "watching" });
    expect(statusText({ ...base, decision: { status: "watch", reason: BIOSKETCH_REQUESTED } })).toEqual({ text: "Watching · biosketch requested", tone: "watching" });
    expect(statusText({ ...base, decision: { status: "rejected", reason: "wrong_area" } })).toEqual({ text: "Dismissed · wrong disease area", tone: "dismissed" });
    expect(statusText({ ...base, decision: { status: "rejected", reason: null } })).toEqual({ text: "Dismissed", tone: "dismissed" });
  });

  it("then the profile, then a teammate's conversation, then the contact fact", () => {
    expect(statusText({ ...base, decision: null, doNotContact: true, teammateActive: true })).toEqual({ text: "Do not contact · on the profile", tone: "dismissed" });
    expect(statusText({ ...base, decision: null, teammateActive: true, contact: "Not contacted" })).toEqual({ text: "Teammate active", tone: "teammate" });
    expect(statusText({ ...base, decision: null, contact: "Contacted Sep 4 · no reply" })).toEqual({ text: "Contacted Sep 4 · no reply", tone: "muted" });
    expect(statusText({ ...base, decision: null })).toEqual({ text: "Not contacted", tone: "muted" });
  });
});

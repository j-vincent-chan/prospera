/**
 * The two mechanisms §3h left open. What matters here is not that the strings
 * exist but that the rules hold: a PI is never offered the action under a
 * verdict they cannot see, a request is never dropped for a bookkeeping gap,
 * and the two audiences' vocabularies collapse onto one set of reasons so
 * METRICS counts one thing.
 */
import { describe, expect, it } from "vitest";
import {
  CONSULT_ACTION,
  PAIR_FLAG_REASONS,
  consultActionFor,
  consultNotification,
  consultPromise,
  isPairFlagReason,
  pairFlagHandoff,
  pairFlagLabel,
  pairFlagReasons,
  pairFlagVerb,
  routeConsult,
} from "./row-actions";
import type { VerdictLabel } from "./verdicts";

const ALL_LABELS: VerdictLabel[] = ["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"];

describe("the PI's row action (§3h)", () => {
  it("is offered only to the investigator, and only where a PI can see the row", () => {
    for (const label of ALL_LABELS) {
      expect(consultActionFor(label, "strategist")).toBeNull();
    }
    expect(consultActionFor("strong", "investigator")).toEqual(CONSULT_ACTION);
    expect(consultActionFor("moderate", "investigator")).toEqual(CONSULT_ACTION);
    // D7 lists Recommended only, so these never reach a PI's screen; the
    // action must not exist for them even if a surface asked.
    for (const label of ["exploratory", "cannot_assess", "ruled_out"] as VerdictLabel[]) {
      expect(consultActionFor(label, "investigator")).toBeNull();
    }
  });

  it("asks a question rather than joining the office's queue", () => {
    expect(CONSULT_ACTION.id).toBe("ask_strategist");
    expect(CONSULT_ACTION.label).not.toMatch(/outreach/i);
  });
});

describe("routing", () => {
  it("goes to the community's strategist when there is one", () => {
    expect(routeConsult({ communityId: "c1", strategistId: "s1" })).toEqual({ strategistId: "s1", communityId: "c1", via: "community_strategist" });
  });

  it("falls to the team rather than dropping the request", () => {
    for (const input of [
      { communityId: "c1", strategistId: null },
      { communityId: null, strategistId: "s1" },
      { communityId: null, strategistId: null },
    ]) {
      const r = routeConsult(input);
      expect(r.via).toBe("team");
      expect(r.strategistId).toBeNull();
    }
  });

  it("promises a name only when there is one to promise", () => {
    expect(consultPromise(routeConsult({ communityId: "c1", strategistId: "s1" }), "Sarah Whitfield")).toContain("Sarah Whitfield");
    // A strategist is routed to but has no name on file: do not claim one.
    expect(consultPromise(routeConsult({ communityId: "c1", strategistId: "s1" }), null)).toContain("research development team");
    expect(consultPromise(routeConsult({ communityId: null, strategistId: null }), "Sarah Whitfield")).toContain("research development team");
  });
});

describe("the notification", () => {
  const base = { investigatorName: "Priya Natarajan", noticeTitle: "Mechanisms of Immune Regulation in Autoimmune Disease (R01)", label: "strong" as VerdictLabel };

  it("names the person, the notice and the verdict, and quotes a note when there is one", () => {
    const withNote = consultNotification({ ...base, note: "  I have preliminary data on this  " });
    expect(withNote.subject).toContain("Priya Natarajan");
    expect(withNote.text).toContain("Mechanisms of Immune Regulation");
    expect(withNote.text).toContain("strong match");
    expect(withNote.text).toContain("“I have preliminary data on this”");
  });

  it("says plainly when there is no note rather than leaving a blank quote", () => {
    const none = consultNotification({ ...base, note: "   " });
    expect(none.text).toContain("did not add a note");
    expect(none.text).not.toContain("“”");
  });

  it("truncates a long title in the subject but never in the body", () => {
    const long = "A".repeat(120);
    const n = consultNotification({ ...base, noticeTitle: long, note: null });
    expect(n.subject).toContain("…");
    expect(n.subject.length).toBeLessThan(long.length);
    expect(n.text).toContain(long);
  });
});

describe("pair flags", () => {
  it("both audiences map onto one reason vocabulary", () => {
    for (const audience of ["strategist", "investigator"] as const) {
      for (const option of pairFlagReasons(audience)) {
        expect(PAIR_FLAG_REASONS).toContain(option.id);
        expect(isPairFlagReason(option.id)).toBe(true);
      }
    }
  });

  it("does not ask a PI to judge how the notice was read", () => {
    expect(pairFlagReasons("investigator").map((r) => r.id)).not.toContain("notice_misread");
    expect(pairFlagReasons("strategist").map((r) => r.id)).toContain("notice_misread");
  });

  it("speaks in each audience's voice for the same reason", () => {
    expect(pairFlagLabel("wrong_area", "strategist")).toBe("Wrong research area");
    expect(pairFlagLabel("wrong_area", "investigator")).toBe("Not my research area");
    expect(pairFlagVerb("investigator")).toBe("Not a fit for me");
    expect(pairFlagVerb("strategist")).toBe("This match is wrong");
  });

  it("falls back to the strategist wording for a reason an audience does not offer", () => {
    // A strategist's notice_misread rendered on a PI's screen (a flag they did
    // not make) must still read as words, not crash or blank.
    expect(pairFlagLabel("notice_misread", "investigator")).toBe("The notice has been misread");
  });

  it("hands off to the paths that already exist instead of duplicating them", () => {
    expect(pairFlagHandoff("wrong_person")).toBe("identity");
    expect(pairFlagHandoff("wrong_area")).toBe("profile_correction");
    expect(pairFlagHandoff("wrong_research_type")).toBe("profile_correction");
    expect(pairFlagHandoff("not_eligible")).toBeNull();
    expect(pairFlagHandoff("notice_misread")).toBeNull();
  });

  it("rejects anything outside the vocabulary", () => {
    for (const v of ["", "nope", null, undefined, 3, {}]) expect(isPairFlagReason(v)).toBe(false);
  });
});

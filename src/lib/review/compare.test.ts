/** Side-by-side comparison (`lib/review/compare.ts`): pure, over the Review rows. */
import { describe, expect, it } from "vitest";
import { checksCell, compareButtonLabel, compareHeading, compareRows, decisionWord, defaultPicks, togglePick } from "@/lib/review/compare";
import type { ReviewRow } from "@/lib/review/queries";

const row = (over: Partial<ReviewRow> & { investigatorId: string; name: string }): ReviewRow =>
  ({
    opportunityId: "o",
    initials: "AB",
    href: `/investigators/${over.investigatorId}`,
    identity: "Dermatology · ImmunoX",
    tier: "strong",
    verdicts: { label: "strong", approach: { text: "Approach · mechanistic", tone: "ok" }, eligibility: { text: "Eligible", tone: "ok" }, evidence: { text: "3 verified items", tone: "ok" }, reason: "Mechanistic work on tolerance.", caveat: { text: "No blocking constraint.", tone: "quiet" }, action: null },
    chips: [],
    disclosure: { why: "", gaps: [], items: [{ id: "publication:1", title: "Spatial atlas of T cells" }, { id: "grant:2", title: "R01 on tolerance" }, { id: "trial:3", title: "A trial" }] },
    coverage: "3 verified publications · 1 award",
    decision: null,
    call: null,
    needsYourCall: false,
    doNotContact: false,
    contact: null,
    history: null,
    clash: null,
    flag: null,
    card: { stage: "Associate Professor", paradigm: null, themes: [], facts: [] },
    checks: { assessed: true, rows: [{ key: "a", mark: "yes", criterion: "x", note: null }, { key: "b", mark: "unknown", criterion: "y", note: null }] },
    citedIds: [],
    ...over,
  }) as ReviewRow;

const rows = [
  row({ investigatorId: "p1", name: "Ana" }),
  row({ investigatorId: "p2", name: "Ben", tier: "moderate", verdicts: { label: "moderate", approach: { text: "Approach · adjacent", tone: "caution" }, eligibility: { text: "Eligible", tone: "ok" }, evidence: { text: "1 item", tone: "caution" }, reason: "Adjacent.", caveat: { text: "Thin evidence.", tone: "caution" }, action: null }, coverage: null, checks: { assessed: false, rows: [] }, disclosure: { why: "", gaps: [], items: [] } }),
  row({ investigatorId: "p3", name: "Cy", decision: { opportunityId: "o", investigatorId: "p3", status: "confirmed", reason: null, scope: "pair", auto: false, resurfaceOn: null, verdictLabel: "strong", decidedBy: "u", decidedAt: "2026-09-13T00:00:00Z" } }),
  row({ investigatorId: "p4", name: "Di", doNotContact: true }),
];

describe("picking candidates", () => {
  it("opens on the undecided rows in order, then fills with decided ones, up to three", () => {
    expect(defaultPicks(rows)).toEqual(["p1", "p2", "p3"]);
    expect(defaultPicks(rows, 2)).toEqual(["p1", "p2"]);
  });
  it("toggles, and the newest replaces the oldest when full", () => {
    expect(togglePick(["p1", "p2"], "p2")).toEqual(["p1"]);
    expect(togglePick(["p1", "p2", "p3"], "p4")).toEqual(["p2", "p3", "p4"]);
    expect(togglePick(["p1"], "p2")).toEqual(["p1", "p2"]);
  });
});

describe("the table", () => {
  it("one column per pick, in pick order; every cell from the row", () => {
    const t = compareRows(rows, ["p2", "p1"]);
    expect(t.columns.map((c) => c.name)).toEqual(["Ben", "Ana"]);
    expect(t.columns[1]).toMatchObject({ tier: "strong", label: "strong", decision: "Undecided", undecided: true });
    const by = Object.fromEntries(t.criteria.map((c) => [c.key, c.cells.map((x) => `${x.text}|${x.tone}`)]));
    expect(by.verdict).toEqual(["Moderate match|plain", "Strong match|good"]);
    expect(by.approach).toEqual(["Approach · adjacent|warn", "Approach · mechanistic|good"]);
    expect(by.coverage).toEqual(["Nothing verified on file|warn", "3 verified publications · 1 award|plain"]);
    expect(by.checks).toEqual(["Not checked against this notice|warn", "1 met · 0 failed · 1 open|warn"]);
    expect(by.cited).toEqual(["Nothing cited|warn", "Spatial atlas of T cells; R01 on tolerance|plain"]);
    expect(by.decision).toEqual(["Undecided|warn", "Undecided|warn"]);
    expect(by.catch).toEqual(["Thin evidence.|warn", "No blocking constraint.|plain"]);
  });
  it("decided and do-not-contact rows read as such", () => {
    expect(decisionWord(rows[2]!)).toBe("Confirmed");
    expect(decisionWord(rows[3]!)).toBe("Do not contact");
    const t = compareRows(rows, ["p3", "p4"]);
    expect(t.columns.map((c) => c.undecided)).toEqual([false, false]);
    expect(t.criteria.find((c) => c.key === "decision")!.cells.map((c) => c.tone)).toEqual(["good", "plain"]);
  });
  it("the checklist cell is toned by its worst mark", () => {
    expect(checksCell({ checks: { assessed: true, rows: [{ key: "a", mark: "yes", criterion: "", note: null }] } })).toEqual({ text: "1 met · 0 failed · 0 open", tone: "good" });
    expect(checksCell({ checks: { assessed: true, rows: [{ key: "a", mark: "no", criterion: "", note: null }, { key: "b", mark: "unknown", criterion: "", note: null }] } })).toEqual({ text: "0 met · 1 failed · 1 open", tone: "danger" });
  });
  it("heading and button", () => {
    expect(compareHeading({ limited: true, cap: "1 per institution", candidates: 3 })).toEqual({ title: "Compare candidates · limited submission", line: "UCSF may put forward 1 per institution, so the question is which one. 3 candidates side by side; nothing is contacted until you decide." });
    expect(compareHeading({ limited: false, cap: null, candidates: 2 }).title).toBe("Compare candidates");
    expect(compareButtonLabel(true)).toBe("Compare · limited submission");
    expect(compareButtonLabel(false)).toBe("Compare candidates");
  });
});

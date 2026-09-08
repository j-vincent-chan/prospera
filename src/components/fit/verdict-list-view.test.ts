/**
 * The fit card's own rules (fit-UX PR 3): the chip counts, the filter, the
 * selection cap, compare's order, the D7 audience gate and the footer's two
 * lines. Every oracle is written out rather than recomputed from the module —
 * a test that rebuilds `filterChips`' arithmetic and compares would pass on a
 * mutation that changed both.
 */
import { describe, expect, it } from "vitest";
import {
  audienceRules,
  comparedRows,
  filterChipClass,
  filterChips,
  FILTER_ORDER,
  matchesFilter,
  MAX_SELECTED,
  MIN_COMPARED,
  provenanceLine,
  ruledOutLabel,
  sharedRuledOutReason,
  SORT_NOTE,
  toggleSelected,
  type FitFilter,
} from "@/components/fit/verdict-list-view";
import { VERDICT_LABEL_TEXT } from "@/components/fit/verdict-row-view";
import type { VerdictLabel } from "@/lib/fit/verdicts";

describe("filterChips — counted from the rows, never written down", () => {
  it("the prototype's header, from the labels that produce it", () => {
    // The five rows behind `All 5 · Strong 1 · Moderate 1 · Exploratory 2 · Can't assess 1`.
    const labels: VerdictLabel[] = ["strong", "moderate", "exploratory", "exploratory", "cannot_assess"];
    expect(filterChips(labels).map((c) => c.label)).toEqual(["All 5", "Strong 1", "Moderate 1", "Exploratory 2", "Can't assess 1"]);
  });

  it("a chip whose count is zero is omitted; `All` is drawn even at zero, because it is the way back", () => {
    expect(filterChips(["strong", "strong"]).map((c) => c.id)).toEqual(["all", "strong"]);
    expect(filterChips([]).map((c) => c.label)).toEqual(["All 0"]);
  });

  it("ruled-out rows are not counted: they are behind the footer's toggle, not behind a chip", () => {
    const labels: VerdictLabel[] = ["strong", "ruled_out", "ruled_out"];
    expect(filterChips(labels).map((c) => c.label)).toEqual(["All 1", "Strong 1"]);
    expect(FILTER_ORDER).not.toContain("ruled_out" as unknown as FitFilter);
  });

  it("the count is the number of rows the chip shows — the invariant the README says an earlier draft broke", () => {
    const labels: VerdictLabel[] = ["strong", "moderate", "moderate", "cannot_assess", "ruled_out"];
    for (const chip of filterChips(labels)) {
      expect(labels.filter((l) => matchesFilter(l, chip.id)).length).toBe(chip.count);
    }
  });

  it("the chip words come from the row's own label vocabulary, minus 'match'", () => {
    const chips = filterChips(["strong", "moderate", "exploratory", "cannot_assess"]);
    const words = Object.fromEntries(chips.map((c) => [c.id, c.label.replace(/ \d+$/, "")]));
    expect(VERDICT_LABEL_TEXT.strong.startsWith(words.strong!)).toBe(true);
    expect(VERDICT_LABEL_TEXT.moderate.startsWith(words.moderate!)).toBe(true);
    expect(words.exploratory).toBe(VERDICT_LABEL_TEXT.exploratory);
    expect(words.cannot_assess).toBe(VERDICT_LABEL_TEXT.cannot_assess);
  });

  it("the active chip is the navy fill, the idle one the card's border; they are different strings", () => {
    expect(filterChipClass(true)).toContain("bg-navy");
    expect(filterChipClass(false)).toContain("bg-card");
    expect(filterChipClass(true)).not.toBe(filterChipClass(false));
  });
});

describe("matchesFilter", () => {
  it("`all` is every listed row and never a ruled-out one", () => {
    expect(matchesFilter("strong", "all")).toBe(true);
    expect(matchesFilter("cannot_assess", "all")).toBe(true);
    expect(matchesFilter("ruled_out", "all")).toBe(false);
  });

  it("a label filter is exactly its own label", () => {
    expect(matchesFilter("moderate", "moderate")).toBe(true);
    expect(matchesFilter("strong", "moderate")).toBe(false);
  });
});

describe("selection — at most three, a fourth drops the oldest", () => {
  it("the cap is three and the drop is the oldest, not the newest", () => {
    expect(MAX_SELECTED).toBe(3);
    let sel: string[] = [];
    for (const id of ["a", "b", "c"]) sel = toggleSelected(sel, id);
    expect(sel).toEqual(["a", "b", "c"]);
    sel = toggleSelected(sel, "d");
    expect(sel).toEqual(["b", "c", "d"]);
  });

  it("deselecting is unconditional and keeps the order of the rest", () => {
    expect(toggleSelected(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(toggleSelected(["a"], "a")).toEqual([]);
  });

  it("selecting an already-selected row deselects it rather than re-adding", () => {
    expect(toggleSelected(["a", "b"], "a")).toEqual(["b"]);
  });

  it("a different cap is honoured", () => {
    expect(toggleSelected(["a", "b"], "c", 2)).toEqual(["b", "c"]);
  });
});

describe("compare — list order, not click order", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const idOf = (r: { id: string }) => r.id;

  it("columns follow the list even when the clicks did not", () => {
    expect(comparedRows(rows, ["c", "a"], idOf).map(idOf)).toEqual(["a", "c"]);
  });

  it("a selected row that has left the list (a filter changed under it) drops out", () => {
    expect(comparedRows([{ id: "a" }], ["a", "c"], idOf).map(idOf)).toEqual(["a"]);
    expect(comparedRows([{ id: "a" }], ["a", "c"], idOf).length).toBeLessThan(MIN_COMPARED);
  });

  it("two columns is the least a comparison can be", () => {
    expect(MIN_COMPARED).toBe(2);
  });
});

describe("audienceRules — D7 is a gate, not a style", () => {
  it("the PI's own page has no strategist tooling at all (§3h)", () => {
    expect(audienceRules("investigator")).toEqual({ selectable: false, compare: false, bulk: false, ruledOut: false, exploratory: false });
  });

  it("a strategist has all of it", () => {
    expect(audienceRules("strategist")).toEqual({ selectable: true, compare: true, bulk: true, ruledOut: true, exploratory: true });
  });
});

describe("the footer", () => {
  it("names the reason only when every hidden row shares one", () => {
    expect(sharedRuledOutReason(["eligibility"])).toBe("eligibility");
    expect(sharedRuledOutReason(["eligibility", "eligibility"])).toBe("eligibility");
    expect(sharedRuledOutReason(["eligibility", "the floors"])).toBeNull();
    expect(sharedRuledOutReason([])).toBeNull();
    expect(sharedRuledOutReason([null])).toBeNull();
    expect(sharedRuledOutReason(["eligibility", undefined])).toBeNull();
  });

  it("§3f's toggle, both ways round", () => {
    expect(ruledOutLabel(false, 1, "eligibility")).toBe("Show 1 ruled out (eligibility)");
    expect(ruledOutLabel(false, 3, "a different field")).toBe("Show 3 ruled out (a different field)");
    expect(ruledOutLabel(false, 2, null)).toBe("Show 2 ruled out");
    expect(ruledOutLabel(true, 1, "eligibility")).toBe("Hide the 1 ruled out");
  });

  it("provenance is phrased for whoever is reading (§3h, §3j)", () => {
    expect(provenanceLine({ audience: "strategist", corpus: 1190, noun: "open notice" })).toBe("1,190 open notices assessed · refreshed nightly");
    expect(provenanceLine({ audience: "investigator", corpus: 1190, noun: "open notice" })).toBe("Assessed against 1,190 open notices · the list refreshes nightly · your strategist sees the same assessment");
    expect(provenanceLine({ audience: "strategist", corpus: 1, noun: "open notice" })).toContain("1 open notice assessed");
    expect(provenanceLine({ audience: "strategist", corpus: 12, noun: "directory profile", refreshed: "Sep 6" })).toBe("12 directory profiles assessed · refreshed nightly · assessed Sep 6");
  });

  it("the order note says what the order is, not what the prototype guessed", () => {
    expect(SORT_NOTE).not.toMatch(/deadline/i);
    expect(SORT_NOTE).toMatch(/\S/);
  });
});

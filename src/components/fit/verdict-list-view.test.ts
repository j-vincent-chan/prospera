/**
 * The fit card's own rules (fit-UX PR 3): the chip counts, the filter, the
 * selection cap, compare's order, the D7 audience gate and the footer's two
 * lines. Every oracle is written out rather than recomputed from the module —
 * a test that rebuilds `filterChips`' arithmetic and compares would pass on a
 * mutation that changed both.
 *
 * The last block reads the three client shells' source, for the same reason
 * and with the same caveats as `verdict-row-view.test.ts`' last block: there is
 * no DOM environment in this repo, so what a `.tsx` wires to what is asserted
 * as narrow `toContain`s over the file with its comments stripped. Weaker than
 * rendering, and written as exactly that.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  audienceRules,
  CARD_HEADER,
  CARD_HEADER_ACTIONS,
  CARD_HEADER_CHIPS,
  comparedRows,
  filterChipClass,
  filterChips,
  FILTER_ORDER,
  listsLabel,
  matchesFilter,
  MAX_SELECTED,
  MIN_COMPARED,
  PROFILES_DEGRADED_NOTE,
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
    expect(audienceRules("investigator")).toEqual({ selectable: false, compare: false, ruledOut: false, beyondModerate: false });
  });

  it("a strategist has all of it", () => {
    expect(audienceRules("strategist")).toEqual({ selectable: true, compare: true, ruledOut: true, beyondModerate: true });
  });

  it("every rule the type declares is a capability something draws — no tested dead capability", () => {
    // `bulk` was computed, documented and asserted here, and no component read
    // it: the README's "Add *n* to recipients" is a people-facing list, and the
    // only `VerdictList` is the investigator page's notice-facing one. A rule
    // no surface can act on is the same fault as a button that goes nowhere.
    expect(Object.keys(audienceRules("strategist")).sort()).toEqual(["beyondModerate", "compare", "ruledOut", "selectable"]);
  });

  it("§3h is applied to the label, not to the tier the loader read", () => {
    // The gate the PI's page needs: a Strong pair whose notice profile is
    // incomplete is labelled `cannot_assess`, and reading only the two tiers
    // still let that row — and its chip — onto their own page.
    const pi = audienceRules("investigator");
    expect(["strong", "moderate"].map((l) => listsLabel(l as VerdictLabel, pi))).toEqual([true, true]);
    expect(["cannot_assess", "exploratory", "ruled_out"].map((l) => listsLabel(l as VerdictLabel, pi))).toEqual([false, false, false]);
    const strategist = audienceRules("strategist");
    for (const l of ["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"] as VerdictLabel[]) expect(listsLabel(l, strategist)).toBe(true);
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
  });

  it("a failed counterpart-profile read is said once, in the footer, on both readings (§3i)", () => {
    // Without it "no notice profile on file" — a claim about *that notice* — is
    // what a missing table looks like, on every row.
    expect(provenanceLine({ audience: "strategist", corpus: 12, noun: "open notice", degraded: true })).toBe(`12 open notices assessed · refreshed nightly · ${PROFILES_DEGRADED_NOTE}`);
    expect(provenanceLine({ audience: "investigator", corpus: 12, noun: "open notice", degraded: true })).toContain(PROFILES_DEGRADED_NOTE);
    expect(provenanceLine({ audience: "strategist", corpus: 12, noun: "open notice", degraded: false })).not.toContain(PROFILES_DEGRADED_NOTE);
  });

  it("the order note says what the order is, not what the prototype guessed", () => {
    expect(SORT_NOTE).not.toMatch(/deadline/i);
    expect(SORT_NOTE).toMatch(/\S/);
  });
});

// ---------------------------------------------------------------------------
// The three client shells — what is wired to what
// ---------------------------------------------------------------------------

const src = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");
/** Source with comments removed: a file must be free to *name* the copy in the rule it keeps. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const list = code(src("./verdict-list.tsx"));
const stack = code(src("./verdict-stack.tsx"));
const tab = code(src("../outreach/recipients-tab.tsx"));

describe("the verb is dispatched on the id, never on the copy", () => {
  it("no surface compares an action's label to a string", () => {
    // `actionOf` returns "Open in Outreach" for any row flagged `in_pipeline` —
    // the common case, since the board is the office's queue. The list branched
    // on labels and fell **through** to `saveOpportunitiesAction`: a button that
    // navigated nowhere, wrote, and toasted "Saved … to outreach · Triage"
    // about a notice already on that board. The aside gated on
    // `label === "Add to outreach"` and drew no control at all.
    for (const [name, file] of [["verdict-list", list], ["verdict-stack", stack], ["recipients-tab", tab]] as const) {
      expect(file, `${name} compares a verb's label`).not.toMatch(/action(\?)?\.label\s*===/);
      expect(file, `${name} compares a verb's label`).not.toMatch(/===\s*"(Add to outreach|Open in Outreach|See what's missing|Keep as a lead|Read the notice|Dismiss)"/);
    }
  });

  it("the list switches on `action.id` and has a branch for every id it can receive", () => {
    expect(list).toContain("const action = row.verdicts.action;");
    expect(list).toContain('if (action.id === "see_whats_missing") return toggle(row.id);');
    expect(list).toContain('if (action.id === "read_notice") return router.push(`/opportunities/${row.id}`);');
    expect(list).toContain("switch (action.id) {");
    for (const id of ["open_in_outreach", "keep_as_lead", "dismiss"]) expect(list).toContain(`case "${id}":`);
  });

  it("`Open in Outreach` navigates, and does not fall through to a write", () => {
    const branch = list.slice(list.indexOf('case "open_in_outreach":'), list.indexOf('case "keep_as_lead":'));
    expect(branch).toContain("createOutreachItemAction(row.id)");
    expect(branch).toContain("router.push(`/outreach?item=${r.itemId}`)");
    expect(branch).not.toContain("saveOpportunitiesAction");
    // and the write is where the words say it is
    expect(list.slice(list.indexOf("default: {"))).toContain("saveOpportunitiesAction({ opportunityIds: [row.id], saved: true })");
  });

  it("the aside gives an in-pipeline person a control instead of nothing", () => {
    expect(stack).toContain('case "add_to_outreach":');
    expect(stack).toContain('case "open_in_outreach":');
    expect(stack).toContain("router.push(`/outreach?item=${target}`)");
    expect(stack).toContain("onAction={actionFor(r)}");
  });
});

describe("compare keeps the row's four slots and its own exit (§3g)", () => {
  it("each column carries the row's verb at its foot", () => {
    // the `{` is part of the assertion: `{false && row.verdicts.action …` still
    // contains the condition, and draws nothing
    expect(list).toContain("{row.verdicts.action && onAction ? (");
    expect(list).toContain("{row.verdicts.action.label}");
    expect(list).toContain("onAction={r.verdicts.action ? () => act(r) : undefined}");
  });

  it("the right-hand field is captioned from the subject, not from a constant", () => {
    // The caption-crossing hazard the README warns about in as many words:
    // `DUE_CAPTION.notice` written into a column is the leak waiting for the
    // first people-facing list.
    expect(list).toContain("{DUE_CAPTION[subject]}");
    expect(list).not.toContain("DUE_CAPTION.notice");
    expect(list).toContain('subject = "notice"');
    expect(list).toContain("subject={subject}");
  });

  it("a comparison that has lost a column is over", () => {
    // `comparing` used to be cleared only by "Back to the list" and by removing
    // a column from inside it, so a filter change that dropped the set below
    // two fell back to the list with the flag still set: "Compare *n*" stayed
    // hidden and selecting a second row jumped back in unasked.
    expect(list).toContain("if (comparing && compared.length < MIN_COMPARED) setComparing(false);");
    expect(list).toContain("useEffect(");
  });
});

describe("the header height does not depend on the selection", () => {
  it("the chips and the action slot are separate boxes, and the slot is always drawn", () => {
    expect(list).toContain("<div className={CARD_HEADER_CHIPS}>");
    expect(list).toContain("<div className={CARD_HEADER_ACTIONS}>");
    // reserved width and fixed height: the chips wrap the same way in both states
    expect(CARD_HEADER_ACTIONS).toMatch(/\bw-\[\d+px\]/);
    expect(CARD_HEADER_ACTIONS).toContain("shrink-0");
    expect(CARD_HEADER_ACTIONS).toMatch(/\bh-7\b/);
    expect(CARD_HEADER).toContain("flex-nowrap");
    expect(CARD_HEADER).not.toContain("flex-wrap");
    expect(CARD_HEADER_CHIPS).toContain("flex-wrap");
    expect(CARD_HEADER_CHIPS).toContain("min-w-0");
  });

  it("the order note is in the footer, where it cannot make the header grow", () => {
    const header = list.slice(list.indexOf("const header = ("), list.indexOf("const footer = ("));
    expect(header).not.toContain("SORT_NOTE");
    expect(list.slice(list.indexOf("const footer = ("))).toContain("{SORT_NOTE}");
  });
});

describe("the flag control says what it does (W6)", () => {
  it("the workspace names the dialog it opens, and the row draws nothing without a label", () => {
    expect(tab).toContain("onFlag={onWrongType}");
    expect(tab).toContain("flagLabel={WRONG_TYPE_LABEL}");
    expect(src("../outreach/recipients-tab.tsx")).toContain('const WRONG_TYPE_LABEL = "Wrong type of research…";');
    // "This is wrong…" over a handler whose dialog's primary button is
    // "Dismiss and propose correction" is the promise that must not be made.
    expect(tab).not.toContain("This is wrong");
    expect(code(src("./verdict-row-disclosure.tsx"))).not.toContain("This is wrong");
  });

  it("the investigator card draws none, because it has no mechanism of its own", () => {
    // `flagFitProfile` flags an axis of a stored profile and is behind
    // `requireAdmin`; the workspace's wrong-type dismissal is about a person on
    // a notice. Neither is "this notice is a wrong match for this
    // investigator", so no link is drawn rather than one wired to a different
    // thing (§3h's gap, said plainly).
    expect(list).not.toContain("onFlag");
    expect(list).not.toContain("flagLabel");
  });
});

describe("the workspace no longer explains the model (W8, §2.2)", () => {
  it("neither string this PR removed from the investigator card survives on the fit path", () => {
    for (const s of ["a tier is a set of floors, not a score", "evidence coverage is separate", "Leads to check, not recommendations", "the first line names the gap"]) {
      expect(tab, `recipients-tab still prints: ${s}`).not.toContain(s);
    }
    // the legacy heading keeps its note: a legacy row has no verdicts to say it
    expect(tab).toContain("Match tier and evidence coverage are separate: a strong match can rest on limited data.");
  });

  it("the checks reach the disclosure as their own group, uncapped by the analysis", () => {
    expect(tab).toContain("gaps: s.fit.disclosure.gaps,");
    expect(tab).toContain("checks,");
    expect(tab).not.toContain("...s.fit.disclosure.gaps].slice(");
  });
});

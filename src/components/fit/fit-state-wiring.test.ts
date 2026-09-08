/**
 * §3i's call sites (fit-UX PR 5).
 *
 * **Why this file reads source instead of rendering.** Everything asserted
 * below is a condition inside JSX in a client component tree, and this repo's
 * vitest environment is `node` with no DOM: `VerdictList`, `VerdictStack` and
 * `FitStateCard` cannot be mounted, and the branches are unreachable from a
 * test. A mutation run over the four states bore that out exactly — every
 * mutant in the pure modules died and every mutant in the wiring survived,
 * which is the split `AUDIT_AND_DECISIONS.md`'s own branch history predicted.
 *
 * Most of that wiring was answered by moving it: `investigatorCardState`,
 * `noticeAsideStates` and `workspaceStaleBanner` are pure now and are tested
 * against real loaded surfaces in their own files. What is left is genuinely
 * markup — which element is drawn, and with which handler — and for that a
 * source contract is the only instrument this repo has. It is the same
 * instrument `audit-items.test.ts` already uses on the same surfaces, and its
 * limits are the same: it pins the shape of the call, not its behaviour.
 *
 * Each assertion below names the fault it exists to catch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const LIST = read("src/components/fit/verdict-list.tsx");
const STACK = read("src/components/fit/verdict-stack.tsx");
const CARD = read("src/components/fit/fit-state-card.tsx");
const FIT = read("src/components/fit/fit-opportunities.tsx");
const PAGE = read("src/app/(app)/opportunities/[id]/page.tsx");
const TAB = read("src/components/outreach/recipients-tab.tsx");

describe("the investigator card (fit-opportunities.tsx)", () => {
  it("asks the loader's module for the state and computes none of it here", () => {
    expect(FIT).toContain("const state = investigatorCardState(surface);");
    // The three choices that used to be made in this file, and each of which
    // has a plausible wrong answer nothing here could see.
    expect(FIT).not.toMatch(/investigatorSurfaceState\(/);
    expect(FIT).not.toMatch(/poorTotal/);
    expect(FIT).not.toMatch(/audience: "strategist"/);
  });

  it("only the no-profile state replaces the card; the answer keeps the chips, the footer and the provenance", () => {
    expect(FIT).toContain('if (state?.id === "no_profile") return <FitStateCard');
    expect(FIT).toContain("empty={state ?? undefined}");
  });

  it("Refresh sources is given the id it acts on", () => {
    // Without it `FitStateCard` draws no button at all (see below), which is a
    // state with no way out rather than a wrong one — but still a regression.
    expect(FIT).toContain("investigatorId={surface.investigatorId}");
  });
});

describe("the card's shell (verdict-list.tsx)", () => {
  it("the state is drawn on `listed`, not on every row this audience has", () => {
    // Measured at 1366px: gating on `audienceRows` counted the ruled-out rows
    // behind the footer toggle as content, so a card whose only content was a
    // ruled-out row drew "No row in this filter." where the answer belongs.
    expect(LIST).toContain("const stateShowing = Boolean(empty) && !listed.length;");
    expect(LIST).toContain("      ) : stateShowing && empty ? (");
    expect(LIST).not.toMatch(/empty && !audienceRows\.length/);
  });

  it("a filter that empties a populated list says so, and does not borrow §3i's answer", () => {
    expect(LIST).toContain("{FILTER_EMPTY}");
    expect(LIST).toMatch(/\) : \(\s*<p className="m-0 border-t border-line-row px-5 py-4 text-dense leading-normal text-ink-muted">\{FILTER_EMPTY\}<\/p>/);
  });

  it("the state's one verb reveals the ruled-out rows, and clears the filter that would hide them again", () => {
    expect(LIST).toContain('if (id !== "show_nearest") return;');
    expect(LIST).toContain('setFilter("all");');
    expect(LIST).toContain("setShowRuledOut(true);");
  });

  it("the handler exists only where there is something to reveal (PR 3's `3b`)", () => {
    expect(LIST).toContain("rules.ruledOut && ruled.length\n      ? (id: FitStateAction[\"id\"]) => {");
    expect(LIST).toContain("<FitStatePanel state={empty} onAction={onStateAction} />");
  });

  it("the footer's toggle stands down while the state offers the same reveal", () => {
    // Measured: both were drawn on an empty card, 90px apart — §2.7's
    // repetition. The toggle is back the moment the rows are.
    expect(LIST).toContain("{rules.ruledOut && ruled.length && !(stateShowing && !showRuledOut) ? (");
  });
});

describe("the aside's list (verdict-stack.tsx)", () => {
  it("the thin-directory state holds the rows back, and 'Show the n anyway' lets them through", () => {
    expect(STACK).toContain("{state && !revealed ? <FitStatePanel state={state} onAction={onStateAction} /> : null}");
    expect(STACK).toContain("{state && !revealed ? null : rows.map((r, i) => (");
    expect(STACK).toContain('if (id === "show_anyway") setRevealed(true);');
  });

  it("the banner carries no Reassess here: this surface cannot re-run the sweep", () => {
    expect(STACK).toContain("{banner ? <FitStateBannerRow banner={banner} /> : null}");
    expect(STACK).not.toMatch(/FitStateBannerRow banner=\{banner\} onAction/);
  });
});

describe("the state's controls (fit-state-card.tsx)", () => {
  it("no control without its mechanism", () => {
    // The three gates, one per kind of action. Each drops the button rather
    // than drawing an inert one — PR 2's rule, PR 3's `3b`, §3h's own gap.
    expect(CARD).toContain("  if (!onAction) return null;");
    expect(CARD).toContain("    if (!investigatorId) return null;");
    expect(CARD).toContain("{banner.action && onAction ? (");
  });

  it("Refresh sources is the app's own action, not a new one", () => {
    expect(CARD).toContain("refreshSourcesAction(investigatorId, \"all\")");
    expect(CARD).toContain("router.refresh();");
  });
});

describe("the opportunity aside (the page)", () => {
  it("asks the loader's module for both states and writes no condition of its own", () => {
    expect(PAGE).toContain("const aside = noticeAsideStates(data.fit, { updatedAt: data.updatedAt, rows: ASIDE_ROWS, today });");
    expect(PAGE).not.toMatch(/noticeChangedAfter\(/);
    expect(PAGE).not.toMatch(/noticeChangedBanner\(/);
    expect(PAGE).not.toMatch(/demoted\(/);
  });

  it("draws the state in place of the rows, the banner above them, and the caption in the header", () => {
    expect(PAGE).toContain("<FitStatePanel state={aside.state} />");
    expect(PAGE).toContain("banner={aside.banner}");
    expect(PAGE).toContain("state={aside.state}");
    expect(PAGE).toContain("aside={aside.when ? <span className=\"text-meta text-ink-muted\">{aside.when}</span> :");
  });
});

describe("the Outreach workspace (recipients-tab.tsx)", () => {
  it("the stale banner is the shared one, on this tab's own signal, with the Reassess it does have", () => {
    expect(TAB).toContain("const staleBanner = workspaceStaleBanner(data.item, active.length);");
    expect(TAB).toContain("<FitStateBannerRow banner={staleBanner} onAction={() => regenerate()}");
    // The words it replaced: this tab wrote its own sentence and its own verb.
    // Both survive only inside the comment that records what they were, which
    // is why the check is on the rendered strings rather than on the file.
    const rendered = TAB.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(rendered).not.toMatch(/These suggestions were made before that/);
    expect(rendered).not.toMatch(/>Re-check</);
  });

  it("§3j: the tab's provenance is written once, in `lib/outreach/profile.ts`", () => {
    expect(TAB).toContain("{recipientsProvenanceLine(data.directoryCount)}");
    expect(TAB.match(/refreshed nightly/g) ?? []).toHaveLength(0);
    expect(TAB).not.toMatch(/Suggestions describe fit, not merit/);
  });
});

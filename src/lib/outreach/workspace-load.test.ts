/**
 * How the Outreach workspace loads (fit-UX follow-up, L2), and how wide it
 * opens (V2).
 *
 * **Why a source read and not a render.** The defect is a *shape* — five
 * sequential round trips where three would do — and this repo has no DOM
 * environment and no database in tests, so the two things that can be checked
 * without one are the pure selector that decides what is read
 * (`rowsForFitVerdicts`) and the arrangement of the reads in the file. The
 * second is asserted as narrow `toContain`s over the source, which is weaker
 * than a measurement and is written as exactly that; the measurement is in the
 * PR description, against the running server.
 *
 * Measured before, warm, on `/outreach?item=8ed6c612-…` (83 suggestions, real
 * UCSF data): `loadWorkspace` 1.79–2.09s across five sequential legs — item
 * (~150ms) → nine reads (~500ms, all of it one 724KB `outreach_suggestions`
 * read) → verdicts (~230ms) → two profile reads (~650ms, 2.15MB) → the
 * evidence lookup (~250ms). After: 1.17–1.54s over three, because the fit
 * reads now run beside the block instead of after it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rowsForFitVerdicts } from "@/lib/outreach/queries";

const QUERIES = readFileSync(path.join(process.cwd(), "src/lib/outreach/queries.ts"), "utf8");
const WORKSPACE = readFileSync(path.join(process.cwd(), "src/components/outreach/outreach-workspace.tsx"), "utf8");
const SLIDE_OVER = readFileSync(path.join(process.cwd(), "src/components/ui/slide-over.tsx"), "utf8");

describe("rowsForFitVerdicts (L2)", () => {
  const s = (investigator_id: string, status: string) => ({ investigator_id, status });

  it("covers every status that can reach a VerdictRow", () => {
    // `active` is the list; `dismissed` is behind a client-side toggle, so its
    // verdicts have to be in the payload before the toggle is pressed.
    expect(rowsForFitVerdicts([s("a", "active"), s("b", "dismissed"), s("c", "added")])).toEqual(["a", "b", "c"]);
  });

  it("drops the one status that cannot", () => {
    // `recipients-tab.tsx` builds `visible` from active + dismissed only; an
    // eligibility-excluded person appears once, as a name and a reason, in the
    // "excluded by eligibility" list. Reading a verdict row, a 26KB fit
    // profile, their evidence ids and building an `auditView` for them is work
    // with no reader.
    expect(rowsForFitVerdicts([s("a", "active"), s("x", "excluded"), s("y", "excluded")])).toEqual(["a"]);
  });

  it("reads a person once, however many suggestion rows name them", () => {
    expect(rowsForFitVerdicts([s("a", "active"), s("a", "dismissed")])).toEqual(["a"]);
  });

  it("nothing to read is an empty list, not a read with no filter", () => {
    expect(rowsForFitVerdicts([])).toEqual([]);
    expect(rowsForFitVerdicts([s("", "active")])).toEqual([]);
  });
});

describe("loadWorkspace issues the fit reads beside the block, not after it (L2)", () => {
  it("starts them before the block is awaited", () => {
    const fitReads = QUERIES.indexOf("const fitReads = Promise.all([");
    const block = QUERIES.indexOf("const [{ data: recRows }");
    expect(fitReads).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(-1);
    expect(fitReads).toBeLessThan(block);
  });

  it("gates them on the flag it reads with them, not on the block", () => {
    // `loadTeamFitEngine` decides whether the fit reads happen at all, so
    // leaving it in the block would have made the block the thing they wait
    // for — the exact serialisation this change removes.
    expect(QUERIES).toContain('db.from("outreach_suggestions").select("investigator_id, status").eq("item_id", itemId),\n    loadTeamFitEngine(db, teamId),');
  });

  it("runs the three fit reads together, and narrows their id list", () => {
    expect(QUERIES).toContain("const ids = rowsForFitVerdicts(");
    expect(QUERIES).toContain("loadFitVerdictsForNoticeInvestigators(db, String(fo.id), ids),");
    expect(QUERIES).toContain("loadNoticeProfiles(db, [String(fo.id)]),");
    expect(QUERIES).toContain("loadInvestigatorProfiles(db, ids),");
  });

  it("degrades rather than throwing, since they are started outside the try", () => {
    // The loaders answer `{available, error}` and do not throw, but the
    // promise is created before the `try` opens: without this, a rejection
    // would be unhandled instead of a fallback row.
    expect(QUERIES).toContain("await fitReads.catch(");
  });

  it("answers null for an item whose notice row did not come back", () => {
    // Every line after this reads `fo`; `outreach/page.tsx` awaits
    // `loadWorkspace` inside a `Promise.all`, so a `TypeError` here was a 500
    // on the whole board rather than an empty workspace.
    expect(QUERIES).toContain("if (!fo) return null;");
  });
});

describe("the workspace opens to the screen it is on (V2)", () => {
  it("SlideOver takes a CSS length, so a caller can express a range", () => {
    expect(SLIDE_OVER).toContain("width?: number | string;");
    // `max-w-full` is what keeps a floor from overflowing a narrow viewport.
    expect(SLIDE_OVER).toContain("max-w-full");
  });

  it("the workspace has a floor, grows with the viewport, and stops", () => {
    // Measured before: a hard 880px in a 1366px viewport left 486px — 36% of
    // the screen — unused, and it did not grow on a larger monitor.
    expect(WORKSPACE).toContain('const WORKSPACE_WIDTH = "clamp(880px, 78vw, 1440px)";');
    expect(WORKSPACE).toContain("width={WORKSPACE_WIDTH}");
  });

  it("the floor is the row grid's, not a preference", () => {
    // D-j sized the recipients row at 880:
    // `grid-cols-[18px_minmax(118px,max-content)_minmax(0,1fr)_minmax(132px,max-content)]`.
    // Below it the flexible column is the one that gives.
    const ROW_VIEW = readFileSync(path.join(process.cwd(), "src/components/fit/verdict-row-view.ts"), "utf8");
    expect(ROW_VIEW).toContain("minmax(118px,max-content)");
    expect(ROW_VIEW).toContain("minmax(132px,max-content)");
  });
});

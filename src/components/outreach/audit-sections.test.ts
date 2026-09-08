/**
 * The audit layer's presentation table and the section order (fit-UX PR 4).
 *
 * Same shape as `verdict-row-view.test.ts`, for the same reason: there is no
 * DOM test environment here, so the decisions are asserted by value and the
 * JSX-only facts are narrow, whole-file `toContain`s on strings a mutation
 * would have to delete. Reading source is a weaker check than rendering and is
 * written as exactly that.
 *
 * The one assertion that carries real weight is the **section order**. README
 * §"Screens / views" 4 lists eight sections top to bottom, "mirroring the
 * row's order", and that order is the property a reader notices broken before
 * any class string — so it is checked by walking `evidence-view.tsx` and
 * comparing the positions of the eight markers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_SECTIONS,
  AXIS_TONE,
  CAVEAT_TONE,
  RECAP_DIVIDER,
  RECAP_GRID,
  ELIGIBILITY_HEADING,
  ELIGIBILITY_STATE_CLASS,
  inspectorHref,
  INTERNALS_NOTE,
  INTERNALS_SUMMARY,
  ITEMS_LABEL,
  NOT_THIS_PERSON,
  PANEL_TITLE,
  PROVENANCE_TAIL,
  RECAP_HEADING,
  RECAP_ORDER,
  RECAP_TONE,
  REQUIREMENT_STATE_CLASS,
  REQUIREMENTS_HEADING,
  RULE_ROW,
  snapshotLine,
} from "@/components/outreach/audit-sections";
import { ELIGIBILITY_STATE_TEXT, REQUIREMENT_STATE_TEXT, type AuditTone, type EligibilityState, type RequirementState } from "@/lib/fit/audit-view";
import type { CaveatTone, Tone } from "@/lib/fit/verdicts";

const SOURCE = readFileSync(path.join(process.cwd(), "src/components/outreach/evidence-view.tsx"), "utf8");

/** The `<details>` element itself, not the word in a comment. */
const DETAILS_TAG = '<details className="border-t border-line">';

describe("the section order is the brief's", () => {
  it("names the eight sections README §4 lists", () => {
    expect(AUDIT_SECTIONS.map((s) => s.id)).toEqual(["provenance", "header", "recap", "why", "approach", "rules", "items", "internals"]);
  });

  it("and the component renders them in that order, once each", () => {
    const positions = AUDIT_SECTIONS.map((s) => {
      const first = SOURCE.indexOf(s.marker);
      expect(first, `missing section marker: ${s.marker}`).toBeGreaterThan(-1);
      expect(SOURCE.indexOf(s.marker, first + 1), `duplicated section marker: ${s.marker}`).toBe(-1);
      return first;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("the recap", () => {
  it("keeps the three verdicts in the order §3a keeps them", () => {
    expect(RECAP_ORDER).toEqual(["approach", "eligibility", "evidence"]);
    expect(RECAP_ORDER.map((a) => RECAP_HEADING[a])).toEqual(["Approach", "Eligibility", "Evidence"]);
  });

  it("colours each verdict by its own tone, and an `ok` verdict is not an endorsement colour", () => {
    const tones: Tone[] = ["ok", "caution", "blocking"];
    for (const t of tones) expect(RECAP_TONE[t]).toBeTruthy();
    expect(RECAP_TONE.ok).toBe("text-ink");
    expect(RECAP_TONE.caution).toContain("text-warning");
    expect(RECAP_TONE.blocking).toContain("text-danger");
    expect(new Set(tones.map((t) => RECAP_TONE[t])).size).toBe(3);
  });

  it("divides three equal columns with the border the brief names", () => {
    expect(RECAP_ORDER.length).toBe(3);
    expect(RECAP_GRID).toContain("grid-cols-3");
    expect(RECAP_DIVIDER).toBe("border-l border-line-row");
  });
});

describe("the caveat", () => {
  it("is coloured by severity, never one flat colour", () => {
    const tones: CaveatTone[] = ["quiet", "caution", "blocking"];
    expect(new Set(tones.map((t) => CAVEAT_TONE[t])).size).toBe(3);
    expect(CAVEAT_TONE.blocking).toContain("text-danger");
  });

  it("and is rendered above the fold, not inside the internals disclosure", () => {
    const caveat = SOURCE.indexOf("verdicts.caveat.text");
    const details = SOURCE.indexOf(DETAILS_TAG);
    expect(caveat).toBeGreaterThan(-1);
    expect(details).toBeGreaterThan(-1);
    expect(caveat).toBeLessThan(details);
  });
});

describe("approach, side by side", () => {
  it("titles the two panels as the brief titles them", () => {
    expect(PANEL_TITLE).toEqual({ notice: "What the notice funds", evidence: "What the evidence shows" });
  });

  it("draws a divergent row in warning or danger, and an agreeing row in neither", () => {
    const tones: AuditTone[] = ["ok", "caution", "blocking"];
    expect(new Set(tones.map((t) => AXIS_TONE[t])).size).toBe(3);
    expect(AXIS_TONE.caution).toContain("text-warning");
    expect(AXIS_TONE.blocking).toContain("text-danger");
    expect(AXIS_TONE.ok).not.toContain("text-warning");
    expect(AXIS_TONE.ok).not.toContain("text-danger");
  });
});

describe("the two rule tables", () => {
  it("are headed as two different things (§3e)", () => {
    expect(ELIGIBILITY_HEADING).toBe("Eligibility · who may apply");
    expect(REQUIREMENTS_HEADING).toBe("Notice requirements · what the application must contain");
    expect(ELIGIBILITY_HEADING).not.toBe(REQUIREMENTS_HEADING);
  });

  it("and are drawn as two boxes, in that order", () => {
    const a = SOURCE.indexOf("ELIGIBILITY_HEADING");
    const b = SOURCE.indexOf("REQUIREMENTS_HEADING");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it("gives every state of both tables a distinct class, and a failure the strongest one", () => {
    const e: EligibilityState[] = ["met", "fails", "unknown"];
    const r: RequirementState[] = ["met", "not_met", "unknown"];
    expect(new Set(e.map((s) => ELIGIBILITY_STATE_CLASS[s])).size).toBe(3);
    expect(ELIGIBILITY_STATE_CLASS.fails).toContain("text-danger");
    expect(ELIGIBILITY_STATE_CLASS.met).toContain("text-success");
    expect(REQUIREMENT_STATE_CLASS.met).toContain("text-success");
    // An unmet *requirement* is amber, not red: it caps the tier, it does not
    // exclude the pair (§3e, §4.1).
    expect(REQUIREMENT_STATE_CLASS.not_met).toContain("text-warning");
    expect(r.every((s) => Boolean(REQUIREMENT_STATE_CLASS[s]))).toBe(true);
  });

  it("gives the requirements table a wider state column, because its words are longer", () => {
    const width = (cls: string) => Number(/_(\d+)px\]/.exec(cls)?.[1] ?? 0);
    expect(REQUIREMENT_STATE_TEXT.not_met.length).toBeGreaterThan(ELIGIBILITY_STATE_TEXT.fails.length);
    expect(width(RULE_ROW.requirements)).toBeGreaterThan(width(RULE_ROW.eligibility));
  });
});

describe("provenance", () => {
  it("dates the snapshot and says what the view rests on", () => {
    expect(snapshotLine("2026-09-04T12:00:00Z")).toBe(`Evidence snapshot saved Sep 4, 2026 · ${PROVENANCE_TAIL}`);
  });

  it("drops the date rather than printing Invalid Date", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      expect(snapshotLine(bad)).toBe(`Evidence snapshot · ${PROVENANCE_TAIL}`);
      expect(snapshotLine(bad)).not.toContain("Invalid");
    }
  });
});

describe("the items", () => {
  it("is the section the brief calls it, with the identity control's own words", () => {
    expect(ITEMS_LABEL).toBe("The items this rests on");
    expect(NOT_THIS_PERSON).toBe("Not this person");
  });

  it("and the identity control is gated on `identityReviewOf`, never on the raw field", () => {
    // C4 — widened by V1 — lives in one pure function; a component that tested
    // `identityItem` itself would offer the control on a biosketch the moment
    // a writer attached one, and would tell the action a kind the item is not.
    expect(SOURCE).toContain("identityReviewOf(item)");
    expect(SOURCE).not.toMatch(/item\.identityItem\s*(\?|&&)/);
    expect(SOURCE).not.toMatch(/item\.publicationId\s*(\?|&&)/);
  });

  it("draws the control only with a handler behind it", () => {
    expect(SOURCE).toContain("identity && onNotThisPerson");
  });
});

describe("engine internals", () => {
  it("is collapsed, and framed as inputs rather than a second opinion", () => {
    expect(INTERNALS_SUMMARY).toBe("Engine internals · component scores, floors and caps");
    expect(INTERNALS_NOTE).toContain("inputs to the verdicts above, not a second opinion on them");
    expect(INTERNALS_NOTE).toContain("taxonomy.json");
    // `<details>` with no `open` attribute — collapsed until asked for.
    expect(SOURCE).toContain('<details className="border-t border-line">');
  });

  it("holds the bars, so no decision surface shows a component value", () => {
    const details = SOURCE.indexOf(DETAILS_TAG);
    expect(SOURCE.indexOf("<ComponentBars")).toBeGreaterThan(details);
  });

  it("links the inspector for the counterpart record, and only when one is passed", () => {
    expect(inspectorHref("person", "abc")).toBe("/investigators/abc/fit");
    expect(inspectorHref("notice", "abc")).toBe("/opportunities/abc/fit");
    expect(SOURCE).toContain("{inspectorHref ?");
  });
});

describe("the flag control", () => {
  it("is drawn only with its own label beside it (PR 3's 3b rule)", () => {
    expect(SOURCE).toContain("onFlag && flagLabel ? { onFlag, flagLabel } : null");
    expect(SOURCE).toContain("{flag.flagLabel}");
    // no hardcoded words for somebody else's mechanism
    expect(SOURCE).not.toContain("This is wrong");
  });
});

describe("back to the list", () => {
  it("is a button the surface handles, not a route", () => {
    expect(SOURCE).toContain("onClick={onBack}");
    expect(SOURCE).not.toMatch(/router\.push|useRouter/);
  });
});

// ---------------------------------------------------------------------------
// The two shells' call sites
//
// Narrow, whole-file `toContain`s again, and for the same reason: these four
// facts have no other reachable home. The list shell is a client component
// with `useState`, the outreach loader takes a Supabase client, and neither
// has a rendering harness here — but a mutation to any of these lines leaves
// the page rendering and the audit layer quietly wrong.
// ---------------------------------------------------------------------------

const LIST = readFileSync(path.join(process.cwd(), "src/components/fit/verdict-list.tsx"), "utf8");
const CARD = readFileSync(path.join(process.cwd(), "src/components/fit/fit-opportunities.tsx"), "utf8");
const LOADER = readFileSync(path.join(process.cwd(), "src/lib/outreach/queries.ts"), "utf8");
const FITS = readFileSync(path.join(process.cwd(), "src/lib/fit/investigator-fits.ts"), "utf8");

describe("the list shell wires `deep` to the audit layer", () => {
  it("renders the audit view in the card's place, before the comparison and the list", () => {
    expect(LIST).toContain("<EvidenceView");
    const audit = LIST.indexOf("if (deepRow?.audit)");
    const compare = LIST.indexOf("if (comparing && compared.length >= MIN_COMPARED)");
    expect(audit).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(audit);
  });

  it("keeps the list's own state mounted, so back restores filter and selection", () => {
    // `setDeep(null)` is the whole of "back": `filter`, `selected`,
    // `showRuledOut` and `open` are never touched by opening or closing it.
    expect(LIST).toContain("onBack={() => setDeep(null)}");
    for (const state of ["setFilter(", "setSelected(", "setShowRuledOut(", "setOpen("]) {
      expect(LIST.slice(LIST.indexOf("if (deepRow?.audit)"), LIST.indexOf("if (comparing &&"))).not.toContain(state);
    }
  });

  it("resolves the deep row over every row the audience lists, not the filtered set", () => {
    expect(LIST).toContain("audienceRows.find((r) => r.id === deep && r.audit)");
  });

  it("draws the row's link only where a row carries an audit", () => {
    expect(LIST).toContain("onDeep={r.audit ? () => setDeep(r.id) : undefined}");
    expect(LIST).not.toContain("deepView");
  });

  it("captions the inspector for the subject, and only for an admin", () => {
    expect(LIST).toContain("inspectorHref={viewerIsAdmin ? inspectorHref(subject, deepRow.id) : null}");
  });
});

describe("both loaders build the audit from the verdicts' own input", () => {
  it("the outreach loader passes one object to both view models", () => {
    // Two separately-assembled inputs is how a row and the audit view it opens
    // come to disagree about which notice profile was checked.
    expect(LOADER).toContain('const input = { row: r, notice, investigator, lookup, audience: "strategist" as const, noticeComplete };');
    expect(LOADER).toContain("const verdicts = fitVerdicts(input);");
    expect(LOADER).toContain("audit: auditView(input)");
  });

  it("the investigator loader does the same", () => {
    expect(FITS).toContain("const input = { row: r, notice, investigator: ctx.investigator, lookup: ctx.lookup, audience: ctx.audience, noticeComplete };");
    expect(FITS).toContain("const verdicts = fitVerdicts(input);");
    expect(FITS).toContain("audit: auditView(input),");
  });

  it("and the card hands the row's own panel to the audit view, so the two say the same thing", () => {
    expect(CARD).toContain("audit: { content: r.audit, panel: r.disclosure, items: r.items }");
  });
});

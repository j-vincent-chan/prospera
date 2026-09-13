/**
 * The Review page's class table (`components/review/review-view.ts`). The
 * same invariant `verdict-row-view.test.ts` keeps: `cn` joins, so no string
 * may name one utility group twice, and the design's measurements are values.
 */
import { describe, expect, it } from "vitest";
import * as view from "@/components/review/review-view";

/** Every class string the module exports, including the ones inside records. */
function allStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(view)) {
    if (typeof value === "string") out.push([name, value]);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) if (typeof v === "string") out.push([`${name}.${k}`, v]);
  }
  return out;
}

/**
 * The CSS property group a Tailwind class writes, or `null` when this test
 * does not model it — the same model `verdict-row-view.test.ts` uses, so the
 * two files disagree about nothing. A variant (`hover:`, `last:`) is skipped:
 * a state is not a conflict with the base.
 */
function utilityGroup(cls: string): string | null {
  const SIZES = ["h1", "title", "body", "dense", "meta", "micro", "section", "label", "stat", "stat-lg"];
  const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
  if (cls.includes(":")) return null;
  if (cls.startsWith("text-")) {
    const rest = cls.slice(5);
    if (SIZES.includes(rest) || /^\[[\d.]+(?:px|rem|em)\]$/.test(rest)) return "font-size";
    if (["left", "center", "right", "justify", "start", "end", "balance", "pretty"].includes(rest)) return "text-align";
    return "color";
  }
  if (cls.startsWith("font-")) return WEIGHTS.includes(cls.slice(5)) ? "font-weight" : "font-family";
  if (cls === "border" || /^border-(?:[0-8]|\[[^\]]+\])$/.test(cls)) return "border-width";
  if (/^border-[trblxy](?:-|$)/.test(cls)) return `border-${cls.slice(7, 8)}`;
  if (cls.startsWith("border-")) return "border-color";
  if (cls.startsWith("bg-")) return "background";
  if (cls.startsWith("shadow")) return "shadow";
  if (cls.startsWith("rounded-")) {
    const m = cls.match(/^rounded-([trbl]|[tb][lr])(?:-|$)/);
    return m ? `rounded-${m[1]}` : "rounded";
  }
  for (const p of ["gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "p", "mx", "my", "mt", "mr", "mb", "ml", "m", "grid-cols", "min-w", "max-w", "w", "h", "rounded", "leading", "tracking", "align", "line-clamp", "top", "bottom", "z"]) {
    if (cls === p || cls.startsWith(`${p}-`)) return p;
  }
  return null;
}

describe("no class string names one utility group twice", () => {
  for (const [name, value] of allStrings()) {
    it(name, () => {
      const seen = new Map<string, string>();
      for (const cls of value.split(/\s+/).filter(Boolean)) {
        const g = utilityGroup(cls);
        if (!g) continue;
        expect(seen.has(g), `${name}: "${cls}" repeats group "${g}" after "${seen.get(g)}"`).toBe(false);
        seen.set(g, cls);
      }
    });
  }
});

describe("the design's measurements", () => {
  it("match-row actions are 34px with a 7px radius; the row's Undo is 30", () => {
    for (const s of [view.MATCH_PRIMARY, view.MATCH_SECONDARY, view.MATCH_WATCH, view.MATCH_DISCLOSURE]) {
      expect(s).toContain("h-[34px]");
      expect(s).toContain("rounded-[7px]");
    }
    expect(view.MATCH_UNDO).toContain("h-[30px]");
  });

  it("the primary match action is navy 13/600; Watch is the secondary box with body-grey text", () => {
    expect(view.MATCH_PRIMARY).toContain("bg-navy");
    expect(view.MATCH_PRIMARY).toContain("font-semibold");
    expect(view.MATCH_WATCH).toContain("text-ink-body");
    expect(view.MATCH_DISCLOSURE).toContain("text-teal");
  });

  it("reason chips are 27px on the warn palette; strength tags 24px", () => {
    expect(view.REASON_CHIP).toContain("h-[27px]");
    expect(view.REASON_CHIP).toContain("border-warning-border");
    expect(view.REASON_CHIP).toContain("text-warning-dark");
    expect(view.STRENGTH_TAG).toContain("h-6");
    expect(view.STRENGTH_TAG_STATE.on).toContain("bg-teal-tint");
  });

  it("row tones: the focused row carries the teal left rail; rejected rows the subtle surface", () => {
    expect(view.ROW_TONE.focused).toContain("shadow-[inset_3px_0_0_theme(colors.teal.DEFAULT)]");
    expect(view.ROW_TONE.rejected).toBe("bg-footer-bar");
    expect(view.ROW_PAD.comfortable).toContain("py-3.5");
    expect(view.ROW_PAD.compact).toContain("py-[11px]");
  });

  it("the caveat is a 2px left border in the tone's colour, three lines at most", () => {
    expect(view.CAVEAT).toContain("border-l-2");
    expect(view.CAVEAT).toContain("line-clamp-3");
    expect(view.CAVEAT_TONE.blocking).toContain("text-danger");
    expect(view.CAVEAT_TONE.caution).toContain("text-warning");
    expect(view.CAVEAT_TONE.quiet).toContain("text-ink-body");
  });

  it("the aside and the layout use the README's clamps", () => {
    expect(view.ASIDE).toContain("w-[clamp(200px,19vw,340px)]");
    expect(view.LAYOUT).toContain("gap-[clamp(12px,1.4vw,20px)]");
    expect(view.PAGE).toContain("max-w-[1720px]");
  });

  it("the queued bar is navy with the dialog shadow and sits 16px off the bottom", () => {
    expect(view.QUEUED_BAR).toContain("bg-navy");
    expect(view.QUEUED_BAR).toContain("shadow-dialog");
    expect(view.QUEUED_BAR).toContain("bottom-4");
  });

  it("disclosure labels", () => {
    expect(view.disclosureLabel(false)).toBe("Read Prospera's assessment");
    expect(view.disclosureLabel(true)).toBe("Hide assessment");
  });
});

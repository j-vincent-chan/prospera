/**
 * The fit row's presentation table (fit-UX PR 2).
 *
 * **There is no DOM test environment in this repo, and this PR does not add
 * one.** `vitest.config.ts` sets `environment: "node"` and
 * `include: ["src/**\/*.test.ts"]`, tsconfig has `jsx: "preserve"`, and no
 * react plugin is registered — a `.tsx` import fails transform ("make sure to
 * not set jsx to preserve"). So the row's *decisions* — every class string,
 * every word, the chip order, the grid, the wrapper — live in
 * `verdict-row-view.ts`, a plain `.ts` module, and are asserted here by value.
 *
 * **What the value assertions cannot reach**, and what the last block of this
 * file therefore reads out of the source instead: JSX-only facts — which
 * element carries `aria-checked`, whether the title is still a `<Link>`,
 * whether the action button still has an `onClick`. Reading source is a weaker
 * check than rendering and is written here as exactly that: narrow, whole-file
 * `toContain`s on strings that a mutation would have to delete. It is not a
 * substitute for PR 3's tests against a rendered list, and it is not claimed
 * to be.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_BUTTON,
  CAVEAT_TONE,
  CHIP_BASE,
  CHIP_ORDER,
  CHIP_TONE,
  DISCLOSURE_BOX,
  DISCLOSURE_GRID,
  DUE_CAPTION,
  DUE_TONE,
  CHECKS_HEADING,
  disclosureSections,
  DUE_URGENT_WORD,
  DUE_URGENT_WORD_CLASS,
  gapHeading,
  GAP_HEADING,
  panelIdFor,
  ROW_GRID,
  rowWrapClass,
  SECTION_LABEL,
  selectBoxClass,
  selectLabel,
  STACKED_BOX,
  STACKED_LABEL_INLINE,
  titleIdFor,
  TITLE_CLASS,
  TITLE_LINK_HOVER,
  toggleLabel,
  VERDICT_LABEL_PILL,
  VERDICT_LABEL_TEXT,
  type DueTone,
  type RowSubject,
  type RowVariant,
} from "@/components/fit/verdict-row-view";
import { FIT_TIER_LABEL } from "@/lib/fit/tier-display";
import type { CaveatTone, Tone, VerdictLabel } from "@/lib/fit/verdicts";

const LABELS: readonly VerdictLabel[] = ["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"];
const TONES: readonly Tone[] = ["ok", "caution", "blocking"];
const CAVEAT_TONES: readonly CaveatTone[] = ["quiet", "caution", "blocking"];
const DUE_TONES: readonly DueTone[] = ["normal", "urgent", "quiet"];
const SUBJECTS: readonly RowSubject[] = ["notice", "person"];
const VARIANTS: readonly RowVariant[] = ["grid", "stacked"];

const src = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

/** Source with comments removed. A file must be free to *explain* the rule it keeps. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const row = src("./verdict-row.tsx");
const panelSrc = src("./verdict-row-disclosure.tsx");
const panelCode = code(panelSrc);
const pill = src("../ui/pill.tsx");
const button = src("../ui/button.tsx");

describe("the label", () => {
  it("says all five states in words", () => {
    expect(LABELS.map((l) => VERDICT_LABEL_TEXT[l])).toEqual([
      "Strong match",
      "Moderate match",
      "Exploratory",
      "Can't assess",
      "Ruled out",
    ]);
  });

  it("takes the three engine tiers from the shared vocabulary rather than retyping them (D33)", () => {
    expect(VERDICT_LABEL_TEXT.strong).toBe(FIT_TIER_LABEL.strong);
    expect(VERDICT_LABEL_TEXT.moderate).toBe(FIT_TIER_LABEL.potential);
    expect(VERDICT_LABEL_TEXT.exploratory).toBe(FIT_TIER_LABEL.exploratory);
  });

  it("maps each state to its own pill by name, not merely to a distinct one", () => {
    // Asserting only distinctness let `strong` and `ruled_out` be swapped —
    // a Strong match rendering the grey "Ruled out" pill — and stay green.
    expect(VERDICT_LABEL_PILL).toEqual({
      strong: "tier-strong-square",
      moderate: "tier-moderate-square",
      exploratory: "tier-exploratory-square",
      cannot_assess: "tier-cannot-assess-square",
      ruled_out: "tier-ruled-out-square",
    });
  });
});

describe("pill.tsx", () => {
  it("declares every square variant the row names, and gives it the prototype's tracking", () => {
    for (const l of LABELS) {
      expect(pill).toContain(`| "${VERDICT_LABEL_PILL[l]}"`);
      expect(pill).toContain(`"${VERDICT_LABEL_PILL[l]}": "py-[3px] text-meta font-semibold tracking-[0.01em] `);
    }
  });

  it("leaves the variants the admin inspectors use untouched", () => {
    // TierPill renders these three through TIER_PILL_VARIANT; the two /fit
    // inspectors depend on them, so PR 2 may add variants and may not change
    // these.
    expect(pill).toContain('"tier-strong": "h-5 text-micro font-medium bg-teal text-white"');
    expect(pill).toContain('"tier-potential": "h-5 text-micro font-medium bg-teal-tint text-teal"');
    expect(pill).toContain('"tier-exploratory": "h-5 text-micro font-medium bg-card text-ink-muted border border-line-control"');
  });

  it("keeps the full-pill shape for every non-square variant", () => {
    expect(pill).toContain('SQUARE.has(variant) ? "rounded-control px-[9px]" : "rounded-full px-2"');
  });
});

describe("button.tsx", () => {
  it("carries a quiet variant that overrides nothing", () => {
    // The row's third action used to be `ghost` plus `text-ink-muted`, which
    // beat ghost's own `text-ink` only because `ink.DEFAULT` is declared above
    // `ink.muted` in tailwind.config.ts. Reorder that object and every quiet
    // action flips colour. The variant carries its own tone instead.
    expect(button).toContain('quiet: "border border-transparent bg-transparent text-ink-muted hover:text-ink"');
    expect(button).toContain('32: "h-8 px-1 text-dense"'); // the prototype's 4px, not sizes[32]'s px-3
  });

  it("leaves the six pre-existing variants exactly as they were", () => {
    expect(button).toContain('primary: "border border-navy bg-navy text-white hover:bg-navy-hover hover:border-navy-hover"');
    expect(button).toContain('secondary: "border border-line-control bg-card text-ink hover:bg-canvas"');
    expect(button).toContain('ghost: "border border-transparent bg-transparent text-ink hover:bg-line-row"');
    expect(button).toContain('link: "border border-transparent bg-transparent text-teal hover:text-navy"');
    expect(button).toContain('destructive: "border border-danger bg-danger text-white hover:bg-danger-dark hover:border-danger-dark"');
    expect(button).toContain('"destructive-outline": "border border-line-control bg-card text-danger hover:bg-danger-tint"');
    expect(button).toContain('32: "h-8 px-3 text-dense"');
  });
});

describe("the tones", () => {
  it("pins every chip, caveat, deadline and action tone by value", () => {
    // `toBeTruthy()` let `ACTION_BUTTON.primary.variant` become "ghost".
    expect(CHIP_TONE).toEqual({
      ok: "bg-line-row text-ink-body",
      caution: "bg-warning-tint text-warning",
      blocking: "bg-danger-tint text-danger",
    });
    expect(CAVEAT_TONE).toEqual({
      quiet: "text-ink-body",
      caution: "font-medium text-warning",
      blocking: "font-medium text-danger",
    });
    expect(DUE_TONE).toEqual({
      normal: "text-dense font-medium text-ink",
      urgent: "text-dense font-semibold text-danger",
      quiet: "text-dense text-ink-muted",
    });
    expect(ACTION_BUTTON).toEqual({
      primary: { variant: "primary" },
      secondary: { variant: "secondary" },
      quiet: { variant: "quiet" },
    });
  });

  it("lets a chip too wide for its line break inside itself rather than outside the card", () => {
    // In the 340px aside "Different approach · basic discovery vs
    // implementation" is 325.9px against a 306px column; nowrap hung it 3.9px
    // outside the card. A flex line still wraps before it shrinks an item, so
    // chips that fit are unchanged.
    expect(CHIP_BASE).toBe("inline-flex max-w-full items-center rounded-[5px] px-2 py-0.5 text-meta font-medium");
  });

  it("keeps a row with no material caveat out of the warning palette", () => {
    expect(CAVEAT_TONE.quiet).toBe("text-ink-body");
    expect(CAVEAT_TONE.caution).toContain("text-warning");
    expect(CAVEAT_TONE.blocking).toContain("text-danger");
  });

  it("uses existing tokens only — no hex, no arbitrary colour", () => {
    const tone = [
      CHIP_BASE,
      ...TONES.map((t) => CHIP_TONE[t]),
      ...CAVEAT_TONES.map((t) => CAVEAT_TONE[t]),
      ...DUE_TONES.map((t) => DUE_TONE[t]),
      DUE_URGENT_WORD_CLASS,
      TITLE_LINK_HOVER,
    ].join(" ");
    expect(tone).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(tone).not.toMatch(/\b(?:bg|text|border)-\[/);

    // The layout strings carry the README's own arbitrary *lengths*
    // (`text-[15px]`, `pl-[170px]`, `rounded-[4px]`); what they may never
    // carry is an arbitrary colour.
    const layout = [
      ROW_GRID, STACKED_BOX, STACKED_LABEL_INLINE, TITLE_CLASS, SECTION_LABEL,
      selectBoxClass(true), selectBoxClass(false), rowWrapClass({ selected: true }),
      ...VARIANTS.map((v) => `${DISCLOSURE_BOX[v]} ${DISCLOSURE_GRID[v]}`),
    ].join(" ");
    expect(layout).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(layout).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-\[\s*(?:#|rgba?\(|hsla?\()/i);
  });

  it("never names one utility group twice in a single class string", () => {
    // `cn` is a plain join, not a class merger, so "gap-7 … gap-4" resolves by
    // the generated stylesheet's source order, not by the last name written:
    // the panel's stacked grid shipped as `grid gap-7 grid-cols-1 gap-4` and
    // rendered at 28px, because `.gap-4` precedes `.gap-7` in the output. Any
    // string that names one group twice is that bug.
    const strings: Record<string, string> = {
      ROW_GRID,
      STACKED_BOX,
      STACKED_LABEL_INLINE,
      CHIP_BASE,
      TITLE_CLASS,
      SECTION_LABEL,
      DUE_URGENT_WORD_CLASS,
      "selectBoxClass(true)": selectBoxClass(true),
      "selectBoxClass(false)": selectBoxClass(false),
      "rowWrapClass(selected)": rowWrapClass({ selected: true, className: "" }),
      ...Object.fromEntries(TONES.map((t) => [`CHIP_TONE.${t}`, `${CHIP_BASE} ${CHIP_TONE[t]}`])),
      ...Object.fromEntries(CAVEAT_TONES.map((t) => [`CAVEAT_TONE.${t}`, `mt-1.5 text-body leading-[1.5] ${CAVEAT_TONE[t]}`])),
      ...Object.fromEntries(DUE_TONES.map((t) => [`DUE_TONE.${t}`, `whitespace-nowrap ${DUE_TONE[t]}`])),
      ...Object.fromEntries(VARIANTS.map((v) => [`DISCLOSURE_BOX.${v}`, DISCLOSURE_BOX[v]])),
      ...Object.fromEntries(VARIANTS.map((v) => [`DISCLOSURE_GRID.${v}`, DISCLOSURE_GRID[v]])),
    };
    for (const [name, value] of Object.entries(strings)) {
      const seen = new Map<string, string>();
      const clash: string[] = [];
      for (const cls of value.split(/\s+/).filter(Boolean)) {
        if (cls.includes(":")) continue; // hover:/md:/… — a state is not a conflict
        const g = utilityGroup(cls);
        if (!g) continue;
        const prev = seen.get(g);
        if (prev) clash.push(`${name}: ${prev} and ${cls} both set ${g}`);
        seen.set(g, cls);
      }
      expect(clash).toEqual([]);
    }
  });
});

/**
 * The CSS property group a Tailwind class writes, or `null` when this test
 * does not model it. Only groups where a duplicate is unambiguously a bug —
 * `text-` is split, because `text-dense text-ink` is a size and a colour and
 * is correct, while `text-ink text-ink-muted` is the `ghost`/quiet collision.
 */
function utilityGroup(cls: string): string | null {
  const SIZES = ["h1", "title", "body", "dense", "meta", "micro", "section", "label", "stat", "stat-lg"];
  const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
  if (cls.startsWith("text-")) {
    const rest = cls.slice(5);
    if (SIZES.includes(rest) || /^\[[\d.]+(?:px|rem|em)\]$/.test(rest)) return "font-size";
    if (["left", "center", "right", "justify", "start", "end", "balance"].includes(rest)) return "text-align";
    return "color";
  }
  if (cls.startsWith("font-")) return WEIGHTS.includes(cls.slice(5)) ? "font-weight" : "font-family";
  if (cls === "border" || /^border-(?:[0-8]|\[[^\]]+\])$/.test(cls)) return "border-width";
  if (/^border-[trblxy](?:-|$)/.test(cls)) return `border-${cls.slice(7, 8)}`;
  if (cls.startsWith("border-")) return "border-color";
  if (cls.startsWith("bg-")) return "background";
  for (const p of ["gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "p", "mx", "my", "mt", "mr", "mb", "ml", "m", "grid-cols", "min-w", "max-w", "w", "h", "rounded", "leading", "tracking", "align"]) {
    if (cls === p || cls.startsWith(`${p}-`)) return p;
  }
  return null;
}

describe("the row's layout", () => {
  it("keeps the README's grid, widened only where the README's own tracks overflow at 1366px", () => {
    // Measured at 1366px against the repo's compiled Tailwind: "Moderate
    // match" is 113.0px in the README's 104px label track, and "See what's
    // missing" 143.4px / "Complete the profile" 152.9px in its 132px action
    // track — the latter putting 6.9px of an opaque button over the caveat.
    // Both README numbers survive as the floor; `max-content` is the ceiling.
    expect(ROW_GRID).toBe(
      "grid grid-cols-[18px_minmax(118px,max-content)_minmax(0,1fr)_minmax(132px,max-content)] items-start gap-3.5 px-5 py-3.5",
    );
  });

  it("indents the disclosure with the label track and nothing else", () => {
    // 20 (px-5) + 18 (the box) + 14 (gap) + 118 (the label track) = 170.
    expect(DISCLOSURE_BOX.grid).toContain("pl-[170px]");
    expect(DISCLOSURE_BOX.stacked).toContain("px-4");
    expect(DISCLOSURE_BOX.stacked).not.toContain("pl-[");
  });

  it("gives the disclosure two columns on the grid and one when stacked", () => {
    expect(DISCLOSURE_GRID.grid).toBe("grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-7");
    expect(DISCLOSURE_GRID.stacked).toBe("grid grid-cols-1 gap-4");
  });

  it("draws the row divider and the selection tint, and nothing on hover", () => {
    expect(rowWrapClass({})).toBe("border-t border-line-row");
    expect(rowWrapClass({ first: true })).toBe("");
    expect(rowWrapClass({ selected: true })).toBe("border-t border-line-row bg-teal-tint/30");
    expect(rowWrapClass({ first: true, selected: true })).toBe("bg-teal-tint/30");
    expect(rowWrapClass({ className: "x" })).toBe("border-t border-line-row x");
    // Rows do not change on hover: the flat system uses borders, not elevation.
    expect(rowWrapClass({ selected: true, className: "x" })).not.toContain("hover:");
  });

  it("tints the checkbox only when it is checked", () => {
    expect(selectBoxClass(true)).toContain("border-teal bg-teal text-white");
    expect(selectBoxClass(false)).toContain("border-line-control bg-card text-transparent");
    for (const c of ["h-[18px]", "w-[18px]", "rounded-[4px]", "border"]) expect(selectBoxClass(true).split(" ")).toContain(c);
    expect(selectLabel("PAR-26-041")).toBe("Select PAR-26-041");
  });
});

describe("the verdicts", () => {
  it("fixes the chip order at approach → eligibility → evidence (§3a)", () => {
    // The row maps over this, so the order is a value rather than a property
    // of the JSX: reordering the chips now fails here.
    expect(CHIP_ORDER).toEqual(["approach", "eligibility", "evidence"]);
  });

  it("never lets a tone be the only carrier: the row prints each verdict's own words", () => {
    expect(row).toContain("verdicts[axis].text");
    expect(row).toContain("verdicts[axis].tone");
    expect(row).toContain("{verdicts.caveat.text}");
    expect(row).toContain("{verdicts.reason}");
  });

  it("says the deadline is urgent in a word, not only in red", () => {
    // 13px medium → semibold is close to invisible, so `text-danger` was
    // carrying the whole signal and no word in the caller's string said so.
    // `person` is null: this PR's answer to D-l is that no people-facing status
    // is urgent, because no reply window exists to be past
    // (`verdict-fields.personStatus`).
    expect(DUE_URGENT_WORD).toEqual({ notice: "Closing soon", person: null });
    expect(DUE_URGENT_WORD_CLASS).toBe("text-micro font-semibold text-danger");
    expect(row).toContain('const urgentWord = dueTone === "urgent" ? DUE_URGENT_WORD[subject] : null;');
    expect(row).toContain("{urgentWord ? <span className={DUE_URGENT_WORD_CLASS}>{urgentWord}</span> : null}");
    // and only when it is urgent: a normal or quiet deadline says nothing extra
    for (const t of DUE_TONES.filter((x) => x !== "urgent")) expect(DUE_TONE[t]).not.toContain("text-danger");
  });
});

describe("the disclosure", () => {
  it("reads the toggle both ways", () => {
    expect(toggleLabel(false)).toBe("Why, and what it rests on");
    expect(toggleLabel(true)).toBe("Hide the reasoning");
  });

  it("names the gap list for every state, in both directions", () => {
    for (const s of SUBJECTS) for (const l of LABELS) expect(gapHeading(l, s)).toBeTruthy();
    expect(gapHeading("exploratory")).toBe("What would have to be true");
    expect(gapHeading("ruled_out")).toBe("Why it is ruled out");
    expect(gapHeading("cannot_assess")).toBe("Before this can be assessed");
  });

  it("says write on a notice and contact on a person, and never the other way round", () => {
    expect(gapHeading("strong", "notice")).toBe("Worth checking before you write");
    expect(gapHeading("strong", "person")).toBe("Worth checking before you contact");
    expect(GAP_HEADING.person.moderate).not.toContain("write");
    expect(GAP_HEADING.notice.moderate).not.toContain("contact");
  });

  it("captions the one right-hand field per direction (README: do not let the notice caption leak onto a person)", () => {
    expect(DUE_CAPTION.notice).toBe("Deadline");
    expect(DUE_CAPTION.person).toBe("Status");
  });

  it("checks are their own group with their own heading, and never take the analysis's place", () => {
    // The Outreach path concatenated the snapshot's warnings onto the engine's
    // gap sentences and kept the first five of the result. With three flags, a
    // freshness line and a contact history, every sentence the engine wrote was
    // gone — and what was left sat under a heading chosen from the label.
    const gaps = ["The notice requires human participants.", "Multi-PI is allowed."];
    const checks = ["Identity unverified: name-only match", "Profile last refreshed Mar 2024", "Contacted 3 times this year"];
    expect(disclosureSections("ruled_out", "person", { gaps, checks })).toEqual([
      { heading: "Why it is ruled out", bullets: gaps },
      { heading: "Worth checking before you contact", bullets: checks },
    ]);
    // …and on an Exploratory row the same bullets stop reading as conditions
    // for the pair to work ("for this to work, the identity must be unverified")
    expect(disclosureSections("exploratory", "person", { gaps, checks }).map((s) => s.heading)).toEqual(["What would have to be true", "Worth checking before you contact"]);
    // nothing is dropped, whichever group is longer
    for (const label of LABELS) {
      const flat = disclosureSections(label, "person", { gaps, checks }).flatMap((s) => s.bullets);
      expect(new Set(flat)).toEqual(new Set([...gaps, ...checks]));
      expect(flat.length).toBe(gaps.length + checks.length);
    }
  });

  it("a Strong or Moderate row draws one group, because its own heading is the checks heading", () => {
    // Two identical headings is a repetition, not a distinction. There the
    // surface's own warnings come first and the notice's conditions follow.
    const one = disclosureSections("strong", "person", { gaps: ["Multi-PI is allowed."], checks: ["Contacted 3 times this year"] });
    expect(one).toEqual([{ heading: "Worth checking before you contact", bullets: ["Contacted 3 times this year", "Multi-PI is allowed."] }]);
    expect(disclosureSections("moderate", "notice", { gaps: ["g"], checks: ["c"] })).toEqual([{ heading: "Worth checking before you write", bullets: ["c", "g"] }]);
    expect(CHECKS_HEADING.notice).toBe(GAP_HEADING.notice.strong);
    expect(CHECKS_HEADING.person).toBe(GAP_HEADING.person.strong);
    expect(CHECKS_HEADING.notice).not.toBe(CHECKS_HEADING.person);
  });

  it("an empty group is not drawn, and blank strings are not bullets", () => {
    expect(disclosureSections("ruled_out", "notice", { gaps: ["why"], checks: [] })).toEqual([{ heading: "Why it is ruled out", bullets: ["why"] }]);
    expect(disclosureSections("ruled_out", "notice", { gaps: [], checks: ["c"] })).toEqual([{ heading: "Worth checking before you write", bullets: ["c"] }]);
    expect(disclosureSections("ruled_out", "notice", {})).toEqual([]);
    expect(disclosureSections("ruled_out", "notice", { gaps: ["  ", ""], checks: [" "] })).toEqual([]);
  });

  it("gives the toggle a region to control and the region a name", () => {
    expect(panelIdFor("abc")).toBe("fit-row-abc-why");
    expect(titleIdFor("abc")).toBe("fit-row-abc-title");
    expect(panelIdFor("abc")).not.toBe(titleIdFor("abc"));
    expect(panelIdFor("a")).not.toBe(panelIdFor("b"));
  });

  it("holds nothing disqualifying inside the disclosure, because the panel cannot see the verdicts (§3c)", () => {
    // The first draft asserted this by slicing `verdict-row.tsx` between
    // `function DisclosurePanel` and the next section banner — lines a new
    // prop escapes, and which never covered `EvidenceCard` at all. The panel
    // is now its own module: this is the whole file, and the type is not in
    // scope in it.
    expect(panelCode).not.toMatch(/from "@\/lib\/fit\/verdicts"/);
    expect(panelCode).not.toContain("FitVerdicts");
    expect(panelCode).not.toContain("verdicts");
    expect(panelCode).not.toContain("caveat");
    expect(panelCode).not.toContain("eligibility");
    // What the panel is allowed to take, and what the row is allowed to hand
    // it: ids, open state, the variant, the heading, the payload and the two
    // links. Nothing else, at either end — an unused extra prop is the foothold
    // the next commit fills in.
    const ALLOWED = ["disclosure", "flagLabel", "id", "labelledBy", "onDeep", "onFlag", "open", "sections", "variant"];
    const sig = panelCode.indexOf("export function DisclosurePanel({");
    const taken = panelCode.slice(sig, panelCode.indexOf("}: {", sig));
    expect([...taken.matchAll(/^\s*([a-zA-Z]+),$/gm)].map((m) => m[1]).sort()).toEqual(ALLOWED);
    const call = row.slice(row.indexOf("<DisclosurePanel"), row.indexOf("/>", row.indexOf("<DisclosurePanel")));
    expect([...call.matchAll(/^\s*([a-zA-Z]+)=/gm)].map((m) => m[1]).sort()).toEqual(ALLOWED);
    // `sections` carries headings chosen from the label and the subject, never
    // from a verdict's text — the same rule the single `heading` prop kept.
    expect(call).toContain("sections={disclosureSections(verdicts.label, subject, disclosure)}");
    // What no test here can check: `why`, `gaps[]` and `items[]` are strings
    // the caller builds. Whether PR 3 puts a failed rule in one of them is
    // PR 3's contract, against real rows, in PR 3's tests.
  });
});

describe("the row markup", () => {
  it("is a client component, and says so", () => {
    // Not a server one. Five of its props are functions that land on onClick;
    // a Server Component parent passing any of them throws at request time
    // while tsc, lint and build all stay green.
    expect(row.startsWith('"use client";')).toBe(true);
    expect(panelSrc.startsWith('"use client";')).toBe(true);
  });

  it("takes its layout from the view module rather than writing classes inline", () => {
    // A `toContain` on a grid string is satisfied by a comment; the template
    // is a value now, asserted above, and the markup only names it.
    expect(row).toContain("className={ROW_GRID}");
    expect(row).toContain("className={STACKED_BOX}");
    expect(row).toContain("const wrap = rowWrapClass({ first, selected, className });");
    expect(row).toContain("className={wrap}");
    expect(panelSrc).toContain("className={DISCLOSURE_BOX[variant]}");
    expect(panelSrc).toContain("className={DISCLOSURE_GRID[variant]}");
  });

  it("keeps the disclosure a real button over a controlled region", () => {
    expect(row).toContain("aria-expanded={open}");
    expect(row).toContain("aria-controls={panelId}");
    // The region is hidden, never unmounted, so aria-controls never dangles.
    expect(panelSrc).toContain('role="region"');
    expect(panelSrc).toContain("hidden={!open}");
    expect(panelSrc).toContain("aria-labelledby={labelledBy}");
  });

  it("a bullet's key survives the same sentence arriving twice", () => {
    // The Outreach path composes its bullets from two lists and the same
    // sentence can be in both; `key={g}` on the string alone is then a
    // duplicate React key, and React drops or reorders the repeat.
    expect(panelSrc).toContain("{s.bullets.map((b, i) => (");
    expect(panelSrc).toContain("<li key={`${i}-${b}`}>{b}</li>");
  });

  it("keeps the checkbox announceable and the title linked", () => {
    expect(row).toContain("role=\"checkbox\"");
    expect(row).toContain("aria-checked={selected}");
    expect(row).toContain("aria-label={label}");
    expect(row).toContain("label={selectLabel(title)}");
    // The condition, not only the two branches: `href ? (` becoming `false ? (`
    // leaves both a <Link> and a <span> in the file and stops every title
    // linking.
    expect(row).toContain("const titleNode = href ? (");
    expect(row).toContain("<Link id={titleId} href={href}");
    expect(row).toContain("<span id={titleId}");
  });

  it("draws no control that cannot act — an inert control is worse than none", () => {
    // A read-only row drew a checkbox announcing aria-checked="false" that
    // could never be checked, and a navy "Add to outreach" that did nothing;
    // `disclosure` without `onToggle` drew a hidden panel with no way to open
    // it. All four controls are guarded the same way now.
    expect(row).toContain("{selectable && onSelect ? <SelectBox");
    expect(row).toContain("verdicts.action && onAction ? (");
    expect(row).toContain("onClick={onAction}");
    expect(row).toContain("{disclosure && onToggle ? <DisclosureToggle");
    expect(row).toContain("disclosure && (onToggle || open) ? (");
    // and the deep / flag links are the panel's, guarded there. The flag needs
    // its label as well as its handler: a surface that supplies a mechanism
    // without saying what it does cannot borrow somebody else's words for it.
    expect(panelSrc).toContain("const flag = onFlag && flagLabel ? { onFlag, flagLabel } : null;");
    expect(panelSrc).toContain("{onDeep || flag ? (");
    expect(panelSrc).toContain("{onDeep ? (");
    expect(panelSrc).toContain("{flag ? (");
    expect(panelSrc).toContain("{flag.flagLabel}");
  });

  it("carries no dead margin resets — preflight already zeroes <p>", () => {
    expect(row).not.toMatch(/className="[^"]*\b(?:m-0|mb-0|mt-0)\b/);
    expect(panelSrc).not.toMatch(/className=(?:"|\{`)[^"`]*\b(?:m-0|mb-0|mt-0)\b/);
  });
});

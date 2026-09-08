/**
 * The fit row's presentation table (fit-UX PR 2).
 *
 * **There is no DOM test environment in this repo.** `vitest.config.ts` sets
 * `environment: "node"` and `include: ["src/**\/*.test.ts"]`, tsconfig has
 * `jsx: "preserve"`, and no react plugin is registered — a `.tsx` import fails
 * transform ("make sure to not set jsx to preserve") and there is no
 * testing-library. Wiring one up is out of this PR's scope, so the row's
 * decisions live in `verdict-row-view.ts` — a plain `.ts` module with no JSX —
 * and are asserted here; `verdict-row.tsx` is markup over these maps and
 * carries no colour or copy logic of its own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_BUTTON,
  CAVEAT_TONE,
  CHIP_BASE,
  CHIP_TONE,
  DUE_CAPTION,
  DUE_TONE,
  gapHeading,
  GAP_HEADING,
  panelIdFor,
  titleIdFor,
  toggleLabel,
  VERDICT_LABEL_PILL,
  VERDICT_LABEL_TEXT,
  type DueTone,
  type RowSubject,
} from "@/components/fit/verdict-row-view";
import { FIT_TIER_LABEL } from "@/lib/fit/tier-display";
import type { ActionKind, CaveatTone, Tone, VerdictLabel } from "@/lib/fit/verdicts";

const LABELS: readonly VerdictLabel[] = ["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"];
const TONES: readonly Tone[] = ["ok", "caution", "blocking"];
const CAVEAT_TONES: readonly CaveatTone[] = ["quiet", "caution", "blocking"];
const DUE_TONES: readonly DueTone[] = ["normal", "urgent", "quiet"];
const KINDS: readonly ActionKind[] = ["primary", "secondary", "quiet"];
const SUBJECTS: readonly RowSubject[] = ["notice", "person"];

const src = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

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

  it("gives every state its own square pill variant", () => {
    const variants = LABELS.map((l) => VERDICT_LABEL_PILL[l]);
    expect(new Set(variants).size).toBe(LABELS.length);
    for (const v of variants) expect(v.endsWith("-square")).toBe(true);
  });
});

describe("pill.tsx", () => {
  const pill = src("../ui/pill.tsx");

  it("declares every square variant the row names", () => {
    for (const l of LABELS) {
      expect(pill).toContain(`| "${VERDICT_LABEL_PILL[l]}"`);
      expect(pill).toContain(`"${VERDICT_LABEL_PILL[l]}": "`);
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

describe("the tones", () => {
  it("covers every chip, caveat, deadline and action tone", () => {
    for (const t of TONES) expect(CHIP_TONE[t]).toBeTruthy();
    for (const t of CAVEAT_TONES) expect(CAVEAT_TONE[t]).toBeTruthy();
    for (const t of DUE_TONES) expect(DUE_TONE[t]).toBeTruthy();
    for (const k of KINDS) expect(ACTION_BUTTON[k].variant).toBeTruthy();
  });

  it("keeps a row with no material caveat out of the warning palette", () => {
    expect(CAVEAT_TONE.quiet).toBe("text-ink-body");
    expect(CAVEAT_TONE.caution).toContain("text-warning");
    expect(CAVEAT_TONE.blocking).toContain("text-danger");
  });

  it("escalates the chip background with the tone, never past danger", () => {
    expect(CHIP_TONE.ok).toBe("bg-line-row text-ink-body");
    expect(CHIP_TONE.caution).toBe("bg-warning-tint text-warning");
    expect(CHIP_TONE.blocking).toBe("bg-danger-tint text-danger");
  });

  it("uses existing tokens only — no hex, no arbitrary colour", () => {
    const classes = [
      CHIP_BASE,
      ...TONES.map((t) => CHIP_TONE[t]),
      ...CAVEAT_TONES.map((t) => CAVEAT_TONE[t]),
      ...DUE_TONES.map((t) => DUE_TONE[t]),
      ...KINDS.map((k) => ACTION_BUTTON[k].className ?? ""),
    ].join(" ");
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(classes).not.toMatch(/\b(?:bg|text|border)-\[/);
  });

  it("never lets a tone be the only carrier: the row component prints each verdict's own words", () => {
    const row = src("./verdict-row.tsx");
    for (const axis of ["approach", "eligibility", "evidence"]) {
      expect(row).toContain(`text={verdicts.${axis}.text}`);
      expect(row).toContain(`tone={verdicts.${axis}.tone}`);
    }
    expect(row).toContain("{verdicts.caveat.text}");
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

  it("gives the toggle a region to control and the region a name", () => {
    expect(panelIdFor("abc")).toBe("fit-row-abc-why");
    expect(titleIdFor("abc")).toBe("fit-row-abc-title");
    expect(panelIdFor("abc")).not.toBe(titleIdFor("abc"));
    expect(panelIdFor("a")).not.toBe(panelIdFor("b"));
  });
});

describe("the row markup", () => {
  const row = src("./verdict-row.tsx");
  const toggle = src("./verdict-row-toggle.tsx");

  it("is a server component; only the toggle is a client one", () => {
    expect(row).not.toContain('"use client"');
    expect(row).not.toMatch(/\buseState\b|\buseEffect\b/);
    expect(toggle.startsWith('"use client"')).toBe(true);
  });

  it("lays the grid out to the README's row table", () => {
    expect(row).toContain("grid grid-cols-[18px_104px_minmax(0,1fr)_132px] items-start gap-3.5 px-5 py-3.5");
    expect(row).toContain("border-t border-line-row");
  });

  it("keeps the disclosure a real button over a controlled region", () => {
    expect(toggle).toContain("aria-expanded={open}");
    expect(toggle).toContain("aria-controls={panelId}");
    expect(toggle).toContain('type="button"');
    // The region is hidden, never unmounted, so aria-controls never dangles.
    expect(row).toContain('role="region"');
    expect(row).toContain("hidden={!open}");
    expect(row).toContain("aria-labelledby={labelledBy}");
  });

  it("holds nothing disqualifying inside the disclosure (§3c)", () => {
    const panel = row.slice(row.indexOf("function DisclosurePanel"), row.indexOf("// The row"));
    // Blocks and unknowns are the caveat and the eligibility chip, both on the
    // row. The panel may not reach for either.
    expect(panel).not.toContain("caveat");
    expect(panel).not.toContain("eligibility");
    expect(panel).not.toContain("verdicts.");
  });

  it("draws no action for the PI, because fitVerdicts returns none (§3h)", () => {
    expect(row).toContain("verdicts.action ? (");
  });
});

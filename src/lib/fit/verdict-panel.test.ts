/**
 * The row's disclosure (fit-UX PR 3), and **the half of §3c that PR 2 could
 * not check**.
 *
 * D-k: "what no test in PR 2 can check is what PR 3 puts *into* `why`,
 * `gaps[]` and `items[]` — those are caller-supplied strings, and §3c at that
 * level is PR 3's contract to test against real rows." So the contract is
 * asserted here, over the adversarial suite, driven the whole way a real row
 * travels: `loadAdversarialCases()` → `scorePairDetailed` → `toFitResultRow` →
 * the verdict-column projection → `fitVerdicts` → `verdictPanel`.
 */
import { describe, expect, it } from "vitest";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases } from "@/lib/fit/engine/fixtures";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { rationaleView } from "@/lib/fit/explain-view";
import { toFitResultRow } from "@/lib/fit/results";
import type { FitProvenance, OpportunityFitProfile } from "@/lib/fit/types";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import { assessmentGaps, MAX_GAPS, MAX_ITEMS, MAX_WHY_CHARS, noticeChecks, panelGaps, panelItems, panelWhy, sentencesOf, verdictPanel, type PanelContent, type PanelEvidence } from "@/lib/fit/verdict-panel";
import { fitVerdicts } from "@/lib/fit/verdicts";
import type { VerdictRowDisclosure, VerdictRowEvidence } from "@/components/fit/verdict-row-disclosure";

// ---------------------------------------------------------------------------
// The panel's output is exactly what the panel component accepts
// ---------------------------------------------------------------------------

/**
 * D-k's module boundary in both directions: `verdict-panel.ts` declares its
 * own output shape so that nothing under `lib/` imports a component module,
 * and these two assignments make a drift between the two a type error rather
 * than a runtime surprise on a page nothing renders in a test.
 */
const _content: VerdictRowDisclosure = { why: "", gaps: [], items: [] } satisfies PanelContent;
const _item: VerdictRowEvidence = { id: "x", title: "t" } satisfies PanelEvidence;
void _content;
void _item;

// ---------------------------------------------------------------------------
// Driving the fixtures
// ---------------------------------------------------------------------------

function verdictRow(stored: ReturnType<typeof toFitResultRow>): FitResultVerdictRow {
  const p = stored.provenance as Partial<FitProvenance>;
  return {
    investigator_id: stored.investigator_id,
    opportunity_id: stored.opportunity_id,
    tier: stored.tier,
    score: stored.score,
    rationale: stored.rationale,
    gap: stored.gap,
    why_not: stored.why_not,
    top_items: p.T?.top_items ?? null,
    best_pair: p.P?.best_pair ?? null,
    judged_at: null,
    judged_tier: null,
    judged_from: null,
    judged_confidence: null,
    judged_evidence: null,
    components: stored.components,
    caps: stored.caps,
    flags: stored.flags,
  };
}

const driven = loadAdversarialCases().map((c) => {
  const scored = scorePairDetailed(c.investigator, c.opportunity, c.ctx);
  const row = verdictRow(toFitResultRow(scored.result));
  const rationale = rationaleView(row, EMPTY_LOOKUP);
  const verdicts = fitVerdicts({ row, notice: c.opportunity, investigator: c.investigator, lookup: EMPTY_LOOKUP, audience: "strategist", noticeComplete: true });
  return { id: c.id, title: c.title, notice: c.opportunity, row, verdicts, panel: verdictPanel({ row, label: verdicts.label, rationale, notice: c.opportunity }) };
});

/** Stage 1's failed rules, exactly as `tier.ts` leaves them on `flags`. */
const failedRules = (row: FitResultVerdictRow): string[] => {
  for (const f of row.flags ?? []) if (f.startsWith("excluded: ")) return f.slice("excluded: ".length).split("; ");
  return [];
};

// ---------------------------------------------------------------------------
// §3c — nothing disqualifying lives inside a disclosure
// ---------------------------------------------------------------------------

describe("§3c over the adversarial suite", () => {
  it("has cases to check", () => {
    expect(driven.length).toBeGreaterThan(5);
  });

  it("no bullet is the only place a stage-1 eligibility failure is stated", () => {
    for (const d of driven) {
      const onTheRow = `${d.verdicts.caveat.text} ${d.verdicts.eligibility.text}`;
      for (const rule of failedRules(d.row)) {
        const head = rule.slice(0, 40);
        const inABullet = d.panel.gaps.some((g) => g.includes(head));
        if (inABullet) expect(onTheRow, `${d.id}: "${head}" is in a bullet but not on the row`).toContain(head);
      }
    }
  });

  it("no bullet claims the person is ineligible — eligibility is the chip's and the caveat's (§3e)", () => {
    for (const d of driven) {
      for (const g of d.panel.gaps) expect(g.toLowerCase(), `${d.id}`).not.toMatch(/\bnot eligible\b|\bineligible\b/);
    }
  });

  it("a ruled-out row's block is on the row, not in the panel: the caveat blocks and the panel only elaborates", () => {
    const ruled = driven.filter((d) => d.verdicts.label === "ruled_out");
    expect(ruled.length).toBeGreaterThan(0);
    for (const d of ruled) {
      expect(d.verdicts.caveat.tone, d.id).toBe("blocking");
      expect(d.verdicts.caveat.text, d.id).toMatch(/[A-Za-z]/);
      // the panel's first sentence of `why_not` is the row's reason; the bullets are what is left
      expect(d.panel.gaps.some((g) => g === d.verdicts.reason), d.id).toBe(false);
    }
  });

  it("every panel says something, and stays inside its two caps", () => {
    for (const d of driven) {
      expect(d.panel.why, d.id).toMatch(/[A-Za-z]/);
      expect(d.panel.gaps.length, d.id).toBeLessThanOrEqual(MAX_GAPS);
      expect(d.panel.items.length, d.id).toBeLessThanOrEqual(MAX_ITEMS);
      for (const g of d.panel.gaps) expect(g, d.id).toMatch(/[A-Za-z]/);
    }
  });

  it("no panel string speaks in the inspector's voice — §2.5, one click in", () => {
    // The three shapes `engine/explain.ts` writes values in, plus the caps clause.
    const AXIS_VALUE = /(^|\s)[A-Z][A-Za-z ]*\s\d+(?:\.\d+)?\s*[—–-]\s/;
    const ENGINE_PARENTHETICAL = /\((?:support |yours )?\d+(?:\.\d+)?(?:,\s*(?:recent|career) view)?\)/;
    const FLOOR_COMPARISON = /is below the \w+ floor\s\d/i;
    const CAPS = /(^|\s)Caps\s[—–-]/;
    for (const d of driven) {
      for (const text of [d.panel.why, ...d.panel.gaps]) {
        expect(text, `${d.id}: axis value`).not.toMatch(AXIS_VALUE);
        expect(text, `${d.id}: engine parenthetical`).not.toMatch(ENGINE_PARENTHETICAL);
        expect(text, `${d.id}: floor comparison`).not.toMatch(FLOOR_COMPARISON);
        expect(text, `${d.id}: caps clause`).not.toMatch(CAPS);
      }
    }
  });

  it("`why` is the whole reasoning where the row's reason is its first clause", () => {
    for (const d of driven) {
      if (!d.row.rationale?.trim()) continue;
      expect(d.panel.why.length, d.id).toBeGreaterThanOrEqual(d.verdicts.reason.length - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

describe("sentencesOf", () => {
  it("splits the shape `engine/explain.ts` joins its clauses in", () => {
    expect(sentencesOf("Paradigm: a vs b. Unit: notice works at L5. Topic 0.30 is below the floor.")).toEqual(["Paradigm: a vs b.", "Unit: notice works at L5.", "Topic 0.30 is below the floor."]);
  });

  it("nothing in, nothing out; punctuation alone is nothing", () => {
    expect(sentencesOf(null)).toEqual([]);
    expect(sentencesOf("  ")).toEqual([]);
    expect(sentencesOf(".")).toEqual([]);
  });

  it("does not split a decimal or an abbreviation mid-sentence", () => {
    expect(sentencesOf("Topic 0.30 is below the Exploratory floor 0.35.")).toEqual(["Topic 0.30 is below the Exploratory floor 0.35."]);
  });
});

describe("panelWhy", () => {
  const base = { label: "strong" as const, notice: null, row: { rationale: null, why_not: null, gap: null, tier: "strong" as const, best_pair: null } };

  it("the reasoning, in the row's language rather than the inspector's", () => {
    const rationale = { text: "Paradigm 0.45 — Clinical trials (yours 0.85) vs. required Genetic epidemiology · Unit 0.55 — L3 vs. required L4 · Caps — paradigm_gate (exploratory: P 0.45 < 0.45)", evidence: [], source: "engine" as const, fallback: "none" as const };
    // every clause but the caps one, each with the engine's values taken out
    expect(panelWhy({ ...base, rationale })).toBe("Clinical trials vs. required Genetic epidemiology. L3 vs. required L4.");
  });

  it("opens on the same rewritten sentence the row's reason does (L4)", () => {
    // The disclosure used to say "Molecular / cellular mechanistic vs.
    // required Molecular / cellular mechanistic." one click behind a row that
    // no longer does. Only the opening clause changes; the rest of the
    // reasoning is what §3c says the panel is for.
    const row = { ...base.row, best_pair: { investigator: "molecular_cellular_mechanistic", notice: "molecular_cellular_mechanistic" } };
    const notice = { paradigm: { required: { molecular_cellular_mechanistic: 1 }, required_any: {}, allowed: {}, excluded: {} } } as unknown as OpportunityFitProfile;
    const rationale = { text: "Paradigm 0.95 — Molecular / cellular mechanistic (yours 0.90) vs. required Molecular / cellular mechanistic · Unit 0.55 — L3 vs. required L4", evidence: [], source: "engine" as const, fallback: "none" as const };
    expect(panelWhy({ ...base, row, notice, rationale })).toBe("Molecular / cellular mechanistic — exactly the kind of work this notice funds. L3 vs. required L4.");
  });

  it("a reconciler's prose has no clause separator and survives whole", () => {
    const prose = "The blind pass read this pair as a genuine methods match; the skeptic's objection about cohort size did not hold against the cited trial.";
    expect(panelWhy({ ...base, rationale: { text: prose, evidence: [], source: "judged" as const, fallback: "none" as const } })).toBe(prose);
  });

  it("stops before the paragraph stops reading at a glance", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Axis ${i} 0.50 — a clause about component number ${i} and what it says`).join(" · ");
    expect(panelWhy({ ...base, rationale: { text: long, evidence: [], source: "engine" as const, fallback: "none" as const } }).length).toBeLessThanOrEqual(MAX_WHY_CHARS);
  });

  it("a ruled-out row has no rationale, so the engine's diagnostic paragraph is the reasoning", () => {
    const rationale = { text: "No rationale stored.", evidence: [], source: "engine" as const, fallback: "none" as const };
    expect(panelWhy({ ...base, label: "ruled_out", row: { ...base.row, tier: "poor", why_not: "Unit: notice works at L5; yours is L3 (0.10)." }, rationale })).toBe("Unit: notice works at L5; yours is L3.");
  });

  it("neither: a sentence, never an empty panel", () => {
    const rationale = { text: "No rationale stored.", evidence: [], source: "engine" as const, fallback: "none" as const };
    expect(panelWhy({ ...base, rationale })).toMatch(/[A-Za-z]/);
  });
});

describe("panelGaps", () => {
  const rationale = { text: "r", evidence: [], source: "engine" as const, fallback: "none" as const };

  it("a ruled-out row elaborates past the sentence the row's reason already showed, de-numbered — and a bullet that was only a floor comparison is dropped rather than shown as one", () => {
    const row = { rationale: null, gap: null, tier: "poor" as const, why_not: "Paradigm: a vs b. Unit: notice works at L5; yours is L3 (0.10). Topic 0.30 is below the Exploratory floor 0.35." };
    expect(panelGaps({ row, label: "ruled_out", rationale, notice: null })).toEqual(["Unit: notice works at L5; yours is L3."]);
  });

  it("a one-sentence `why_not` leaves nothing to elaborate", () => {
    expect(panelGaps({ row: { rationale: null, gap: null, tier: "poor", why_not: "Below the Exploratory floors." }, label: "ruled_out", rationale, notice: null })).toEqual([]);
  });

  it("`Can't assess` says what the notice is missing, and what settles it", () => {
    const gaps = panelGaps({ row: { rationale: "r", gap: null, tier: "strong", why_not: null }, label: "cannot_assess", rationale, notice: null });
    expect(gaps[0]).toMatch(/no fit profile is on file/i);
    expect(gaps.join(" ")).toMatch(/re-running/i);
  });

  it("every other row leads with the engine's gap sentences, then the notice's own conditions", () => {
    const notice = { materials: { human_required: true }, mechanism: { clinical_trial: "not_allowed" }, team: {}, non_responsive: [], population: null } as unknown as OpportunityFitProfile;
    const gaps = panelGaps({ row: { rationale: "r", gap: "Design: rct required, none in the evidence.", tier: "exploratory", why_not: null }, label: "exploratory", rationale, notice });
    expect(gaps[0]).toBe("Design: Randomized controlled trial required, none in the evidence.");
    expect(gaps.slice(1)).toEqual(["The notice requires human participants; the application has to name where they come from.", "Clinical trials are not allowed under this announcement."]);
  });
});

describe("noticeChecks — conditions on the application, never on the person", () => {
  const notice = (over: Record<string, unknown>) => ({ materials: {}, mechanism: {}, team: {}, non_responsive: [], population: null, ...over }) as unknown as OpportunityFitProfile;

  it("no notice, no checks", () => {
    expect(noticeChecks(null)).toEqual([]);
    expect(noticeChecks(notice({}))).toEqual([]);
  });

  it("a required consortium outranks a multi-PI encouragement", () => {
    expect(noticeChecks(notice({ team: { consortium_required: true, multi_pi_allowed: true } }))).toEqual(["A consortium is required."]);
    expect(noticeChecks(notice({ team: { multi_pi_allowed: true } }))).toEqual(["Multi-PI is allowed, so a gap can be covered by a co-investigator."]);
  });

  it("non-responsive topics are counted and the first named", () => {
    expect(noticeChecks(notice({ non_responsive: ["clinical trials", "device development", "health services", "surveys"] }))[0]).toBe("The notice names 4 non-responsive topics: clinical trials, device development, health services.");
    expect(noticeChecks(notice({ non_responsive: ["surveys"] }))[0]).toBe("The notice names one non-responsive topic: surveys.");
  });

  it("none of them is an eligibility fact", () => {
    const all = noticeChecks(notice({ materials: { human_required: true }, mechanism: { clinical_trial: "required" }, team: { consortium_required: true }, non_responsive: ["x"], population: "adults over 65" }));
    for (const g of all) expect(g.toLowerCase()).not.toMatch(/eligib|career stage|citizen|esi\b/);
  });
});

describe("assessmentGaps", () => {
  it("names which of the three things happened to the notice's text", () => {
    expect(assessmentGaps({ sources: { text: "synopsis" } } as OpportunityFitProfile)[0]).toMatch(/synopsis/);
    expect(assessmentGaps({ sources: { text: "none" } } as unknown as OpportunityFitProfile)[0]).toMatch(/no notice text/i);
    expect(assessmentGaps({ sources: { text: "full_text" } } as unknown as OpportunityFitProfile)[0]).toMatch(/did not finish/);
  });
});

describe("panelItems", () => {
  it("the resolved items as cards, capped, with the source name and link the row resolved", () => {
    const rationale = {
      text: "r",
      source: "engine" as const,
      fallback: "cited" as const,
      evidence: [1, 2, 3, 4].map((n) => ({ id: `publication:p:${n}`, kind: "publication" as const, kindLabel: "PubMed", title: `Paper ${n}`, meta: "Nature · 2025", href: `https://pubmed.ncbi.nlm.nih.gov/${n}/`, resolved: true, prior: false })),
    };
    const items = panelItems(rationale);
    expect(items.length).toBe(MAX_ITEMS);
    expect(items[0]).toEqual({ id: "publication:p:1", title: "Paper 1", meta: "Nature · 2025", source: "PubMed", href: "https://pubmed.ncbi.nlm.nih.gov/1/" });
  });
});

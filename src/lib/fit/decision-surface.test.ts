/**
 * **The invariant, over everything a decision surface renders** (fit-UX final
 * round, B1).
 *
 * The suite that let `Objective 0.63`, `rct 0.70` and `(C20.111.590 at depth
 * 3)` ship asserted on *hand-written* clauses: `panelWhy` was checked against
 * a rationale typed into the test, and every shape the test author remembered
 * was a shape the stripper already knew. The engine writes shapes nobody
 * typed.
 *
 * So this file drives the **real engine** over **all nine adversarial
 * fixtures** and asserts the invariant on **every string the composed path
 * produces** — `fitVerdicts` (five fields), `verdictPanel` (`why` and every
 * bullet), `reasonOf`, `caveatOf`, `plainWhyLine`, and the audit view's own
 * above-the-fold sections. One `it` per fixture per surface, so a regression
 * names the pair and the field rather than failing one opaque assertion.
 *
 * `loadAdversarialCases()` → `scorePairDetailed` → `toFitResultRow` → the
 * verdict-column projection → the view models. Nothing in the chain is
 * stubbed; the strings under assertion are the ones a browser would paint.
 *
 * The **printed** output of all nine is in `decision-surface.copy.test.ts`'s
 * sibling snapshot assertions, so the copy can be read as copy.
 */
import { describe, expect, it } from "vitest";
import { auditView, eligibilityTable, requirementsTable, type AuditInput } from "@/lib/fit/audit-view";
import { isEngineValueText } from "@/lib/fit/decision-text";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases } from "@/lib/fit/engine/fixtures";
import { rationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { toFitResultRow, type FitResultVerdictRow } from "@/lib/fit/results";
import type { FitProvenance, InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { verdictPanel, panelGaps, panelWhy, type PanelContent } from "@/lib/fit/verdict-panel";
import { caveatOf, fitVerdicts, plainWhyLine, reasonOf, type FitVerdicts } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// Driving the fixtures the whole way a row travels
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

type Driven = {
  id: string;
  title: string;
  row: FitResultVerdictRow;
  notice: OpportunityFitProfile;
  investigator: InvestigatorFitProfile;
  verdicts: FitVerdicts;
  panel: PanelContent;
  whyLine: string;
  audit: ReturnType<typeof auditView>;
};

const driven: Driven[] = loadAdversarialCases().map((c) => {
  const scored = scorePairDetailed(c.investigator, c.opportunity, c.ctx);
  const row = verdictRow(toFitResultRow(scored.result));
  const rationale = rationaleView(row, EMPTY_LOOKUP);
  const input = { row, notice: c.opportunity, investigator: c.investigator, lookup: EMPTY_LOOKUP, audience: "strategist" as const, noticeComplete: true };
  const verdicts = fitVerdicts(input);
  return {
    id: c.id,
    title: c.title,
    row,
    notice: c.opportunity,
    investigator: c.investigator,
    verdicts,
    panel: verdictPanel({ row, label: verdicts.label, rationale, notice: c.opportunity, investigator: c.investigator }),
    whyLine: plainWhyLine(row, rationale.text, { collaborators: c.investigator.collaborators }),
    audit: auditView(input),
  };
});

/** Every string one row puts on a decision surface, labelled by where it is drawn. */
function decisionStrings(d: Driven): Array<[string, string]> {
  const rationale = rationaleView(d.row, EMPTY_LOOKUP);
  const input = { row: d.row, notice: d.notice, investigator: d.investigator, lookup: EMPTY_LOOKUP, audience: "strategist" as const, noticeComplete: true };
  const panelInput = { row: d.row, label: d.verdicts.label, rationale, notice: d.notice, investigator: d.investigator };
  return [
    ["verdicts.approach", d.verdicts.approach.text],
    ["verdicts.eligibility", d.verdicts.eligibility.text],
    ["verdicts.evidence", d.verdicts.evidence.text],
    ["verdicts.reason", d.verdicts.reason],
    ["verdicts.caveat", d.verdicts.caveat.text],
    ["verdicts.action", d.verdicts.action?.label ?? ""],
    ["reasonOf", reasonOf(input)],
    ["caveatOf", caveatOf(input).text],
    ["panelWhy", panelWhy(panelInput)],
    ...panelGaps(panelInput).map((g, i): [string, string] => [`panelGaps[${i}]`, g]),
    ["panel.why", d.panel.why],
    ...d.panel.gaps.map((g, i): [string, string] => [`panel.gaps[${i}]`, g]),
    ["plainWhyLine", d.whyLine],
    // The audit view's sections 3–6, all above the collapsed internals block.
    ...d.audit.notice.map((r): [string, string] => [`audit.notice.${r.axis}`, r.value]),
    ...d.audit.evidence.map((r): [string, string] => [`audit.evidence.${r.axis}`, r.value]),
    ...d.audit.eligibility.map((r): [string, string] => [`audit.eligibility.${r.key}`, r.rule]),
    ...d.audit.requirements.map((r): [string, string] => [`audit.requirements.${r.key}`, r.rule]),
  ];
}

describe("the nine adversarial fixtures, driven through the real engine", () => {
  it("are all nine, and six of them are scored pairs", () => {
    expect(driven).toHaveLength(9);
    expect(driven.filter((d) => d.row.rationale?.trim()).length).toBe(6);
  });

  for (const d of driven) {
    describe(`${d.id}`, () => {
      it("puts no engine value on any decision surface", () => {
        for (const [where, text] of decisionStrings(d)) {
          expect(isEngineValueText(text), `${d.id} · ${where}: ${text}`).toBe(false);
        }
      });

      it("still says something in every slot the row must fill", () => {
        expect(d.verdicts.reason, d.id).toMatch(/[A-Za-z]/);
        expect(d.verdicts.caveat.text, d.id).toMatch(/[A-Za-z]/);
        expect(d.panel.why, d.id).toMatch(/[A-Za-z]/);
        for (const g of d.panel.gaps) expect(g, d.id).toMatch(/[A-Za-z]/);
      });
    });
  }

  it("the two Strong pairs are the ones the old suite passed and the browser failed", () => {
    // Fixture 5 rendered, verbatim, under "Why you are seeing this": "… Rct |
    // early_phase_trial required, rct 0.70. 4 coded matches (C20.111.590 at
    // depth 3), score supplied. 3 of 3. Objective 0.63. …"
    const strong = driven.filter((d) => d.verdicts.label === "strong");
    expect(strong.map((d) => d.id)).toEqual(["5_lupus_trialist_vs_sle_trial", "6a_human_immunologist_vs_besh"]);
    for (const d of strong) {
      expect(d.panel.why, d.id).not.toMatch(/0\.\d/);
      expect(d.panel.why, d.id).not.toMatch(/\bObjective\b/);
      expect(d.panel.why, d.id).not.toMatch(/at depth \d/);
    }
  });

  it("the topic gap keeps the terms a reader can use and loses the tree codes", () => {
    // Fixture 4's bullet was "Not in the evidence: C12.777.419.780,
    // C12.777.419.780.750, Kidney Disease." — a list is pruned, not dropped.
    const d = driven.find((x) => x.id === "4_comp_genomics_vs_kidney_genomics")!;
    expect(d.row.gap).toContain("C12.777.419.780");
    expect(d.panel.gaps[0]).toBe("Not in the evidence: Kidney Disease.");
  });

  it("the one-line form a narrow surface shows is one sentence", () => {
    // B3: fixture 3 rendered 291 characters at 11px grey, ending in a `.;`.
    for (const d of driven) {
      expect(d.whyLine.length, `${d.id}: ${d.whyLine}`).toBeLessThanOrEqual(120);
      expect(d.whyLine, d.id).not.toMatch(/\.;/);
      // one sentence: no `. ` before a capital anywhere inside it
      expect(d.whyLine.split(/(?<=\.)\s+(?=[A-Z])/), d.id).toHaveLength(1);
    }
  });

  it("no surface prints a collaborator id, and the clause is dropped rather than shown with one", () => {
    // `engine/tier.ts`'s `collaboratorsIn` maps `.map((c) => c.id)`; the
    // fixtures' collaborators carry no `name`, so the clause cannot be said.
    const withCollaborators = driven.filter((d) => (d.row.gap ?? "").includes("Collaborators in the directory"));
    expect(withCollaborators.map((d) => d.id)).toEqual(["3_ibd_trialist_vs_population_genomics", "6b_human_immunologist_vs_cart_trial"]);
    for (const d of withCollaborators) {
      for (const [where, text] of decisionStrings(d)) {
        expect(text, `${d.id} · ${where}`).not.toMatch(/collab-/);
        expect(text, `${d.id} · ${where}`).not.toMatch(/Collaborators in the directory/);
      }
    }
  });

  it("but names them where the profile has names", () => {
    const d = driven.find((x) => x.id === "6b_human_immunologist_vs_cart_trial")!;
    const named: InvestigatorFitProfile = {
      ...d.investigator,
      collaborators: d.investigator.collaborators.map((c) => ({ ...c, name: c.id === "collab-trialist-1" ? "Ada One" : "Ben Two" })),
    };
    const rationale = rationaleView(d.row, EMPTY_LOOKUP);
    const gaps = panelGaps({ row: d.row, label: d.verdicts.label, rationale, notice: d.notice, investigator: named });
    expect(gaps).toContain("Collaborators in the directory who do this: Ada One, Ben Two.");
  });
});

// ---------------------------------------------------------------------------
// The audit view's own tables, over the same nine
// ---------------------------------------------------------------------------

describe("the audit view above the internals block", () => {
  it("carries no engine value in either rule table or either approach panel", () => {
    for (const d of driven) {
      const input: AuditInput & { row: FitResultVerdictRow } = { row: d.row, notice: d.notice, investigator: d.investigator };
      for (const r of eligibilityTable(input)) expect(isEngineValueText(r.rule), `${d.id}: ${r.rule}`).toBe(false);
      for (const r of requirementsTable(input)) expect(isEngineValueText(r.rule), `${d.id}: ${r.rule}`).toBe(false);
    }
  });

  it("and the internals block is still where the values are", () => {
    // The invariant is about the decision surface, not about the audit view's
    // collapsed block — §4.8 puts the eight components, their floors, S and the
    // caps there deliberately, and the admin inspectors keep them too.
    const scored = driven.filter((d) => d.audit.scored);
    expect(scored.length).toBeGreaterThan(0);
    for (const d of scored) {
      expect(d.audit.components.length).toBe(8);
      expect(d.audit.components.some((c) => isEngineValueText(c.value.toFixed(2)))).toBe(true);
    }
  });
});

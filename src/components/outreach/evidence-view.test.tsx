/**
 * **The audit view, rendered** (fit-UX final round, B4).
 *
 * `audit-sections.test.ts` asserted this view by **grepping
 * `evidence-view.tsx`'s source text**, and D-k had already written down why
 * that does not work: "§3c is a module boundary, not a source grep". Applied
 * to PR 4's own JSX it failed exactly as D-k predicted. Two of the assertions
 * measured the wrong thing outright —
 *
 *     const a = SOURCE.indexOf("ELIGIBILITY_HEADING");
 *     const b = SOURCE.indexOf("REQUIREMENTS_HEADING");
 *     expect(b).toBeGreaterThan(a);
 *
 * — because **both names appear in the import block**, hundreds of lines above
 * the JSX, so the test compared import order and could never see a swapped
 * heading. Seven of thirty wiring mutations survived, six of them here, and
 * every one is serious: the **requirements** rules rendered into the
 * **eligibility** table, both tables headed "Eligibility · who may apply",
 * `audit.scored` inverted so a scored pair reads "no component vector" and a
 * Poor stub draws eight bars, `RECAP_ORDER.slice(0, 1)` dropping the
 * Eligibility and Evidence verdicts, and `items.slice(0, 0)` removing section 7
 * entirely.
 *
 * So this file renders the component with `react-dom/server` and reads the
 * output. The props are built from the **real engine** over the adversarial
 * fixtures and the real `auditView`, so what is asserted is what production
 * hands it. `vitest.config.ts` gained `src/**\/*.test.tsx` and the React
 * plugin for this; no DOM is needed — `renderToStaticMarkup` is enough for a
 * view whose only interactivity is `<details>` and four handlers.
 *
 * The class strings and copy constants stay in `audit-sections.test.ts`, by
 * value, where they belong. What moved here is every assertion about **what is
 * rendered where**.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceView, type EvidenceViewProps } from "@/components/outreach/evidence-view";
import {
  AUDIT_SECTIONS,
  CAVEAT_TONE,
  ELIGIBILITY_HEADING,
  ELIGIBILITY_STATE_CLASS,
  FLAG_EVIDENCE,
  INTERNALS_SUMMARY,
  ITEMS_LABEL,
  NOT_SCORED,
  NOT_THIS_PERSON,
  PANEL_TITLE,
  RECAP_HEADING,
  RECAP_ORDER,
  RECAP_TONE,
  REQUIREMENTS_HEADING,
} from "@/components/outreach/audit-sections";
import { auditView, ELIGIBILITY_STATE_TEXT, REQUIREMENT_STATE_TEXT, type AuditContent, type AuditItemGroup } from "@/lib/fit/audit-view";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases } from "@/lib/fit/engine/fixtures";
import { rationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { toFitResultRow, type FitResultVerdictRow } from "@/lib/fit/results";
import type { FitProvenance, OpportunityEligibility } from "@/lib/fit/types";
import { verdictPanel } from "@/lib/fit/verdict-panel";
import { fitVerdicts } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// Props built the way the loaders build them
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

/**
 * Investigator-level rules the notice profile itself names, so the eligibility
 * table has something to render. The adversarial fixtures are written to
 * exercise the *scoring* axes and none of them carries an eligibility record —
 * a table with no rows cannot show a swap.
 */
const WITH_ELIGIBILITY: OpportunityEligibility = {
  investigator_rules: ["Applicants must hold a faculty appointment at the time of award."],
  esi_only: true,
  new_investigator_only: false,
  clinician_required: true,
  degree_required: null,
  independent_appointment_required: true,
  citizenship_rule: null,
};

/** One adversarial pair, the whole way a row travels, as `EvidenceViewProps`. */
function propsFor(id: string, over: Partial<EvidenceViewProps> = {}, eligibility: OpportunityEligibility | null = null): EvidenceViewProps {
  const base = loadAdversarialCases().find((x) => x.id === id)!;
  const c = eligibility ? { ...base, opportunity: { ...base.opportunity, eligibility } } : base;
  const scored = scorePairDetailed(c.investigator, c.opportunity, c.ctx);
  const row = verdictRow(toFitResultRow(scored.result));
  const rationale = rationaleView(row, EMPTY_LOOKUP);
  const input = { row, notice: c.opportunity, investigator: c.investigator, lookup: EMPTY_LOOKUP, audience: "strategist" as const, noticeComplete: true };
  const verdicts = fitVerdicts(input);
  return {
    subject: "person",
    title: "Ada One",
    meta: "Medicine · Professor",
    provenance: "Evidence snapshot saved Sep 4, 2026",
    fit: { verdicts, panel: verdictPanel({ row, label: verdicts.label, rationale, notice: c.opportunity }), audit: auditView(input) },
    items: ITEMS,
    onBack: () => {},
    ...over,
  };
}

const ITEMS: AuditItemGroup[] = [
  {
    key: "research",
    title: "Research alignment",
    meta: "Fit engine · 4 compatible items carried the topic score",
    items: [{ id: "publication:p:1", title: "Anifrolumab in SLE", meta: "Lancet Rheumatol · Mar 2024", link: null, quote: null, matched: "carried the topic score", inferred: null, identity: null, identityItem: { kind: "publication", rowId: "pub-1" } }],
  },
  { key: "funding", title: "Funding alignment", meta: "NIH RePORTER", items: [], empty: "No RePORTER profile ID on file, so awards could not be matched.", action: { kind: "add_profile_id", label: "Add profile ID", href: "/investigators/abc" } },
  { key: "self", title: "Self-described expertise", meta: "Biosketch", items: [], empty: "No biosketch on file.", action: { kind: "request_biosketch", label: "Request biosketch", href: "/investigators/abc" } },
];

const render = (props: EvidenceViewProps) => renderToStaticMarkup(<EvidenceView {...props} />);

/** A string as React writes it into the markup — the five characters `escapeHtml` replaces. An apostrophe in a caveat is `&#x27;` on the page. */
const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** Where a string first appears in the rendered output. -1 when it is not rendered at all. */
const at = (html: string, needle: string) => html.indexOf(esc(needle));

/** A heading as its own element, so "Evidence" the recap column is not "Evidence snapshot saved…" in the provenance strip. */
const headingAt = (html: string, heading: string) => html.indexOf(`>${esc(heading)}</p>`);

/** The rendered slice between two markers — how a table's own rows are read apart from its neighbour's. */
function between(html: string, from: string, to: string): string {
  const a = at(html, from);
  const b = to ? at(html, to) : html.length;
  expect(a, `missing: ${from}`).toBeGreaterThan(-1);
  expect(b, `missing: ${to}`).toBeGreaterThan(a);
  return html.slice(a, b);
}

const SCORED = "5_lupus_trialist_vs_sle_trial";
const RULED_OUT = "1_tcell_lab_vs_survivorship_epi";

// ---------------------------------------------------------------------------
// The section order — by rendered position, not by where a name is imported
// ---------------------------------------------------------------------------

describe("the eight sections, in the brief's order", () => {
  const html = render(propsFor(SCORED));

  it("renders one anchor per section, in README §4's order", () => {
    // The eight sections' own rendered content, in order. The marker comments
    // `AUDIT_SECTIONS` carries are for a reader of the source; these are the
    // strings a reader of the page sees.
    const anchors: Array<[string, string]> = [
      ["provenance", "Evidence snapshot saved Sep 4, 2026"],
      ["header", "Ada One"],
      ["recap", RECAP_HEADING.approach],
      ["why", "Why you are seeing this"],
      ["approach", PANEL_TITLE.notice],
      ["rules", ELIGIBILITY_HEADING],
      ["items", ITEMS_LABEL],
      ["internals", INTERNALS_SUMMARY],
    ];
    expect(anchors.map(([id]) => id)).toEqual(AUDIT_SECTIONS.map((s) => s.id));
    const positions = anchors.map(([id, text]) => {
      const i = at(html, text);
      expect(i, `section not rendered: ${id}`).toBeGreaterThan(-1);
      return i;
    });
    expect(positions, `rendered order: ${anchors.map(([id]) => id).join(" → ")}`).toEqual([...positions].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// M01, M02 — the two rule tables (§3e)
// ---------------------------------------------------------------------------

describe("the two rule tables are two different tables", () => {
  /** A pair with a rule in each table, so a swap has something to show. */
  const props = propsFor(SCORED, {}, WITH_ELIGIBILITY);
  const audit = props.fit!.audit;
  const html = render(props);

  it("has rules in both tables, so the mutations below have something to break", () => {
    expect(audit.eligibility.length, "fixture must produce eligibility rules").toBeGreaterThan(0);
    expect(audit.requirements.length, "fixture must produce requirement rules").toBeGreaterThan(0);
  });

  it("M02 · heads them differently, and in the brief's order — read off the page, not off the import block", () => {
    const a = at(html, ELIGIBILITY_HEADING);
    const b = at(html, REQUIREMENTS_HEADING);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    // The heading that used to be measured in the import block: assert the
    // page contains exactly one of each, so heading both tables the same way
    // fails here rather than passing on import order.
    expect(html.split(ELIGIBILITY_HEADING)).toHaveLength(2);
    expect(html.split(REQUIREMENTS_HEADING)).toHaveLength(2);
  });

  it("M01 · renders `audit.eligibility` under the eligibility heading and `audit.requirements` under the requirements one", () => {
    const eligibilityTable = between(html, ELIGIBILITY_HEADING, REQUIREMENTS_HEADING);
    const requirementsTable = html.slice(at(html, REQUIREMENTS_HEADING));
    for (const r of audit.eligibility) {
      expect(eligibilityTable, `eligibility rule missing from its own table: ${r.rule}`).toContain(esc(r.rule));
    }
    for (const r of audit.requirements) {
      expect(requirementsTable, `requirement missing from its own table: ${r.rule}`).toContain(esc(r.rule));
      // …and not in the other one. This is the assertion M01 escaped: passing
      // `audit.requirements` to the eligibility table left the page rendering
      // and every grep green.
      expect(eligibilityTable, `requirement rendered in the eligibility table: ${r.rule}`).not.toContain(esc(r.rule));
    }
  });

  it("M21 · marks a failing eligibility rule in the eligibility table's own class, not the requirements table's", () => {
    // A failed eligibility rule is red (it excludes the pair); an unmet
    // *requirement* is amber (it caps the tier). Swapping the class maps drew
    // a hard exclusion as a caution.
    const eligibilityTable = between(html, ELIGIBILITY_HEADING, REQUIREMENTS_HEADING);
    for (const r of audit.eligibility) {
      expect(eligibilityTable, `${r.key} · ${r.state}`).toContain(ELIGIBILITY_STATE_CLASS[r.state]);
      expect(eligibilityTable, `${r.key} · ${r.state}`).toContain(`>${esc(ELIGIBILITY_STATE_TEXT[r.state])}<`);
    }
  });

  it("and each table uses its own state vocabulary", () => {
    const requirementsTable = html.slice(at(html, REQUIREMENTS_HEADING));
    // "Met by the evidence" is the requirements table's word for Met; the
    // eligibility table's is "Met". Merging them is §3e read backwards.
    expect(requirementsTable).not.toContain(`>${ELIGIBILITY_STATE_TEXT.fails}<`);
    const requirementWords = new Set(audit.requirements.map((r) => REQUIREMENT_STATE_TEXT[r.state]));
    for (const w of requirementWords) expect(requirementsTable).toContain(w);
  });
});

// ---------------------------------------------------------------------------
// M04 — the internals block, and what a pair with no components shows
// ---------------------------------------------------------------------------

describe("the internals block", () => {
  it("M04 · draws the eight bars for a scored pair, and never the not-scored stub", () => {
    const props = propsFor(SCORED);
    expect(props.fit!.audit.scored, "fixture must be a scored pair").toBe(true);
    const html = render(props);
    // one bar per component, each printing its own value
    for (const c of props.fit!.audit.components) expect(html, `bar missing: ${c.key}`).toContain(c.value.toFixed(2));
    expect(props.fit!.audit.components).toHaveLength(8);
    expect(html).not.toContain(NOT_SCORED);
  });

  it("M04 · and the stub, with no bars at all, for a pair the engine stopped before scoring", () => {
    const props = propsFor(RULED_OUT);
    const stub: AuditContent = { ...props.fit!.audit, scored: false, components: [] };
    const html = render({ ...props, fit: { ...props.fit!, audit: stub } });
    expect(html).toContain(NOT_SCORED);
    // "Moderate 0.50 · Exploratory 0.35" is the floor pair every bar prints.
    expect(html).not.toMatch(/Moderate 0\.\d\d/);
  });

  it("keeps the values behind the collapsed `<details>`, which is the whole point of the block", () => {
    const props = propsFor(SCORED);
    const html = render(props);
    // markup, not text: `at` escapes its needle the way React escapes content.
    const details = html.indexOf("<details");
    expect(details).toBeGreaterThan(-1);
    expect(html).not.toContain("<details open");
    for (const c of props.fit!.audit.components) expect(at(html, c.value.toFixed(2)), `${c.key} is above the fold`).toBeGreaterThan(details);
    // and the caveat, which decides the row, is above it
    expect(at(html, props.fit!.verdicts.caveat.text)).toBeLessThan(details);
  });
});

// ---------------------------------------------------------------------------
// M06 — the verdict recap
// ---------------------------------------------------------------------------

describe("the verdict recap", () => {
  it("M06 · renders all three verdicts, each under its own heading, in §3a's order", () => {
    const props = propsFor(SCORED);
    const html = render(props);
    expect(RECAP_ORDER).toHaveLength(3);
    const positions = RECAP_ORDER.map((axis) => {
      // By element, not by substring: "Evidence" is also the first word of the
      // provenance strip, 700 characters higher up the page.
      const heading = headingAt(html, RECAP_HEADING[axis]);
      const text = at(html, props.fit!.verdicts[axis].text);
      expect(heading, `recap heading missing: ${axis}`).toBeGreaterThan(-1);
      expect(text, `recap verdict missing: ${axis} — "${props.fit!.verdicts[axis].text}"`).toBeGreaterThan(heading);
      return heading;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("M08 · colours each verdict by its own tone — an `ok` chip on a ruled-out row would read as an endorsement", () => {
    // `coherent()` demotes every chip on a ruled-out row, so this fixture's
    // three tones are not all the same and a flattened map is visible.
    const props = propsFor(RULED_OUT);
    const html = render(props);
    for (const axis of RECAP_ORDER) {
      const column = html.slice(headingAt(html, RECAP_HEADING[axis]));
      const verdict = props.fit!.verdicts[axis];
      expect(column.slice(0, 400), `${axis} · ${verdict.tone}`).toContain(RECAP_TONE[verdict.tone]);
    }
    expect(new Set(RECAP_ORDER.map((a) => props.fit!.verdicts[a].tone)).has("ok"), "a ruled-out row has no `ok` chip (D-e)").toBe(false);
  });

  it("M09 · colours the caveat by its own severity, which is what says the row is blocked", () => {
    for (const id of [SCORED, RULED_OUT]) {
      const props = propsFor(id);
      const html = render(props);
      const caveat = at(html, props.fit!.verdicts.caveat.text);
      expect(caveat, id).toBeGreaterThan(-1);
      expect(html.slice(Math.max(0, caveat - 200), caveat), `${id} · ${props.fit!.verdicts.caveat.tone}`).toContain(CAVEAT_TONE[props.fit!.verdicts.caveat.tone]);
    }
    // the two fixtures must differ, or the assertion above passes on one colour
    expect(propsFor(SCORED).fit!.verdicts.caveat.tone).not.toBe(propsFor(RULED_OUT).fit!.verdicts.caveat.tone);
  });

  it("and the row's own reason and caveat, which no other section carries", () => {
    const props = propsFor(RULED_OUT);
    const html = render(props);
    expect(html).toContain(esc(props.fit!.verdicts.caveat.text));
    expect(html).toContain(esc(props.fit!.panel.why));
  });
});

// ---------------------------------------------------------------------------
// M05 — approach, side by side
// ---------------------------------------------------------------------------

describe("approach, side by side", () => {
  it("M05 · each panel shows its own side — this is the instrument that stops shared keywords reading as a match", () => {
    const props = propsFor(RULED_OUT);
    const audit = props.fit!.audit;
    const html = render(props);
    // The fixture must actually diverge, or one panel's rows would satisfy both.
    const notice = new Map(audit.notice.map((r) => [r.axis, r.value]));
    const evidence = new Map(audit.evidence.map((r) => [r.axis, r.value]));
    const diverging = audit.notice.filter((r) => notice.get(r.axis) !== evidence.get(r.axis));
    expect(diverging.length, "the fixture must diverge on at least one axis").toBeGreaterThan(0);

    const noticePanel = between(html, PANEL_TITLE.notice, PANEL_TITLE.evidence);
    const evidencePanel = html.slice(at(html, PANEL_TITLE.evidence), at(html, ELIGIBILITY_HEADING));
    for (const r of audit.notice) expect(noticePanel, `notice ${r.axis}: ${r.value}`).toContain(esc(r.value));
    for (const r of audit.evidence) expect(evidencePanel, `evidence ${r.axis}: ${r.value}`).toContain(esc(r.value));
    for (const r of diverging) expect(evidencePanel, `the notice's ${r.axis} is drawn as the evidence's`).not.toContain(esc(r.value));
  });
});

// ---------------------------------------------------------------------------
// M30 — the items
// ---------------------------------------------------------------------------

describe("the items section", () => {
  const props = propsFor(SCORED);
  const html = render(props);

  it("M30 · renders every group the caller passed, with its heading and its meta", () => {
    expect(ITEMS.length).toBeGreaterThan(1);
    for (const g of ITEMS) {
      expect(html, `group missing: ${g.title}`).toContain(esc(g.title));
      if (g.meta) expect(html, `group meta missing: ${g.title}`).toContain(esc(g.meta));
    }
  });

  it("and every item inside them, with what matched", () => {
    for (const g of ITEMS) for (const it of g.items) expect(html, `item missing: ${it.title}`).toContain(esc(it.title));
    expect(html).toContain("carried the topic score");
  });

  it("an empty group says why it is empty", () => {
    for (const g of ITEMS) if (!g.items.length && g.empty) expect(html).toContain(esc(g.empty));
  });

  // -------------------------------------------------------------------------
  // B8 — the affordances PR 4 dropped
  // -------------------------------------------------------------------------

  it("B8 · an empty group offers the action that would fill it", () => {
    // "Add profile ID" (no RePORTER id) and "Request biosketch" / "Send
    // reminder" (no biosketch) are the only in-context prompts to fix the two
    // most common data gaps, and the rebuilt section dropped both.
    expect(html).toContain("Add profile ID");
    expect(html).toContain("Request biosketch");
    expect(html).toContain('href="/investigators/abc"');
  });

  it("B8 · and the footer links the record the evidence comes from", () => {
    expect(render(propsFor(SCORED, { evidenceHref: "/investigators/abc" }))).toContain(FLAG_EVIDENCE);
    // drawn only with a destination — a control is drawn only with its mechanism
    expect(html).not.toContain(FLAG_EVIDENCE);
  });

  it("draws the identity control only with a handler behind it (C4)", () => {
    expect(html).not.toContain(NOT_THIS_PERSON);
    expect(render(propsFor(SCORED, { onNotThisPerson: () => {} }))).toContain(NOT_THIS_PERSON);
  });
});

// ---------------------------------------------------------------------------
// The legacy path (D-a) and the controls
// ---------------------------------------------------------------------------

describe("the legacy path draws none of the fit instruments", () => {
  const html = render({
    subject: "person",
    title: "Ada One",
    provenance: "p",
    fit: null,
    legacy: { label: <span>Potential match</span>, summary: "The legacy summary.", checks: ["Identity unverified"] },
    items: ITEMS,
    onBack: () => {},
  });

  it("no recap, no approach panels, no rule tables, no bars", () => {
    for (const axis of RECAP_ORDER) expect(headingAt(html, RECAP_HEADING[axis]), axis).toBe(-1);
    expect(html).not.toContain(PANEL_TITLE.notice);
    expect(html).not.toContain(ELIGIBILITY_HEADING);
    expect(html).not.toContain(INTERNALS_SUMMARY);
  });

  it("but the summary, the checks and the items", () => {
    expect(html).toContain("The legacy summary.");
    expect(html).toContain("Identity unverified");
    expect(html).toContain("Research alignment");
  });
});

describe("every control is drawn only with its handler", () => {
  const props = propsFor(SCORED);

  it("the flag control needs its own label beside it (PR 3's 3b rule)", () => {
    expect(render(props)).not.toContain("Wrong type of research…");
    expect(render({ ...props, onFlag: () => {} })).not.toContain("Wrong type of research…");
    expect(render({ ...props, onFlag: () => {}, flagLabel: "Wrong type of research…" })).toContain("Wrong type of research…");
  });

  it("the row's verb is drawn only with an `onAction`", () => {
    const label = props.fit!.verdicts.action!.label;
    expect(render(props)).not.toContain(esc(label));
    expect(render({ ...props, onAction: () => {} })).toContain(esc(label));
  });

  it("and a surface with its own cluster supplies it instead", () => {
    const html = render({ ...props, onAction: () => {}, actions: <button type="button">Add to recipients</button> });
    expect(html).toContain("Add to recipients");
    expect(html).not.toContain(esc(props.fit!.verdicts.action!.label));
  });

  it("the inspector link only for an admin", () => {
    expect(render(props)).not.toContain("/investigators/abc/fit");
    expect(render({ ...props, inspectorHref: "/investigators/abc/fit" })).toContain("/investigators/abc/fit");
  });
});

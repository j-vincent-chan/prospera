import { describe, expect, it } from "vitest";
import { scorePairDetailed } from "@/lib/fit/engine";
import { explain, gapSentences, rationale, whyNot } from "@/lib/fit/engine/explain";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { checkFloors } from "@/lib/fit/engine/tier";
import { floors } from "@/lib/fit/taxonomy";
import type { ScoreContext } from "@/lib/fit/types";

/** The Strong base pair of tier.test.ts. */
const BASE_INV: FixtureInvestigator = {
  paradigm: { recent: { clinical_trials: 0.9 } },
  unit: { L3: 0.9 },
  design: { rct: 0.9 },
  materials: { enrolled_participants: 0.9 },
  objective: { treatment_evaluation_efficacy: 0.9 },
  topic: { mesh_major: ["C20.111.590"], rcdc: ["Lupus"] },
  characteristics: { mechanisms_held: ["R01"], active_awards: 1, trial_pi_count: 2, runway_weeks: 10, esi: false },
};
const BASE_OPP: FixtureOpportunity = {
  mechanism: { activity_code: "R01", clinical_trial: "required" },
  paradigm: { required: { clinical_trials: 1 } },
  unit: { required: ["L3"] },
  design: { required_any: ["rct"] },
  materials: { expected: ["enrolled_participants"] },
  objective: { treatment_evaluation_efficacy: 0.9 },
  topic: { mesh: ["C20.111.590"], rcdc: ["Lupus"], terms: ["interferon"] },
  confidence: "high",
};

type Over = { inv?: Partial<FixtureInvestigator>; opp?: FixtureOpportunity; ctx?: Partial<ScoreContext>; topic?: number | null };
function scored(o: Over = {}) {
  const invFx: FixtureInvestigator = { ...BASE_INV, ...o.inv, characteristics: { ...BASE_INV.characteristics, ...o.inv?.characteristics } };
  const oppFx: FixtureOpportunity = { ...BASE_OPP, ...o.opp };
  const ctx: ScoreContext = { ...hydrateContext(invFx, {}, o.topic === undefined ? 0.9 : o.topic), ...o.ctx };
  return scorePairDetailed(hydrateInvestigator("i", invFx), hydrateOpportunity("o", oppFx), ctx);
}

describe("explain · rationale (§7 stage 9 'from component provenance')", () => {
  it("names every component with its evidence, in stage order, and the caps last", () => {
    const { stages, tier } = scored();
    expect(rationale(stages, tier)).toBe(
      [
        "Paradigm 1.00 — Clinical trials (yours 0.90) vs. required Clinical trials",
        "Unit 1.00 — L3 vs. required L3",
        "Design 0.94 — rct required, rct 0.90",
        "Topic 0.90 — 2 coded matches (C20.111.590 at depth 3), score supplied",
        "Methods 1.00 — 2 of 2",
        "Objective 0.90",
        "Track record 0.70 — R01 held vs. R01",
        "Actionability 1.00 — 10 weeks to the deadline",
      ].join(" · ")
    );
    const capped = scored({ inv: { characteristics: { runway_weeks: 2, in_pipeline: true } } });
    expect(rationale(capped.stages, capped.tier)).toContain("Actionability 0.00 — 2 weeks to the deadline, in the pipeline");
    expect(rationale(capped.stages, capped.tier)).toMatch(/ · Caps — runway_short \(moderate: 2 weeks to the deadline\)$/);
  });

  it("describes a cross-cutting investigator, an excluded hit, a prohibited design and an unknown mechanism", () => {
    const cross = scored({ inv: { paradigm: { recent: { computational_data_science: 0.9 } } } });
    expect(rationale(cross.stages, cross.tier)).toContain("Paradigm 0.97 — cross-cutting, from unit and design");
    // epidemiology vs a mechanistic requirement: support 0.05 < 0.4 and the dominant paradigm is excluded → P := min(P, 0.15)
    const excluded = scored({ inv: { paradigm: { recent: { epidemiology: 0.9 } } }, opp: { paradigm: { required: { molecular_cellular_mechanistic: 1 }, excluded: { epidemiology: 1 } } } });
    expect(rationale(excluded.stages, excluded.tier)).toContain("Paradigm 0.05 — Epidemiology (yours 0.90) vs. required Molecular / cellular mechanistic · Epidemiology excluded");
    expect(excluded.stages.P.excluded_hit).toBe("epidemiology");
    const prohibited = scored({ inv: { design: { rct: 0.9, prospective_cohort: 0.3 } }, opp: { design: { required_any: ["prospective_cohort"], prohibited: ["rct"] } } });
    expect(rationale(prohibited.stages, prohibited.tier)).toContain("prospective_cohort required, prospective_cohort 0.30; rct prohibited (75% of design mass)");
    const unknown = scored({ inv: { characteristics: { mechanisms_held: [] } }, opp: { mechanism: { activity_code: null, clinical_trial: "required" } } });
    expect(rationale(unknown.stages, unknown.tier)).toContain("Track record 0.52 — no NIH mechanism held vs. unknown code");
  });
});

describe("explain · gap sentences (§10 Exploratory: name the gap and the fix)", () => {
  it("a missed Strong floor names the floor, the value and what is missing", () => {
    const t = scored({ topic: 0.55 });
    expect(gapSentences(t.stages, t.tier)).toEqual(["Topic 0.55 is below the Strong floor 0.6; not in the evidence: interferon."]);
    const m = scored({ inv: { materials: {} }, opp: { materials: { expected: ["enrolled_participants", "human_blood_fluids"] } } });
    expect(gapSentences(m.stages, m.tier)).toEqual(["Methods 0.33 is below the Strong floor 0.5; missing enrolled_participants, human_blood_fluids."]);
    const d = scored({ inv: { design: { rct: 0.35, prospective_cohort: 0.55 } }, opp: { design: { required_any: ["rct"], allowed: ["prospective_cohort"] } } });
    expect(gapSentences(d.stages, d.tier)).toEqual(["Design 0.61 is below the Strong floor 0.75; rct required, rct 0.35."]);
    const k = scored({ inv: { characteristics: { mechanisms_held: ["R21"], trial_pi_count: 0, active_awards: 0 }, evidence_summary: { trials: 2 } } });
    expect(gapSentences(k.stages, k.tier)).toEqual(["Track record 0.21: R21 held against R01."]);
  });

  it("a paradigm gap names the notice's and the investigator's paradigms and the collaborators who could fill it; an unmet design group is named once with them", () => {
    const bridged = (collaborators: FixtureInvestigator["collaborators"]): Partial<FixtureInvestigator> => ({ paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: 0.4 } }, collaborators, design: { wet_lab_experiment: 0.9 } });
    const basic = scored({ inv: bridged([{ id: "trialist-1", name: "Dana Okonjo", dominant_family: "clinical", categories: ["clinical_trials"] }]) });
    expect(basic.result.tier).toBe("exploratory");
    expect(gapSentences(basic.stages, basic.tier)).toEqual([
      "Paradigm: notice requires Clinical trials; yours is Molecular / cellular mechanistic (1.00, recent view) (support 0.24). Collaborators in the directory who do this: Dana Okonjo.",
      "Design: rct required, none in the evidence.",
    ]);
    // provenance keeps the ids for the UI to resolve into profile links; the sentence a person reads never carries one
    expect(basic.result.provenance.collaborators).toEqual(["trialist-1"]);
    expect(basic.result.gap).not.toContain("trialist-1");
    // no name on file: counted, never printed as an id
    const unnamed = scored({ inv: bridged([{ id: "trialist-1", dominant_family: "clinical", categories: ["clinical_trials"] }]) });
    expect(gapSentences(unnamed.stages, unnamed.tier)[0]).toContain("Collaborators in the directory who do this: a collaborator with no name on file.");
    expect(unnamed.result.gap).not.toContain("trialist-1");
    // a blank name counts as no name, and several are one count, in profile order after the named ones
    const mixed = scored({
      inv: bridged([
        { id: "trialist-1", name: "Dana Okonjo", dominant_family: "clinical", categories: ["clinical_trials"] },
        { id: "trialist-2", name: "   ", dominant_family: "clinical", categories: ["clinical_trials"] },
        { id: "trialist-3", name: null, dominant_family: "clinical", categories: ["clinical_trials"] },
      ]),
    });
    expect(mixed.result.provenance.collaborators).toEqual(["trialist-1", "trialist-2", "trialist-3"]);
    expect(gapSentences(mixed.stages, mixed.tier)[0]).toContain("Collaborators in the directory who do this: Dana Okonjo, 2 collaborators with no name on file.");
    const noCollab = scored({ inv: { paradigm: { recent: { molecular_cellular_mechanistic: 1, clinical_trials: 0.4 } }, design: { wet_lab_experiment: 0.9 } } });
    expect(gapSentences(noCollab.stages, noCollab.tier)).toEqual(["Paradigm: notice requires Clinical trials; yours is Molecular / cellular mechanistic (1.00, recent view) (support 0.40).", "Design: rct required, none in the evidence."]);
  });

  it("unit, prohibited-design, actionability, eligibility and confidence sentences", () => {
    const unit = scored({ inv: { unit: { L1: 1, L3: 0.5 } } });
    expect(gapSentences(unit.stages, unit.tier)).toEqual(["Unit: notice works at L3 (human individual); yours is L1 (molecular–cellular) (0.50)."]);
    const prohibited = scored({ inv: { design: { rct: 0.9, prospective_cohort: 0.3 } }, opp: { design: { required_any: ["prospective_cohort"], prohibited: ["rct"] } } });
    expect(gapSentences(prohibited.stages, prohibited.tier)).toContain("The notice prohibits rct, 75% of the design evidence; the application, not the person, is constrained.");
    const pipeline = scored({ inv: { characteristics: { in_pipeline: true } } });
    expect(gapSentences(pipeline.stages, pipeline.tier)).toEqual(["Actionability: already in the Outreach pipeline."]);
    const short = scored({ inv: { characteristics: { runway_weeks: 2 } } });
    expect(gapSentences(short.stages, short.tier)).toEqual(["Actionability: 2 weeks to the deadline, 6 needed."]);
    const esi = scored({ opp: { eligibility: { esi_only: true } }, inv: { characteristics: { esi: null } } });
    expect(gapSentences(esi.stages, esi.tier)).toEqual(["Eligibility not confirmed: ESI status not on file."]);
    const partial = scored({ ctx: { investigator_pending_items: 2 } });
    expect(gapSentences(partial.stages, partial.tier)).toEqual(["Confidence: investigator profile high (partial, 2 pending), notice profile high."]);
    const incomplete = scored({ ctx: { notice_complete: false }, opp: { confidence: "low" } });
    expect(gapSentences(incomplete.stages, incomplete.tier)).toEqual(["Confidence: investigator profile high, notice profile low (incomplete)."]);
    // a notice whose paradigm axis is empty is capped low_notice_confidence on that alone (D24 point 2): the sentence names the reason, which neither confidence shows
    const empty = scored({ opp: { ...BASE_OPP, paradigm: {} } });
    expect(empty.result.caps).toEqual(["low_notice_confidence"]);
    expect(empty.tier.caps.map((c) => c.reason)).toEqual(["notice names no paradigm requirement"]);
    expect(gapSentences(empty.stages, empty.tier)).toEqual(["Confidence: investigator profile high, notice profile high, notice names no paradigm requirement."]);
    expect(explain(empty.stages, empty.tier).gap).toBe("Confidence: investigator profile high, notice profile high, notice names no paradigm requirement.");
    const emptyLow = scored({ opp: { ...BASE_OPP, paradigm: {}, confidence: "low" } });
    expect(gapSentences(emptyLow.stages, emptyLow.tier)).toEqual(["Confidence: investigator profile high, notice profile low, notice names no paradigm requirement."]);
    // an excluded-only axis is structure (the rule amended in PR 2.2): a low-confidence cap on such a notice does not name the empty-axis reason
    const excludedLow = scored({ opp: { ...BASE_OPP, paradigm: { excluded: { basic_discovery: 1 } }, confidence: "low" } });
    expect(excludedLow.result.caps).toEqual(["low_notice_confidence"]);
    expect(gapSentences(excludedLow.stages, excludedLow.tier)).toEqual(["Confidence: investigator profile high, notice profile low."]);
  });

  // A gap sentence names a tier and a number, and the number must be that tier's floor.
  // `gapSentences` took the NAME from `tier_by_floors` (exploratory -> "Moderate") and the
  // NUMBER from `missed_next`, which tier.ts fills with the STRONG checks whenever a pair meets
  // every Moderate floor and is held at Exploratory by `gaps_allowed` alone. On the 2026-09-07
  // corpus 574 pairs read "below the Moderate floor 0.6" at T 0.45-0.59 — every one of them at
  // or above the real Moderate floor of 0.45. The sentence now reads `missed_tier`, so a pair
  // held back by its Strong gaps names Strong, whose floor 0.60 is the one it must still clear.
  // topic.ts composes T from the terms that have an input. When the notice carries no code and no
  // term, the only input left is the embedding, and T is a bare cosine — the signal §11 subordinates.
  // Strong is already impossible there (T_specific_depth wants a depth-3 coded match), so this
  // discloses rather than caps: the reader is told what the number is made of.
  it("says so when the topic score is text similarity alone", () => {
    const bare = scored({ topic: null, opp: { ...BASE_OPP, topic: { mesh: [], rcdc: [], terms: [] } } });
    const topicSentence = gapSentences(bare.stages, bare.tier).find((s) => s.startsWith("Topic "));
    expect(topicSentence).toContain("notice names no topic codes or terms, so this is text similarity alone");
    expect(bare.stages.T.absent).toContain("coded");
    // and it stays out of the way when the notice does name a topic
    const coded = scored({ topic: 0.55 });
    expect(gapSentences(coded.stages, coded.tier).find((s) => s.startsWith("Topic "))).not.toContain("text similarity alone");
  });

  it("quotes the floor of the tier it names, on every pair that names one", () => {
    const tierOf = { Strong: "strong", Moderate: "moderate", Exploratory: "exploratory" } as const;
    /** Every "<component> x is below the <Tier> floor <n>" sentence, checked against taxonomy.json. */
    const assertFloorsAgree = (r: ReturnType<typeof scored>) => {
      const named = gapSentences(r.stages, r.tier).flatMap((s) => Array.from(s.matchAll(/below the (\w+) floor ([\d.]+)/g)));
      for (const m of named) {
        const tier = tierOf[m[1] as keyof typeof tierOf];
        expect(tier, `unknown tier "${m[1]}" in a gap sentence`).toBeDefined();
        const floorsOfTier = floors(tier) as Record<string, unknown>;
        expect(Object.values(floorsOfTier)).toContain(Number(m[2]));
      }
      return named.length;
    };

    // T 0.55 meets the Moderate T floor 0.45 and misses the Strong 0.60; the missing materials
    // miss the Strong M floor 0.50 and meet the Moderate 0.30. Two Strong gaps exceed
    // `gaps_allowed` (1), so the pair sits at Exploratory with every Moderate floor met — the
    // case that used to print Strong's number under Moderate's name.
    const held = scored({ topic: 0.55, inv: { materials: {} }, opp: { materials: { expected: ["enrolled_participants", "human_blood_fluids"] } } });
    expect(held.tier.tier_by_floors).toBe("exploratory");
    expect(checkFloors("moderate", held.stages).filter((c) => !c.ok)).toEqual([]);
    expect(held.tier.missed_tier).toBe("strong");
    expect(gapSentences(held.stages, held.tier)).toContain("Topic 0.55 is below the Strong floor 0.6; not in the evidence: interferon.");
    expect(assertFloorsAgree(held)).toBe(2);

    // and the ordinary cases still name their own tier's floors
    expect(assertFloorsAgree(scored({ topic: 0.55 }))).toBe(1);
    expect(assertFloorsAgree(scored({ topic: 0.4, inv: { characteristics: { mechanisms_held: [], trial_pi_count: 0, active_awards: 0 } } }))).toBeGreaterThan(0);
  });
});

describe("explain · why not (§10 Poor: explainable on request)", () => {
  it("names the exclusion, the gates and the Exploratory floor that put the pair in Poor", () => {
    const ineligible = scored({ inv: { characteristics: { runway_weeks: -1 } } });
    expect(whyNot(ineligible.stages, ineligible.tier)).toBe("Ineligible: deadline has passed.");
    // a bench scientist against a system-level trial notice: paradigm gate (0.15), unit gate (L1 vs L5 = 0.05) and the required rct unmet
    const gated = scored({ inv: { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, unit: { L1: 0.9 }, design: { wet_lab_experiment: 0.9 } }, opp: { ...BASE_OPP, unit: { required: ["L5"] } } });
    expect(gated.result.caps).toEqual(["paradigm_gate", "unit_gate", "design_required_unsupported"]);
    expect(whyNot(gated.stages, gated.tier)).toBe(
      "Paradigm: notice requires Clinical trials; yours is Molecular / cellular mechanistic (0.90, recent view) (support 0.15). Unit: notice works at L5 (system); yours is L1 (molecular–cellular) (0.05). Design: rct required, none in the evidence."
    );
    // a Poor whose paradigm is merely below the next tier's floor (no gate) still explains it: epidemiology vs clinical_trials supports 0.45
    const belowFloor = scored({ inv: { paradigm: { recent: { epidemiology: 0.9 } }, unit: { L4: 0.9 }, design: { prospective_cohort: 0.9 } }, topic: 0.3 });
    expect(belowFloor.result.tier).toBe("poor");
    expect(whyNot(belowFloor.stages, belowFloor.tier)).toBe("Design: rct required, none in the evidence. Topic 0.30 is below the Exploratory floor 0.35.");
    const topic = scored({ topic: 0.3 });
    expect(whyNot(topic.stages, topic.tier)).toBe("Topic 0.30 is below the Exploratory floor 0.35.");
    // a bridge-lifted gate that is Poor for another reason still explains the paradigm
    const unitGated = scored({ inv: { paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: 0.4 } }, collaborators: [{ id: "trialist-1", dominant_family: "clinical", categories: ["clinical_trials"] }], unit: { L1: 0.9 } }, opp: { ...BASE_OPP, unit: { required: ["L5"] } } });
    expect(unitGated.tier.exception).toBe("translational_bridge");
    expect(whyNot(unitGated.stages, unitGated.tier)).toContain("Paradigm: notice requires Clinical trials");
    expect(whyNot(unitGated.stages, unitGated.tier)).toContain("Unit: notice works at L5 (system); yours is L1 (molecular–cellular) (0.05).");
  });

  it("falls back to listing the missed Exploratory floors", () => {
    const { stages, tier } = scored();
    expect(whyNot(stages, { ...tier, caps: [], missed_next: [{ key: "M", ok: false, value: 0, floor: 0.3 }] })).toBe("Below the Exploratory floors: M.");
  });
});

describe("explain · explain()", () => {
  it("Strong has neither gap nor why_not; Moderate and Exploratory carry the gap; Poor carries why_not", () => {
    const strong = scored();
    expect(explain(strong.stages, strong.tier)).toEqual({ rationale: expect.stringContaining("Paradigm 1.00"), gap: null, why_not: null });
    const moderate = scored({ topic: 0.55 });
    expect(explain(moderate.stages, moderate.tier)).toMatchObject({ gap: "Topic 0.55 is below the Strong floor 0.6; not in the evidence: interferon.", why_not: null });
    const poor = scored({ topic: 0.3 });
    expect(explain(poor.stages, poor.tier)).toMatchObject({ gap: null, why_not: "Topic 0.30 is below the Exploratory floor 0.35." });
  });
});

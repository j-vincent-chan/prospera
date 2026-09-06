import { describe, expect, it } from "vitest";
import { buildOpportunityTags, enrichOpportunityTags, extractOpportunityTags } from "./opportunity-tags";

describe("opportunity display tags", () => {
  it("extracts tags from the notice text", () => {
    const t = extractOpportunityTags({
      title: "AI and machine learning for biomedical imaging biomarkers",
      description: "Computational approaches including deep learning.",
      agency: "NIH",
    });
    expect(t.technical_expertise).toContain("machine_learning");
    expect(t.research_focal_areas.length + t.disease_areas.length + t.technical_expertise.length).toBeGreaterThan(0);
  });

  it("adds pathway and IC tags when text extraction is sparse", () => {
    const enriched = enrichOpportunityTags(
      { research_focal_areas: [], disease_areas: [], technical_expertise: [] },
      { nih_ic_tokens: ["NIDDK", "NHLBI"], rd_research_pathway: "clinical", clinical_trial_mode: "not_allowed", activity_families: ["U"] }
    );
    expect(enriched.research_focal_areas.length).toBeGreaterThan(0);
    expect(enriched.disease_areas).toEqual(expect.arrayContaining(["diabetes", "cardiovascular_disease"]));
    expect(enriched.technical_expertise).toEqual(expect.arrayContaining(["consortium_coordination"]));
    // a notice that does not allow trials never gains the trials-methods tag from its pathway
    expect(enriched.technical_expertise).not.toContain("clinical_trials_methods");
  });

  it("fills all three buckets for a cardiovascular diabetes consortium notice", () => {
    const tags = buildOpportunityTags(
      {
        title: "Continuation of the Cardiovascular Repository for Type 1 Diabetes (CARE-TID) Consortium U01 (Open Competition) - Research (U01, Clinical Trial Not Allowed)",
        description: "This cooperative agreement supports a multi-site registry and repository for type 1 diabetes cardiovascular outcomes research.",
        agency: "National Institutes of Health",
        opportunity_number: "RFA-HL-24-001",
      },
      { nih_ic_tokens: ["NHLBI", "NIDDK"], rd_research_pathway: "population", clinical_trial_mode: "not_allowed", activity_families: ["U"], category: "health" }
    );
    expect(tags.research_focal_areas.length).toBeGreaterThan(0);
    expect(tags.disease_areas.length).toBeGreaterThan(0);
    expect(tags.technical_expertise.length).toBeGreaterThan(0);
    expect(tags.disease_areas).toEqual(expect.arrayContaining(["type_1_diabetes", "cardiovascular_disease"]));
  });
});

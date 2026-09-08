/**
 * The display-label map (PR 3.2b): every enum a person reads has a written
 * label, and the engine's stored sentences come back with their ids read as
 * labels — without touching the notice text they quote.
 */
import { describe, expect, it } from "vitest";
import {
  capLabel,
  CAP_LABEL,
  COMPONENT_LABEL,
  designLabel,
  DESIGN_LABEL,
  displayLabel,
  hasRawId,
  humanizeIds,
  MATERIALS_LABEL,
  materialsLabel,
  OBJECTIVE_LABEL,
  paradigmLabel,
  rawIdsIn,
  UNIT_LABEL,
  unitLevelLabel,
} from "@/lib/fit/inspect/display-labels";
import { DESIGN_IDS, MATERIALS_KIND_IDS, OBJECTIVE_IDS, UNIT_IDS } from "@/lib/fit/types";
import { PARADIGM_CATEGORY_IDS } from "@/lib/fit/taxonomy";

describe("display-labels · every id has a written label", () => {
  it("covers the four axes the taxonomy leaves unlabelled, and never leaves an underscore in one", () => {
    for (const ids of [DESIGN_IDS, MATERIALS_KIND_IDS, OBJECTIVE_IDS, UNIT_IDS] as ReadonlyArray<readonly string[]>) {
      for (const id of ids) {
        const label = displayLabel(id);
        expect(label, id).not.toContain("_");
        expect(label.length, id).toBeGreaterThan(1);
      }
    }
    expect(Object.keys(DESIGN_LABEL)).toHaveLength(DESIGN_IDS.length);
    expect(Object.keys(MATERIALS_LABEL)).toHaveLength(MATERIALS_KIND_IDS.length);
    expect(Object.keys(OBJECTIVE_LABEL)).toHaveLength(OBJECTIVE_IDS.length);
    expect(Object.keys(UNIT_LABEL)).toHaveLength(UNIT_IDS.length);
  });

  it("reads the acronym ids as words, not as capitalised ids", () => {
    expect(designLabel("rct")).toBe("Randomized controlled trial");
    expect(designLabel("gwas")).toBe("Genome-wide association study");
    expect(designLabel("hybrid_effectiveness_implementation")).toBe("Hybrid effectiveness–implementation trial");
    expect(materialsLabel("organoids_ipsc")).toBe("Organoids and iPSC");
    expect(materialsLabel("animal_rat")).toBe("Rat");
  });

  it("keeps the taxonomy's own labels for paradigm and unit levels", () => {
    for (const c of PARADIGM_CATEGORY_IDS) expect(paradigmLabel(c), c).not.toContain("_");
    expect(unitLevelLabel("L3")).toBe("L3 · human individual");
    expect(unitLevelLabel("L9")).toBe("L9");
  });

  it("names every cap and component as a reason, not an id", () => {
    for (const [id, label] of Object.entries(CAP_LABEL)) {
      expect(label, id).not.toContain("_");
      expect(capLabel(id), id).toBe(label);
    }
    expect(COMPONENT_LABEL.K).toBe("Track record");
    expect(capLabel("something_new")).toBe("Something new");
  });

  it("spells out an id it has never seen rather than showing it raw", () => {
    expect(displayLabel("brand_new_axis_id")).toBe("Brand new axis id");
  });
});

describe("display-labels · humanizeIds over the engine's stored sentences", () => {
  it("reads a required-design run, including the bare ids, and reads the engine's `|` as the \"any of\" it means", () => {
    expect(humanizeIds("Design: rct | early_phase_trial | pragmatic_trial required, none in the evidence.")).toBe(
      "Design: Randomized controlled trial or Early-phase trial or Pragmatic trial required, none in the evidence."
    );
  });

  it("reads the supporting design and the prohibited one", () => {
    expect(humanizeIds("prospective_cohort required, prospective_cohort 0.30")).toBe("Prospective cohort required, Prospective cohort 0.30");
    expect(humanizeIds("notice prohibits rct, which dominates the design evidence (75%)")).toBe("notice prohibits Randomized controlled trial, which dominates the design evidence (75%)");
  });

  it("reads a paradigm id after the verb that makes it one", () => {
    expect(humanizeIds("the notice excludes epidemiology, the dominant paradigm")).toBe("the notice excludes Epidemiology, the dominant paradigm");
    expect(humanizeIds("Paradigm: notice requires genetic_epidemiology; yours is clinical_trials.")).toBe("Paradigm: notice requires Genetic epidemiology; yours is Clinical trials.");
  });

  it("reads the methods clause's `missing` list — ids, an `a | b` alternation, and both at once (fit-UX merge)", () => {
    // `engine/methods.ts` builds these labels out of materials kind ids and
    // `" | "`-joined required design groups; `engine/explain.ts` prints them
    // after the word "missing", and the bare ones (`gwas`, `ehr`) were the
    // last ids reaching a caveat as themselves.
    expect(humanizeIds("Methods 0.25 is below the Moderate floor 0.3; missing gwas, ehr")).toBe(
      "Methods 0.25 is below the Moderate floor 0.3; missing Genome-wide association study, Electronic health records"
    );
    expect(humanizeIds("missing gwas | secondary_data_analysis, cohort_biobank_datasets, genomic_datasets.")).toBe(
      "missing Genome-wide association study or Secondary data analysis, Cohort and biobank datasets, Genomic datasets."
    );
    expect(hasRawId(humanizeIds("Methods 0.25 is below the Moderate floor 0.3; missing gwas | secondary_data_analysis, cohort_biobank_datasets."))).toBe(false);
    // A named piece of infrastructure in the same list is prose and stays.
    expect(humanizeIds("missing Genomics CoLab")).toBe("missing Genomics CoLab");
  });

  it("reads the characteristic ids stage 1 quotes", () => {
    expect(humanizeIds("MD/DO required; clinical role on file: phd_investigator")).toBe("MD/DO required; clinical role on file: PhD investigator");
    expect(humanizeIds("notice profile flagged needs_review")).toBe("notice profile flagged needs review");
  });

  it("leaves an evidence id, a notice number and quoted notice text alone", () => {
    const quoted = 'citizenship rule not evaluated: "Applicants must be citizens or permanent residents; see the population and community sections."';
    expect(humanizeIds(quoted)).toBe(quoted);
    expect(humanizeIds("Topic 0.42 — 2 coded matches (publication:0f5b:31000001 at depth 4)")).toContain("publication:0f5b:31000001");
    expect(humanizeIds("Reissue of PAR-24-118 · RFA-DK-27-012")).toBe("Reissue of PAR-24-118 · RFA-DK-27-012");
  });

  it("is total on null and empty text", () => {
    expect(humanizeIds(null)).toBeNull();
    expect(humanizeIds(undefined)).toBeNull();
    expect(humanizeIds("")).toBe("");
  });
});

describe("display-labels · hasRawId is the guard the surfaces assert with", () => {
  it("sees a raw id and does not see prose or an evidence id", () => {
    expect(hasRawId("Design: rct required, none in the evidence.")).toBe(true);
    expect(hasRawId("missing animal_rat")).toBe(true);
    expect(hasRawId(humanizeIds("Design: rct | early_phase_trial required, none in the evidence."))).toBe(false);
    expect(hasRawId("Paradigm matches: Clinical trials work, which is what the notice asks for.")).toBe(false);
    expect(hasRawId("publication:0f5b1b2c-1111-4222-8333-444455556666:31000001")).toBe(false);
    expect(hasRawId(null)).toBe(false);
  });
});

describe("display-labels · the guard is not a tautology", () => {
  it("fires on an id the map has never heard of — the case a rewrite cannot fix", () => {
    // A taxonomy addition reaches a stored sentence before this map learns it. `humanizeIds` leaves it,
    // and a guard built from the map's own keys would stay silent on exactly that.
    expect(humanizeIds("Materials: frobnicated_widget required.")).toBe("Materials: frobnicated_widget required.");
    expect(rawIdsIn("Materials: frobnicated_widget required.")).toEqual(["frobnicated_widget"]);
    expect(hasRawId("Paradigm: notice requires health_systems_science.")).toBe(true);
  });

  it("strips an evidence id but not a colon that merely precedes one", () => {
    expect(rawIdsIn("cites publication:0f5b1b2c-1111-4222-8333-444455556666:31000001 and self_declared:abc")).toEqual([]);
    // the old strip swallowed any `word:` prefix, hiding the id right after it
    expect(hasRawId("Design:rct required")).toBe(true);
    expect(hasRawId("Design: rct required")).toBe(true);
  });

  it("stays quiet on finished prose and on a notice number", () => {
    expect(rawIdsIn("Design: Randomized controlled trial or Early-phase trial required, none in the evidence.")).toEqual([]);
    expect(rawIdsIn("Reissue of PAR-24-118 · RFA-DK-27-012")).toEqual([]);
    expect(rawIdsIn(null)).toEqual([]);
  });
});

describe("display-labels · a quoted slug is a machine value, not the notice's words", () => {
  it("reads the slug the extractor sometimes returns in place of verbatim text", () => {
    expect(humanizeIds('citizenship rule not evaluated: "US_citizen_or_permanent_resident"')).toBe('citizenship rule not evaluated: "US citizen or permanent resident"');
    expect(humanizeIds('degree rule not evaluated: "clinical_or_research_doctorate"')).toBe('degree rule not evaluated: "clinical or research doctorate"');
    expect(hasRawId(humanizeIds('degree rule not evaluated: "clinical_or_research_doctorate"'))).toBe(false);
  });

  it("still leaves real quoted legalese exactly as the notice wrote it", () => {
    const real = 'citizenship rule not evaluated: "By the time of award, the individual must be a citizen or a non-citizen national of the United States."';
    expect(humanizeIds(real)).toBe(real);
    // more than one token inside the quotes is prose, whatever underscores it happens to contain
    const mixed = 'not evaluated: "See the eligibility_section of the parent announcement for details."';
    expect(humanizeIds(mixed)).toBe(mixed);
  });
});

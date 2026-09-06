/**
 * A manifest pair shaped like the real export, for the gold-set tests
 * (not a test file itself, so importing it registers nothing).
 */
import type { ManifestPair } from "@/lib/fit/goldset/manifest";

/** A synthetic pair shaped like the export's: the fixture's population investigator against a real discovery notice. */
export const SYNTHETIC_PAIR: ManifestPair = {
  id: "g090",
  investigator_id: "synthetic:2_cvd_epi_vs_mito_mechanism",
  opportunity_id: "5d3e8f7a-6a2f-4e4c-9e9b-4b7c8d9e0f1a",
  stratum: "adversarial",
  cell: { investigator: "population", notice: "discovery" },
  forbidden: true,
  synthetic: true,
  synthetic_source: "2_cvd_epi_vs_mito_mechanism",
  sources: ["cell:population->discovery", "synthetic:2_cvd_epi_vs_mito_mechanism"],
  at_export: { fit_v1_tier: null, legacy_tier: "dropped", legacy_rank: null, legacy_similarity: null, outreach_tier: null, source: "synthetic:2_cvd_epi_vs_mito_mechanism" },
  investigator: { name: "Cardiovascular epidemiologist (synthetic)", dominant: { category: "epidemiology", label: "Epidemiology", family: "population", weight: 0.9, view: "recent" }, evidence: ["Paradigm (recent): Epidemiology 0.90, Population health 0.60"], item_count: 0, pending_items: 0, paradigm_confidence: "high", evidence_vectors: 0 },
  notice: { number: "PAR-26-100", title: "Mechanisms of cardiomyocyte mitochondrial dysfunction", designation: "Clinical Trial Not Allowed", activity_code: "R01", family: "discovery", family_from: "required", excerpt: "Mechanistic studies.", excerpt_source: "Part 1 · Funding Opportunity Purpose" },
};

export const PAIR: ManifestPair = {
  id: "g001",
  investigator_id: "04e59cf5-600a-462c-91bc-b2b97f122c3d",
  opportunity_id: "710a95dc-223f-4dd4-a76a-4bd686f2463f",
  stratum: "adversarial",
  cell: { investigator: "discovery", notice: "population" },
  forbidden: true,
  synthetic: false,
  synthetic_source: null,
  sources: ["cell:discovery->population", "legacy:potential"],
  at_export: { fit_v1_tier: "poor", legacy_tier: "potential", legacy_rank: 3, legacy_similarity: 0.47, outreach_tier: null, source: "cell:discovery->population" },
  investigator: { name: "Ada Lovelace", dominant: { category: "molecular_cellular_mechanistic", label: "Molecular / cellular mechanistic", family: "discovery", weight: 0.81, view: "recent" }, evidence: ["T cells, \"quoted\"", "Line two"], item_count: 41, pending_items: 0, paradigm_confidence: "medium", evidence_vectors: 40 },
  notice: { number: "RFA-CA-27-001", title: "Survivorship, disparities", designation: "Clinical Trial Not Allowed", activity_code: "R01", family: "population", family_from: "required", excerpt: "Population cohorts;\nregistry linkage.", excerpt_source: "Part 1 · Funding Opportunity Purpose" },
};

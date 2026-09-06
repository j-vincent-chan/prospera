/**
 * A manifest pair shaped like the real export, for the gold-set tests
 * (not a test file itself, so importing it registers nothing).
 */
import type { ManifestPair } from "@/lib/fit/goldset/manifest";

export const PAIR: ManifestPair = {
  id: "g001",
  investigator_id: "04e59cf5-600a-462c-91bc-b2b97f122c3d",
  opportunity_id: "710a95dc-223f-4dd4-a76a-4bd686f2463f",
  stratum: "adversarial",
  cell: { investigator: "discovery", notice: "population" },
  forbidden: true,
  sources: ["cell:discovery->population"],
  at_export: { fit_v1_tier: "poor", legacy_tier: "potential", legacy_similarity: 0.47, outreach_tier: null },
  investigator: { name: "Ada Lovelace", dominant: { category: "molecular_cellular_mechanistic", label: "Molecular / cellular mechanistic", family: "discovery", weight: 0.81, view: "recent" }, evidence: ["T cells, \"quoted\"", "Line two"], item_count: 41, pending_items: 0, paradigm_confidence: "medium" },
  notice: { number: "RFA-CA-27-001", title: "Survivorship, disparities", designation: "Clinical Trial Not Allowed", activity_code: "R01", family: "population", family_from: "required", excerpt: "Population cohorts;\nregistry linkage.", excerpt_source: "Part 1 · Funding Opportunity Purpose" },
};

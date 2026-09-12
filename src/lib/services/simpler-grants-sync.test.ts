import { describe, expect, it } from "vitest";
import type { SimplerOpportunityHit } from "@/lib/ingestion/simpler-grants/types";
import { hitToFundingRow } from "./simpler-grants-sync";

const adrn = (): SimplerOpportunityHit => ({
  opportunity_id: "12345",
  opportunity_number: "RFA-AI-27-004",
  opportunity_title: "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)",
  agency_code: "HHS-NIH11",
  agency_name: "National Institutes of Health",
  opportunity_status: "posted",
  summary: {
    summary_description: "The purpose of this notice of funding opportunity (NOFO) is to solicit applications for the ADRN program.",
    agency_contact_description: "National Institute of Allergy and Infectious Diseases (NIAID)\nminnicozzim@niaid.nih.gov",
    post_date: "2026-06-29",
    close_date: "2026-09-24",
  },
});

describe("hitToFundingRow — institute resolution", () => {
  it("resolves from Simpler fields and the number when nothing is stored, and records the option used", () => {
    const hit = adrn();
    const row = hitToFundingRow(hit, hit as unknown as Record<string, unknown>, null);
    expect(row.nih_ic_tokens).toEqual(["NIAID"]);
    expect(row.nih_ic_source).toBe("notice_number");
    expect(row.nih_ic_reason).toBe("From the notice number (RFA-AI = NIAID); the NIH Guide was not read this run and the title and summary name no institute.");
  });

  it("keeps the stored Guide answer — a nightly sync without the Guide cannot demote it", () => {
    const hit = adrn();
    const row = hitToFundingRow(hit, hit as unknown as Record<string, unknown>, { nih_ic_tokens: ["NIAID", "NIAMS"], nih_ic_source: "guide_participating_orgs" });
    expect(row.nih_ic_tokens).toEqual(["NIAID", "NIAMS"]);
    expect(row.nih_ic_source).toBe("guide_participating_orgs");
  });

  it("re-resolves over a stored answer from a lower option", () => {
    const hit = adrn();
    const row = hitToFundingRow(hit, hit as unknown as Record<string, unknown>, { nih_ic_tokens: ["NCI"], nih_ic_source: "agency_contact" });
    expect(row.nih_ic_tokens).toEqual(["NIAID"]);
    expect(row.nih_ic_source).toBe("notice_number");
  });

  it("falls to the Simpler contact for a PAR and flags a notice nothing can place", () => {
    const hit = { ...adrn(), opportunity_number: "PAR-27-500" };
    const row = hitToFundingRow(hit, hit as unknown as Record<string, unknown>, null);
    expect(row.nih_ic_source).toBe("agency_contact");
    expect(row.nih_ic_tokens).toEqual(["NIAID"]);

    const blank = { ...hit, summary: { summary_description: "A program.", agency_contact_description: "NIH Grants Information\ngrantsinfo@nih.gov" } };
    const none = hitToFundingRow(blank, blank as unknown as Record<string, unknown>, null);
    expect(none.nih_ic_tokens).toEqual([]);
    expect(none.nih_ic_source).toBe("unresolved");
  });
});

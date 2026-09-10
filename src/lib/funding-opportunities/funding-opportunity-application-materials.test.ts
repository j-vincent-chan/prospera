import { describe, expect, it } from "vitest";
import {
  formatApplicationDocumentSize,
  isNihFundingOpportunity,
  withInlineAnnouncement,
  type FundingApplicationMaterials,
} from "@/lib/funding-opportunities/funding-opportunity-application-materials";

describe("isNihFundingOpportunity", () => {
  it("detects NIH from agency name", () => {
    expect(isNihFundingOpportunity({ agency: "National Institutes of Health" })).toBe(true);
  });

  it("detects NIH from opportunity number prefix", () => {
    expect(isNihFundingOpportunity({ opportunityNumber: "PAR-26-116" })).toBe(true);
  });

  it("returns false for EPA opportunities", () => {
    expect(
      isNihFundingOpportunity({
        agency: "Environmental Protection Agency",
        opportunityNumber: "EPA-R9-SFUND-23-003",
      })
    ).toBe(false);
  });
});

describe("formatApplicationDocumentSize", () => {
  it("formats kilobytes and megabytes", () => {
    expect(formatApplicationDocumentSize(890)).toBe("890 B");
    expect(formatApplicationDocumentSize(147_084)).toBe("144 KB");
    expect(formatApplicationDocumentSize(2_400_000)).toBe("2.3 MB");
  });
});

describe("withInlineAnnouncement", () => {
  const base: FundingApplicationMaterials = {
    packageAvailable: true,
    statusMessage: null,
    previewPackageUrl: null,
    previewPackageLabel: "Grants.gov Package",
    startApplicationUrl: null,
    startApplicationLabel: "Start application",
    startApplicationSubtitle: "ASSIST or Workspace",
    assistUrl: null,
    nihStandardFormsUrl: null,
    documents: [
      { fileName: "RFA-HG-27-011-Full-Announcement.html", downloadUrl: "https://www.grants.gov/grantsws/rest/opportunity/att/download/353192", openUrl: null, fileSizeBytes: 144267, folderType: "Full Announcement" },
      { fileName: "RFA-HG-27-011-Full-Announcement.html", downloadUrl: "https://files.simpler.grants.gov/opportunities/a/attachments/b/RFA-HG-27-011-Full-Announcement.html", openUrl: null, fileSizeBytes: 144267, folderType: null },
      { fileName: "Budget-Template.pdf", downloadUrl: "https://www.grants.gov/grantsws/rest/opportunity/att/download/353193", openUrl: null, fileSizeBytes: 1000, folderType: "Other Supporting Documents" },
    ],
  };

  // The Grants.gov copy of the announcement downloads; the notice's announcement page opens it instead.
  it("opens the Grants.gov full-announcement HTML through the announcement page", () => {
    const out = withInlineAnnouncement(base, "https://grants.nih.gov/grants/guide/rfa-files/RFA-HG-27-011.html");
    expect(out.documents.map((d) => d.openUrl)).toEqual([
      "https://grants.nih.gov/grants/guide/rfa-files/RFA-HG-27-011.html",
      "https://files.simpler.grants.gov/opportunities/a/attachments/b/RFA-HG-27-011-Full-Announcement.html",
      null,
    ]);
    // The download itself is untouched.
    expect(out.documents[0]!.downloadUrl).toBe(base.documents[0]!.downloadUrl);
  });

  it("still opens the Simpler-hosted HTML on its own URL when no announcement page is known", () => {
    const out = withInlineAnnouncement(base, null);
    expect(out.documents.map((d) => d.openUrl)).toEqual([null, base.documents[1]!.downloadUrl, null]);
  });
});

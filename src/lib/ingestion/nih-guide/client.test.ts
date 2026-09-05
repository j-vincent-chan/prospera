import { describe, expect, it } from "vitest";
import { guideAttachmentUrl, guideSourceForUrl, guideUrlFor, isGuideNumber, isSimplerFilesUrl } from "./client";

describe("guideUrlFor", () => {
  it("maps RFA, PA, PAR and PAS numbers to the classic paths", () => {
    expect(guideUrlFor("RFA-CA-27-020")).toBe("https://grants.nih.gov/grants/guide/rfa-files/RFA-CA-27-020.html");
    expect(guideUrlFor("PA-25-303")).toBe("https://grants.nih.gov/grants/guide/pa-files/PA-25-303.html");
    expect(guideUrlFor("PAR-27-064")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html");
    expect(guideUrlFor("PAS-27-028")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAS-27-028.html");
    expect(guideUrlFor(" par-27-064 ")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html");
  });
  it("keeps the NOT- branch", () => {
    expect(guideUrlFor("NOT-NS-24-061")).toBe("https://grants.nih.gov/grants/guide/notice-files/NOT-NS-24-061.html");
  });
  it("returns null for numbers that cannot have a Guide page", () => {
    expect(guideUrlFor("RFA-IP-18-000")).toBeNull(); // CDC umbrella placeholder
    expect(guideUrlFor("PA-FPH-27-001")).toBeNull(); // HHS-OPHS office code, not an IC
    expect(guideUrlFor("PA-EAA-26-001")).toBeNull();
    expect(guideUrlFor("FOR-AR-26-008")).toBeNull(); // NIH forecast placeholder
    expect(guideUrlFor("RFA-27-020")).toBeNull(); // RFA without an IC
    expect(guideUrlFor("PAR-27-0640")).toBeNull();
    expect(guideUrlFor("NSF 26-501")).toBeNull();
    expect(guideUrlFor("")).toBeNull();
  });
  it("uses Simpler's additional_info_url only when it points at the Guide", () => {
    expect(guideUrlFor("PAS-25-100", "http://grants.nih.gov/grants/guide/pa-files/PAS-25-100.html")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAS-25-100.html");
    expect(guideUrlFor("PA-FPH-27-001", "https://grants.nih.gov/grants/guide/pa-files/PA-FPH-27-001.html")).toBe("https://grants.nih.gov/grants/guide/pa-files/PA-FPH-27-001.html");
    expect(guideUrlFor("PAR-27-064", "https://www.niaid.nih.gov/some/page")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html");
    expect(guideUrlFor("PAR-27-007", "Not Applicable")).toBe("https://grants.nih.gov/grants/guide/pa-files/PAR-27-007.html");
  });
});

describe("isGuideNumber", () => {
  it("accepts the four Guide shapes and rejects placeholders", () => {
    for (const n of ["RFA-DK-26-308", "PA-27-034", "PAR-26-116", "PAS-27-028"]) expect(isGuideNumber(n)).toBe(true);
    for (const n of ["RFA-GH-18-000", "PA-PHE-26-001", "NOT-OD-25-001", "R01", null, undefined]) expect(isGuideNumber(n)).toBe(false);
  });
});

describe("guideAttachmentUrl", () => {
  const url = "https://files.simpler.grants.gov/opportunities/81895450-caf7-48ab-bab4-b80f0d74e3b1/attachments/89fd3002-0a0a-43ff-9a18-a94ede94778d/PAR-27-064-Full-Announcement.html";
  it("picks the <number>-Full-Announcement.html attachment with an HTML mime type", () => {
    const attachments = [
      { file_name: "PAR-27-064-Budget-Template.pdf", mime_type: "application/pdf", download_path: "https://files.simpler.grants.gov/x/y.pdf" },
      { file_name: "PAR-27-064-Full-Announcement.html", mime_type: "text/html;charset=ISO-8859-1", download_path: url },
    ];
    expect(guideAttachmentUrl(attachments, "PAR-27-064")).toBe(url);
    expect(guideAttachmentUrl(attachments, "par-27-064")).toBe(url);
    expect(guideAttachmentUrl(attachments, "PAR-27-065")).toBeNull();
  });
  it("accepts the -Revised-Full-Announcement variant and prefers it over the original", () => {
    const revised = url.replace("PAR-27-064-Full", "PAR-27-064-Revised-Full");
    expect(guideAttachmentUrl([{ file_name: "PAR-27-064-Revised-Full-Announcement.html", mime_type: "text/html;charset=UTF-8", download_path: revised }], "PAR-27-064")).toBe(revised);
    expect(
      guideAttachmentUrl(
        [
          { file_name: "PAR-27-064-Full-Announcement.html", mime_type: "text/html", download_path: url },
          { file_name: "PAR-27-064-Revised-Full-Announcement.html", mime_type: "text/html", download_path: revised },
        ],
        "PAR-27-064",
      ),
    ).toBe(revised);
  });
  it("tolerates a missing mime type and upper-case file names, and rejects other hosts or names", () => {
    expect(guideAttachmentUrl([{ file_name: "RFA-CA-27-020-FULL-ANNOUNCEMENT.HTML", download_path: url.replace("PAR-27-064", "RFA-CA-27-020") }], "RFA-CA-27-020")).toContain("RFA-CA-27-020");
    expect(guideAttachmentUrl([{ file_name: "PAR-27-064-Full-Announcement.html", mime_type: "application/pdf", download_path: url }], "PAR-27-064")).toBeNull();
    expect(guideAttachmentUrl([{ file_name: "PAR-27-064-Full-Announcement.html", mime_type: "text/html", download_path: "https://example.com/PAR-27-064-Full-Announcement.html" }], "PAR-27-064")).toBeNull();
    expect(guideAttachmentUrl([{ file_name: "Full-Announcement.html", mime_type: "text/html", download_path: url }], "PAR-27-064")).toBeNull();
    expect(guideAttachmentUrl([], "PAR-27-064")).toBeNull();
    expect(guideAttachmentUrl(null, "PAR-27-064")).toBeNull();
    expect(guideAttachmentUrl(undefined, "PAR-27-064")).toBeNull();
  });
});

describe("isSimplerFilesUrl / guideSourceForUrl", () => {
  it("recognises the Simpler file host", () => {
    expect(isSimplerFilesUrl("https://files.simpler.grants.gov/opportunities/a/attachments/b/X.html")).toBe(true);
    expect(isSimplerFilesUrl("https://grants.nih.gov/grants/guide/pa-files/PAR-27-064.html")).toBe(false);
    expect(isSimplerFilesUrl(null)).toBe(false);
    expect(isSimplerFilesUrl("not a url")).toBe(false);
    expect(guideSourceForUrl("https://files.simpler.grants.gov/o/a/X.html")).toBe("simpler_attachment");
    expect(guideSourceForUrl("https://grants.nih.gov/grants/guide/rfa-files/RFA-CA-27-020.html")).toBe("grants_nih_gov");
  });
});

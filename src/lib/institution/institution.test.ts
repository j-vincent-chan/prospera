import { describe, expect, it } from "vitest";
import { internalDueLabel } from "./curated";
import { excerptOf, scanSensitive } from "./library";
import { mapHeaders, normalizeOsrRows } from "./osr-import";
import { activityCodeOf, derivedStatus, fiscalYearOf, institutePrefixOf, isLive, overlayNominationLine, piShort, tidyDepartment } from "./types";

describe("derived curated status", () => {
  const today = "2026-09-03";
  it("drafts stay drafts regardless of dates", () => {
    expect(derivedStatus({ status: "draft", review_by: "2020-01-01", application_due: "2020-01-01" }, today)).toBe("draft");
  });
  it("published + current = published", () => {
    expect(derivedStatus({ status: "published", review_by: "2027-02-16", application_due: "2027-02-15" }, today)).toBe("published");
    expect(isLive({ status: "published", review_by: "2027-02-16", application_due: "2027-02-15" }, today)).toBe(true);
  });
  it("past review-by → needs review and is not live", () => {
    expect(derivedStatus({ status: "published", review_by: "2026-08-12", application_due: "2026-10-30" }, today)).toBe("needs_review");
    expect(isLive({ status: "published", review_by: "2026-08-12", application_due: "2026-10-30" }, today)).toBe(false);
  });
  it("past deadline auto-hides as closed even when review-by is fine", () => {
    expect(derivedStatus({ status: "published", review_by: "2027-01-01", application_due: "2026-09-02" }, today)).toBe("closed");
  });
});

describe("overlay nomination line", () => {
  it("shows interest while open and (closed) once the cap is met", () => {
    expect(overlayNominationLine({ cap: 1, nominated_count: 0, interest_count: 2 })).toBe("1 nominee · 0 nominated · 2 interested");
    expect(overlayNominationLine({ cap: 1, nominated_count: 1, interest_count: 2 })).toBe("1 nominee · 1 nominated (closed)");
    expect(overlayNominationLine({ cap: 3, nominated_count: 1, interest_count: 0 })).toBe("3 nominees · 1 nominated");
  });
  it("internal due label counts days and marks passed", () => {
    expect(internalDueLabel("2026-10-01", "2026-09-02")).toEqual({ label: "Oct 1 · 29 days", tone: "urgent" });
    expect(internalDueLabel("2026-11-03", "2026-09-02")).toEqual({ label: "Nov 3 · 62 days", tone: "normal" });
    expect(internalDueLabel("2026-08-29", "2026-09-02")).toEqual({ label: "Aug 29 · passed", tone: "muted" });
    expect(internalDueLabel(null, "2026-09-02")).toEqual({ label: "Not set", tone: "muted" });
  });
});

describe("award helpers", () => {
  it("fiscal year rolls over on Oct 1", () => {
    expect(fiscalYearOf("2026-09-30")).toBe(2026);
    expect(fiscalYearOf("2026-10-01")).toBe(2027);
  });
  it("parses activity code and institute from project numbers", () => {
    expect(activityCodeOf("5R01AI158703-03")).toBe("R01");
    expect(activityCodeOf("1K08HL167220-01A1")).toBe("K08");
    expect(institutePrefixOf("2R01NS118240-06")).toBe("NS");
    expect(activityCodeOf(null)).toBeNull();
  });
  it("formats PI and department lines", () => {
    expect(piShort("NATARAJAN, PRIYA", "Rheumatology")).toBe("Natarajan · Rheumatology");
    expect(piShort("Hannah Park", null)).toBe("Park");
    expect(tidyDepartment("INTERNAL MEDICINE/MEDICINE")).toBe("Medicine");
    expect(tidyDepartment("MICROBIOLOGY & IMMUNOLOGY")).toBe("Microbiology & Immunology");
  });
});

describe("OSR export import", () => {
  const headers = ["Proposal ID", "Proposal Title", "PI Name", "Dept", "Sponsor", "Activity Code", "Proposal Status", "Fiscal Year", "Award Date", "Direct Costs", "Sponsor Award Number", "Proposal Type"];
  it("maps loose header names", () => {
    const m = mapHeaders(headers);
    expect(m.external_id).toBe("Proposal ID");
    expect(m.title).toBe("Proposal Title");
    expect(m.status).toBe("Proposal Status");
    expect(m.mechanism).toBe("Activity Code");
    expect(m.department).toBe("Dept");
    expect(m.direct_cost).toBe("Direct Costs");
  });
  it("splits funded and declined rows and infers institute + fiscal year", () => {
    const m = mapHeaders(headers);
    const out = normalizeOsrRows(
      [
        { "Proposal ID": "P1", "Proposal Title": "Tregs in lupus", "PI Name": "Natarajan, Priya", Dept: "Medicine", Sponsor: "NIH", "Activity Code": "", "Proposal Status": "Awarded", "Fiscal Year": "", "Award Date": "11/15/2025", "Direct Costs": "$498,000", "Sponsor Award Number": "5R01AI158703-03", "Proposal Type": "New" },
        { "Proposal ID": "P2", "Proposal Title": "Sepsis priming", "PI Name": "Okafor, D", Dept: "Medicine", Sponsor: "NIH", "Activity Code": "R01", "Proposal Status": "Declined", "Fiscal Year": "2025", "Award Date": "", "Direct Costs": "", "Sponsor Award Number": "", "Proposal Type": "Resubmission" },
        { "Proposal ID": "P3", "Proposal Title": "Pending one", "PI Name": "X", Dept: "Medicine", Sponsor: "NIH", "Activity Code": "R21", "Proposal Status": "Pending", "Fiscal Year": "2026", "Award Date": "", "Direct Costs": "", "Sponsor Award Number": "", "Proposal Type": "New" },
      ],
      m,
      "batch-1",
    );
    expect(out.awards).toHaveLength(1);
    expect(out.declines).toHaveLength(1);
    expect(out.skipped).toBe(1);
    const a = out.awards[0];
    expect(a.mechanism).toBe("R01");
    expect(a.institute).toBe("NIAID");
    expect(a.fiscal_year).toBe(2026);
    expect(a.award_date).toBe("2025-11-15");
    expect(a.direct_cost).toBe(498000);
    expect(a.source).toBe("osr");
    expect(out.declines[0].is_resubmission).toBe(true);
    expect(out.declines[0].fiscal_year).toBe(2025);
  });
});

describe("library document helpers", () => {
  it("scans for names, unpublished mentions and emails", () => {
    const f = scanSensitive("We thank Dr. Priya Natarajan and Dr. Okafor. Our preliminary data (unpublished) show… contact jane.doe@ucsf.edu or JANE.DOE@ucsf.edu.");
    expect(f.collaborators).toBe(2);
    expect(f.unpublished).toBe(2);
    expect(f.emails).toBe(1);
    expect(f.samples.some((s) => s.startsWith("Named: Priya Natarajan"))).toBe(true);
  });
  it("excerpt ends at a sentence boundary", () => {
    const text = `${"Significance. ".repeat(20)}Cutaneous lupus affects many patients. ${"x".repeat(600)}`;
    const e = excerptOf(text, 120);
    expect(e.length).toBeLessThanOrEqual(122);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toContain("Significance.");
  });
});

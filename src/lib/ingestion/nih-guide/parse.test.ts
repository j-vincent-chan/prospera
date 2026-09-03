import { describe, expect, it } from "vitest";
import { parseGuideDate, parseNihGuide } from "./parse";

const row = (label: string, value: string, code = "KD") =>
  `<div class="row"><div class="col-md-4 datalabel" data-section-code="${code}"><a id="x"></a>${label}</div><div class=" col-md-8 datacolumn">${value}</div></div>`;

const HTML = `<html><head><title>Expired RFA-XX-25-001: Example Notice (R01 Clinical Trial Not Allowed) - NIH</title></head><body>
${row("Activity Code", "R01 Research Project Grant", "OI")}
${row("Reissue of", "RFA-XX-24-004", "OI")}
${row("Companion Funding Opportunity", "RFA-XX-25-002 , U01 Research Project", "OI")}
${row("Clinical Trial?", "Not Allowed: Only accepting applications that do not propose clinical trials.", "OI")}
<h2>Key Dates</h2>
${row("Posted Date", "September 24, 2024")}
${row("Open Date (Earliest Submission Date)", "May 02, 2025")}
${row("Letter of Intent Due Date", "30 days prior to the application due date")}
<table>
 <tr><th>Application Due Dates</th><th colspan="3">Review and Award Cycles</th></tr>
 <tr><th>New</th><th>Renewal / Resubmission / Revision (as allowed)</th><th>AIDS - New/Renewal/Resubmission/Revision, as allowed</th><th>Scientific Merit Review</th><th>Advisory Council Review</th><th>Earliest Start Date</th></tr>
 <tr><td>June 02, 2025</td><td>Not Applicable</td><td>Not Applicable</td><td>November 2025</td><td>January 2026</td><td>April 2026</td></tr>
 <tr><td>January 20, 2026 *</td><td>January 20, 2026</td><td>Not Applicable</td><td>July 2026</td><td>October 2026</td><td>December 2026</td></tr>
</table>
${row("Expiration Date", "New Date June 16, 2026 per issuance of NOT-XX-26-005 . (Original Expiration Date: January 21, 2026 )")}
${row("Related Notices", "February 13, 2026 - Notice of Change to Key Dates. See Notice NOT-XX-26-005 . March 31, 2025 - This funding opportunity was updated.", "OI")}
<p>Dates in bold and italics reflect changes per NOT-XX-26-005</p>
</body></html>`;

describe("parseGuideDate", () => {
  it("handles month names, asterisks and Not Applicable", () => {
    expect(parseGuideDate("June 02, 2025 *")).toBe("2025-06-02");
    expect(parseGuideDate("Not Applicable")).toBeNull();
    expect(parseGuideDate("Sept 7, 2026")).toBe("2026-09-07");
  });
});

describe("parseNihGuide", () => {
  const p = parseNihGuide(HTML);
  it("reads header facts", () => {
    expect(p.title).toBe("RFA-XX-25-001: Example Notice (R01 Clinical Trial Not Allowed)");
    expect(p.expired).toBe(true);
    expect(p.activityCode).toBe("R01");
    expect(p.activityTitle).toBe("Research Project Grant");
    expect(p.reissueOf).toBe("RFA-XX-24-004");
    expect(p.companionOf).toBe("RFA-XX-25-002");
    expect(p.clinicalTrial).toBe("not_allowed");
  });
  it("reads key dates and cycles", () => {
    expect(p.postedDate).toBe("2024-09-24");
    expect(p.openDate).toBe("2025-05-02");
    expect(p.loiDue).toBeNull();
    expect(p.loiNote).toMatch(/30 days prior/);
    expect(p.expirationDate).toBe("2026-06-16");
    expect(p.originalExpirationDate).toBe("2026-01-21");
    expect(p.earliestStart).toBe("April 2026");
    expect(p.cycles).toEqual([
      { due: "2025-06-02", kind: "new", review: "November 2025", council: "January 2026", start: "April 2026" },
      { due: "2026-01-20", kind: "new", review: "July 2026", council: "October 2026", start: "December 2026" },
      { due: "2026-01-20", kind: "renewal", review: "July 2026", council: "October 2026", start: "December 2026" },
    ]);
    expect(p.standardDatesApply).toBe(false);
  });
  it("reads related notices and the change note", () => {
    expect(p.relatedNotices.map((n) => n.number)).toEqual(["NOT-XX-26-005", null]);
    expect(p.relatedNotices[0]?.date).toBe("2026-02-13");
    expect(p.lastChangeNote).toBe("Key dates changed per NOT-XX-26-005");
  });
});

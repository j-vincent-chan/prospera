import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockText,
  guideHtmlHash,
  isPlainGuideLayout,
  parseClinicalTrialDesignation,
  parseGuideDate,
  parseGuideSections,
  parseNihGuide,
  parseProgramDivision,
} from "./parse";

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

const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

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

describe("reissue lineage (IC segment optional)", () => {
  it("captures a PAR predecessor: Reissue of PAR-22-181", () => {
    const html = `<html><body>${row("Announcement Type", "Reissue of PAR-22-181 <br>", "OI")}</body></html>`;
    expect(parseNihGuide(html).reissueOf).toBe("PAR-22-181");
  });
  it("captures PA, PAS and RFA predecessors, through tags and line breaks", () => {
    expect(parseNihGuide(`${row("Announcement Type", "Reissue of\n\t<a href='#'>PA-20-184</a>", "OI")}`).reissueOf).toBe("PA-20-184");
    expect(parseNihGuide(`${row("Announcement Type", "Reissue of PAS-24-010", "OI")}`).reissueOf).toBe("PAS-24-010");
    expect(parseNihGuide(`${row("Announcement Type", "Reissue of RFA-CA-24-018", "OI")}`).reissueOf).toBe("RFA-CA-24-018");
    expect(parseNihGuide(`${row("Announcement Type", "New", "OI")}`).reissueOf).toBeNull();
  });
  it("captures a PAR companion", () => {
    expect(parseNihGuide(`${row("Companion Funding Opportunity", "PAR-23-287 , K99/R00 Clinical Trial Required", "OI")}`).companionOf).toBe("PAR-23-287");
  });
});

describe("blockText", () => {
  it("keeps one line per paragraph, list item and <br>, drops inline tags without a gap, decodes entities", () => {
    const html = `<p>National Institute (<a href="x">NIAID</a>)</p>\n<p>Second&nbsp;line<br>third &#147;quoted&#148; &amp; more</p><ul><li><p>Item one</p></li><li>Item two</li></ul>`;
    expect(blockText(html)).toBe('National Institute (NIAID)\nSecond line\nthird "quoted" & more\n- Item one\n- Item two');
  });
});

describe("Simpler attachment fixture · PAR-27-064 (PAR, Clinical Trial Required, reissue of a PAR)", () => {
  const html = fixture("PAR-27-064-Full-Announcement.html");
  const parsed = parseNihGuide(html);
  const sections = parseGuideSections(html);
  const headings = sections.map((s) => `${s.section}|${s.heading}`);

  it("parses Key Dates and the PAR lineage unchanged", () => {
    expect(parsed.activityCode).toBe("U01");
    expect(parsed.cycles.length).toBe(18);
    expect(parsed.reissueOf).toBe("PAR-24-100");
    expect(parsed.expirationDate).toBe("2029-07-06");
  });
  it("sections Part 1 and Section I with its sub-headings verbatim", () => {
    expect(headings).toContain("overview|Funding Opportunity Purpose");
    expect(headings).toContain("overview|Announcement Type");
    expect(sections.find((s) => s.heading === "Announcement Type")?.text).toBe("Reissue of PAR-24-100");
    expect(sections.find((s) => s.heading === "Components of Participating Organizations")?.text).toBe("National Institute of Allergy and Infectious Diseases (NIAID)");
    expect(headings).toContain("I|Background");
    expect(headings).toContain("I|Scope");
    expect(headings).toContain("I|Applications Not Responsive to This NOFO");
    const nonResponsive = sections.find((s) => s.heading === "Applications Not Responsive to This NOFO")!;
    expect(nonResponsive.part).toBe(2);
    expect(nonResponsive.text).toMatch(/^The following types of applications are not responsive/);
    expect(nonResponsive.text).toMatch(/\n- Clinical trials that fall outside the mission/);
  });
  it("keeps Section II rows, III.3, the Section IV human-subjects item and Section VII contacts", () => {
    expect(sections.find((s) => s.section === "II" && s.heading === "Clinical Trial?")?.text).toBe("Required: Only accepting applications that propose clinical trial(s).");
    expect(headings).toContain("III.1|Eligible Individuals (Program Director/Principal Investigator)");
    expect(headings).toContain("III.3|Number of Applications");
    expect(headings).toContain("IV.2|PHS Human Subjects and Clinical Trials Information");
    expect(sections.find((s) => s.heading === "PHS Human Subjects and Clinical Trials Information")?.text).toMatch(/2\.7 Study Timeline/);
    expect(headings).toContain("VII|Scientific/Research Contact(s)");
    expect(headings).not.toContain("VII|Financial/Grants Management Contact(s)");
    expect(headings.some((h) => h.startsWith("V|") || h.startsWith("VI|") || h.startsWith("VIII|"))).toBe(false);
    expect(headings.some((h) => /Page Limitations|SF424\(R&R\) Cover|Eligible Organizations/.test(h))).toBe(false);
  });
  it("strips boilerplate lines", () => {
    const all = sections.map((s) => s.text).join("\n");
    expect(all).not.toMatch(/See Section VIII\. Other Information for award authorities/);
    expect(all).not.toMatch(/Research Methods Resources website/);
  });
  it("designation from the title; no division when the contact is only the IC", () => {
    expect(parseClinicalTrialDesignation(parsed.title, html)).toBe("required");
    expect(parseProgramDivision(sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n"))).toBeNull();
  });
});

describe("Simpler attachment fixture · RFA-CA-27-020 (RFA, Clinical Trial Optional, reissue of an RFA)", () => {
  const html = fixture("RFA-CA-27-020-Full-Announcement.html");
  const parsed = parseNihGuide(html);
  const sections = parseGuideSections(html);
  const sectionVII = sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n");

  it("parses header facts", () => {
    expect(parsed.activityCode).toBe("U24");
    expect(parsed.reissueOf).toBe("RFA-CA-24-018");
    expect(parsed.companionOf).toBe("RFA-CA-27-019");
    expect(parsed.cycles.length).toBe(4);
  });
  it("splits Section I on bold-paragraph sub-headings", () => {
    const s1 = sections.filter((s) => s.section === "I").map((s) => s.heading);
    expect(s1).toEqual(["The ITCR Program", "Specific Research Objectives and Scope of this NOFO", "Responsive Technologies and Scientific Scope", "Applications Not Responsive to this NOFO"]);
  });
  it("reads the designation from the title and the division from the scientific contact", () => {
    expect(parseClinicalTrialDesignation(parsed.title, html)).toBe("optional");
    expect(parseProgramDivision(sectionVII)).toBe("Center for Strategic Scientific Initiatives (CSSI)");
  });
  it("keeps Award Budget and Funds Available rows", () => {
    expect(sections.find((s) => s.heading === "Funds Available and Anticipated Number of Awards")?.text).toMatch(/\$2,600,000/);
  });
});

describe("classic Guide fixture · PA-25-303 (parent R01, Basic Experimental Studies with Humans Required)", () => {
  const html = fixture("PA-25-303.html");
  const parsed = parseNihGuide(html);
  const sections = parseGuideSections(html);

  it("is BESH from the title and from the Clinical Trial? row alike", () => {
    expect(parseClinicalTrialDesignation(parsed.title, html)).toBe("besh_required");
    expect(parseClinicalTrialDesignation(null, html)).toBe("besh_required");
    expect(parseClinicalTrialDesignation("Some title without a suffix", html)).toBe("besh_required");
    expect(sections.find((s) => s.heading === "Clinical Trial?")?.text).toMatch(/^Required:Basic Experimental Studies with Humans/);
  });
  it("keeps a Section I without sub-headings under the section heading verbatim", () => {
    const s1 = sections.filter((s) => s.section === "I");
    expect(s1.length).toBe(1);
    expect(s1[0]!.heading).toBe("Section I. Notice of Funding Opportunity Description");
    expect(s1[0]!.text).toMatch(/basic science experimental studies involving humans/);
  });
  it("lists every participating IC and returns no division for a parent notice", () => {
    const components = sections.find((s) => s.heading === "Components of Participating Organizations")!.text;
    expect(components.split("\n").length).toBeGreaterThan(15);
    expect(components).toMatch(/National Eye Institute \(NEI\)/);
    expect(parseProgramDivision(sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n"))).toBeNull();
  });
  it("still reads the expired title and 27 cycles", () => {
    expect(parsed.expired).toBe(true);
    expect(parsed.cycles.length).toBe(27);
    expect(parsed.reissueOf).toBe("PA-20-184");
  });
});

describe("plain-text Guide fixture · PAR-27-026 (no headings at all)", () => {
  const html = fixture("PAR-27-026.html");
  const sections = parseGuideSections(html);
  it("is recognised as the plain layout; the styled pages are not", () => {
    expect(isPlainGuideLayout(html)).toBe(true);
    expect(isPlainGuideLayout(fixture("PA-25-303.html"))).toBe(false);
    expect(isPlainGuideLayout(fixture("PAR-27-064-Full-Announcement.html"))).toBe(false);
  });
  it("falls back to section-level text anchored on the template phrases", () => {
    const keys = [...new Set(sections.map((s) => s.section))];
    expect(keys).toEqual(expect.arrayContaining(["I", "II", "III", "IV", "VII"]));
    expect(sections.find((s) => s.section === "I")?.text).toMatch(/Avant-Garde and Avenir Awards Program/);
    expect(sections.find((s) => s.heading === "Clinical Trial?")?.text).toMatch(/^Optional/);
    expect(sections.find((s) => s.heading === "Scientific/Research Contact(s)")?.text).toMatch(/NIDA/);
  });
  it("reads the designation from the title and finds no division", () => {
    expect(parseClinicalTrialDesignation(parseNihGuide(html).title, html)).toBe("optional");
    expect(parseProgramDivision(sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n"))).toBeNull();
    expect(parseNihGuide(html).reissueOf).toBe("PAR-23-125");
  });
});

describe("parseClinicalTrialDesignation", () => {
  it("prefers the title suffix over Section II", () => {
    const html = row("Clinical Trial?", "Optional: Accepting applications that either propose or do not propose clinical trial(s).", "AI");
    expect(parseClinicalTrialDesignation("X (R01 Clinical Trial Not Allowed)", html)).toBe("not_allowed");
    expect(parseClinicalTrialDesignation("X (U01 Clinical Trials Required)", html)).toBe("required");
    expect(parseClinicalTrialDesignation("X (Clinical Trial(s) Optional)", "")).toBe("optional");
    expect(parseClinicalTrialDesignation("X (R01 Basic Experimental Studies with Humans Required)", html)).toBe("besh_required");
    expect(parseClinicalTrialDesignation("X with no suffix", html)).toBe("optional");
    expect(parseClinicalTrialDesignation("X with no suffix", "<p>nothing here</p>")).toBe("unknown");
  });
});

describe("parseProgramDivision", () => {
  it("returns the unit line under the scientific contact and skips people, phones and the IC", () => {
    const vii = [
      "Scientific/Research Contact(s)",
      "Jane Q. Example, Ph.D.",
      "Division of Cancer Control and Population Sciences (DCCPS)",
      "National Cancer Institute (NCI)",
      "Telephone: 240-276-0000",
      "Email: example@nih.gov",
      "Peer Review Contact(s)",
      "Office of Referral, Review, and Program Coordination",
    ].join("\n");
    expect(parseProgramDivision(vii)).toBe("Division of Cancer Control and Population Sciences (DCCPS)");
  });
  it("ignores job titles and returns null when only the IC is listed", () => {
    expect(parseProgramDivision("Scientific/Research Contact(s)\nProgram Officer\nNational Institute on Aging (NIA)\nEmail: x@nih.gov")).toBeNull();
    expect(parseProgramDivision("")).toBeNull();
    expect(parseProgramDivision(null)).toBeNull();
  });
  it("accepts HTML input", () => {
    expect(parseProgramDivision("<div class=\"heading4\">Scientific/Research Contact(s)</div><p>A. Person, M.D.<br>Epidemiology Branch<br>National Heart, Lung, and Blood Institute (NHLBI)</p>")).toBe("Epidemiology Branch");
  });
});

describe("guideHtmlHash", () => {
  const html = fixture("RFA-CA-27-020-Full-Announcement.html");
  it("is stable across comments, scripts, styles and attribute changes but not text changes", () => {
    const a = guideHtmlHash(html);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const cosmetic = `<!-- Changed ON 09/05/2026 --><script>var x = ${Date.now()};</script><style>.a{}</style>${html.replace(/class="row"/g, 'class="row extra"')}`;
    expect(guideHtmlHash(cosmetic)).toBe(a);
    expect(guideHtmlHash(html.replace("Advanced Development of Informatics Technologies", "Advanced Development of Informatics Technology"))).not.toBe(a);
  });
});

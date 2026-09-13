import { describe, expect, it } from "vitest";
import { fmtEmailDate, footerNote, PREVIEW_ASSETS, renderOutreachEmail, responseLinksText, type OutreachEmailInput } from "@/lib/email/outreach-email-html";

const base: OutreachEmailInput = {
  subject: "Funding opportunity: Pilot Projects Investigating Understudied Proteins in Rare Diseases — due Oct 16",
  preheader: "Your 2025 paper is close to what this notice is asking for.",
  greeting: "Dear Dr. Wiita,",
  relevant: "NIH has posted PAR-25-122 — Pilot Projects Investigating Understudied Proteins in Rare Diseases — due Oct 16. Awards run to $100K direct per year for up to 2 years.",
  whyYou: "Your 2025 paper “Pathway assignment for 84 minimally annotated kinases” is close to what this notice is asking for — worth a conversation before you commit anything.",
  know: "Worth knowing before you decide: no clinical trial; internal routing Oct 9. I can handle the internal routing.",
  next: "If you would like to pursue it, reply here and I will set up a 20-minute scoping call.",
  card: {
    sponsor: "National Institutes of Health",
    mechanism: "R03",
    number: "PAR-25-122",
    title: "Pilot Projects Investigating Understudied Proteins in Rare Diseases",
    summary: "It funds the preliminary work that makes a poorly characterized protein studyable.",
    dueDate: "2026-10-16",
    awardLine: "$100,000 direct / year · 2 years",
    url: "https://grants.nih.gov/grants/guide/pa-files/PAR-25-122.html",
  },
  sender: { name: "Vincent Chan", title: "Research Development Strategist", email: "vincent.chan@ucsf.edu" },
  community: "ImmunoX",
  urls: { interested: "https://prospera.example/r/abc?a=interested", pass: "https://prospera.example/r/abc?a=pass" },
  assets: PREVIEW_ASSETS,
};

describe("renderOutreachEmail", () => {
  it("carries every beat, the card facts and both response links", () => {
    const html = renderOutreachEmail(base);
    expect(html).toContain("Dear Dr. Wiita,");
    expect(html).toContain("NIH has posted PAR-25-122");
    expect(html).toContain("worth a conversation before you commit anything");
    expect(html).toContain("Worth knowing before you decide");
    expect(html).toContain("20-minute scoping call");
    expect(html).toContain("National Institutes of Health · R03");
    expect(html).toContain("Friday, October 16, 2026");
    expect(html).toContain("$100,000 direct / year · 2 years");
    expect(html).toContain('href="https://prospera.example/r/abc?a=interested"');
    expect(html).toContain('href="https://prospera.example/r/abc?a=pass"');
    expect(html).toContain('href="mailto:vincent.chan@ucsf.edu"');
    expect(html).toContain("/brand/ocr-mark.png");
    expect(html).toContain("Vincent Chan is the research development strategist for ImmunoX.");
  });

  it("escapes what the strategist typed", () => {
    const html = renderOutreachEmail({ ...base, whyYou: 'Your work on <script>alert("x")</script> & co.' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co.");
  });

  it("omits the rows it has nothing for", () => {
    const html = renderOutreachEmail({ ...base, know: null, card: { ...base.card, summary: null, dueDate: null, awardLine: null, url: null }, sender: { ...base.sender, title: null, email: null } });
    expect(html).not.toContain("Application deadline");
    expect(html).not.toContain("Award</td>");
    expect(html).not.toContain("View full funding announcement");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("Worth knowing");
    expect(html).toContain("UCSF Office of Collaborative Research");
  });

  it("is 600px wide for Outlook and fluid below that for everyone else", () => {
    const html = renderOutreachEmail(base);
    expect(html).toContain('width="600" style="width:100%;max-width:600px;');
    expect(html).toContain(".btn{width:100%!important}");
    expect(html).toContain(".stack{display:block!important;width:100%!important;");
  });

  it("splits blank-line paragraphs", () => {
    const html = renderOutreachEmail({ ...base, relevant: "First.\n\nSecond." });
    expect(html).toContain('<p style="margin:0px 0 0;">First.</p><p style="margin:12px 0 0;">Second.</p>');
  });
});

describe("helpers", () => {
  it("formats the deadline the way the design does", () => {
    expect(fmtEmailDate("2026-10-16")).toBe("Friday, October 16, 2026");
    expect(fmtEmailDate("not a date")).toBe("not a date");
  });
  it("names the community in the footer, or none", () => {
    expect(footerNote("Vincent Chan", "Diabetes Center")).toBe("You are receiving this because Vincent Chan is the research development strategist for Diabetes Center. Reply and say so if you would like fewer of these.");
    expect(footerNote("Vincent Chan", null)).toBe("You are receiving this because Vincent Chan is your research development strategist. Reply and say so if you would like fewer of these.");
    expect(footerNote("Vincent Chan", "  ")).toContain("is your research development strategist.");
  });
  it("writes the plain-text ask with both links", () => {
    const t = responseLinksText(base.urls);
    expect(t).toContain("Interested in exploring this?");
    expect(t).toContain("I’m interested: https://prospera.example/r/abc?a=interested");
    expect(t).toContain("Not this time: https://prospera.example/r/abc?a=pass");
  });
});

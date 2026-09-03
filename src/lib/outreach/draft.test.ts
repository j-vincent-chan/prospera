import { describe, expect, it } from "vitest";
import { buildBody, buildSubject, hookFromReasons, renderForRecipient } from "./draft";

const notice = { title: "Mechanisms of Immune Regulation in Autoimmune Disease (R01 Clinical Trial Not Allowed)", opportunityNumber: "PAR-26-114", agency: "NIH", activityCode: "R01", clinicalTrialNote: "Clinical Trial Not Allowed", dueDate: "2026-09-25", awardCeiling: 500_000, projectYears: 5, multiPi: true, routingDate: "2026-09-18" };
const sender = { name: "Sarah Whitfield", title: "Research Development Strategist", signature: null };

describe("draft", () => {
  it("builds the subject and body from the notice brief", () => {
    expect(buildSubject(notice)).toBe("Funding opportunity: Mechanisms of Immune Regulation in Autoimmune Disease (R01) — due Sep 25");
    const body = buildBody(notice, sender, "personalized");
    expect(body).toContain("Dear Dr. {last name},");
    expect(body).toContain("NIH has posted PAR-26-114, Mechanisms of Immune Regulation in Autoimmune Disease (R01, clinical trial not allowed), due Sep 25, 2026. Budgets run to $500K direct per year for up to 5 years, and multi-PI applications are welcome.");
    expect(body).toContain("[Personal line for each recipient]");
    expect(body).toContain("handle the internal routing (OSR date Sep 18, 2026)");
    expect(body.endsWith("Sarah Whitfield\nResearch Development Strategist · Office of Collaborative Research")).toBe(true);
  });

  it("renders per recipient", () => {
    const r = renderForRecipient({ subject: buildSubject(notice), body: buildBody(notice, sender, "personalized"), lastName: "Park", personalLine: "Your spatial atlas is close to what this notice is asking for." });
    expect(r.body).toContain("Dear Dr. Park,");
    expect(r.body).toContain("Your spatial atlas is close to what this notice is asking for.");
    expect(r.body).not.toContain("[Personal line");
  });

  it("derives a hook from the strongest reason", () => {
    expect(hookFromReasons([{ text: "“Spatial atlas of tissue-resident T cells in psoriatic skin” (Sci Immunol, 2025) matches the topic facet.", source: "PubMed · 2025", title: "", evidenceIds: [] }], {})).toBe("Your work on “Spatial atlas of tissue-resident T cells in psoriatic skin” is close to what this notice is asking for.");
    expect(hookFromReasons([], { contactedAt: "2026-08-26T00:00:00Z", routingDate: "2026-09-18" })).toBe("Following up on my note from Aug 26; the internal routing date is Sep 18.");
  });
});

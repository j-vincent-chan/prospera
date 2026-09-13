/** Message — Draft outreach: the four beats, composed from the notice and the match (`lib/outreach/beats.ts`). Pure; dates through a fixed `today`. */
import { describe, expect, it } from "vitest";
import { assembleBody, composeBeats, evidenceBeat, knowBeat, relevantBeat, sharpBeat, shortTitleOf, subjectOf, yearOf, DEFAULT_CLOSING_LINE, type BeatNotice } from "@/lib/outreach/beats";
import { DEFAULT_PERSONAL_LINE, renderForRecipient } from "@/lib/outreach/draft";

const TODAY = "2026-09-13";
const notice: BeatNotice = {
  sponsor: "NIH",
  number: "PAR-26-114",
  shortTitle: "Mechanisms of Immune Regulation in Autoimmune Disease",
  dueDate: "2026-10-16",
  ceilingPerYear: 500_000,
  periodYears: 5,
  awardSection: "Part 2 · Section II",
  limited: true,
  cap: 1,
  consortiumRequired: false,
  requiredPartners: [],
  clinicalTrial: "not_allowed",
  humanMaterialsRequired: false,
  loiDue: null,
  routingDate: "2026-09-17",
  requiredApproaches: ["Molecular / cellular mechanistic", "Animal-model research"],
  population: "autoimmune disease",
};

describe("why it is relevant", () => {
  it("names the sponsor, number, title, due date and the award, with the Guide section", () => {
    expect(relevantBeat(notice, TODAY)).toEqual({ text: "NIH has posted PAR-26-114 — Mechanisms of Immune Regulation in Autoimmune Disease — due Oct 16. Awards run to $500k direct per year for up to 5 years.", source: "from the notice · Part 2 · Section II" });
  });
  it("says less when the notice records less", () => {
    expect(relevantBeat({ ...notice, ceilingPerYear: null, periodYears: null, awardSection: null }, TODAY)).toEqual({ text: "NIH has posted PAR-26-114 — Mechanisms of Immune Regulation in Autoimmune Disease — due Oct 16.", source: "from the notice · Key Dates" });
    expect(relevantBeat({ ...notice, ceilingPerYear: null, dueDate: null, awardSection: null }, TODAY).text).toBe("NIH has posted PAR-26-114 — Mechanisms of Immune Regulation in Autoimmune Disease. Projects run up to 5 years.");
  });
});

describe("why you", () => {
  it("writes the evidence-led line from the first cited item and names its source", () => {
    expect(evidenceBeat({ kind: "publication", title: "Spatial atlas of tissue-resident T cells in psoriatic skin", meta: "Sci Immunol · 2025", year: "2025" }, null, null, TODAY)).toEqual({ text: "Your 2025 paper “Spatial atlas of tissue-resident T cells in psoriatic skin” is close to what this notice is asking for — worth a conversation before you commit anything.", source: "from PubMed · Sci Immunol" });
    expect(evidenceBeat({ kind: "grant", title: "Regulatory T cells in tolerance", meta: "1R03AR082948-01 · NIAMS · 2023–2026", year: "2023" }, null, null, TODAY)).toEqual({ text: "Your award “Regulatory T cells in tolerance” (1R03AR082948-01) sits squarely in the scope here, and this notice would support a distinct next project.", source: "from NIH RePORTER · 1R03AR082948-01" });
  });
  it("says so when nothing is cited, instead of inventing a sentence", () => {
    expect(evidenceBeat(null, null, null, TODAY)).toEqual({ text: DEFAULT_PERSONAL_LINE, source: "no cited evidence — Prospera has not assessed this pair, so write this line yourself" });
  });
  it("a follow-up refers to the first note", () => {
    expect(evidenceBeat(null, "2026-09-01T10:00:00Z", "2026-09-17", TODAY).text).toBe("Following up on my note from Sep 1 — the internal routing date is Sep 17, in case it slipped past.");
    expect(sharpBeat(notice, "2026-09-01T10:00:00Z")).toBeNull();
  });
  it("the sharper line is what the notice requires, and only exists when the profile says it", () => {
    expect(sharpBeat(notice, null)!.text).toBe("This notice is written for molecular / cellular mechanistic or animal-model work in autoimmune disease, and that is where your work sits — the fit is closer than most on my list, and I would rather you heard it from me than found it later.");
    expect(sharpBeat({ ...notice, population: null }, null)!.text).toContain("animal-model work, and that");
    expect(sharpBeat({ ...notice, requiredApproaches: [] }, null)).toBeNull();
  });
});

describe("what to know", () => {
  it("lists the constraints, then the routing offer", () => {
    expect(knowBeat(notice, TODAY)).toEqual({ text: "Worth knowing before you decide: limited submission · 1 per institution; no clinical trial; internal routing Sep 17. I can handle the internal routing.", source: "from the notice and your team's routing rule" });
    expect(knowBeat({ ...notice, consortiumRequired: true, requiredPartners: ["A clinical site", "A data core"], loiDue: "2026-09-30", clinicalTrial: "required", humanMaterialsRequired: true }, TODAY).text).toContain("needs a consortium; needs a clinical site and a data core; a clinical trial is required; human materials or participants are required; letter of intent due Sep 30; internal routing Sep 17.");
  });
  it("says there is nothing unusual when there is nothing", () => {
    const plain = { ...notice, limited: false, cap: null, clinicalTrial: "optional" };
    expect(knowBeat(plain, TODAY)).toEqual({ text: "No unusual constraints on this one; internal routing Sep 17, and I can handle it.", source: "from the notice and your team's routing rule" });
    expect(knowBeat({ ...plain, routingDate: null }, TODAY)).toEqual({ text: "No unusual constraints on this one, and I can handle the internal routing.", source: "from the notice" });
  });
});

describe("next step, subject, body", () => {
  it("the closing line is the team's, else the default and it says so", () => {
    const b = composeBeats({ notice, evidence: null, contactedAt: null, closingLine: null, today: TODAY });
    expect(b.next).toEqual({ text: DEFAULT_CLOSING_LINE, source: "the default closing line · set your own in Team settings" });
    expect(composeBeats({ notice, evidence: null, contactedAt: null, closingLine: " Reply and we can talk. ", today: TODAY }).next).toEqual({ text: "Reply and we can talk.", source: "your standing template" });
  });
  it("subject and title", () => {
    expect(subjectOf(notice, TODAY)).toBe("Funding opportunity: Mechanisms of Immune Regulation in Autoimmune Disease — due Oct 16");
    expect(shortTitleOf("Nutrition Obesity Research Centers (NORCs) (P30 Clinical Trial Optional)")).toBe("Nutrition Obesity Research Centers (NORCs)");
    expect(shortTitleOf("BRAIN Initiative: Data Archives for the BRAIN Initiative")).toBe("BRAIN Initiative: Data Archives for the BRAIN Initiative");
    expect(yearOf("1R03AR082948-01 · NIAMS · 2023–2026")).toBe("2023");
    expect(yearOf(null)).toBeNull();
  });
  it("the assembled body renders per recipient through the existing send path", () => {
    const body = assembleBody({ relevant: "R.", know: "K.", next: "N." }, "Sarah Whitfield\nResearch Development");
    expect(body).toBe("Dear Dr. {last name},\n\nR.\n\n[Personal line for each recipient]\n\nK.\n\nN.\n\nBest,\nSarah Whitfield\nResearch Development");
    const r = renderForRecipient({ subject: "S", body, lastName: "Park", personalLine: "Your paper is close." });
    expect(r.body).toBe("Dear Dr. Park,\n\nR.\n\nYour paper is close.\n\nK.\n\nN.\n\nBest,\nSarah Whitfield\nResearch Development");
  });
});

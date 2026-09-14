/** Message — Draft outreach: the section chat's prompt, its reply parsing, and applying what changed (R37). */
import { describe, expect, it } from "vitest";
import {
  applyChanges,
  buildDraftChatMessages,
  changedLabels,
  cleanText,
  HISTORY_TURNS,
  MAX_SECTION_CHARS,
  MAX_SUBJECT_CHARS,
  parseDraftChatReply,
  renderTexts,
  SECTION_KEYS,
  SECTION_LABELS,
  systemPrompt,
  type ChatTexts,
  type DraftChatContext,
} from "@/lib/outreach/draft-chat";

const texts: ChatTexts = {
  subject: "Funding opportunity: Development of Candidate Medical Countermeasures — due Nov 9",
  relevant: "NIH has posted RFA-AI-27-014 — Development of Candidate Medical Countermeasures — due Nov 9. Awards run to $350K direct per year for up to 5 years.",
  whyYou: "This notice is written for animal-model work, and that is where your work sits.",
  know: "Worth knowing before you decide: no clinical trial; internal routing Nov 2. I can handle the internal routing.",
  next: "If you would like to pursue it, reply here and I will set up a 20-minute scoping call.",
};

const context: DraftChatContext = {
  recipient: { name: "Adrian Erlebacher", lastName: "Erlebacher", followUp: false, sharedWith: 2 },
  notice: { sponsor: "National Institutes of Health", mechanism: "U01 · cooperative agreement", number: "RFA-AI-27-014", title: "Development of Candidate Medical Countermeasures", dueDate: "2026-11-09", awardLine: "$350,000 direct / year · 5 years", summary: "Preclinical development of countermeasures." },
  sender: { name: "Vincent Chan", title: "Research Development Strategist" },
  whyYou: { evidence: "Your 2025 paper is close to what this notice is asking for.", sharp: "This notice is written for animal-model work, and that is where your work sits." },
};

describe("the sections", () => {
  it("are the four beats, in the email's order, with the page's labels", () => {
    expect(SECTION_KEYS).toEqual(["relevant", "whyYou", "know", "next"]);
    expect(SECTION_KEYS.map((k) => SECTION_LABELS[k])).toEqual(["Why it is relevant", "Why you", "What to know", "Next step"]);
    expect(changedLabels(["subject", "whyYou"])).toEqual(["the subject", "Why you"]);
  });
});

describe("the prompt", () => {
  it("names the facts, the focus and the shared sections", () => {
    const s = systemPrompt(context, "whyYou");
    expect(s).toContain("Dr. Adrian Erlebacher (surname Erlebacher)");
    expect(s).toContain("first message to them");
    expect(s).toContain("National Institutes of Health · U01 · cooperative agreement: RFA-AI-27-014 — Development of Candidate Medical Countermeasures. Due 2026-11-09. Award: $350,000 direct / year · 5 years.");
    expect(s).toContain("in its own words: Preclinical development of countermeasures.");
    expect(s).toContain("Vincent Chan, Research Development Strategist");
    expect(s).toContain('sharper — "This notice is written for animal-model work');
    expect(s).toContain("go to all 2 recipients on this notice");
    expect(s).toContain('looking at "Why you"');
    expect(s).toContain('"changes": {"subject"?: string');
  });

  it("says when there is no sharper line, one recipient, or a follow-up", () => {
    const s = systemPrompt({ ...context, recipient: { ...context.recipient, followUp: true, sharedWith: 1 }, whyYou: { evidence: "x", sharp: null }, notice: { ...context.notice, summary: null, sponsor: null, mechanism: null } }, "know");
    expect(s).toContain("follow-up to an earlier note");
    expect(s).toContain("No sharper line exists");
    expect(s).not.toContain("go to all");
    expect(s).not.toContain("in its own words");
    expect(s).toContain("- Notice: RFA-AI-27-014 — Development of Candidate Medical Countermeasures. Due 2026-11-09.");
    expect(s).toContain('looking at "What to know"');
  });

  it("renders the five texts, marking an empty one", () => {
    const r = renderTexts({ ...texts, know: "" });
    expect(r.startsWith(`Subject: ${texts.subject}\n\n[Why it is relevant]\n${texts.relevant}\n\n[Why you]\n`)).toBe(true);
    expect(r).toContain("[What to know]\n(empty)\n\n[Next step]");
    expect(r.endsWith(texts.next)).toBe(true);
  });

  it("builds system, the last exchanges, then the texts and the request", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i}` }));
    const m = buildDraftChatMessages({ context, texts, focus: "relevant", instruction: "  shorter  ", history: [...history, { role: "user", content: "   " }] });
    expect(m[0]!.role).toBe("system");
    expect(m).toHaveLength(1 + HISTORY_TURNS * 2 + 1);
    expect(m[1]!.content).toBe(`turn ${30 - HISTORY_TURNS * 2}`);
    const last = m[m.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toContain(renderTexts(texts));
    expect(last.content.endsWith("Request: shorter")).toBe(true);
  });
});

describe("cleaning a returned text", () => {
  it("drops a greeting and a sign-off the model put back", () => {
    expect(cleanText("relevant", "Dear Dr. Erlebacher,\n\nNIH has posted RFA-AI-27-014.\n\nBest,\nVincent Chan\nResearch Development")).toBe("NIH has posted RFA-AI-27-014.");
    expect(cleanText("next", "Reply here and I will set up a call.\n\nThanks")).toBe("Reply here and I will set up a call.");
    expect(cleanText("next", "Thank you for considering it; reply here.")).toBe("Thank you for considering it; reply here.");
  });

  it("keeps paragraphs, collapses runs of blank lines, and caps the length", () => {
    expect(cleanText("know", "One.\r\n\r\n\r\n\r\nTwo.")).toBe("One.\n\nTwo.");
    expect(cleanText("know", "x".repeat(MAX_SECTION_CHARS + 50))).toHaveLength(MAX_SECTION_CHARS);
  });

  it("puts a subject on one line and caps it", () => {
    expect(cleanText("subject", "  Funding\n opportunity:   RFA  ")).toBe("Funding opportunity: RFA");
    expect(cleanText("subject", "y".repeat(MAX_SUBJECT_CHARS + 10))).toHaveLength(MAX_SUBJECT_CHARS);
  });
});

describe("parsing the reply", () => {
  it("returns the reply and only the texts that changed", () => {
    const r = parseDraftChatReply(JSON.stringify({ reply: "Trimmed it.", changes: { whyYou: "Your work sits where this notice points.", relevant: texts.relevant, know: "  ", tone: "warm" } }), texts);
    expect(r).toEqual({ ok: true, reply: "Trimmed it.", changes: { whyYou: "Your work sits where this notice points." } });
  });

  it("does not count an echo with curlier quotes, a longer dash or more spaces as a change", () => {
    const echo = { ...texts, know: texts.know.replace("decide:", "decide:  ").replace("routing Nov", "routing  Nov"), next: texts.next.replace("20-minute", "20–minute"), whyYou: "This notice is written for animal-model work, and that is where your work sits." };
    const r = parseDraftChatReply(JSON.stringify({ reply: "Done.", changes: { ...echo, relevant: texts.relevant.replace(/—/g, "-"), subject: `“${texts.subject}”`.slice(1, -1) } }), texts);
    expect(r).toEqual({ ok: true, reply: "Done.", changes: {} });
  });

  it("accepts a fenced object and writes a reply when the model gave none", () => {
    const r = parseDraftChatReply("```json\n" + JSON.stringify({ changes: { subject: "Shorter subject", next: "Reply here and I will set up a call." } }) + "\n```", texts);
    expect(r.ok && r.reply).toBe("Rewrote the subject and Next step.");
    expect(r.ok && r.changes).toEqual({ subject: "Shorter subject", next: "Reply here and I will set up a call." });
  });

  it("treats a change-free reply as an answer, and a bare answer as one too", () => {
    expect(parseDraftChatReply(JSON.stringify({ reply: "The award is $350K direct per year.", changes: {} }), texts)).toEqual({ ok: true, reply: "The award is $350K direct per year.", changes: {} });
    expect(parseDraftChatReply(JSON.stringify({ changes: null }), texts)).toEqual({ ok: true, reply: "Nothing to change there.", changes: {} });
  });

  it("refuses what it cannot read, leaving the message alone", () => {
    expect(parseDraftChatReply("Sure! Here is a shorter version: ...", texts)).toEqual({ ok: false, error: "Prospera's answer could not be read; the message is unchanged." });
    expect(parseDraftChatReply("[1,2]", texts).ok).toBe(false);
  });
});

describe("applying changes", () => {
  it("returns the next texts, what each replaced, and the keys in section order", () => {
    const { next, before, changed } = applyChanges(texts, { next: "Reply here.", subject: "New subject", know: texts.know });
    expect(changed).toEqual(["subject", "next"]);
    expect(before).toEqual({ subject: texts.subject, next: texts.next });
    expect(next).toEqual({ ...texts, subject: "New subject", next: "Reply here." });
    expect(applyChanges(texts, {})).toEqual({ next: texts, before: {}, changed: [] });
  });
});

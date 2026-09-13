import { describe, expect, it } from "vitest";
import { isSendingIdentity, replyToFor, senderLabel, sendingNote } from "@/lib/outreach/sender";

describe("the sending identity", () => {
  it("names the sender the way the setting says", () => {
    expect(senderLabel({ identity: "strategist_via_prospera", senderName: "Vincent Chan", teamName: "OCR Research Development" })).toBe("Vincent Chan via Prospera");
    expect(senderLabel({ identity: "team_address", senderName: "Vincent Chan", teamName: "OCR Research Development" })).toBe("OCR Research Development");
    expect(senderLabel({ identity: null, senderName: "Vincent Chan", teamName: "OCR" })).toBe("Vincent Chan via Prospera");
    expect(senderLabel({ identity: "team_address", senderName: "Vincent Chan", teamName: "  " })).toBe("The team");
  });
  it("routes replies to the team address only under the team identity", () => {
    expect(replyToFor({ identity: "team_address", sendingAddress: "rd@ucsf.edu", replyToEmail: "inbox@ucsf.edu", senderEmail: "v@ucsf.edu" })).toBe("rd@ucsf.edu");
    expect(replyToFor({ identity: "team_address", sendingAddress: null, replyToEmail: "inbox@ucsf.edu", senderEmail: "v@ucsf.edu" })).toBe("inbox@ucsf.edu");
    expect(replyToFor({ identity: "strategist_via_prospera", sendingAddress: "rd@ucsf.edu", replyToEmail: "inbox@ucsf.edu", senderEmail: "v@ucsf.edu" })).toBe("inbox@ucsf.edu");
    expect(replyToFor({ identity: "strategist_via_prospera", sendingAddress: null, replyToEmail: null, senderEmail: "v@ucsf.edu" })).toBe("v@ucsf.edu");
    expect(replyToFor({ identity: "strategist_via_prospera", sendingAddress: null, replyToEmail: " ", senderEmail: null })).toBeNull();
  });
  it("the note and the guard", () => {
    expect(sendingNote({ label: "OCR Research Development", fromAddress: "alerts@x.org", replyTo: "rd@ucsf.edu" })).toBe("Sent individually as “OCR Research Development” from alerts@x.org; replies go to rd@ucsf.edu and are recorded here.");
    expect(sendingNote({ label: "V via Prospera", fromAddress: null, replyTo: null })).toBe("Sent individually as “V via Prospera”; replies go to your address and are recorded here.");
    expect(isSendingIdentity("team_address")).toBe(true);
    expect(isSendingIdentity("other")).toBe(false);
  });
});

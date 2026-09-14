/** Message — Draft outreach: the page's copy, and the class-table invariant the Review tables keep. */
import { describe, expect, it } from "vitest";
import * as view from "@/lib/outreach/draft-view";

describe("copy", () => {
  it("subline, send label, back link", () => {
    expect(view.draftSubline({ matches: 2, followUps: 0 })).toBe("2 confirmed matches · each message is assembled from the evidence behind the match, then edited by you");
    expect(view.draftSubline({ matches: 1, followUps: 1 })).toBe("1 confirmed match and 1 follow-up · each message is assembled from the evidence behind the match, then edited by you");
    expect(view.draftSubline({ matches: 0, followUps: 0 })).toMatch(/^Nothing to draft · /);
    expect(view.sendLabel(2)).toBe("Send 2 · individually");
    expect(view.backLabel("review")).toBe("← Back to review");
    expect(view.backHref("outreach")).toBe("/outreach");
  });

  it("recipient state and the toggle", () => {
    expect(view.recipientState({ selected: true, email: "a@ucsf.edu" })).toBe("Editing");
    expect(view.recipientState({ selected: false, email: "a@ucsf.edu" })).toBe("Draft ready");
    expect(view.recipientState({ selected: true, email: null })).toBe("No email on file");
    expect(view.toggleLabel("evidence")).toBe("Try a sharper line");
    expect(view.toggleLabel("sharp")).toBe("Use the evidence-led line");
    expect(view.sharedNote(1)).toBeNull();
    expect(view.sharedNote(2)).toBe("same for the 2 recipients on this notice");
  });

  it("the preview caption and the section chat", () => {
    expect(view.previewCaption("Adrian Erlebacher")).toBe("What Adrian Erlebacher receives · the two buttons are live in the sent message, inert here");
    expect(view.chatPlaceholder("Why you")).toBe("Ask for a change to “Why you”…");
    expect(view.changedNote([])).toBe("Nothing changed");
    expect(view.changedNote(["Why you"])).toBe("Rewrote Why you");
    expect(view.changedNote(["the subject", "Why you"])).toBe("Rewrote the subject and Why you");
    expect(view.changedNote(["Why you", "What to know", "Next step"])).toBe("Rewrote Why you, What to know and Next step");
    expect(view.CHAT_STARTERS.map((s) => s.label)).toEqual(["Shorter", "Warmer", "More direct"]);
    for (const s of view.CHAT_STARTERS) expect(s.ask).toMatch(/\.$/);
  });

  it("the stamp", () => {
    const now = Date.parse("2026-09-13T10:00:00Z");
    expect(view.stampText({ savedAt: null, dirty: false, now })).toBe("Not saved yet");
    expect(view.stampText({ savedAt: null, dirty: true, now })).toBe("Not saved yet");
    expect(view.stampText({ savedAt: "2026-09-13T09:59:50Z", dirty: false, now })).toBe("Draft saved · just now");
    expect(view.stampText({ savedAt: "2026-09-13T09:56:00Z", dirty: false, now })).toBe("Draft saved · 4 min ago");
    expect(view.stampText({ savedAt: "2026-09-13T09:56:00Z", dirty: true, now })).toBe("Unsaved changes");
  });
});

/** Every class string the module exports, including the ones inside records. */
function allStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(view)) {
    if (typeof value === "string" && /^[a-z[-]/.test(value) && value.includes(" ")) out.push([name, value]);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) if (typeof v === "string") out.push([`${name}.${k}`, v]);
  }
  return out;
}

/** The same model `review-view.test.ts` uses. */
function utilityGroup(cls: string): string | null {
  const SIZES = ["h1", "title", "body", "dense", "meta", "micro", "section", "label", "stat", "stat-lg"];
  const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
  if (cls.includes(":")) return null;
  if (cls.startsWith("text-")) {
    const rest = cls.slice(5);
    if (SIZES.includes(rest) || /^\[[\d.]+(?:px|rem|em)\]$/.test(rest)) return "font-size";
    if (["left", "center", "right", "justify", "start", "end", "balance", "pretty"].includes(rest)) return "text-align";
    return "color";
  }
  if (cls.startsWith("font-")) return WEIGHTS.includes(cls.slice(5)) ? "font-weight" : "font-family";
  if (cls === "border" || /^border-(?:[0-8]|\[[^\]]+\])$/.test(cls)) return "border-width";
  if (/^border-[trblxy](?:-|$)/.test(cls)) return `border-${cls.slice(7, 8)}`;
  if (cls.startsWith("border-")) return "border-color";
  if (cls.startsWith("bg-")) return "background";
  if (cls.startsWith("shadow")) return "shadow";
  if (cls.startsWith("rounded-")) {
    const m = cls.match(/^rounded-([trbl]|[tb][lr])(?:-|$)/);
    return m ? `rounded-${m[1]}` : "rounded";
  }
  for (const p of ["gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "p", "mx", "my", "mt", "mr", "mb", "ml", "m", "grid-cols", "min-w", "max-w", "w", "h", "rounded", "leading", "tracking", "top", "line-clamp"]) {
    if (cls === p || cls.startsWith(`${p}-`)) return p;
  }
  return null;
}

describe("no class string names one utility group twice", () => {
  const strings = allStrings();
  it("sees the class table", () => {
    expect(strings.length).toBeGreaterThan(20);
  });
  for (const [name, value] of strings) {
    it(name, () => {
      const seen = new Map<string, string>();
      for (const cls of value.split(/\s+/).filter(Boolean)) {
        const g = utilityGroup(cls);
        if (!g) continue;
        expect(seen.has(g), `${name}: "${cls}" repeats group "${g}" after "${seen.get(g)}"`).toBe(false);
        seen.set(g, cls);
      }
    });
  }
});

import { describe, expect, it } from "vitest";
import { cutAt, designationLabel, EXCERPT_MAX, purposeExcerpt } from "@/lib/fit/goldset/excerpt";

describe("goldset/excerpt", () => {
  it("prefers Part 1 Funding Opportunity Purpose, then a Section I purpose / description section, then the synopsis", () => {
    const sections = [
      { section: "overview", heading: "Announcement Type", text: "New" },
      { section: "I", heading: "Section I. Funding Opportunity Description", text: "  Section <b>one</b>   text " },
      { section: "overview", heading: "Funding Opportunity Purpose", text: "The purpose&nbsp;is X." },
    ];
    expect(purposeExcerpt(sections, "syn")).toEqual({ text: "The purpose is X.", source: "Part 1 · Funding Opportunity Purpose" });
    expect(purposeExcerpt(sections.slice(0, 2), "syn")).toEqual({ text: "Section one text", source: "Section I · Section I. Funding Opportunity Description" });
    expect(purposeExcerpt([{ section: "I", heading: "Applications Not Responsive", text: "no" }, { section: "I", heading: "Background", text: "bg" }], "syn")).toEqual({ text: "bg", source: "Section I · Background" });
    expect(purposeExcerpt(null, "<p>Synopsis</p> here")).toEqual({ text: "Synopsis here", source: "synopsis" });
    expect(purposeExcerpt([], "")).toEqual({ text: "", source: "none" });
  });

  it("cuts at the limit on a word boundary with an ellipsis", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const cut = cutAt(long);
    expect(cut.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.slice(0, -1)).not.toMatch(/\s$/);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cutAt("short")).toBe("short");
    expect(cutAt("a".repeat(700), 100).length).toBe(100);
  });

  it("labels designations", () => {
    expect(designationLabel("required")).toBe("Clinical Trial Required");
    expect(designationLabel("besh_required")).toBe("Basic Experimental Studies with Humans Required");
    expect(designationLabel(null)).toBe("unknown");
    expect(designationLabel("odd_value")).toBe("odd value");
  });
});

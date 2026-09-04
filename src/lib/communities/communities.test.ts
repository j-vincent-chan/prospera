import { describe, expect, it } from "vitest";
import { titlePhrases } from "./queries";

describe("titlePhrases", () => {
  it("prefers recurring two-word phrases and skips stopwords", () => {
    const titles = [
      "Tissue-resident regulatory T cells in cutaneous lupus",
      "Regulatory T cells control tissue immunity in psoriasis",
      "Single-cell atlas of regulatory T cells in the airway",
      "Immune regulation by regulatory T cells after checkpoint blockade",
      "The role of the microbiome in immune regulation",
      "Microbiome control of neutrophil priming in sepsis",
      "Microbiome signatures of immune regulation in IBD",
    ];
    const top = titlePhrases(titles, 4);
    expect(top.map(([p]) => p)).toContain("immune regulation");
    expect(top.map(([p]) => p)).toContain("regulatory");
    expect(top.every(([p]) => !/^(the|of|in)\b/.test(p))).toBe(true);
    expect(top.every(([, n]) => n >= 3)).toBe(true);
  });
  it("returns nothing for too few titles", () => {
    expect(titlePhrases(["One paper only"], 4)).toEqual([]);
  });
});

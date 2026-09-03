import { describe, expect, it } from "vitest";
import { normalizeOrcid, parseOrcidWorks, pickConfidentOrcid } from "./client";

describe("ORCID connector", () => {
  it("normalizes and checksums iDs", () => {
    expect(normalizeOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000000218250097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000-0002-1825-0098")).toBeNull();
    expect(normalizeOrcid("not an id")).toBeNull();
  });

  it("parses work groups with PMIDs and DOIs", () => {
    const works = parseOrcidWorks({
      group: [
        {
          "external-ids": { "external-id": [{ "external-id-type": "doi", "external-id-value": "10.5555/12345680" }, { "external-id-type": "pmid", "external-id-value": "12345" }] },
          "work-summary": [{ "put-code": 1, title: { title: { value: "A Methodology" } }, type: "journal-article", "publication-date": { year: { value: "2012" } }, "journal-title": { value: "J" } }],
        },
      ],
    });
    expect(works).toEqual([{ putCode: 1, title: "A Methodology", type: "journal-article", year: 2012, journal: "J", pmid: "12345", doi: "10.5555/12345680" }]);
  });

  it("only trusts a single UCSF-affiliated hit", () => {
    const a = { orcid: "0000-0002-2632-1465", givenNames: "Katerina", familyName: "Akassoglou", institutions: ["University of California, San Francisco"] };
    const b = { ...a, orcid: "0000-0002-1825-0097", institutions: ["Brown University"] };
    expect(pickConfidentOrcid([a, b])?.orcid).toBe(a.orcid);
    expect(pickConfidentOrcid([b])).toBeNull();
    expect(pickConfidentOrcid([a, { ...a, orcid: "0000-0001-5109-3700" }])).toBeNull();
  });
});

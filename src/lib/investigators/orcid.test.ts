import { describe, expect, it } from "vitest";
import { normalizeOrcid, orcidChecksumOk, orcidUrl, parseOrcid } from "@/lib/investigators/orcid";

// 0000-0002-1825-0097 is ORCID's own documentation example; 0000-0002-1694-233X
// (Josiah Carberry) ends in the X check character; 0000-0002-1762-1677 is the
// one iD on the NOFO pilot sheet.

describe("parseOrcid", () => {
  it("accepts the canonical, URL and unhyphenated forms and normalizes them", () => {
    for (const input of [
      "0000-0002-1825-0097",
      " 0000-0002-1825-0097 ",
      "https://orcid.org/0000-0002-1825-0097",
      "http://orcid.org/0000-0002-1825-0097",
      "orcid.org/0000-0002-1825-0097/",
      "ORCID: 0000-0002-1825-0097",
      "0000000218250097",
    ]) {
      expect(parseOrcid(input), input).toEqual({ ok: true, orcid: "0000-0002-1825-0097" });
    }
  });

  it("accepts an X check character, in either case", () => {
    expect(parseOrcid("0000-0002-1694-233X")).toEqual({ ok: true, orcid: "0000-0002-1694-233X" });
    expect(parseOrcid("0000-0002-1694-233x")).toEqual({ ok: true, orcid: "0000-0002-1694-233X" });
    expect(parseOrcid("000000021694233x")).toEqual({ ok: true, orcid: "0000-0002-1694-233X" });
  });

  it("accepts the pilot sheet's iD", () => {
    expect(parseOrcid("0000-0002-1762-1677")).toEqual({ ok: true, orcid: "0000-0002-1762-1677" });
  });

  it("rejects a mistyped digit with the checksum reason", () => {
    expect(parseOrcid("0000-0002-1825-0098")).toEqual({ ok: false, reason: "checksum" });
    expect(parseOrcid("0000-0002-1825-0079")).toEqual({ ok: false, reason: "checksum" });
    expect(parseOrcid("https://orcid.org/0000-0002-1694-2330")).toEqual({ ok: false, reason: "checksum" });
  });

  it("rejects malformed input with the format reason", () => {
    for (const input of ["not an id", "0000-0002-1825", "0000-0002-1825-00971", "10000-0002-1825-0097", "0000 0002 1825 0097", "12345"]) {
      expect(parseOrcid(input), input).toEqual({ ok: false, reason: "format" });
    }
  });

  it("treats blank input as empty, not invalid", () => {
    for (const input of ["", "   ", null, undefined]) expect(parseOrcid(input)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("normalizeOrcid", () => {
  it("returns the canonical iD or null", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000-0002-1825-0098")).toBeNull();
    expect(normalizeOrcid("")).toBeNull();
    expect(normalizeOrcid(null)).toBeNull();
  });
});

describe("orcidChecksumOk", () => {
  it("implements ISO 7064 MOD 11-2 over the 15 leading digits", () => {
    expect(orcidChecksumOk("0000-0002-1825-0097")).toBe(true);
    expect(orcidChecksumOk("0000000218250097")).toBe(true);
    expect(orcidChecksumOk("0000-0002-1694-233X")).toBe(true);
    expect(orcidChecksumOk("0000-0002-1825-0096")).toBe(false);
  });

  it("is false for anything that is not 16 characters", () => {
    expect(orcidChecksumOk("0000-0002-1825")).toBe(false);
    expect(orcidChecksumOk("")).toBe(false);
  });
});

describe("orcidUrl", () => {
  it("builds the public record URL", () => {
    expect(orcidUrl("0000-0002-1825-0097")).toBe("https://orcid.org/0000-0002-1825-0097");
  });
});

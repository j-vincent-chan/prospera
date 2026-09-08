/**
 * The shared entity table and its decoder. The announcement pipeline's own
 * policy — what `&nbsp;` and `&shy;` become in text bound for the extractor —
 * is held by `ingestion/announcement/announcement.test.ts`, next to the code
 * that decides it.
 */
import { describe, expect, it } from "vitest";
import { decodeEntityReferences, HTML_ENTITIES } from "@/lib/formatting/html-entities";

describe("HTML_ENTITIES", () => {
  it("is the HTML 4.01 sets plus apos, and every value is one character", () => {
    expect(Object.keys(HTML_ENTITIES)).toHaveLength(253);
    for (const [name, value] of Object.entries(HTML_ENTITIES)) {
      expect([...value], `&${name};`).toHaveLength(1);
    }
  });

  it("opens with Latin-1 as U+00A0 to U+00FF in order, which is how to check the block by eye", () => {
    const latin1 = Object.entries(HTML_ENTITIES).slice(0, 96);
    expect(latin1[0]).toEqual(["nbsp", "\u00a0"]);
    expect(latin1[95]).toEqual(["yuml", "ÿ"]);
    latin1.forEach(([name, value], i) => {
      expect(value.codePointAt(0), `&${name};`).toBe(0xa0 + i);
    });
  });

  it("carries the references that were surviving verbatim into announcement text", () => {
    expect(HTML_ENTITIES).toMatchObject({ sect: "§", reg: "®", deg: "°", trade: "™", shy: "\u00ad" });
  });
});

describe("decodeEntityReferences", () => {
  it("resolves named, decimal and hexadecimal references", () => {
    expect(decodeEntityReferences("25 U.S.C. &sect;&sect; 5130-5131")).toBe("25 U.S.C. §§ 5130-5131");
    expect(decodeEntityReferences("50&#37; effort &#x2014; at least")).toBe("50% effort — at least");
    expect(decodeEntityReferences("&#X41;&#x42;")).toBe("AB");
  });

  it("scans once, so an escaped reference stays the text it is", () => {
    // `&amp;` then `&sect;` in sequence would turn this into `§`, which is a
    // different document from the one the funder published.
    expect(decodeEntityReferences("&amp;sect;")).toBe("&sect;");
    expect(decodeEntityReferences("&amp;amp;")).toBe("&amp;");
  });

  it("requires the terminating semicolon, so R&D and AT&T survive", () => {
    expect(decodeEntityReferences("R&D and AT&T")).toBe("R&D and AT&T");
    expect(decodeEntityReferences("&sect 12")).toBe("&sect 12");
  });

  it("keeps case where it carries meaning and folds it where it cannot", () => {
    expect(decodeEntityReferences("&Alpha;&alpha;")).toBe("Αα");
    // `&NBSP;` decoded under the old `gi` tables and goes on decoding.
    expect(decodeEntityReferences("a&NBSP;b&MDASH;c")).toBe("a\u00a0b—c");
    // `&ALPHA;` folds to two entities, so it resolves to neither.
    expect(decodeEntityReferences("&ALPHA;")).toBe("&ALPHA;");
  });

  it("leaves a reference it cannot resolve exactly as written, and never invents a character", () => {
    expect(decodeEntityReferences("&notanentity; &#0; &#1114112; &#xD800;")).toBe("&notanentity; &#0; &#1114112; &#xD800;");
    // Names that would reach Object.prototype if the lookup were a bare index.
    expect(decodeEntityReferences("&constructor;&toString;&hasOwnProperty;")).toBe("&constructor;&toString;&hasOwnProperty;");
  });

  it("reads 0x80-0x9F as Windows-1252, not as the C1 controls those code points are", () => {
    // A curly quote written numerically. Decoded literally it is an invisible
    // control character that travels all the way into the extractor's prompt.
    expect(decodeEntityReferences("&#147;core facility&#148;")).toBe("“core facility”");
    expect(decodeEntityReferences("a&#150;b")).toBe("a–b");
  });

  it("takes overrides by the table's name for the reference, including through a case fold", () => {
    const overrides = { nbsp: " ", shy: "", rsquo: "'" };
    expect(decodeEntityReferences("a&nbsp;b", overrides)).toBe("a b");
    expect(decodeEntityReferences("a&NBSP;b", overrides)).toBe("a b");
    expect(decodeEntityReferences("inter&shy;disciplinary", overrides)).toBe("interdisciplinary");
    expect(decodeEntityReferences("the program&rsquo;s aim", overrides)).toBe("the program's aim");
    // An override is not consulted for a name it does not carry.
    expect(decodeEntityReferences("&sect;", overrides)).toBe("§");
  });
});

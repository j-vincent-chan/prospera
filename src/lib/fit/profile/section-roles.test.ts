/**
 * Section roles (PR 5.1) — a pure refactor, so the tests are about sameness.
 *
 * The load-bearing one is the round trip: `groupSections` must produce the same
 * three lists for the stored Guide HTML fixtures whether roles were stamped at
 * parse time or derived at read time, *including* the team cross-cut, where one
 * Section I section belongs to two groups at once. If those two paths ever
 * disagree, a re-parsed notice would route differently from a stored one and
 * every cached extraction under it would re-key.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupSections, sectionLabel, type NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { parseGuideSections } from "@/lib/ingestion/nih-guide/parse";
import { ROLE_GROUP, rolesForNihSection, SECTION_ROLES, withRoles, type SectionRole } from "@/lib/fit/profile/section-roles";

const FIXTURE_DIR = path.join("src", "lib", "ingestion", "nih-guide", "__fixtures__");
const FIXTURES = ["PA-25-303.html", "PAR-27-026.html", "PAR-27-064-Full-Announcement.html", "RFA-CA-27-020-Full-Announcement.html"];

/** The same sections with every `roles` key stripped — a row as PR 0.5 stored it. */
function stripRoles(sections: readonly NoticeSection[]): NoticeSection[] {
  return sections.map(({ part, section, heading, text }) => ({ part, section, heading, text }));
}

const shape = (groups: Record<1 | 2 | 3, NoticeSection[]>) =>
  ([1, 2, 3] as const).map((g) => groups[g].map((s) => `${s.part}|${s.section}|${s.heading}|${s.text.length}`));

describe("groupSections round trip", () => {
  for (const file of FIXTURES) {
    it(`${file}: stamped at parse time and derived at read time route identically`, () => {
      const stamped = parseGuideSections(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as NoticeSection[];
      expect(stamped.length, "fixture parsed to nothing").toBeGreaterThan(0);
      expect(stamped.every((s) => Array.isArray(s.roles) && s.roles.length), "parseGuideSections did not stamp roles").toBe(true);

      const legacy = stripRoles(stamped);
      expect(legacy.every((s) => s.roles === undefined)).toBe(true);

      expect(shape(groupSections(legacy))).toEqual(shape(groupSections(stamped)));
    });
  }

  it("keeps the team cross-cut: one Section I section lands in group 1 and group 3", () => {
    const sections: NoticeSection[] = [
      { part: 2, section: "I", heading: "Research Objectives", text: "objectives" },
      { part: 2, section: "I", heading: "Team and Collaboration", text: "team language" },
    ];
    const groups = groupSections(sections);
    expect(groups[1].map((s) => s.heading)).toEqual(["Research Objectives", "Team and Collaboration"]);
    expect(groups[3].map((s) => s.heading)).toEqual(["Team and Collaboration"]);
    expect(rolesForNihSection("I", "Team and Collaboration")).toEqual(["objectives", "team"]);
  });

  it("a non-responsive Section I heading with team language lands in group 2 and group 3, not group 1", () => {
    const sections: NoticeSection[] = [{ part: 2, section: "I", heading: "Non-Responsive Partnerships", text: "x" }];
    const groups = groupSections(sections);
    expect(groups[1]).toEqual([]);
    expect(groups[2]).toHaveLength(1);
    expect(groups[3]).toHaveLength(1);
  });

  /**
   * None of the four committed fixtures contains a Section I heading that
   * matches `TEAM_HEADING`, so the fixture round trip above does *not* exercise
   * the cross-cut, and on its own it proves less than it appears to. The cases
   * either side of this one carry that weight instead.
   *
   * The cross-cut is not hypothetical: measured over the 512 stored notices on
   * 2026-09-07, 54 (10.5%) have a Section I section resolving to
   * `["objectives","team"]` — "Research Education Program Structure",
   * "CTSA Program UM1 Hub Application Structure" and the like — and the round
   * trip held on 512 of 512. This test records the fixture gap so nobody reads
   * the round trip as covering more than it does; it does not fail if a future
   * fixture happens to close it.
   */
  it("records that the fixtures do not cover the cross-cut, so the synthetic cases carry it", () => {
    const covered = FIXTURES.filter((file) => {
      const sections = parseGuideSections(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as NoticeSection[];
      return sections.some((s) => (s.roles ?? []).length > 1);
    });
    expect(covered, "a fixture now covers the cross-cut — good, but the note above is stale").toEqual([]);
  });

  it("a cross-cut section round-trips: stripping roles and re-deriving gives both groups back", () => {
    const stamped: NoticeSection[] = withRoles([
      { part: 2, section: "I", heading: "Research Education Program Structure", text: "structure" },
      { part: 2, section: "II", heading: "Award Information", text: "award" },
    ]);
    expect(stamped[0]!.roles).toEqual(["objectives", "team"]);
    expect(shape(groupSections(stripRoles(stamped)))).toEqual(shape(groupSections(stamped)));
    expect(shape(groupSections(stamped))[0]).toHaveLength(1);
    expect(shape(groupSections(stamped))[2]).toHaveLength(1);
  });
});

describe("rolesForNihSection reproduces the roman-numeral routing", () => {
  const cases: Array<[string, string, 1 | 2, SectionRole[]]> = [
    ["synopsis", "Synopsis", 1, ["synopsis"]],
    ["overview", "Funding Opportunity Purpose", 1, ["purpose"]],
    ["overview", "Announcement Type", 1, ["other"]],
    ["I", "Research Objectives", 2, ["objectives"]],
    ["I", "Non-Responsive Research", 2, ["non_responsive"]],
    ["II", "Award Information", 2, ["award_info"]],
    ["III", "Eligibility Information", 2, ["eligibility"]],
    ["III.3", "Additional Information on Eligibility", 2, ["eligibility"]],
    ["IV.2", "Human Subjects Study Record", 2, ["human_subjects"]],
    ["IV.1", "Application Submission", 2, ["other"]],
    ["VII", "Agency Contacts", 2, ["contacts"]],
    ["V", "Application Review Information", 2, ["other"]],
  ];
  for (const [section, heading, part, expected] of cases) {
    it(`${part}·${section} "${heading}" → ${expected.join("+")}`, () => {
      expect(rolesForNihSection(section, heading, part)).toEqual(expected);
    });
  }

  it("Section V stays out of every group — it was never in KEPT_SECTIONS", () => {
    expect(ROLE_GROUP.review).toBeNull();
    expect(ROLE_GROUP.other).toBeNull();
  });

  it("every role has a group decision, so none is silently dropped by omission", () => {
    for (const role of SECTION_ROLES) expect(Object.hasOwn(ROLE_GROUP, role), `${role} missing from ROLE_GROUP`).toBe(true);
  });
});

describe("withRoles", () => {
  it("leaves roles a caller already supplied alone — that is how a non-NIH adapter routes", () => {
    const given: NoticeSection[] = [{ part: 2, section: "Program Description", heading: "Areas of Emphasis", text: "x", roles: ["objectives"] }];
    expect(withRoles(given)[0]!.roles).toEqual(["objectives"]);
    expect(groupSections(given)[1]).toHaveLength(1);
  });

  it("derives roles for a row stored before PR 5.1", () => {
    expect(withRoles([{ part: 2, section: "II", heading: "Award Information", text: "x" }])[0]!.roles).toEqual(["award_info"]);
  });
});

describe("sectionLabel", () => {
  it("keeps the NIH rendering — the extraction cache key depends on it byte for byte", () => {
    expect(sectionLabel({ part: 2, section: "I", heading: "Research Objectives", text: "" })).toBe("Part 2 · Section I · Research Objectives");
    expect(sectionLabel({ part: 2, section: "III.3", heading: "Additional Information", text: "" })).toBe("Part 2 · Section III.3 · Additional Information");
    expect(sectionLabel({ part: 1, section: "overview", heading: "Funding Opportunity Purpose", text: "" })).toBe("Part 1 · Overview · Funding Opportunity Purpose");
    expect(sectionLabel({ part: 1, section: "synopsis", heading: "Synopsis", text: "" })).toBe("Synopsis");
  });

  it("labels a section by its role when the numbering is not NIH-shaped", () => {
    expect(sectionLabel({ part: 2, section: "program_description", heading: "Areas of Emphasis", text: "", roles: ["objectives"] })).toBe(
      "Program Description · Areas of Emphasis",
    );
    expect(sectionLabel({ part: 2, section: "eligibility", heading: "Who May Submit", text: "", roles: ["eligibility"] })).toBe("Eligibility · Who May Submit");
  });
});

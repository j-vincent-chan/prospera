import { describe, expect, it } from "vitest";
import {
  formatCoverageReport,
  formatDryRunRow,
  formatRcdcSection,
  pct,
  RCDC_HEADING,
  rcdcNamesInSignalMapping,
  rcdcStatus,
  summarizeCoverage,
  tallyRcdc,
  type ScannedRow,
} from "@/lib/community/reporter-fields-backfill";
import { parseReporterRow } from "@/lib/community/reporter-fields";

/** DECISIONS.md D9, decided by default in PR 0.4: the seven research-type names the mapping keys on. */
const D9_MAPPED = [
  "Clinical Trials",
  "Clinical Research",
  "Health Services",
  "Comparative Effectiveness Research",
  "Prevention",
  "Behavioral and Social Science",
  "Basic Behavioral and Social Science",
];
const D9_UNVERIFIED = ["Epidemiology and Longitudinal Studies", "Dissemination and Implementation Research", "Translational Research"];

describe("rcdcNamesInSignalMapping", () => {
  it("the real mapping keys on exactly the seven D9 names, and the three unconfirmed ones are _verify_name (update D9 if this changes)", () => {
    const m = rcdcNamesInSignalMapping();
    expect([...m.mapped].sort()).toEqual([...D9_MAPPED].sort());
    expect([...m.unverified].sort()).toEqual([...D9_UNVERIFIED].sort());
    expect(m.ruleIds["Clinical Trials"]).toEqual(["reporter_rcdc_clinical_trials"]);
    expect(m.ruleIds["Basic Behavioral and Social Science"]).toEqual(["reporter_rcdc_behavioral"]);
  });

  it("reads string and array clauses and ignores rules without rcdc_any", () => {
    const m = rcdcNamesInSignalMapping({
      rules: [
        { id: "a", when: { rcdc_any: "Prevention" } },
        { id: "b", when: { rcdc_any: ["Prevention", "Health Services"] } },
        { id: "c", when: { rcdc_any: ["Translational Research"] }, _verify_name: true },
        { id: "d", when: { activity_code_any: ["K08"] } },
      ],
    });
    expect(m).toEqual({
      mapped: ["Prevention", "Health Services"],
      unverified: ["Translational Research"],
      ruleIds: { Prevention: ["a", "b"], "Health Services": ["b"], "Translational Research": ["c"] },
    });
  });
});

const mapping = { mapped: ["Clinical Research", "Prevention"], unverified: ["Translational Research"], ruleIds: {} };

describe("tallyRcdc", () => {
  it("counts rows per distinct value, most common first, ties by name, with the D9 status", () => {
    expect(tallyRcdc([["Cancer", "Lung"], ["Cancer", "Clinical Research"], null, ["Translational Research"]], mapping)).toEqual([
      { name: "Cancer", rows: 2, status: "unmapped" },
      { name: "Clinical Research", rows: 1, status: "mapped" },
      { name: "Lung", rows: 1, status: "unmapped" },
      { name: "Translational Research", rows: 1, status: "unverified" },
    ]);
    expect(tallyRcdc([null, null], mapping)).toEqual([]);
    expect(rcdcStatus("Prevention", mapping)).toBe("mapped");
  });
});

const AT = "2026-09-05T12:00:00.000Z";
const scanned = (raw: Record<string, unknown>, profileId: number | null): ScannedRow => ({ raw, fields: parseReporterRow(raw, profileId, AT) });
const rows: ScannedRow[] = [
  scanned(
    {
      project_num: "1R01AI024349-01",
      activity_code: "R01",
      spending_categories_desc: "Cancer; Clinical Research",
      full_study_section: { name: "Immunobiology Study Section[IMB]", srg_code: "IMB" },
      principal_investigators: [{ profile_id: 1, is_contact_pi: true }],
      abstract_text: "Text.",
      phr_text: "Relevance.",
    },
    1
  ),
  scanned(
    {
      project_num: "1DP2AI177915-01",
      activity_code: "DP2",
      spending_categories_desc: null,
      full_study_section: { name: null, srg_code: null },
      principal_investigators: [{ profile_id: 1, is_contact_pi: false }, { profile_id: 2, is_contact_pi: true }],
      abstract_text: "Text.",
      phr_text: null,
    },
    1
  ),
  scanned({ project_num: "unknown", activity_code: "K99", principal_investigators: [] }, null),
];

describe("summarizeCoverage", () => {
  it("counts parsed fields, the rows only the new parser reaches, and agreement with RePORTER's own code", () => {
    expect(summarizeCoverage(rows)).toEqual({
      rows: 3,
      activity_code: 3,
      activity_code_legacy_null: 2, // DP2 and "unknown"
      activity_code_raw_present: 3,
      activity_code_raw_disagrees: 0,
      rcdc_field_present: 1,
      rcdc_parsed: 1,
      study_section: 1,
      study_section_code: 1,
      contact_pi_true: 1,
      contact_pi_false: 1,
      contact_pi_null: 1,
      abstract: 2,
      phr_text: 1,
    });
  });

  it("flags a parsed code that disagrees with RePORTER's", () => {
    const c = summarizeCoverage([scanned({ project_num: "1R01AI024349-01", activity_code: "R21" }, null)]);
    expect(c.activity_code_raw_disagrees).toBe(1);
  });

  it("pct", () => {
    expect(pct(508, 818)).toBe("62.1%");
    expect(pct(818, 818)).toBe("100%");
    expect(pct(0, 0)).toBe("—");
  });
});

describe("formatting", () => {
  it("coverage report names the target and the shares", () => {
    const text = formatCoverageReport(summarizeCoverage(rows));
    expect(text).toContain("Coverage over 3 rows");
    expect(text).toContain("activity_code parsed            3 (100%)   [target 100%]");
    expect(text).toContain("spending_categories_desc present 1 (33.3%)   → rcdc_categories parsed 1 (33.3%)");
    expect(text).toContain("is_contact_pi                   true 1 · false 1 · null 1");
  });

  it("dry-run row shows what would be stored", () => {
    const line = formatDryRunRow("Jane Doe", "1R01AI024349-01", 1987, rows[0]!.fields);
    expect(line).toBe(
      "1R01AI024349-01  FY1987  Jane Doe\n" +
        '    activity_code R01 · contact_pi true · study_section "Immunobiology Study Section" [IMB]\n' +
        "    rcdc Cancer · Clinical Research\n" +
        "    abstract 5 chars · phr 10 chars"
    );
    expect(formatDryRunRow("—", "unknown", null, rows[2]!.fields)).toContain("activity_code K99 · contact_pi null · study_section —\n    rcdc —\n    abstract none · phr none");
  });

  it("§ 12 markdown lists every mapping name with its row count and the unmapped values", () => {
    const tally = tallyRcdc(rows.map((r) => r.fields.rcdc_categories), mapping);
    const md = formatRcdcSection(tally, summarizeCoverage(rows), { ...mapping, ruleIds: { "Clinical Research": ["reporter_rcdc_clinical_research"] } }, AT);
    expect(md.startsWith(`${RCDC_HEADING}\n\nGenerated ${AT}`)).toBe(true);
    expect(md).toContain("| rows with activity_code parsed | 3 (100%) |");
    expect(md).toContain("| rows with spending_categories_desc | 1 (33.3%) |");
    expect(md).toContain("| distinct RCDC values | 2 |");
    expect(md).toContain("| mapped names seen | 1 of 2 |");
    expect(md).toContain("| unverified names seen | 0 of 1 |");
    expect(md).toContain("| Clinical Research | mapped | `reporter_rcdc_clinical_research` | 1 |");
    expect(md).toContain("| Prevention | mapped |  | 0 |");
    expect(md).toContain("| Translational Research | unverified |  | 0 |");
    expect(md).toContain("Unmapped values seen (1;");
    expect(md).toContain("| Cancer | 1 |");
    expect(md.endsWith("\n")).toBe(true);
  });
});

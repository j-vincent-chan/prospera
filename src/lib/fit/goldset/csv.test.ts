import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, csvRowFor, LABEL_COLUMNS, parseCsv, serializeCsv, stratumLabel } from "@/lib/fit/goldset/csv";
import { PAIR } from "@/lib/fit/goldset/test-fixtures";


describe("goldset/csv", () => {
  it("has the summary columns, the stratum, and empty label columns for A, B and the adjudicator", () => {
    expect(CSV_COLUMNS.slice(0, 13)).toEqual(["pair_id", "investigator_id", "investigator_name", "investigator_paradigm", "investigator_family", "evidence_top3", "opportunity_id", "notice_number", "notice_title", "designation", "notice_family", "purpose_excerpt", "stratum"]);
    expect(LABEL_COLUMNS).toEqual(["tier_a", "reason_a", "axis_reason_a", "tier_b", "reason_b", "axis_reason_b", "tier_adj", "reason_adj", "axis_reason_adj"]);
    expect(CSV_COLUMNS).not.toContain("fit_v1_tier");
    const row = csvRowFor(PAIR);
    expect(row.pair_id).toBe("g001");
    expect(row.evidence_top3).toBe('T cells, "quoted" | Line two');
    expect(row.stratum).toBe("adversarial");
    for (const c of LABEL_COLUMNS) expect(row[c]).toBe("");
    expect(row.notes).toBe("");
    expect(csvRowFor(PAIR, { b: { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" } }).tier_b).toBe("poor");
  });

  it("round-trips through papaparse with quotes, commas and newlines", () => {
    const text = serializeCsv([csvRowFor(PAIR, { a: { tier: "strong", reason: "", axis_reason: "" } })]);
    expect(text.split("\n")[0]).toBe(CSV_COLUMNS.join(","));
    const parsed = parseCsv(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.missing_columns).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.purpose_excerpt).toBe("Population cohorts;\nregistry linkage.");
    expect(parsed.rows[0]!.evidence_top3).toBe('T cells, "quoted" | Line two');
    expect(parsed.rows[0]!.tier_a).toBe("strong");
    expect(parsed.rows[0]!.tier_b).toBe("");
  });

  it("reports missing summary columns, tolerates missing label columns and unknown ones", () => {
    const parsed = parseCsv("pair_id,tier_a,extra\ng001,strong,x\n");
    expect(parsed.rows[0]).toMatchObject({ pair_id: "g001", tier_a: "strong", tier_b: "" });
    expect(parsed.missing_columns).toContain("investigator_id");
    expect(parsed.missing_columns).not.toContain("tier_b");
  });

  it("labels the strata", () => {
    expect(stratumLabel("dropped")).toMatch(/Dropped by both engines/);
    expect(stratumLabel("extra")).toBe("extra");
  });
});

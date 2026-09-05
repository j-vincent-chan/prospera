import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { MATERIALS_KINDS } from "@/lib/fit/self-declared";
import { autoMapHeader, IMPORT_FIELDS, importRowSchema, mapImportRow, splitName, type ImportColumn } from "@/lib/investigators/import-mapping";

describe("autoMapHeader", () => {
  it("maps the intake form's headers", () => {
    expect(autoMapHeader("First Name")).toBe("first_name");
    expect(autoMapHeader("Last Name")).toBe("last_name");
    expect(autoMapHeader("NIH Profile ID")).toBe("nih_profile_id");
    expect(autoMapHeader("Email")).toBe("email");
    expect(autoMapHeader("Home Department")).toBe("home_department");
    expect(autoMapHeader("Rank Series")).toBe("title_series");
    expect(autoMapHeader("Rank Title")).toBe("rank");
    expect(autoMapHeader("Affiliations")).toBe("communities");
    expect(autoMapHeader("Primary Research Area")).toBe("primary_research_area");
    expect(autoMapHeader("Clinical Samples")).toBe("clinical_samples");
    expect(autoMapHeader("Biobanks")).toBe("biobanks");
  });

  it("maps the NOFO sheet's headers", () => {
    expect(autoMapHeader("orcid")).toBe("orcid");
    expect(autoMapHeader("reporter_profile_id")).toBe("nih_profile_id");
    expect(autoMapHeader("middle_initial")).toBe("middle_initial");
  });

  it("leaves ambiguous and unknown headers for a person", () => {
    expect(autoMapHeader("Home Division (if applicable)")).toBeNull();
    expect(autoMapHeader("Notes")).toBeNull();
    expect(autoMapHeader("profile_id")).toBeNull();
    expect(autoMapHeader("")).toBeNull();
  });

  it("every mappable field has a label in the picker", () => {
    const labelled = new Set(IMPORT_FIELDS.map((f) => f.value));
    for (const h of ["First Name", "Rank Series", "orcid", "Clinical Samples"]) expect(labelled.has(autoMapHeader(h)!)).toBe(true);
  });
});

describe("splitName", () => {
  it("splits 'First Last' and 'Last, First'", () => {
    expect(splitName("Ana  Rodríguez")).toEqual({ first: "Ana", last: "Rodríguez" });
    expect(splitName("Rodríguez, Ana")).toEqual({ first: "Ana", last: "Rodríguez" });
    expect(splitName("Nam Woo Cho")).toEqual({ first: "Nam Woo", last: "Cho" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });
});

const INTAKE_COLUMNS: ImportColumn[] = [
  { header: "First Name", field: "first_name" },
  { header: "Last Name", field: "last_name" },
  { header: "Email", field: "email" },
  { header: "Rank Series", field: "title_series" },
  { header: "Rank Title", field: "rank" },
  { header: "Clinical Samples", field: "clinical_samples" },
  { header: "Biobanks", field: "biobanks" },
  { header: "orcid", field: "orcid" },
  { header: "Gender", field: "note" },
  { header: "Website", field: "skip" },
  { header: "Home Division (if applicable)", field: null },
];

describe("mapImportRow", () => {
  it("maps Rank Series to title_series, mines materials, normalizes the ORCID and keeps notes", () => {
    const r = mapImportRow(
      {
        "First Name": "Ana",
        "Last Name": "Rodríguez",
        Email: "Ana.Rodriguez@ucsf.edu",
        "Rank Series": "In Residence",
        "Rank Title": "Associate Professor",
        "Clinical Samples": "Yes, plasma and CSF samples",
        Biobanks: "Yes, as previously discussed.",
        orcid: "https://orcid.org/0000-0002-1825-0097",
        Gender: "F",
        Website: "https://example.org",
        "Home Division (if applicable)": "Rheumatology",
      },
      INTAKE_COLUMNS,
      2,
    );
    expect(r.error).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.input).toMatchObject({
      line: 2,
      first_name: "Ana",
      last_name: "Rodríguez",
      email: "Ana.Rodriguez@ucsf.edu",
      title_series: "In Residence",
      rank: "Associate Professor",
      clinical_samples: "Yes, plasma and CSF samples",
      biobanks: "Yes, as previously discussed.",
      orcid: "0000-0002-1825-0097",
      self_declared_materials: ["human_blood_fluids", "biobank_specimens"],
      extra: { gender: "F" },
    });
    expect(r.input).not.toHaveProperty("division");
    expect(importRowSchema.safeParse(r.input).success).toBe(true);
  });

  it("reports an invalid ORCID as a warning and does not store it; the row still imports", () => {
    const r = mapImportRow({ "First Name": "Ana", "Last Name": "Rodríguez", orcid: "0000-0002-1825-0098" }, INTAKE_COLUMNS, 3);
    expect(r.error).toBeNull();
    expect(r.warnings).toEqual(["ORCID “0000-0002-1825-0098” not stored: the check digit doesn't match"]);
    expect(r.input.orcid).toBeUndefined();
    const bad = mapImportRow({ "First Name": "Ana", "Last Name": "Rodríguez", orcid: "n/a" }, INTAKE_COLUMNS, 4);
    expect(bad.warnings).toEqual(["ORCID “n/a” not stored: not an ORCID iD"]);
    expect(bad.input.orcid).toBeUndefined();
  });

  it("derives no materials from negative intake answers", () => {
    const r = mapImportRow({ "First Name": "Ana", "Last Name": "Rodríguez", "Clinical Samples": "no", Biobanks: "N/A" }, INTAKE_COLUMNS, 5);
    expect(r.input.self_declared_materials).toEqual([]);
  });

  it("blocks rows without a name or with a bad email", () => {
    expect(mapImportRow({ "First Name": "Ana" }, INTAKE_COLUMNS, 6).error).toBe("First and last name are required");
    expect(mapImportRow({ "First Name": "Ana", "Last Name": "R", Email: "ana at ucsf" }, INTAKE_COLUMNS, 7).error).toBe("Not a valid email");
  });

  it("splits a full-name column and merges community columns", () => {
    const r = mapImportRow(
      { Name: "Cho, Nam Woo", Affiliation: "ImmunoX; HDFCCC", Community: "Gladstone" },
      [
        { header: "Name", field: "full_name" },
        { header: "Affiliation", field: "communities" },
        { header: "Community", field: "communities" },
      ],
      2,
    );
    expect(r.input).toMatchObject({ first_name: "Nam Woo", last_name: "Cho", communities: ["ImmunoX", "HDFCCC", "Gladstone"] });
  });
});

// ---------------------------------------------------------------------------
// The real pilot sheets, read-only. They live one level above the repo (or
// wherever PROSPERA_PILOT_CSV_DIR points) and are never copied in; the tests
// skip when a file is absent.
// ---------------------------------------------------------------------------

const PILOT_DIR = process.env.PROSPERA_PILOT_CSV_DIR ?? path.resolve(process.cwd(), "..");

function loadCsv(name: string): { headers: string[]; rows: Record<string, string>[] } | null {
  const file = path.join(PILOT_DIR, name);
  if (!fs.existsSync(file)) return null;
  const res = Papa.parse<Record<string, string>>(fs.readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
  const rows = res.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
  return { headers: (res.meta.fields ?? []).filter(Boolean), rows };
}

function mapAll(csv: { headers: string[]; rows: Record<string, string>[] }) {
  const columns: ImportColumn[] = csv.headers.map((h) => ({ header: h, field: autoMapHeader(h) }));
  const mapped = csv.rows.map((r, i) => mapImportRow(r, columns, i + 2));
  return { columns, mapped };
}

const FORM = loadCsv("Form Responses-Grid view.csv");
const NOFO = loadCsv("immunox_members_pilot_NOFO.csv");

describe("pilot intake sheet (Form Responses-Grid view.csv)", () => {
  it.skipIf(!FORM)("maps all 115 rows with no errors and no warnings", () => {
    const { columns, mapped } = mapAll(FORM!);
    expect(FORM!.rows).toHaveLength(115);
    expect(columns.find((c) => c.header === "Rank Series")?.field).toBe("title_series");
    expect(columns.find((c) => c.header === "Clinical Samples")?.field).toBe("clinical_samples");
    expect(columns.find((c) => c.header === "Biobanks")?.field).toBe("biobanks");

    const errors = mapped.filter((m) => m.error).map((m) => `${m.input.line}: ${m.error}`);
    const warnings = mapped.flatMap((m) => m.warnings.map((w) => `${m.input.line}: ${w}`));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    for (const m of mapped) expect(importRowSchema.safeParse(m.input).success, `line ${m.input.line}`).toBe(true);

    const series = new Set(mapped.map((m) => m.input.title_series));
    expect(mapped.every((m) => m.input.title_series)).toBe(true);
    expect([...series].sort()).toEqual(["Adjunct", "Clinical X", "Health Sciences Clinical", "In Residence", "Ladder Rank", "Professional Researcher"]);

    const byKind = new Map<string, number>();
    for (const m of mapped) for (const k of m.input.self_declared_materials ?? []) byKind.set(k, (byKind.get(k) ?? 0) + 1);
    for (const k of byKind.keys()) expect(MATERIALS_KINDS).toContain(k);
    const withMaterials = mapped.filter((m) => (m.input.self_declared_materials ?? []).length).length;
    expect(withMaterials).toBeGreaterThan(50);
    console.info(
      `[pilot] Form Responses: ${mapped.length} rows · 0 errors · 0 warnings · title_series on ${mapped.filter((m) => m.input.title_series).length} · materials on ${withMaterials} · ` +
        [...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(", "),
    );
  });
});

describe("pilot NOFO sheet (immunox_members_pilot_NOFO.csv)", () => {
  it.skipIf(!NOFO)("maps every row with no errors; the orcid column validates", () => {
    const { columns, mapped } = mapAll(NOFO!);
    expect(NOFO!.rows.length).toBeGreaterThan(100);
    expect(columns.find((c) => c.header === "orcid")?.field).toBe("orcid");
    expect(columns.find((c) => c.header === "reporter_profile_id")?.field).toBe("nih_profile_id");

    const errors = mapped.filter((m) => m.error).map((m) => `${m.input.line}: ${m.error}`);
    const warnings = mapped.flatMap((m) => m.warnings.map((w) => `${m.input.line}: ${w}`));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const orcids = mapped.map((m) => m.input.orcid).filter(Boolean);
    expect(orcids).toEqual(["0000-0002-1762-1677"]);
    console.info(`[pilot] NOFO: ${mapped.length} rows · 0 errors · 0 warnings · ${orcids.length} ORCID iD(s) valid · nih_profile_id on ${mapped.filter((m) => m.input.nih_profile_id).length}`);
  });
});

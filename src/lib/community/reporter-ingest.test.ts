import { afterEach, describe, expect, it, vi } from "vitest";
import { isNihNewGrantByProjectNum } from "@/lib/community/signal-nih-funding";
import { refreshInvestigatorReporter, reporterPiNameMatches } from "@/lib/community/reporter-ingest";

describe("RePORTER new-grant filter", () => {
  it("accepts type-1 (new) project numbers", () => {
    expect(isNihNewGrantByProjectNum("1R01AI123456")).toBe(true);
    expect(isNihNewGrantByProjectNum("1 U01 DK099999 01")).toBe(true);
  });

  it("rejects continuing / non-type-1 project numbers", () => {
    expect(isNihNewGrantByProjectNum("5R01AI123456")).toBe(false);
    expect(isNihNewGrantByProjectNum("3U01DK099999")).toBe(false);
  });
});

describe("PR 0.1b · reporterPiNameMatches", () => {
  const cho = { first_name: "Nam Woo", last_name: "Cho", full_name: "Nam Woo Cho" };
  it("accepts exact, first-token and initial forms of the first name", () => {
    expect(reporterPiNameMatches({ first_name: "Nam Woo", last_name: "Cho" }, cho)).toBe(true);
    expect(reporterPiNameMatches({ first_name: "NAM", last_name: "CHO" }, cho)).toBe(true);
    expect(reporterPiNameMatches({ first_name: "N", last_name: "Cho" }, cho)).toBe(true);
    expect(reporterPiNameMatches({ first_name: "Arthur", last_name: "Weiss" }, { first_name: "A", last_name: "Weiss", full_name: "A Weiss" })).toBe(true);
  });
  it("rejects a different person and a different last name", () => {
    expect(reporterPiNameMatches({ first_name: "NAMITA", last_name: "ROY-CHOWDHURY" }, cho)).toBe(false);
    expect(reporterPiNameMatches({ first_name: "Raymond", last_name: "Cho" }, cho)).toBe(false);
    expect(reporterPiNameMatches({ first_name: "James", last_name: "Leech" }, { first_name: "James", last_name: "Lee", full_name: "James C Lee" })).toBe(false);
  });
  it("accepts a compound surname that contains the roster surname as a whole word, in either direction", () => {
    const prakash = { first_name: "Arun", last_name: "Prakash", full_name: "Arun Prakash" };
    expect(reporterPiNameMatches({ first_name: "Arun", last_name: "Prakash Budde", full_name: "Arun Prakash Budde" }, prakash)).toBe(true);
    expect(reporterPiNameMatches({ first_name: "A", last_name: "Prakash Budde" }, prakash)).toBe(true);
    expect(reporterPiNameMatches({ first_name: "Arun", last_name: "Prakash" }, { first_name: "Arun", last_name: "Prakash Budde", full_name: "Arun Prakash Budde" })).toBe(true);
    expect(reporterPiNameMatches({ first_name: "Judith", last_name: "Ashouri" }, { first_name: "Judith", last_name: "Ashouri-Sinha", full_name: "Judith F Ashouri-Sinha" })).toBe(true);
  });
  it("whole word only: substrings and other hyphen parts do not match, and the first name still gates", () => {
    expect(reporterPiNameMatches({ first_name: "James", last_name: "Leech" }, { first_name: "James", last_name: "Lee", full_name: "James C Lee" })).toBe(false);
    expect(reporterPiNameMatches({ first_name: "Namita", last_name: "Roy-Chowdhury" }, { first_name: "Nam Woo", last_name: "Cho", full_name: "Nam Woo Cho" })).toBe(false);
    expect(reporterPiNameMatches({ first_name: "Nam", last_name: "Roy-Chowdhury" }, { first_name: "Nam Woo", last_name: "Cho", full_name: "Nam Woo Cho" })).toBe(false);
    expect(reporterPiNameMatches({ first_name: "Vijay", last_name: "Prakash Budde" }, { first_name: "Arun", last_name: "Prakash", full_name: "Arun Prakash" })).toBe(false);
  });
  it("folds diacritics in the last name", () => {
    expect(reporterPiNameMatches({ first_name: "José", last_name: "Nicolás-Ávila" }, { first_name: "Jose Angel", last_name: "Nicolas Avila", full_name: "Jose Angel Nicolas Avila" })).toBe(true);
  });
});

describe("PR 0.1b · refreshInvestigatorReporter profile-id guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeDb(inv: Record<string, unknown>) {
    const deleteEq = vi.fn(async () => ({ error: null }));
    const upsert = vi.fn(async () => ({ error: null }));
    const db = {
      from: vi.fn((table: string) =>
        table === "investigators"
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: inv, error: null }) }) }) }
          : { delete: () => ({ eq: deleteEq }), upsert }
      ),
    };
    return { db: db as never, deleteEq, upsert };
  }

  const cho = { id: "inv-1", first_name: "Nam Woo", last_name: "Cho", full_name: "Nam Woo Cho", home_department: null, division: null, nih_profile_id: "1955985" };
  const project = (pi: Record<string, unknown>) => ({
    project_num: "1R01DK092469-01",
    fiscal_year: 2012,
    principal_investigators: [pi],
    spending_categories_desc: "Digestive Diseases; Clinical Research",
    full_study_section: { name: "Gastrointestinal Mucosal Pathobiology Study Section[GMPB]", srg_code: "GMPB" },
    abstract_text: "Project summary\nline two.",
    phr_text: null,
  });

  it("does not touch the cache and fails with the resolved name when the profile id is someone else", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [project({ profile_id: 1955985, first_name: "NAMITA", last_name: "ROY-CHOWDHURY", full_name: "NAMITA ROY-CHOWDHURY" })], meta: { total: 1 } }), { status: 200 }))
    );
    const { db, deleteEq, upsert } = fakeDb(cho);
    await expect(refreshInvestigatorReporter(db, "inv-1")).rejects.toThrow("profile id 1955985 resolves to NAMITA ROY-CHOWDHURY");
    expect(deleteEq).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts as before when the returned PI is the investigator, with the PR 0.4 fields parsed from the record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [project({ profile_id: 1955985, first_name: "NAM WOO", last_name: "CHO", is_contact_pi: false })], meta: { total: 1 } }), { status: 200 }))
    );
    const { db, deleteEq, upsert } = fakeDb(cho);
    const r = await refreshInvestigatorReporter(db, "inv-1");
    expect(r.inserted).toBe(1);
    expect(deleteEq).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = (upsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(payload).toMatchObject({
      investigator_id: "inv-1",
      project_num: "1R01DK092469-01",
      fiscal_year: 2012,
      identity_method: "profile_id",
      identity_status: "verified",
      activity_code: "R01",
      rcdc_categories: ["Digestive Diseases", "Clinical Research"],
      study_section: "Gastrointestinal Mucosal Pathobiology Study Section",
      study_section_code: "GMPB",
      is_contact_pi: false,
      abstract: "Project summary line two.",
      phr_text: null,
    });
    expect(typeof payload.fields_parsed_at).toBe("string");
    expect((payload.raw_json as Record<string, unknown>).project_num).toBe("1R01DK092469-01");
  });
});

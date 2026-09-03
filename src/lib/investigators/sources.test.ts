import { describe, expect, it } from "vitest";
import {
  countDirectory,
  emptySourceRow,
  headerSummary,
  matchesSourcesFilter,
  refreshedPhrase,
  sourceChip,
  staleRefreshedPhrase,
  type InvestigatorSourceRow,
  type PersonChips,
  type SourceContext,
} from "./sources";

const now = new Date("2026-09-03T12:00:00Z");

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    now,
    fullName: "Priya Natarajan",
    lastName: "Natarajan",
    email: "priya.natarajan@ucsf.edu",
    nihProfileId: "8033726",
    orcid: null,
    addedVia: null,
    addedAt: null,
    grants: [],
    publications: [],
    repliedInterestedAt: null,
    ...over,
  };
}

function row(source: InvestigatorSourceRow["source"], over: Partial<InvestigatorSourceRow> = {}): InvestigatorSourceRow {
  return { ...emptySourceRow("inv-1", source), ...over };
}

describe("refreshed phrases", () => {
  it("uses relative days inside the week and Mon D after", () => {
    expect(refreshedPhrase("2026-09-01T10:00:00Z", now)).toBe("2 days ago");
    expect(refreshedPhrase("2026-09-03T01:00:00Z", now)).toBe("today");
    expect(refreshedPhrase("2026-08-20T10:00:00Z", now)).toBe("Aug 20");
    expect(refreshedPhrase("2025-08-20T10:00:00Z", now)).toBe("Aug 20, 2025");
    expect(staleRefreshedPhrase("2025-06-15T10:00:00Z", now)).toBe("Jun 2025 (15 months ago)");
  });
});

describe("RePORTER chip", () => {
  it("is unavailable with an Add profile ID action when no id is on file", () => {
    const chip = sourceChip(row("reporter"), ctx({ nihProfileId: null, addedVia: "CSV import", addedAt: "2024-11-05" }));
    expect(chip.count).toBe("(—)");
    expect(chip.visual).toBe("none");
    expect(chip.meta).toBe("No profile ID on file");
    expect(chip.empty).toContain("Added Nov 2024 by CSV import");
    expect(chip.action.kind).toBe("add_profile_id");
  });

  it("shows the count, the teal dot and grant evidence when refreshed this week", () => {
    const chip = sourceChip(
      row("reporter", { state: "available", item_count: 2, last_refreshed_at: "2026-09-01T10:00:00Z" }),
      ctx({
        grants: [
          { project_num: "5R01AI158703-03", project_title: "Tissue-resident regulatory T cells in cutaneous lupus", ic_name: "NIAID — National Institute of Allergy and Infectious Diseases", fiscal_year: 2025, is_active: true, start: "2022-07-01", end: "2027-06-30", role: "Contact PI", identity_status: "verified" },
          { project_num: "1R21AR079442-01", project_title: "Skin-resident Treg checkpoints", ic_name: "NIAMS", fiscal_year: 2024, is_active: false, start: "2024-01-01", end: "2026-01-01", role: "PI", identity_status: "verified" },
        ],
      }),
    );
    expect(chip.count).toBe("(2)");
    expect(chip.recent).toBe(true);
    expect(chip.stateLabel).toBe("Updated this week");
    expect(chip.meta).toBe("Matched by profile ID · refreshed 2 days ago");
    expect(chip.items[0]).toEqual({ heading: "5R01AI158703-03 · Tissue-resident regulatory T cells in cutaneous lupus", sub: "NIAID · 2022–2027 · Contact PI" });
    expect(chip.items[1]!.sub).toBe("NIAMS · 2024–2026 · completed");
    expect(chip.action.label).toBe("Refresh now");
  });

  it("offers Retry refresh when the nightly job is failing", () => {
    const chip = sourceChip(row("reporter", { state: "error", last_error: "RePORTER API 503", item_count: 1, last_refreshed_at: "2026-08-20T10:00:00Z" }), ctx({ grants: [{ project_num: "1R01NS118240-01", project_title: null, ic_name: "NINDS", fiscal_year: 2021, is_active: true, start: null, end: null, role: null, identity_status: "verified" }] }));
    expect(chip.meta).toContain("the nightly refresh is failing for this profile");
    expect(chip.action.kind).toBe("retry");
  });
});

describe("PubMed chip", () => {
  it("reads Never fetched with a Fetch PubMed action", () => {
    const chip = sourceChip(row("pubmed"), ctx());
    expect(chip.meta).toBe("Never fetched");
    expect(chip.empty).toContain("Fetching takes about a minute and runs nightly afterwards.");
    expect(chip.action.label).toBe("Fetch PubMed");
  });

  it("flags name-only matches and asks for an identity review", () => {
    const chip = sourceChip(
      row("pubmed", { state: "available", item_count: 3, unverified_count: 2, last_refreshed_at: "2026-08-20T10:00:00Z" }),
      ctx({
        publications: [
          { pmid: "1", title: "Microglial checkpoints in EAE", journal: "J Exp Med", publication_date: "2024-05-01", identity_method: "affiliation", identity_status: "verified" },
          { pmid: "2", title: "A", journal: "J", publication_date: "2024-01-01", identity_method: "affiliation", identity_status: "verified" },
          { pmid: "3", title: "B", journal: "J", publication_date: "2023-01-01", identity_method: "affiliation", identity_status: "verified" },
          { pmid: "4", title: "Retinal ganglion cell survival after optic neuritis", journal: "IOVS", publication_date: "2024-03-01", identity_method: "name_only", identity_status: "unverified" },
          { pmid: "5", title: "C", journal: "J", publication_date: "2022-01-01", identity_method: "name_only", identity_status: "unverified" },
        ],
      }),
    );
    expect(chip.count).toBe("(3)");
    expect(chip.flag).toBe("2 of 5 matches are name-only and unverified");
    expect(chip.meta).toBe("5 matched · 3 affiliation-matched, 2 name-only · refreshed Aug 20");
    expect(chip.items.map((i) => i.sub)).toEqual(["J Exp Med · 2024 · verified", "IOVS · 2024 · name-only · confirm or reject on the profile"]);
    expect(chip.action.label).toBe("Review identity");
  });

  it("turns amber and reports the month when older than a year", () => {
    const chip = sourceChip(row("pubmed", { state: "error", item_count: 2, last_refreshed_at: "2025-06-15T10:00:00Z", last_error: "429" }), ctx({ publications: [{ pmid: "9", title: "T", journal: "Am J Transplant", publication_date: "2023-01-01", identity_method: "affiliation", identity_status: "verified" }] }));
    expect(chip.visual).toBe("stale");
    expect(chip.stateLabel).toBe("Stale");
    expect(chip.meta).toBe("1 publication · affiliation-matched · last refreshed Jun 2025 (15 months ago) · the nightly refresh is failing for this profile");
    expect(chip.action.label).toBe("Retry refresh");
  });

  it("describes an all-affiliation set", () => {
    const pubs = Array.from({ length: 31 }, (_, i) => ({ pmid: String(i), title: `T${i}`, journal: "J", publication_date: "2025-01-01", identity_method: "affiliation" as const, identity_status: "verified" as const }));
    const chip = sourceChip(row("pubmed", { state: "available", item_count: 31, last_refreshed_at: "2026-08-20T10:00:00Z" }), ctx({ publications: pubs }));
    expect(chip.meta).toBe("31 publications · all affiliation-matched · refreshed Aug 20");
  });
});

describe("Biosketch chip", () => {
  it("shows the document year, authorization and purpose when on file", () => {
    const chip = sourceChip(
      row("biosketch", {
        state: "on_file",
        document_date: "2025-03-01",
        authorized_at: "2026-01-12T18:00:00Z",
        authorized_by: "Dr. Natarajan",
        written_for: "an R01 renewal",
        personal_statement: "My program asks how tissue-resident regulatory T cells keep autoimmune inflammation in check.",
        contributions: [{ title: "Treg tissue residency", summary: "" }, { title: "lupus skin immunology", summary: "" }],
      }),
      ctx(),
    );
    expect(chip.count).toBe("(2025)");
    expect(chip.visual).toBe("ok");
    expect(chip.meta).toBe("Document dated Mar 2025 · authorized by Dr. Natarajan Jan 12, 2026 · written for an R01 renewal");
    expect(chip.items[0]!.heading).toBe("Personal statement");
    expect(chip.items[1]).toEqual({ heading: "Contributions to science · 2", sub: "Treg tissue residency · lupus skin immunology" });
    expect(chip.action.label).toBe("Request update");
  });

  it("marks a three-year-old document stale", () => {
    const chip = sourceChip(row("biosketch", { state: "on_file", document_date: "2023-09-01", authorized_at: "2025-02-10T00:00:00Z", written_for: "an NCI U01 renewal" }), ctx({ lastName: "Brandt" }));
    expect(chip.visual).toBe("stale");
    expect(chip.meta).toBe("Document dated Sep 2023 · authorized Feb 2025 · written for an NCI U01 renewal; may not reflect current directions");
  });

  it("walks the request states", () => {
    expect(sourceChip(row("biosketch", { state: "requested", requested_at: "2026-07-14T00:00:00Z" }), ctx({ lastName: "Okafor" })).empty).toBe(
      "Dr. Okafor hasn’t authorized a biosketch. A request was sent Jul 14, 2026; no reply yet. Missing biosketches never lower a match tier.",
    );
    expect(sourceChip(row("biosketch"), ctx({ email: null })).meta).toBe("Not requested · no email on file");
    expect(sourceChip(row("biosketch"), ctx({ email: null })).action.label).toBe("Add email");
    expect(sourceChip(row("biosketch"), ctx()).action.label).toBe("Request biosketch");
    const declined = sourceChip(row("biosketch", { state: "declined", declined_at: "2026-02-03T00:00:00Z" }), ctx({ lastName: "Goldstein" }));
    expect(declined.meta).toBe("Not authorized");
    expect(declined.empty).toBe("Dr. Goldstein declined to share a biosketch (Feb 2026). Prospera won’t ask again unless you do so directly.");
  });
});

describe("directory summaries and filters", () => {
  const chips = (r: Partial<PersonChips> = {}): PersonChips => ({
    reporter: sourceChip(row("reporter"), ctx({ nihProfileId: null })),
    pubmed: sourceChip(row("pubmed"), ctx()),
    biosketch: sourceChip(row("biosketch"), ctx()),
    ...r,
  });

  it("counts sources and people with none", () => {
    const withReporter = chips({ reporter: sourceChip(row("reporter", { state: "available", item_count: 1, last_refreshed_at: "2026-08-20T00:00:00Z" }), ctx()) });
    const counts = countDirectory([
      { email: "a@ucsf.edu", chips: withReporter },
      { email: null, chips: chips() },
    ]);
    expect(counts).toEqual({ total: 2, withEmail: 1, reporter: 1, pubmed: 0, biosketch: 0, noSources: 1 });
    expect(headerSummary(counts)).toBe("2 in directory · 1 with email · RePORTER 1 · PubMed 0 · Biosketch 0 · 1 with no sources yet");
  });

  it("applies the Sources select", () => {
    const c = chips();
    expect(matchesSourcesFilter("missing_any", c)).toBe(true);
    expect(matchesSourcesFilter("missing_reporter", c)).toBe(true);
    expect(matchesSourcesFilter("recent", c)).toBe(false);
    expect(matchesSourcesFilter("unverified", c)).toBe(false);
  });
});

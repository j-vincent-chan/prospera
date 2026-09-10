import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Acquisition } from "@/lib/ingestion/announcement/registry";
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { GRANTS_GOV_ATTACHMENT_ADAPTER_ID } from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import {
  isAnnouncementFetchDue,
  sanitizeSections,
  orderDue,
  planAnnouncementFetch,
  syncAnnouncements,
  type AnnouncementCandidateRow,
  type AnnouncementFetchReason,
} from "./announcement-sync";

const NOW = new Date("2026-09-09T08:50:00.000Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function row(over: Partial<AnnouncementCandidateRow> = {}): AnnouncementCandidateRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    opportunity_number: "DFOP0019546",
    agency_code: "DOS-DRL",
    forecasted: false,
    source_opportunity_id: "11111111-1111-1111-1111-111111111111",
    raw_payload_json: {},
    posted_date: "2026-08-01",
    source_updated_at: null,
    guide_fetched_at: null,
    guide_fetch_status: null,
    ...over,
  } as AnnouncementCandidateRow;
}

describe("isAnnouncementFetchDue (the re-queue predicate)", () => {
  it("is due when never fetched, and when forced", () => {
    expect(isAnnouncementFetchDue(row(), { now: NOW })).toBe("never_fetched");
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(1), guide_fetch_status: "ok" }), { now: NOW, force: true })).toBe("force");
  });

  it("is due when Simpler changed the notice after the last fetch", () => {
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(2), guide_fetch_status: "ok", source_updated_at: days(1) }), { now: NOW })).toBe("source_updated");
  });

  it("never puts not_applicable on a cadence — no announcement exists on any route", () => {
    // The whole point of the value 20260914100000_fit_guide_sections.sql added:
    // NSF's PD- rows, DOJ's 31 and NASA's 11 are structural absences, not failures.
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(400), guide_fetch_status: "not_applicable" }), { now: NOW })).toBeNull();
  });

  it("re-examines a not_applicable row only when the funder changed it", () => {
    const r = row({ guide_fetched_at: days(40), guide_fetch_status: "not_applicable", source_updated_at: days(1) });
    expect(isAnnouncementFetchDue(r, { now: NOW })).toBe("source_updated");
  });

  it("refreshes ok rows at 30 days and retries failures at 14", () => {
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(10), guide_fetch_status: "ok" }), { now: NOW })).toBeNull();
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(31), guide_fetch_status: "ok" }), { now: NOW })).toBe("refresh");
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(3), guide_fetch_status: "not_found" }), { now: NOW })).toBeNull();
    // 8 days would be due under the Guide sync's cadence; here it is not.
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(8), guide_fetch_status: "error" }), { now: NOW })).toBeNull();
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(15), guide_fetch_status: "error" }), { now: NOW })).toBe("retry");
    expect(isAnnouncementFetchDue(row({ guide_fetched_at: days(2), guide_fetch_status: "error" }), { now: NOW, retryAfterDays: 1 })).toBe("retry");
  });

  it("never consults updated_at — the trigger stamps this sync's own write", () => {
    const r = row({ guide_fetched_at: days(1), guide_fetch_status: "ok", source_updated_at: days(1.001) });
    expect(isAnnouncementFetchDue({ ...r, source_updated_at: days(2) }, { now: NOW })).toBeNull();
  });
});

describe("planAnnouncementFetch", () => {
  it("refuses an NIH-corpus row before anything else, however due it looks", () => {
    for (const n of ["PA-26-100", "PAR-25-122", "PAS-26-315", "RFA-DK-26-315"]) {
      expect(planAnnouncementFetch(row({ opportunity_number: n }), { now: NOW, force: true })).toEqual({ action: "skip", reason: "nih_corpus" });
    }
    expect(planAnnouncementFetch(row({ agency_code: "HHS-NIH-NIAID" }), { now: NOW, force: true })).toEqual({ action: "skip", reason: "nih_corpus" });
  });

  it("fetches an open non-NIH notice that was never read", () => {
    expect(planAnnouncementFetch(row(), { now: NOW })).toEqual({
      action: "fetch",
      adapter: GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
      family: "other_federal",
      reason: "never_fetched",
    });
  });

  it("skips forecasts, rows no adapter applies to, and rows outside the requested families", () => {
    expect(planAnnouncementFetch(row({ forecasted: true }), { now: NOW })).toEqual({ action: "skip", reason: "forecast" });
    expect(planAnnouncementFetch(row({ source_opportunity_id: null, raw_payload_json: {} }), { now: NOW })).toEqual({ action: "skip", reason: "no_adapter" });
    expect(planAnnouncementFetch(row(), { now: NOW, families: ["nsf"] })).toEqual({ action: "skip", reason: "no_adapter" });
  });

  it("distinguishes a not_applicable skip from a not-due one", () => {
    expect(planAnnouncementFetch(row({ guide_fetched_at: days(400), guide_fetch_status: "not_applicable" }), { now: NOW })).toEqual({ action: "skip", reason: "not_applicable" });
    expect(planAnnouncementFetch(row({ guide_fetched_at: days(1), guide_fetch_status: "ok" }), { now: NOW })).toEqual({ action: "skip", reason: "not_due" });
  });
});

describe("orderDue", () => {
  it("reads never-fetched notices before re-reads, newest posted first inside a reason", () => {
    const due = [
      { row: row({ id: "c", posted_date: "2026-01-01" }), reason: "refresh" as AnnouncementFetchReason },
      { row: row({ id: "b", posted_date: "2026-07-01" }), reason: "never_fetched" as AnnouncementFetchReason },
      { row: row({ id: "a", posted_date: "2026-08-01" }), reason: "never_fetched" as AnnouncementFetchReason },
      { row: row({ id: "d", posted_date: "2026-09-01" }), reason: "retry" as AnnouncementFetchReason },
    ];
    expect(orderDue(due).map((d) => d.row.id)).toEqual(["a", "b", "d", "c"]);
  });
});

// ---------------------------------------------------------------------------
// The runner, over a fake database and an injected adapter — no network.
// ---------------------------------------------------------------------------

type Write = { table: string; id: string | null; values: Record<string, unknown> };

function fakeDb(rows: AnnouncementCandidateRow[], writes: Write[], refuseWrite?: (values: Record<string, unknown>) => { message: string } | null): SupabaseClient {
  const db = {
    from(table: string) {
      const state: { verb: "select" | "insert" | "update"; values: Record<string, unknown> | null; id: string | null; from?: number } = {
        verb: "select",
        values: null,
        id: null,
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (v: Record<string, unknown>) => ((state.verb = "insert"), (state.values = v), chain),
        update: (v: Record<string, unknown>) => ((state.verb = "update"), (state.values = v), chain),
        eq: (col: string, v: unknown) => (col === "id" ? ((state.id = String(v)), chain) : chain),
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => chain,
        maybeSingle: () => chain,
        range: (from: number) => ((state.from = from), chain),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const settle = () => {
            if (state.verb === "insert") return { data: { id: "log-1" }, error: null };
            if (state.verb === "update") {
              const values = state.values ?? {};
              writes.push({ table, id: state.id, values });
              const refusal = table === "funding_opportunities" ? (refuseWrite?.(values) ?? null) : null;
              return { data: null, error: refusal };
            }
            // `range` was called ⇒ the paged candidate read; otherwise the migration probe.
            if (state.from === undefined) return { data: [], error: null };
            return { data: state.from === 0 ? rows : [], error: null };
          };
          return Promise.resolve(settle()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db as unknown as SupabaseClient;
}

const okAcquisition = (n: number): Acquisition => ({
  status: "ok",
  url: "https://example.gov/nofo.pdf",
  source: "grants_gov_attachment",
  sections: Array.from({ length: n }, (_, i) => ({ part: 1, section: String(i), heading: `H${i}`, text: "body", roles: ["objectives"] })) as NoticeSection[],
  textHash: "hash-abc",
  pageFetches: 1,
  simplerCalls: 1,
});

describe("sanitizeSections", () => {
  const section = (heading: string, text: string) => ({ part: 1, section: "A", heading, text, roles: ["objectives"] }) as NoticeSection;

  it("strips the U+0000 that Postgres jsonb refuses, and keeps newlines and tabs", () => {
    const [out] = sanitizeSections([section("A\u0000B", "line one\nline\u0000 two\tend")]);
    expect(out.heading).toBe("AB");
    expect(out.text).toBe("line one\nline two\tend");
  });

  it("strips unpaired surrogates but keeps a real astral character", () => {
    const [out] = sanitizeSections([section("hi \uD800 there", "keep \uD83D\uDE00 and drop \uDC00")]);
    expect(out.heading).toBe("hi  there");
    expect(out.text).toBe("keep \uD83D\uDE00 and drop ");
  });

  it("leaves clean sections and every other field untouched", () => {
    const input = [section("A. Program Description", "The goal of the program is…")];
    expect(sanitizeSections(input)).toEqual(input);
  });
});

describe("syncAnnouncements", () => {
  it("writes the sectioned text, the source and both stamps for an ok row", async () => {
    const writes: Write[] = [];
    const result = await syncAnnouncements(fakeDb([row()], writes), {
      now: NOW,
      simplerClient: null,
      acquire: async () => okAcquisition(3),
    });
    expect(result.ok).toBe(true);
    const write = writes.find((w) => w.table === "funding_opportunities");
    expect(write?.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(write?.values).toMatchObject({
      guide_source: "grants_gov_attachment",
      guide_fetch_status: "ok",
      announcement_kind: GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
      announcement_text_hash: "hash-abc",
      guide_url: "https://example.gov/nofo.pdf",
    });
    expect((write?.values.guide_sections as unknown[]).length).toBe(3);
    if (result.ok) expect(result).toMatchObject({ scanned: 1, due: 1, attempted: 1, updated: 1, remaining: 0 });
  });

  it("stamps a failed row with the status the adapter reached and leaves guide_sections alone", async () => {
    for (const status of ["not_applicable", "not_found", "error"] as const) {
      const writes: Write[] = [];
      await syncAnnouncements(fakeDb([row()], writes), {
        now: NOW,
        simplerClient: null,
        acquire: async () => ({ status, url: null, source: null, error: "nothing on any route", pageFetches: 1, simplerCalls: 0 }),
      });
      const write = writes.find((w) => w.table === "funding_opportunities");
      expect(write?.values.guide_fetch_status).toBe(status);
      expect(write?.values).not.toHaveProperty("guide_sections");
      // Nulling guide_url would clear whatever the row already had.
      expect(write?.values).not.toHaveProperty("guide_url");
    }
  });

  it("never reads or writes an NIH-corpus row, even when it is the only candidate", async () => {
    const writes: Write[] = [];
    const seen: string[] = [];
    const result = await syncAnnouncements(fakeDb([row({ opportunity_number: "PAR-25-122" }), row({ id: "nih2", agency_code: "HHS-NIH-NIAID" })], writes), {
      now: NOW,
      force: true,
      simplerClient: null,
      acquire: async (_a, r) => {
        seen.push(String(r.opportunity_number));
        return okAcquisition(1);
      },
    });
    expect(seen).toEqual([]);
    expect(writes.filter((w) => w.table === "funding_opportunities")).toEqual([]);
    if (result.ok) expect(result).toMatchObject({ scanned: 2, nihSkipped: 2, due: 0, attempted: 0 });
  });

  it("refuses families: ['nih'] outright", async () => {
    const result = await syncAnnouncements(fakeDb([], []), { now: NOW, families: ["nih"], simplerClient: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("'nih' is refused");
  });

  it("honours the limit and reports what is left for the next run", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `row-${i}`, posted_date: `2026-08-0${i + 1}` }));
    const writes: Write[] = [];
    const result = await syncAnnouncements(fakeDb(rows, writes), { now: NOW, limit: 2, simplerClient: null, acquire: async () => okAcquisition(1) });
    if (result.ok) expect(result).toMatchObject({ due: 5, attempted: 2, updated: 2, remaining: 3, outOfTime: false });
    // Newest posted first among never-fetched rows.
    expect(writes.filter((w) => w.table === "funding_opportunities").map((w) => w.id)).toEqual(["row-4", "row-3"]);
  });

  it("stops starting notices when the time budget is spent, and says so", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => row({ id: `row-${i}` }));
    const result = await syncAnnouncements(fakeDb(rows, []), {
      now: NOW,
      timeBudgetMs: 1_000,
      simplerClient: null,
      acquire: async () => {
        await new Promise((r) => setTimeout(r, 600));
        return okAcquisition(1);
      },
    });
    if (result.ok) {
      expect(result.outOfTime).toBe(true);
      expect(result.attempted).toBeLessThan(4);
      expect(result.remaining).toBeGreaterThan(0);
    }
  });

  it("stamps the status columns when the payload write is refused, so the row leaves rank 0", async () => {
    const writes: Write[] = [];
    // Refuse any update carrying guide_sections — what Postgres does for a U+0000 the sanitiser missed.
    const db = fakeDb([row()], writes, (values) => ("guide_sections" in values ? { message: "unsupported Unicode escape sequence" } : null));
    const result = await syncAnnouncements(db, { now: NOW, simplerClient: null, acquire: async () => okAcquisition(2) });
    const stamps = writes.filter((w) => w.table === "funding_opportunities");
    expect(stamps).toHaveLength(2);
    expect(stamps[1]!.values).toEqual({ guide_fetch_status: "error", guide_fetched_at: expect.any(String) });
    if (result.ok) expect(result.errors).toBe(1);
  });

  it("writes nothing at all on a dry run", async () => {
    const writes: Write[] = [];
    const result = await syncAnnouncements(fakeDb([row()], writes), { now: NOW, dryRun: true, simplerClient: null, acquire: async () => okAcquisition(2) });
    expect(writes).toEqual([]);
    if (result.ok) expect(result).toMatchObject({ attempted: 1, updated: 1, dryRun: true });
  });
});

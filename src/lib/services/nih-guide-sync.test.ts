import { describe, expect, it } from "vitest";
import { isGuideFetchDue, planGuideFetch, preferredGuideUrl, type GuideCandidateRow } from "./nih-guide-sync";

const NOW = new Date("2026-09-05T08:30:00.000Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function row(over: Partial<GuideCandidateRow> = {}): GuideCandidateRow {
  return {
    opportunity_number: "PAR-27-064",
    forecasted: false,
    guide_fetched_at: null,
    guide_fetch_status: null,
    source_updated_at: null,
    guide_url: null,
    raw_payload_json: { summary: { additional_info_url: null } },
    ...over,
  };
}

describe("isGuideFetchDue (the re-queue predicate)", () => {
  it("never consults updated_at: a row the trigger stamped right after the fetch is not due", () => {
    // guide_fetched_at 09:18:08.041, trigger-set updated_at 09:18:08.053 (GUIDE_DIAGNOSTICS.md) — the old predicate re-queued this nightly.
    const r = row({ guide_fetched_at: days(1), guide_fetch_status: "not_found", source_updated_at: "2026-06-16T14:16:55.000Z" });
    expect(isGuideFetchDue(r, { now: NOW })).toBeNull();
  });
  it("is due when Simpler changed the notice after the last fetch", () => {
    const r = row({ guide_fetched_at: days(1), guide_fetch_status: "ok", source_updated_at: days(0.5) });
    expect(isGuideFetchDue(r, { now: NOW })).toBe("source_updated");
  });
  it("is due when never fetched, when forced, and when it was not_applicable but is fetchable now", () => {
    expect(isGuideFetchDue(row(), { now: NOW })).toBe("never_fetched");
    expect(isGuideFetchDue(row({ guide_fetched_at: days(1), guide_fetch_status: "ok" }), { now: NOW, force: true })).toBe("force");
    expect(isGuideFetchDue(row({ guide_fetched_at: days(1), guide_fetch_status: "not_applicable" }), { now: NOW })).toBe("was_not_applicable");
  });
  it("keeps the 7-day refresh and retry cadences", () => {
    expect(isGuideFetchDue(row({ guide_fetched_at: days(3), guide_fetch_status: "ok" }), { now: NOW })).toBeNull();
    expect(isGuideFetchDue(row({ guide_fetched_at: days(8), guide_fetch_status: "ok" }), { now: NOW })).toBe("refresh");
    expect(isGuideFetchDue(row({ guide_fetched_at: days(3), guide_fetch_status: "not_found" }), { now: NOW })).toBeNull();
    expect(isGuideFetchDue(row({ guide_fetched_at: days(8), guide_fetch_status: "not_found" }), { now: NOW })).toBe("retry");
    expect(isGuideFetchDue(row({ guide_fetched_at: days(2), guide_fetch_status: "error" }), { now: NOW, retryAfterDays: 1 })).toBe("retry");
  });
});

describe("planGuideFetch", () => {
  it("stamps forecasts not_applicable once and never fetches them", () => {
    expect(planGuideFetch(row({ forecasted: true, guide_fetch_status: "not_found", guide_fetched_at: days(30) }), { now: NOW })).toEqual({ action: "not_applicable", reason: "forecast", stamp: true });
    expect(planGuideFetch(row({ forecasted: true, guide_fetch_status: "not_applicable", guide_fetched_at: days(30) }), { now: NOW })).toEqual({ action: "not_applicable", reason: "forecast", stamp: false });
    expect(planGuideFetch(row({ forecasted: true }), { now: NOW, force: true }).action).toBe("not_applicable");
  });
  it("stamps placeholders and non-Guide numbers not_applicable", () => {
    expect(planGuideFetch(row({ opportunity_number: "RFA-IP-18-000", guide_fetch_status: "not_found", guide_fetched_at: days(30) }), { now: NOW })).toEqual({ action: "not_applicable", reason: "not_guide_number", stamp: true });
    expect(planGuideFetch(row({ opportunity_number: "PA-FPH-27-001" }), { now: NOW }).action).toBe("not_applicable");
    expect(planGuideFetch(row({ opportunity_number: "  " }), { now: NOW })).toEqual({ action: "not_applicable", reason: "no_number", stamp: true });
  });
  it("fetches the classic path for a posted, well-formed, never-fetched number", () => {
    expect(planGuideFetch(row({ opportunity_number: "PAS-27-028" }), { now: NOW })).toEqual({
      action: "fetch",
      url: "https://grants.nih.gov/grants/guide/pa-files/PAS-27-028.html",
      source: "grants_nih_gov",
      reason: "never_fetched",
    });
  });
  it("prefers a stored Simpler attachment URL over the classic path", () => {
    const stored = "https://files.simpler.grants.gov/opportunities/a/attachments/b/PAR-27-064-Full-Announcement.html";
    const r = row({ guide_url: stored, guide_fetch_status: "ok", guide_fetched_at: days(9) });
    expect(preferredGuideUrl(r)).toBe(stored);
    expect(planGuideFetch(r, { now: NOW })).toEqual({ action: "fetch", url: stored, source: "simpler_attachment", reason: "refresh" });
  });
  it("skips a fresh row nothing changed", () => {
    expect(planGuideFetch(row({ guide_fetch_status: "ok", guide_fetched_at: days(1), source_updated_at: days(10) }), { now: NOW })).toEqual({ action: "skip", reason: "not_due" });
  });
  it("re-queues a forecast that posted: forecasted flips, source_updated_at moves past the not_applicable stamp", () => {
    const r = row({ forecasted: false, guide_fetch_status: "not_applicable", guide_fetched_at: days(20), source_updated_at: days(2) });
    expect(planGuideFetch(r, { now: NOW })).toMatchObject({ action: "fetch", reason: "was_not_applicable" });
  });
});

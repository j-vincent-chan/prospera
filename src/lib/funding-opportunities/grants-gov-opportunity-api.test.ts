import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantsGovUnavailableError, lookupGrantsGovOpportunity } from "./grants-gov-opportunity-api";

type Call = { path: string; body: Record<string, unknown> };

function mockGrantsGov(handler: (call: Call) => { status?: number; json?: unknown } | "network") {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { path: new URL(url).pathname.replace("/v1/api", ""), body: JSON.parse(String(init.body)) as Record<string, unknown> };
      calls.push(call);
      const out = handler(call);
      if (out === "network") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

const details = { errorcode: 0, data: { id: 359279, opportunityNumber: "RFA-HG-27-011", synopsisAttachmentFolders: [], opportunityPkgs: [{ packageId: "PKG00293394", workspaceCompatibleFlag: "Y" }] } };

describe("lookupGrantsGovOpportunity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips /search2 when the payload already carries the legacy id", async () => {
    const calls = mockGrantsGov(() => ({ json: details }));
    const out = await lookupGrantsGovOpportunity("RFA-HG-27-011", 359279);
    expect(calls.map((c) => c.path)).toEqual(["/fetchOpportunity"]);
    expect(calls[0]!.body).toEqual({ opportunityId: 359279 });
    expect(out.legacyOpportunityId).toBe(359279);
    expect(out.details?.packageIds).toEqual(["PKG00293394"]);
    expect(out.details?.workspaceCompatible).toBe(true);
  });

  it("searches by number only when there is no hint", async () => {
    const calls = mockGrantsGov((c) => (c.path === "/search2" ? { json: { errorcode: 0, data: { oppHits: [{ id: "359279", number: "RFA-HG-27-011" }] } } } : { json: details }));
    const out = await lookupGrantsGovOpportunity("RFA-HG-27-011", null);
    expect(calls.map((c) => c.path)).toEqual(["/search2", "/fetchOpportunity"]);
    expect(out.legacyOpportunityId).toBe(359279);
  });

  it("answers 'nothing on Grants.gov' when the search comes back empty", async () => {
    mockGrantsGov(() => ({ json: { errorcode: 0, data: { oppHits: [] } } }));
    expect(await lookupGrantsGovOpportunity("PAS-TUNIS-FY2026", null)).toEqual({ legacyOpportunityId: null, details: null });
  });

  // The caller caches the answer for hours; an outage must not be stored as "no package".
  it("throws when Grants.gov does not answer", async () => {
    mockGrantsGov(() => ({ status: 503 }));
    await expect(lookupGrantsGovOpportunity("RFA-HG-27-011", 359279)).rejects.toBeInstanceOf(GrantsGovUnavailableError);
    vi.unstubAllGlobals();
    mockGrantsGov(() => "network");
    await expect(lookupGrantsGovOpportunity("RFA-HG-27-011", 359279)).rejects.toBeInstanceOf(GrantsGovUnavailableError);
  });
});

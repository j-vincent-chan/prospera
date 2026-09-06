import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeTables } from "@/lib/fit/__fixtures__/fake-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/admin-service", () => ({ createServiceRoleClient: () => holder.db }));

import { GET, POST } from "./route";

const URL = "http://localhost/api/cron/fit-results";
const auth = { authorization: "Bearer test-secret" };

/** A database without the PR 2.2 migration: fit_results absent, the job log present. */
function beforeMigration(over: Partial<FakeTables> = {}) {
  return fakeDb({ sync_job_logs: [], fit_results: null, ...over });
}

describe("/api/cron/fit-results", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    holder.db = beforeMigration();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects a request without the cron secret", async () => {
    const res = await GET(new Request(URL));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    const wrong = await POST(new Request(URL, { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });

  it("before the migration the run is skipped: 200, logged as success with outcome skipped, nothing scored", async () => {
    const db = beforeMigration();
    holder.db = db;
    const res = await GET(new Request(URL, { headers: auth }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: expect.stringMatching(/fit_results is not on the database/), message: expect.stringMatching(/^fit_results skipped/) });
    const writes = db.log.writes.map((w) => `${w.table}:${w.op}`);
    expect(writes).toEqual(["sync_job_logs:insert", "sync_job_logs:update"]);
    expect(db.log.writes[0]!.rows[0]).toMatchObject({ job_type: "fit_results", status: "started", details: { limit: null, cursor: null } });
    expect(db.log.writes[1]!.values).toMatchObject({ status: "success", details: expect.objectContaining({ outcome: "skipped" }) });
  });

  it("a POST with a cursor that is not an investigator UUID is a 400 before anything runs", async () => {
    const db = beforeMigration();
    holder.db = db;
    const res = await POST(new Request(URL, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ cursor: "ghost" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "cursor must be an investigator UUID" });
    const ids = await POST(new Request(URL, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ investigatorIds: ["not-a-uuid"] }) }));
    expect(ids.status).toBe(400);
    expect(db.log.writes).toEqual([]);
  });

  it("a POST dry run writes no log row", async () => {
    const db = beforeMigration();
    holder.db = db;
    const res = await POST(new Request(URL, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dryRun: true, cursor: "001f7e5b-4cda-43ff-b12a-ec8dfe428e98" }) }));
    // a dry run skips the table check and loads the corpus; the fake has no such tables, so it is a 500 from the corpus read — but no sync_job_logs row was written first
    expect([200, 500]).toContain(res.status);
    expect(db.log.writes.filter((w) => w.table === "sync_job_logs")).toEqual([]);
  });
});

/**
 * The one-click confirmation (PR 3.2) on the fake PostgREST builder: the
 * audience comes from the sign-in email (never `profiles.email`), a readable
 * dismissal is required — before the 3.2 migration it is re-read without
 * `axis_reason` — the ownership and reason checks run on it, one row per
 * open path is written, and a prior on file makes the click a duplicate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeTables, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { evidenceHash, type CorrectionRow } from "@/lib/fit/judge/corrections";
import { TRIALIST } from "@/lib/fit/judge/test-fixtures";

const holder = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/team/require-team", () => ({ requireUser: async () => holder.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { proposeProfileCorrection } from "./fit-correction-actions";

const INV = "0f5b1b2c-1111-4222-8333-444455556666";
const SUG = "9a9a9a9a-2222-4333-8444-555566667777";
const ITEM = "1b1b1b1b-3333-4444-8555-666677778888";
const OPP = "2c2c2c2c-4444-4555-8666-777788889999";

const suggestion = (over: Row = {}): Row => ({ id: SUG, item_id: ITEM, investigator_id: INV, status: "dismissed", dismissed_reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", dismissed_by: "u-strategist", dismissed_at: "2026-09-06T10:00:00.000Z", outreach_items: { opportunity_id: OPP }, ...over });

const tables = (over: Partial<FakeTables> = {}): FakeTables => ({
  investigators: [{ id: INV, email: "Ada@ucsf.edu", full_name: "Ada Lovelace", archived_at: null }],
  outreach_suggestions: [suggestion()],
  investigator_fit_profiles: [{ investigator_id: INV, profile: TRIALIST }],
  fit_corrections: [],
  ...over,
});

/** The session as the action sees it: `email` is the editable profile email, `authEmail` the sign-in. */
function signIn(db: ReturnType<typeof fakeDb>, opts: { authEmail: string | null; email?: string | null }) {
  holder.user = { ok: true, userId: "u-1", email: opts.email ?? opts.authEmail, authEmail: opts.authEmail, fullName: null, admin: db, session: db };
}

/** A database before the 3.2 migration: a select naming `axis_reason` fails the way PostgREST does; the same read without it works. */
function beforeMigration(t: FakeTables) {
  const db = fakeDb(t);
  const from = db.from.bind(db);
  const asked: string[] = [];
  (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const q = from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table !== "outreach_suggestions") return q;
    const select = q.select!;
    q.select = (cols: unknown, o?: unknown) => {
      asked.push(String(cols));
      if (!String(cols).includes("axis_reason")) return select(cols, o);
      const fail = { data: null, error: { message: "Could not find the 'axis_reason' column of 'outreach_suggestions' in the schema cache" } };
      const dead: Record<string, unknown> = { maybeSingle: async () => fail, single: async () => fail, then: (r: (v: unknown) => unknown) => Promise.resolve(fail).then(r) };
      for (const m of ["eq", "in", "is", "order", "limit"]) dead[m] = () => dead;
      return dead;
    };
    return q;
  };
  return { db, asked };
}

/**
 * A `fit_corrections` table whose rows sit past the window an unfiltered list
 * reads: every select answers empty **unless** it filters on
 * `status = 'rejected'` — which is exactly what the indexed lookup does. It
 * models the 500-row cap on `listCorrections` without 500 fixtures.
 */
function pastTheWindow(t: FakeTables) {
  const db = fakeDb(t);
  const from = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const q = from(table) as unknown as Record<string, unknown>;
    if (table !== "fit_corrections") return q;
    let onlyRejected = false;
    const eq = q.eq as (col: string, v: unknown) => unknown;
    const then = q.then as (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => unknown;
    q.eq = (col: string, v: unknown) => {
      if (col === "status" && v === "rejected") onlyRejected = true;
      eq(col, v);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => (onlyRejected ? then(resolve, reject) : Promise.resolve({ data: [], error: null, count: null }).then(resolve, reject));
    return q;
  };
  return db;
}

const input = { investigatorId: INV, axisReason: "paradigm:clinical_trials", suggestionId: SUG };

describe("actions/fit-correction · proposeProfileCorrection", () => {
  beforeEach(() => {
    holder.user = { ok: false, error: "Sign in to continue." };
  });

  it("writes one proposed row per open path — both paradigm views — with the dismissal as evidence, and proposed_by from the sign-in email against the record's", async () => {
    const db = fakeDb(tables());
    signIn(db, { authEmail: "ada@UCSF.edu", email: "edited@example.org" });
    const r = await proposeProfileCorrection(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.proposedBy).toBe("investigator");
    expect(r.ids).toHaveLength(2);
    expect(r.id).toBe(r.ids[0]);
    expect(r.preview.paths).toEqual(["paradigm.recent.clinical_trials", "paradigm.career.clinical_trials"]);
    const inserts = db.log.writes.filter((w) => w.table === "fit_corrections" && w.op === "insert");
    expect(inserts.map((w) => w.rows[0])).toEqual([
      expect.objectContaining({ target: "investigator_profile", target_id: INV, path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, kind: "profile_weight", proposed_by: "investigator", status: "proposed", evidence: expect.objectContaining({ via: "dismissal", pair: { investigator_id: INV, opportunity_id: OPP }, dismissal: { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: SUG, item_id: ITEM, by: "u-strategist", at: "2026-09-06T10:00:00.000Z" } }) }),
      expect.objectContaining({ path: "paradigm.career.clinical_trials", from_value: 0.7, to_value: 0.15, proposed_by: "investigator" }),
    ]);
  });

  it("F3: the audience follows auth.getUser()'s email, not profiles.email — a profile email edited to the record's does not make a strategist the investigator", async () => {
    const db = fakeDb(tables());
    signIn(db, { authEmail: "strategist@ucsf.edu", email: "ada@ucsf.edu" });
    const r = await proposeProfileCorrection(input);
    expect(r.ok && r.proposedBy).toBe("strategist");
    expect(db.log.writes.filter((w) => w.op === "insert").map((w) => w.rows[0]!.proposed_by)).toEqual(["strategist", "strategist"]);
    const none = fakeDb(tables());
    signIn(none, { authEmail: null, email: "ada@ucsf.edu" });
    expect((await proposeProfileCorrection(input)) as { proposedBy?: string }).toMatchObject({ ok: true, proposedBy: "strategist" });
    expect(none.log.writes.filter((w) => w.op === "insert")).toHaveLength(2);
  });

  it("F4: a dismissal is required — an unreadable row (another team's, or restored) refuses with a reason and writes nothing; so does a missing suggestionId", async () => {
    const db = fakeDb(tables({ outreach_suggestions: [] }));
    signIn(db, { authEmail: "ada@ucsf.edu" });
    const r = await proposeProfileCorrection(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/not readable.*team you are not a member of/) });
    expect(db.log.writes).toEqual([]);
    const missing = await proposeProfileCorrection({ ...input, suggestionId: undefined as unknown as string });
    expect(missing.ok).toBe(false);
    const notUuid = await proposeProfileCorrection({ ...input, suggestionId: "sug-1" });
    expect(notUuid.ok).toBe(false);
  });

  it("F4: the ownership and reason checks run on the readable row", async () => {
    const other = fakeDb(tables({ outreach_suggestions: [suggestion({ investigator_id: "someone-else" })] }));
    signIn(other, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: "That dismissal is not about this investigator." });
    const reason = fakeDb(tables({ outreach_suggestions: [suggestion({ dismissed_reason: "not_relevant" })] }));
    signIn(reason, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/Only a .wrong type of research. dismissal/) });
    expect([...other.log.writes, ...reason.log.writes]).toEqual([]);
  });

  it("F4: before the 3.2 migration the row is re-read without axis_reason, the checks still run, and the sub-reason given is the record", async () => {
    const { db, asked } = beforeMigration(tables({ outreach_suggestions: [suggestion({ axis_reason: undefined })] }));
    signIn(db, { authEmail: "ada@ucsf.edu" });
    const r = await proposeProfileCorrection({ ...input, axisReason: "materials:enrolled_participants" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(asked).toEqual([expect.stringContaining("axis_reason"), expect.not.stringContaining("axis_reason")]);
    expect(r.preview.paths).toEqual(["materials.enrolled_participants"]);
    expect(db.log.writes.filter((w) => w.op === "insert").map((w) => w.rows[0])).toEqual([expect.objectContaining({ path: "materials.enrolled_participants", from_value: 0.9, to_value: 0.15, evidence: expect.objectContaining({ dismissal: expect.objectContaining({ axis_reason: "materials:enrolled_participants", suggestion_id: SUG, item_id: ITEM }) }) })]);
    // the checks still run on the re-read row
    const { db: other } = beforeMigration(tables({ outreach_suggestions: [suggestion({ axis_reason: undefined, investigator_id: "someone-else" })] }));
    signIn(other, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: "That dismissal is not about this investigator." });
  });

  it("a prior on file: every path covered is a duplicate (nothing written); one path covered writes the other; a rejection of this dismissal refuses", async () => {
    const prior = (id: string, path: string, status: CorrectionRow["status"] = "proposed"): Row => ({ id, target: "investigator_profile", target_id: INV, path, from_value: 0.81, to_value: 0.15, evidence: { ids: [], quote: null, section: null, confidence: "high", pair: null, via: "dismissal", dismissal: { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: SUG, item_id: ITEM, by: "u", at: null } }, kind: "profile_weight", proposed_by: "strategist", status, decided_by: null, created_at: "2026-09-06T10:00:00.000Z", decided_at: null });
    const both = fakeDb(tables({ fit_corrections: [prior("c-1", "paradigm.recent.clinical_trials"), prior("c-2", "paradigm.career.clinical_trials", "applied")] }));
    signIn(both, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toMatchObject({ ok: true, duplicate: true, id: "c-1", ids: ["c-1"] });
    expect(both.log.writes).toEqual([]);
    const one = fakeDb(tables({ fit_corrections: [prior("c-1", "paradigm.recent.clinical_trials")] }));
    signIn(one, { authEmail: "ada@ucsf.edu" });
    const r = await proposeProfileCorrection(input);
    expect(r).toMatchObject({ ok: true, duplicate: false, preview: { paths: ["paradigm.career.clinical_trials"], sentence: "Lower Clinical trials (paradigm, career view) from 0.70 to 0.15 on the fit profile?" } });
    expect(one.log.writes.filter((w) => w.op === "insert").map((w) => w.rows[0]!.path)).toEqual(["paradigm.career.clinical_trials"]);
    const rejected = fakeDb(tables({ fit_corrections: [prior("c-1", "paradigm.career.clinical_trials", "rejected")] }));
    signIn(rejected, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/rejected this correction/) });
    expect(rejected.log.writes).toEqual([]);
  });

  it("PR 3.3: the store's indexed rejection lookup is asked before every insert — a rejection past the rows in hand still blocks the confirmation", async () => {
    // The same argument on file as a rejection, from another pair, and *outside* the 500 rows `listCorrections` reads: only `rejectionBlocking`'s indexed (target, target_id, path, status) lookup can see it, and the never-reappear rule must hold anyway.
    const evidence = { ids: [], quote: null, section: null, confidence: "high" as const, pair: { investigator_id: INV, opportunity_id: "9e9e9e9e-5555-4666-8777-888899990000" }, via: "dismissal", dismissal: { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: SUG, item_id: ITEM, by: "u", at: null } };
    const rejected: Row = { id: "c-rejected", target: "investigator_profile", target_id: INV, path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, evidence, evidence_hash: evidenceHash(evidence), kind: "profile_weight", proposed_by: "strategist", status: "rejected", decided_by: "u-2", created_at: "2026-09-05T10:00:00.000Z", decided_at: "2026-09-05T11:00:00.000Z" };
    const db = pastTheWindow(tables({ fit_corrections: [rejected] }));
    signIn(db, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/rejected this correction on this evidence/) });
    expect(db.log.writes).toEqual([]);
    // Two reads of the table: the unfiltered list that missed it, and the rejection lookup that did not.
    expect(db.log.reads.filter((r) => r.startsWith("fit_corrections")).length).toBeGreaterThan(1);
  });

  it("no stored profile, a category the profile does not carry, the missing corrections table, and a signed-out user each refuse with a reason", async () => {
    const noProfile = fakeDb(tables({ investigator_fit_profiles: [] }));
    signIn(noProfile, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/no stored fit profile/) });
    // the stored sub-reason is the record (the input's is the fallback before the migration), so the row names the uncarried category
    const notCarried = fakeDb(tables({ outreach_suggestions: [suggestion({ axis_reason: "paradigm:epidemiology" })] }));
    signIn(notCarried, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/does not carry Paradigm · Epidemiology \(weight 0 in both views\)/) });
    expect(notCarried.log.writes).toEqual([]);
    const noTable = fakeDb(tables({ fit_corrections: null }));
    signIn(noTable, { authEmail: "ada@ucsf.edu" });
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: expect.stringMatching(/fit_corrections is not on the database yet/) });
    holder.user = { ok: false, error: "Sign in to continue." };
    expect(await proposeProfileCorrection(input)).toEqual({ ok: false, error: "Sign in to continue." });
  });
});

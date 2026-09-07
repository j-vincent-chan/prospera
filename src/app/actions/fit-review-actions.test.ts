/**
 * The review queue's writes (plan § PR 3.3) on the fake PostgREST builder:
 * the gate, the input validation, approve → patch + re-queue for the judge +
 * the re-score scope (synchronous under the ops bound, the nightly above it),
 * reject → status only for a `proposed` row and the reverse patch for an
 * `applied` one, and D6's "not your own profile" refusal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeTables, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { evidenceHash } from "@/lib/fit/judge/corrections";
import { TRIALIST } from "@/lib/fit/judge/test-fixtures";

const holder = vi.hoisted(() => ({ guard: null as unknown, ranked: [] as Array<{ how: string; id: string }>, roleAsked: [] as string[] }));

vi.mock("@/lib/team/require-team", async (orig) => ({ ...(await orig<Record<string, unknown>>()), requireTeamRole: async (minRole: string) => (holder.roleAsked.push(minRole), holder.guard) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/fit/service", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  supabaseFitStore: () => ({}),
  rankForInvestigator: async (_store: unknown, id: string) => (holder.ranked.push({ how: "investigator", id }), { results: [{}, {}, {}] }),
  rankForNotice: async (_store: unknown, id: string) => (holder.ranked.push({ how: "notice", id }), { results: [{}, {}] }),
}));

import { decideCorrection, markPairReviewed } from "./fit-review-actions";

const INV = "11111111-1111-4111-8111-111111111111";
const OPP = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_INV = "22222222-2222-4222-8222-222222222222";
const C_RECENT = "cccccccc-1111-4111-8111-111111111111";
const C_CAREER = "cccccccc-2222-4222-8222-222222222222";
const C_NOTICE = "cccccccc-3333-4333-8333-333333333333";
const C_GHOST = "cccccccc-9999-4999-8999-999999999999";

const dismissal = { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "s-1", item_id: "i-1", by: "u-9", at: "2026-09-06T07:00:00.000Z" };

function correctionRow(over: Row = {}): Row {
  const evidence = { ids: [], quote: null, section: null, confidence: "high" as const, pair: null, via: "dismissal", dismissal, ...((over.evidence as Row) ?? {}) };
  return { id: C_RECENT, target: "investigator_profile", target_id: INV, path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, evidence_hash: evidenceHash(evidence), kind: "profile_weight", proposed_by: "strategist", status: "proposed", decided_by: null, created_at: "2026-09-06T07:05:00.000Z", decided_at: null, rescored_at: null, ...over, evidence };
}

const noticeCorrection = (over: Row = {}): Row => correctionRow({ id: C_NOTICE, target: "opportunity_profile", target_id: OPP, path: "design.required_any", from_value: ["rct", "early_phase_trial"], to_value: ["rct"], kind: "misread_requirement", proposed_by: "judge", evidence: { ids: [], quote: "Applications must propose a clinical trial in participants with SLE.", section: "I", confidence: "high", pair: null, via: "reconciler" }, ...over });

/** `fit_results` rows: two judged pairs on the notice and one unjudged. */
const judged = (investigator_id: string, opportunity_id: string, adjudication: unknown = { reconciliation: { tier: "poor" } }): Row => ({ investigator_id, opportunity_id, tier: "poor", score: 12, adjudication });

/** A `fit_adjudications` row carrying a queued review item — what "mark reviewed" is for. The fake resolves both the alias and the stored blob. */
const adjudication = (over: { kind?: string | null; created_at?: string } = {}): Row => {
  const kind = over.kind === undefined ? "ai_flagged_lead" : over.kind;
  return { investigator_id: INV, opportunity_id: OPP, created_at: over.created_at ?? "2026-09-06T10:00:00.000Z", reviewed_at: null, reviewed_by: null, reconciliation: { result: { tier: "exploratory", review: kind ? { kind, note: "a methods transfer" } : null } }, review_kind: kind };
};

const tables = (over: Partial<FakeTables> = {}): FakeTables => ({
  fit_corrections: [correctionRow(), correctionRow({ id: C_CAREER, path: "paradigm.career.clinical_trials", from_value: 0.7 })],
  investigator_fit_profiles: [
    { investigator_id: INV, profile: JSON.parse(JSON.stringify(TRIALIST)), fit_judged_at: "2026-09-06T02:00:00.000Z" },
    { investigator_id: OTHER_INV, profile: JSON.parse(JSON.stringify(TRIALIST)), fit_judged_at: "2026-09-06T02:00:00.000Z" },
  ],
  opportunity_fit_profiles: [{ opportunity_id: OPP, profile: { opportunity_id: OPP, design: { required_any: ["rct", "early_phase_trial"] } } }],
  fit_results: [judged(INV, OPP), judged(OTHER_INV, OPP), { investigator_id: "33333333-3333-4333-8333-333333333333", opportunity_id: OPP, tier: "poor", score: 4, adjudication: null }],
  fit_adjudications: [adjudication()],
  investigators: [{ id: INV, email: "ada@ucsf.edu", full_name: "Ada Lovelace" }],
  ...over,
});

function signIn(db: ReturnType<typeof fakeDb>, over: { authEmail?: string | null; ok?: boolean; error?: string } = {}) {
  if (over.ok === false) holder.guard = { ok: false, error: over.error ?? "Owners and admins only." };
  else holder.guard = { ok: true, actor: { userId: "u-1", email: "s@ucsf.edu", authEmail: over.authEmail ?? "s@ucsf.edu", fullName: null, teamId: "t-1", role: "admin" }, admin: db, session: db };
}

beforeEach(() => {
  holder.ranked = [];
  holder.roleAsked = [];
});

describe("fit-review-actions · the gate and the input", () => {
  it("refuses a viewer the team guard rejects, asks it for admin, and never touches the tables", async () => {
    const db = fakeDb(tables());
    signIn(db, { ok: false, error: "Owners and admins only." });
    expect(await decideCorrection({ ids: [C_RECENT], decision: "approve" })).toEqual({ ok: false, error: "Owners and admins only." });
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP })).toEqual({ ok: false, error: "Owners and admins only." });
    // Deciding changes an institution-wide profile: a plain member reads the queue but does not write to it.
    expect(holder.roleAsked).toEqual(["admin", "admin"]);
    expect(db.log.writes).toHaveLength(0);
  });

  it("validates the shape before the gate: ids are UUIDs, at most eight, and the decision is approve or reject", async () => {
    const db = fakeDb(tables());
    signIn(db);
    expect(await decideCorrection({ ids: [], decision: "approve" })).toMatchObject({ ok: false });
    expect(await decideCorrection({ ids: ["not-a-uuid"], decision: "approve" })).toMatchObject({ ok: false });
    expect(await decideCorrection({ ids: [INV], decision: "sideways" as "approve" })).toEqual({ ok: false, error: "A decision is approve or reject." });
    expect(await markPairReviewed({ investigatorId: "nope", opportunityId: OPP })).toMatchObject({ ok: false });
    expect(db.log.writes).toHaveLength(0);
  });

  it("refuses when the corrections named are on different profiles, or do not exist", async () => {
    const db = fakeDb(tables({ fit_corrections: [correctionRow(), noticeCorrection()] }));
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT, C_NOTICE], decision: "approve" })).toEqual({ ok: false, error: "Those corrections are on different profiles; decide them separately." });
    expect(await decideCorrection({ ids: [C_GHOST], decision: "approve" })).toEqual({ ok: false, error: `No correction ${C_GHOST}.` });
  });

  it("says which migration is missing when fit_corrections is not on the database", async () => {
    const db = fakeDb(tables({ fit_corrections: null }));
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT], decision: "approve" })).toMatchObject({ ok: false, error: expect.stringContaining("20260919100000_fit_adjudications_corrections.sql") });
  });

  it("D6: an investigator may not decide a correction on their own fit profile", async () => {
    const db = fakeDb(tables());
    signIn(db, { authEmail: "Ada@UCSF.edu" });
    const r = await decideCorrection({ ids: [C_RECENT], decision: "approve" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("your own fit profile") });
    expect(db.log.writes).toHaveLength(0);
  });

  it("D6: an investigator-proposed correction on a subject with no directory email is refused — the check above cannot run", async () => {
    const db = fakeDb(tables({ fit_corrections: [correctionRow({ proposed_by: "investigator" })], investigators: [{ id: INV, email: null, full_name: "Ada Lovelace" }] }));
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT], decision: "approve" })).toMatchObject({ ok: false, error: expect.stringContaining("no email on file") });
    expect(db.log.writes).toHaveLength(0);
    // The judge's proposal on the same subject is decidable: no one can be closing their own loop.
    const judgeProposed = fakeDb(tables({ fit_corrections: [correctionRow({ proposed_by: "judge" })], investigators: [{ id: INV, email: null, full_name: "Ada Lovelace" }] }));
    signIn(judgeProposed);
    expect(await decideCorrection({ ids: [C_RECENT], decision: "approve" })).toMatchObject({ ok: true });
  });
});

describe("fit-review-actions · approve", () => {
  it("applies both view-rows of one proposal, patches the stored profile, re-queues the investigator for the judge, drops the stale adjudication and re-scores", async () => {
    const t = tables();
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_RECENT, C_CAREER], decision: "approve" });
    expect(r).toMatchObject({ ok: true, decision: "approve", target: "investigator_profile", targetId: INV, reQueued: 1, rescored: true, pairs: 3, investigators: 1 });

    const rows = t.fit_corrections as Row[];
    expect(rows.map((x) => x.status)).toEqual(["applied", "applied"]);
    expect(rows.every((x) => x.decided_by === "u-1" && typeof x.decided_at === "string" && typeof x.rescored_at === "string")).toBe(true);
    const profile = (t.investigator_fit_profiles as Row[])[0]!.profile as typeof TRIALIST;
    expect(profile.paradigm.recent.clinical_trials).toBe(0.15);
    expect(profile.paradigm.career.clinical_trials).toBe(0.15);
    // Re-queued for the judge, and every judged row of the subject reverted (adjudication cleared) — the LOWERED ones included.
    expect((t.investigator_fit_profiles as Row[])[0]!.fit_judged_at).toBeNull();
    expect((t.investigator_fit_profiles as Row[])[1]!.fit_judged_at).toBe("2026-09-06T02:00:00.000Z");
    expect((t.fit_results as Row[]).map((x) => x.adjudication)).toEqual([null, { reconciliation: { tier: "poor" } }, null]);
    expect(holder.ranked).toEqual([{ how: "investigator", id: INV }]);
  });

  it("a notice correction under the ops bound is re-scored in the action; every investigator judged against the notice goes back in the judge's queue", async () => {
    const t = tables({ fit_corrections: [noticeCorrection()] });
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_NOTICE], decision: "approve" });
    expect(r).toMatchObject({ ok: true, target: "opportunity_profile", targetId: OPP, investigators: 3, rescored: true, pairs: 2, reQueued: 2 });
    expect(r.ok && r.message).toContain("2 pairs re-scored");
    expect((t.opportunity_fit_profiles as Row[])[0]!.profile).toMatchObject({ design: { required_any: ["rct"] } });
    expect(holder.ranked).toEqual([{ how: "notice", id: OPP }]);
    expect((t.investigator_fit_profiles as Row[]).map((x) => x.fit_judged_at)).toEqual([null, null]);
    expect((t.fit_corrections as Row[])[0]).toMatchObject({ status: "applied", decided_by: "u-1" });
    expect((t.fit_corrections as Row[])[0]!.rescored_at).toEqual(expect.any(String));
  });

  it("a notice correction above the ops bound leaves rescored_at NULL for the nightly prelude, and says so", async () => {
    const many: Row[] = Array.from({ length: 40 }, (_, i) => ({ investigator_id: `inv-${i}`, opportunity_id: OPP, tier: "poor", score: 1, adjudication: null }));
    const t = tables({ fit_corrections: [noticeCorrection()], fit_results: many });
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_NOTICE], decision: "approve" });
    expect(r).toMatchObject({ ok: true, rescored: false, pairs: 0, investigators: 40 });
    expect(r.ok && r.message).toContain("re-scored by tonight's fit-results run");
    expect(holder.ranked).toEqual([]);
    expect((t.fit_corrections as Row[])[0]).toMatchObject({ status: "applied", rescored_at: null });
  });

  it("a grouped proposal is all-or-nothing: one row that no longer matches refuses the whole item, before the profile is touched", async () => {
    // The career view moved since the two rows were written (a rebuild, or another correction): applying the recent view alone would leave the career weight holding the gate.
    const moved = JSON.parse(JSON.stringify(TRIALIST));
    moved.paradigm.career.clinical_trials = 0.4;
    const t = tables({ investigator_fit_profiles: [{ investigator_id: INV, profile: moved, fit_judged_at: "2026-09-06T02:00:00.000Z" }] });
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_RECENT, C_CAREER], decision: "approve" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Nothing was changed.") });
    expect(r.ok === false && r.error).toContain("paradigm.career.clinical_trials is now 0.4, not 0.7");
    // The profile is untouched and both rows are still proposed — no write at all.
    expect((t.fit_corrections as Row[]).map((x) => x.status)).toEqual(["proposed", "proposed"]);
    expect(((t.investigator_fit_profiles as Row[])[0]!.profile as typeof TRIALIST).paradigm.recent.clinical_trials).toBe(0.81);
    expect(db.log.writes).toHaveLength(0);
    expect(holder.ranked).toEqual([]);
  });

  it("refuses two rows of one proposal that name the same path — one would be applied on top of the other", async () => {
    const db = fakeDb(tables({ fit_corrections: [correctionRow(), correctionRow({ id: C_CAREER, to_value: 0.2 })] }));
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT, C_CAREER], decision: "approve" })).toMatchObject({ ok: false, error: expect.stringContaining("Two rows of this proposal name paradigm.recent.clinical_trials") });
    expect(db.log.writes).toHaveLength(0);
  });

  it("refuses when the stored value has moved since the correction was proposed", async () => {
    const moved = JSON.parse(JSON.stringify(TRIALIST));
    moved.paradigm.recent.clinical_trials = 0.4;
    const t = tables({ investigator_fit_profiles: [{ investigator_id: INV, profile: moved, fit_judged_at: null }] });
    const db = fakeDb(t);
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT], decision: "approve" })).toMatchObject({ ok: false, error: expect.stringContaining("is now 0.4, not 0.81") });
    expect((t.fit_corrections as Row[])[0]!.status).toBe("proposed");
  });
});

describe("fit-review-actions · reject", () => {
  it("flips a proposed row without touching the profile or re-scoring — and the rejection is what stops it being proposed again", async () => {
    const t = tables();
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_RECENT, C_CAREER], decision: "reject" });
    expect(r).toMatchObject({ ok: true, decision: "reject", rescored: false, reQueued: 0 });
    const rows = t.fit_corrections as Row[];
    expect(rows.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    expect(rows[0]).toMatchObject({ decided_by: "u-1" });
    expect(rows[0]!.evidence_hash).toEqual(expect.any(String));
    expect((t.investigator_fit_profiles as Row[])[0]!.profile).toMatchObject({ paradigm: { recent: { clinical_trials: 0.81 } } });
    expect(holder.ranked).toEqual([]);
  });

  it("reverts the profile patch of an applied correction, then re-scores and re-queues", async () => {
    const patched = JSON.parse(JSON.stringify(TRIALIST));
    patched.paradigm.recent.clinical_trials = 0.15;
    const t = tables({ fit_corrections: [correctionRow({ status: "applied", decided_at: "2026-09-06T09:00:00.000Z", rescored_at: "2026-09-06T09:00:00.000Z" })], investigator_fit_profiles: [{ investigator_id: INV, profile: patched, fit_judged_at: "2026-09-06T02:00:00.000Z" }] });
    const db = fakeDb(t);
    signIn(db);
    const r = await decideCorrection({ ids: [C_RECENT], decision: "reject" });
    expect(r).toMatchObject({ ok: true, decision: "reject", rescored: true, reQueued: 1 });
    expect(((t.investigator_fit_profiles as Row[])[0]!.profile as typeof TRIALIST).paradigm.recent.clinical_trials).toBe(0.81);
    expect((t.fit_corrections as Row[])[0]).toMatchObject({ status: "rejected", decided_by: "u-1" });
    expect(holder.ranked).toEqual([{ how: "investigator", id: INV }]);
  });

  it("refuses to reverse an applied correction whose value has changed since, writing nothing", async () => {
    const later = JSON.parse(JSON.stringify(TRIALIST));
    later.paradigm.recent.clinical_trials = 0.5;
    const t = tables({ fit_corrections: [correctionRow({ status: "applied" })], investigator_fit_profiles: [{ investigator_id: INV, profile: later, fit_judged_at: null }] });
    const db = fakeDb(t);
    signIn(db);
    expect(await decideCorrection({ ids: [C_RECENT], decision: "reject" })).toMatchObject({ ok: false, error: expect.stringContaining("is 0.5, not the 0.15 this correction wrote") });
    expect((t.fit_corrections as Row[])[0]!.status).toBe("applied");
    expect(((t.investigator_fit_profiles as Row[])[0]!.profile as typeof TRIALIST).paradigm.recent.clinical_trials).toBe(0.5);
  });
});

describe("fit-review-actions · mark reviewed", () => {
  it("stamps the pair's adjudication rows and clears them again", async () => {
    const t = tables();
    const db = fakeDb(t);
    signIn(db);
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP })).toEqual({ ok: true, reviewed: true, rows: 1 });
    expect((t.fit_adjudications as Row[])[0]).toMatchObject({ reviewed_by: "u-1" });
    expect((t.fit_adjudications as Row[])[0]!.reviewed_at).toEqual(expect.any(String));
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP, reviewed: false })).toEqual({ ok: true, reviewed: false, rows: 1 });
    expect((t.fit_adjudications as Row[])[0]).toMatchObject({ reviewed_by: null, reviewed_at: null });
  });

  it("refuses a pair whose newest adjudication raises no queued review item, and one with no adjudication at all", async () => {
    // The pair was judged again and this time raised nothing (or a kind decided through its correction rows): there is nothing in the queue to clear.
    const settled = fakeDb(tables({ fit_adjudications: [adjudication({ created_at: "2026-09-01T10:00:00.000Z" }), adjudication({ kind: "structured_miss", created_at: "2026-09-08T10:00:00.000Z" })] }));
    signIn(settled);
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP })).toMatchObject({ ok: false, error: expect.stringContaining("raises no review item") });
    expect(settled.log.writes).toHaveLength(0);

    const none = fakeDb(tables({ fit_adjudications: [] }));
    signIn(none);
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP })).toMatchObject({ ok: false, error: expect.stringContaining("no stored adjudication row") });

    // Un-marking is always allowed: it puts the pair back in the queue and can never hide one.
    const unmark = fakeDb(tables({ fit_adjudications: [adjudication({ kind: "structured_miss" })] }));
    signIn(unmark);
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP, reviewed: false })).toMatchObject({ ok: true, reviewed: false });
  });

  it("names this PR's migration when fit_adjudications is not on the database", async () => {
    const db = fakeDb(tables({ fit_adjudications: null }));
    signIn(db);
    expect(await markPairReviewed({ investigatorId: INV, opportunityId: OPP })).toMatchObject({ ok: false, error: expect.stringContaining("20260921100000_fit_review_state.sql") });
  });
});

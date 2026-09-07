import { describe, expect, it } from "vitest";
import { alreadyDecided, applyCorrection, applyCorrectionToProfile, evidenceHash, fromCorrectionRow, hashOf, isGateInput, parseCorrectionPath, rejectCorrection, rejectedOnSameEvidence, rejectionBlocking, reverseCorrection, routeCorrection, toCorrectionRow, validateCorrection, validateCorrections, type CorrectionContext, type CorrectionRow, type CorrectionStore, type NewCorrectionRow } from "@/lib/fit/judge/corrections";
import { EVIDENCE_IDS, SECTIONS, SLE_TRIAL, TRIALIST } from "@/lib/fit/judge/test-fixtures";

/** The item classifier's paradigm vectors per short id (F11): the RCT paper and the R01 carry some translational work, the trial and the statement none. */
const ITEM_PARADIGMS = new Map([
  ["PMID:31000001", { clinical_trials: 0.8, translational: 0.4 }],
  ["NCT04000001", { clinical_trials: 1 }],
  ["5R01AR070001", { clinical_trials: 0.6, translational: 0.35 }],
  ["biosketch:statement", { clinical_trials: 0.9 }],
]);

const ctx: CorrectionContext = { evidenceIds: EVIDENCE_IDS, verifiedIds: ["PMID:31000001", "NCT04000001", "5R01AR070001", "biosketch:statement"], itemParadigms: ITEM_PARADIGMS, sections: SECTIONS, investigator: TRIALIST, notice: SLE_TRIAL };

const raw = (over: Record<string, unknown> = {}) => ({ target: "investigator", path: "design.rct", from: 0.7, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high", ...over });

describe("judge/corrections · path grammar", () => {
  it("knows the investigator and notice fields, strips the target prefix, maps a flat paradigm path to the recent view, and refuses topic and unknown fields", () => {
    expect(parseCorrectionPath("investigator", "investigator.design.rct")).toMatchObject({ path: "design.rct", keys: ["design", "rct"], value: "weight", group: "design" });
    expect(parseCorrectionPath("investigator", "paradigm.clinical_trials")).toMatchObject({ path: "paradigm.recent.clinical_trials", keys: ["paradigm", "recent", "clinical_trials"] });
    expect(parseCorrectionPath("investigator", "paradigm.career.translational")).toMatchObject({ keys: ["paradigm", "career", "translational"], group: "paradigm" });
    expect(parseCorrectionPath("investigator", "unit.l3")).toMatchObject({ path: "unit.L3", keys: ["unit", "L3"] });
    expect(parseCorrectionPath("investigator", "characteristics.trial_pi_count")).toMatchObject({ value: "count", group: "characteristics" });
    expect(parseCorrectionPath("investigator", "characteristics.mechanisms_held")).toMatchObject({ value: "codes" });
    expect(parseCorrectionPath("investigator", "topic.mesh_major")).toBeNull();
    expect(parseCorrectionPath("investigator", "design.nope")).toBeNull();
    expect(parseCorrectionPath("investigator", "design")).toBeNull();
    expect(parseCorrectionPath("notice", "notice.paradigm.required.human_biospecimen")).toMatchObject({ path: "paradigm.required.human_biospecimen", value: "weight", group: "paradigm" });
    expect(parseCorrectionPath("notice", "unit.required")).toMatchObject({ value: "unit_levels" });
    expect(parseCorrectionPath("notice", "design.prohibited")).toMatchObject({ value: "designs" });
    expect(parseCorrectionPath("notice", "materials.human_required")).toMatchObject({ value: "boolean" });
    expect(parseCorrectionPath("notice", "eligibility.esi_only")).toMatchObject({ value: "boolean", group: "eligibility" });
    expect(parseCorrectionPath("notice", "mechanism.clinical_trial")).toMatchObject({ value: "designation", group: "mechanism" });
    expect(parseCorrectionPath("notice", "paradigm.required")).toBeNull();
    expect(parseCorrectionPath("notice", "topic.terms")).toBeNull();
    expect(isGateInput(parseCorrectionPath("investigator", "design.rct")!)).toBe(true);
    expect(isGateInput(parseCorrectionPath("investigator", "materials.ehr")!)).toBe(false);
    expect(isGateInput(parseCorrectionPath("notice", "eligibility.esi_only")!)).toBe(true);
  });

  it("applies to a copy of the profile: a weight set, a zero weight removed, a list replaced, a count set; the original untouched", () => {
    const set = applyCorrectionToProfile(TRIALIST, { target: "investigator", path: "design.rct", to: 0.9 });
    expect(set.design.rct).toBe(0.9);
    expect(TRIALIST.design.rct).toBe(0.7);
    expect(applyCorrectionToProfile(TRIALIST, { target: "investigator", path: "design.rct", to: 0 }).design).not.toHaveProperty("rct");
    expect(applyCorrectionToProfile(TRIALIST, { target: "investigator", path: "characteristics.trial_pi_count", to: 6 }).characteristics.trial_pi_count).toBe(6);
    expect(applyCorrectionToProfile(SLE_TRIAL, { target: "notice", path: "unit.required", to: ["L3", "L4"] }).unit.required).toEqual(["L3", "L4"]);
    expect(applyCorrectionToProfile(SLE_TRIAL, { target: "notice", path: "paradigm.required.human_biospecimen", to: 0.8 }).paradigm.required).toEqual({ clinical_trials: 1, human_biospecimen: 0.8 });
    expect(() => applyCorrectionToProfile(TRIALIST, { target: "investigator", path: "topic.terms", to: [] })).toThrow(/unknown correction path/);
  });
});

describe("judge/corrections · validation against the taxonomy, the stored profile and the evidence (reconciler.md post-rule 1)", () => {
  it("keeps a well-formed investigator ingest miss with one verified id at high confidence and routes it auto", () => {
    const v = validateCorrection(raw(), ctx);
    expect(v.correction).toMatchObject({ target: "investigator", path: "design.rct", from: 0.7, to: 0.9, evidence_ids: ["NCT04000001"], kind: "ingest_miss", confidence: "high", route: "auto", quote: null });
    expect(v.dropped).toEqual([]);
    expect(routeCorrection({ target: "investigator", kind: "ingest_miss", confidence: "medium" })).toBe("provisional");
    expect(routeCorrection({ target: "investigator", kind: "profile_weight", confidence: "high" })).toBe("provisional");
    expect(routeCorrection({ target: "investigator", kind: "characteristic", confidence: "high" })).toBe("auto");
    expect(routeCorrection({ target: "notice", kind: "misread_requirement", confidence: "high" })).toBe("provisional");
  });

  it("drops and logs: an unknown path, a from that does not match, a to outside [0, 1], a to equal to the stored value, a kind that does not fit the target or the path", () => {
    const reasons = (over: Record<string, unknown>) => validateCorrection(raw(over), ctx).dropped.join(" | ");
    expect(validateCorrection(raw({ path: "topic.terms" }), ctx).correction).toBeNull();
    expect(reasons({ path: "topic.terms" })).toContain("path not known");
    expect(reasons({ from: 0.2 })).toContain("from_value 0.2 does not match the stored value 0.7");
    expect(reasons({ to: 1.4 })).toContain("outside [0, 1]");
    expect(reasons({ to: 0.7 })).toContain("to equals the stored value");
    expect(reasons({ kind: "misread_requirement" })).toContain("does not apply to a investigator correction");
    expect(reasons({ path: "characteristics.trial_pi_count", from: 4, to: 5, kind: "ingest_miss" })).toContain("needs kind characteristic");
    expect(reasons({ kind: "characteristic" })).toContain("kind characteristic does not apply to design.rct");
    expect(reasons({ target: "nowhere" })).toContain("target missing or unknown");
    expect(validateCorrection("x", ctx).dropped[0]).toContain("not an object");
  });

  it("evidence bar: ids not in the input are dropped and logged; an investigator field needs one verified id, a paradigm weight two (priors do not count)", () => {
    const none = validateCorrection(raw({ evidence_ids: ["PMID:1"] }), ctx);
    expect(none.correction).toBeNull();
    expect(none.dropped).toEqual(expect.arrayContaining([expect.stringContaining("id not in the input (PMID:1)"), expect.stringContaining("design.rct needs 1 verified evidence id, 0 given")]));
    const one = validateCorrection(raw({ path: "paradigm.recent.translational", from: 0.29, to: 0.5, kind: "profile_weight", evidence_ids: ["PMID:31000001"] }), ctx);
    expect(one.correction).toBeNull();
    expect(one.dropped.join(" ")).toContain("needs 2 verified evidence ids, 1 given");
    const two = validateCorrection(raw({ path: "paradigm.recent.translational", from: 0.29, to: 0.5, kind: "profile_weight", evidence_ids: ["PMID:31000001", "5R01AR070001"] }), ctx);
    expect(two.correction).toMatchObject({ path: "paradigm.recent.translational", route: "provisional" });
    const prior = validateCorrection(raw({ path: "paradigm.recent.translational", from: 0.29, to: 0.5, kind: "profile_weight", evidence_ids: ["PMID:31000001", "profiles:narrative"] }), { ...ctx, evidenceIds: [...EVIDENCE_IDS, "profiles:narrative"] });
    expect(prior.correction).toBeNull();
  });

  it("F11 · a paradigm weight's cited items must themselves be classified in the corrected category's family at ≥ thin_evidence.cap; a citation of items that show another paradigm is dropped", () => {
    const translational = raw({ path: "paradigm.recent.translational", from: 0.29, to: 0.5, kind: "profile_weight", evidence_ids: ["NCT04000001", "biosketch:statement"] });
    const wrongFamily = validateCorrection(translational, ctx);
    expect(wrongFamily.correction).toBeNull();
    expect(wrongFamily.dropped.join(" ")).toContain("paradigm.recent.translational needs 2 cited items classified in the translational family at ≥ 0.3, 0 carry it");
    // one carrier is not enough
    expect(validateCorrection(raw({ ...translational, evidence_ids: ["PMID:31000001", "NCT04000001"] }), ctx).dropped.join(" ")).toContain("1 carry it");
    // the family, not the exact category: human_biospecimen is translational too
    expect(validateCorrection(raw({ ...translational, evidence_ids: ["PMID:31000001", "5R01AR070001"] }), { ...ctx, itemParadigms: new Map([["PMID:31000001", { human_biospecimen: 0.5 }], ["5R01AR070001", { translational: 0.3 }]]) }).correction).toMatchObject({ path: "paradigm.recent.translational" });
    // below the cap does not count; without the vectors nothing carries
    expect(validateCorrection(raw({ ...translational, evidence_ids: ["PMID:31000001", "5R01AR070001"] }), { ...ctx, itemParadigms: new Map([["PMID:31000001", { translational: 0.29 }], ["5R01AR070001", { translational: 0.35 }]]) }).correction).toBeNull();
    expect(validateCorrection(raw({ ...translational, evidence_ids: ["PMID:31000001", "5R01AR070001"] }), { ...ctx, itemParadigms: undefined }).correction).toBeNull();
    // the bar is the paradigm axis's only: a design weight needs no family
    expect(validateCorrection(raw(), { ...ctx, itemParadigms: undefined }).correction).not.toBeNull();
  });

  it("a notice correction needs a verbatim quote: an elided or absent quote is dropped, a verbatim one verifies and records its section", () => {
    const base = { target: "notice", path: "paradigm.required.human_biospecimen", from: null, to: 0.6, evidence_ids: [], kind: "misread_requirement", confidence: "high" };
    expect(validateCorrection({ ...base, quote: null, section: null }, ctx).dropped.join(" ")).toContain("needs a verbatim quote");
    expect(validateCorrection({ ...base, quote: "Mechanistic studies ... are welcome", section: "Research Objectives" }, ctx).dropped.join(" ")).toContain("quote not verbatim");
    expect(validateCorrection({ ...base, quote: "Mechanistic studies in human blood are welcome", section: "Research Objectives" }, ctx).dropped.join(" ")).toContain("not found");
    const ok = validateCorrection({ ...base, quote: "Mechanistic studies in human tissue collected during the trial are welcome as correlative aims.", section: "Research Objectives" }, ctx);
    expect(ok.correction).toMatchObject({ target: "notice", path: "paradigm.required.human_biospecimen", from: null, to: 0.6, route: "provisional", verified_section: "Part 2 · Section I · Research Objectives" });
  });

  it("reads the reconciler's `paradigm.required += category` form as the leaf at the map's top weight; the list form validates ids and set-equality of from", () => {
    const plus = validateCorrection({ target: "notice", path: "notice.paradigm.required", from: null, to: "human_biospecimen", evidence_ids: [], quote: "Mechanistic studies in human tissue collected during the trial are welcome as correlative aims.", section: "Research Objectives", kind: "misread_requirement", confidence: "medium" }, ctx);
    expect(plus.correction).toMatchObject({ path: "paradigm.required.human_biospecimen", to: 1 });
    expect(plus.dropped[0]).toContain("read \"notice.paradigm.required += human_biospecimen\" as paradigm.required.human_biospecimen → 1");
    const list = validateCorrection({ target: "notice", path: "unit.allowed", from: [], to: ["L4", "l3"], evidence_ids: [], quote: "Applications must propose a clinical trial in participants with SLE.", section: "Research Objectives", kind: "misread_requirement", confidence: "high" }, ctx);
    expect(list.correction).toMatchObject({ path: "unit.allowed", to: ["L4", "L3"] });
    const badId = validateCorrection({ target: "notice", path: "design.allowed", from: ["biospecimen_assay"], to: ["biospecimen_assay", "telepathy"], evidence_ids: [], quote: "Applications must propose a clinical trial in participants with SLE.", section: "Research Objectives", kind: "misread_requirement", confidence: "high" }, ctx);
    expect(badId.dropped.join(" ")).toContain("outside the vocabulary (telepathy)");
    const wrongFrom = validateCorrection({ target: "notice", path: "design.allowed", from: ["rct"], to: ["biospecimen_assay", "bulk_omics"], evidence_ids: [], quote: "Applications must propose a clinical trial in participants with SLE.", section: "Research Objectives", kind: "misread_requirement", confidence: "high" }, ctx);
    expect(wrongFrom.dropped.join(" ")).toContain("does not match the stored value");
  });

  it("validateCorrections keeps the first of duplicate paths and tolerates a non-list", () => {
    const v = validateCorrections([raw(), raw({ to: 0.8 }), raw({ path: "characteristics.trial_pi_count", from: 4, to: 5, kind: "characteristic" })], ctx);
    expect(v.corrections.map((c) => `${c.path}=${c.to}`)).toEqual(["design.rct=0.9", "characteristics.trial_pi_count=5"]);
    expect(v.dropped).toEqual([expect.stringContaining("duplicate path design.rct")]);
    expect(validateCorrections("nope", ctx)).toMatchObject({ corrections: [], dropped: [expect.stringContaining("not a list")] });
    expect(validateCorrections(undefined, ctx)).toEqual({ corrections: [], dropped: [] });
  });
});

// ---------------------------------------------------------------------------
// The store: apply / reject on a fake
// ---------------------------------------------------------------------------

function memoryStore(profiles: { investigator?: unknown; notice?: unknown } = { investigator: JSON.parse(JSON.stringify(TRIALIST)), notice: JSON.parse(JSON.stringify(SLE_TRIAL)) }) {
  const rows: CorrectionRow[] = [];
  const saved: Array<{ target: string; id: string; profile: unknown }> = [];
  let seq = 0;
  const store: CorrectionStore = {
    async loadCorrection(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listCorrections(f) {
      return rows.filter((r) => r.target === f.target && r.target_id === f.target_id && (!f.status || r.status === f.status));
    },
    async insertCorrection(row) {
      const id = `c${++seq}`;
      rows.push({ ...row, id, created_at: new Date(seq * 1000).toISOString() });
      return id;
    },
    async updateCorrection(id, patch) {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
    async loadProfile(target) {
      return target === "investigator_profile" ? (profiles.investigator ?? null) : (profiles.notice ?? null);
    },
    async saveProfile(target, id, profile) {
      saved.push({ target, id, profile });
      if (target === "investigator_profile") profiles.investigator = profile;
      else profiles.notice = profile;
    },
    async tableMissing() {
      return false;
    },
  };
  return { store, rows, saved, profiles };
}

describe("judge/corrections · apply and reject on a fake store", () => {
  const pair = { investigator_id: "inv-lupus", opportunity_id: "opp-sle" };

  it("toCorrectionRow / fromCorrectionRow round-trip the pair, evidence and status", () => {
    const c = validateCorrection(raw(), ctx).correction!;
    const row = toCorrectionRow(c, pair, "proposed");
    expect(row).toMatchObject({ target: "investigator_profile", target_id: "inv-lupus", path: "design.rct", from_value: 0.7, to_value: 0.9, kind: "ingest_miss", proposed_by: "judge", status: "proposed", decided_at: null, evidence: { ids: ["NCT04000001"], confidence: "high", pair } });
    expect(toCorrectionRow(c, pair, "applied", { decidedAt: "2026-09-06T00:00:00.000Z" }).decided_at).toBe("2026-09-06T00:00:00.000Z");
    expect(fromCorrectionRow({ ...row, id: "x", created_at: "" })).toMatchObject({ target: "investigator", path: "design.rct", from: 0.7, to: 0.9, evidence_ids: ["NCT04000001"], kind: "ingest_miss", confidence: "high" });
  });

  it("applyCorrection patches the stored profile, marks the row applied, re-scores through the callback; a second apply and a moved value are refused", async () => {
    const m = memoryStore();
    const id = await m.store.insertCorrection(toCorrectionRow(validateCorrection(raw(), ctx).correction!, pair, "proposed"));
    const rescored: string[] = [];
    const r = await applyCorrection(m.store, id, { decidedBy: "user-1", now: () => new Date("2026-09-06T10:00:00.000Z"), rescore: async (t, i) => (rescored.push(`${t}:${i}`), "ok") });
    expect(r).toMatchObject({ ok: true, target: "investigator_profile", target_id: "inv-lupus", rescored: "ok" });
    expect((m.profiles.investigator as typeof TRIALIST).design.rct).toBe(0.9);
    expect(m.saved).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ status: "applied", decided_by: "user-1", decided_at: "2026-09-06T10:00:00.000Z" });
    expect(rescored).toEqual(["investigator_profile:inv-lupus"]);
    expect(await applyCorrection(m.store, id)).toMatchObject({ ok: false, error: "correction is applied, not proposed" });
    const id2 = await m.store.insertCorrection({ ...toCorrectionRow(validateCorrection(raw({ to: 0.95 }), ctx).correction!, pair, "proposed") });
    const moved = await applyCorrection(m.store, id2);
    expect(moved).toMatchObject({ ok: false, error: expect.stringContaining("is now 0.9, not 0.7") });
    expect(await applyCorrection(m.store, "ghost")).toMatchObject({ ok: false, error: "no such correction" });
  });

  it("rejectCorrection marks the row; alreadyDecided finds an open duplicate and a rejection on the same evidence, not a rejection on other evidence", async () => {
    const m = memoryStore();
    const c = validateCorrection(raw(), ctx).correction!;
    const id = await m.store.insertCorrection(toCorrectionRow(c, pair, "proposed"));
    expect(await rejectCorrection(m.store, id, { decidedBy: "user-2" })).toEqual({ ok: true });
    expect(m.rows[0]).toMatchObject({ status: "rejected", decided_by: "user-2" });
    expect(await rejectCorrection(m.store, id)).toMatchObject({ ok: false });
    const again: NewCorrectionRow = toCorrectionRow(c, pair, "proposed");
    expect(alreadyDecided(again, m.rows)?.id).toBe(id);
    const otherEvidence = toCorrectionRow({ ...c, evidence_ids: ["PMID:31000001"] }, pair, "proposed");
    expect(alreadyDecided(otherEvidence, m.rows)).toBeNull();
    const open = await m.store.insertCorrection(toCorrectionRow({ ...c, evidence_ids: ["PMID:31000001"] }, pair, "proposed"));
    expect(alreadyDecided(otherEvidence, m.rows)?.id).toBe(open);
    expect(alreadyDecided(toCorrectionRow({ ...c, to: 0.8 }, pair, "proposed"), m.rows)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PR 3.3: the evidence hash, the never-reappear rule, the reverse patch
// ---------------------------------------------------------------------------

describe("judge/corrections · rejected items never reappear for the same evidence (PR 3.3)", () => {
  const pair = { investigator_id: "inv-lupus", opportunity_id: "opp-sle" };
  const otherPair = { investigator_id: "inv-lupus", opportunity_id: "opp-other" };

  it("evidenceHash keys on the ids, quote, section, via and dismissal — not on the pair or the confidence", () => {
    const base = { ids: ["NCT04000001", "PMID:31000001"], quote: null, section: null, confidence: "high" as const, pair, via: "reconciler" };
    // The ids are a set: order and case do not change the hash.
    expect(evidenceHash({ ...base, ids: ["pmid:31000001", "NCT04000001"] })).toBe(evidenceHash(base));
    // The same argument from a second pair, or at a lower confidence, is the same argument.
    expect(evidenceHash({ ...base, pair: otherPair, confidence: "medium" })).toBe(evidenceHash(base));
    // A different id set, quote, section, via or dismissal is a different argument.
    expect(evidenceHash({ ...base, ids: ["PMID:31000001"] })).not.toBe(evidenceHash(base));
    expect(evidenceHash({ ...base, quote: "must lead a trial" })).not.toBe(evidenceHash(base));
    expect(evidenceHash({ ...base, via: "dismissal" })).not.toBe(evidenceHash(base));
    expect(evidenceHash({ ...base, dismissal: { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "s-1", item_id: null, by: null, at: null } })).not.toBe(evidenceHash(base));
    expect(evidenceHash(null)).toBe(evidenceHash({ ids: [], quote: null, section: null, confidence: "high", pair: null }));
    // toCorrectionRow stamps it, so the column and the recomputation agree.
    const c = validateCorrection(raw(), ctx).correction!;
    const row = toCorrectionRow(c, pair, "proposed");
    expect(row.evidence_hash).toBe(evidenceHash(row.evidence));
    expect(row.rescored_at).toBeNull();
  });

  it("blocks a re-proposal of the same edit on the same evidence hash — from any pair, and on a row stored before the migration filled the column", async () => {
    const m = memoryStore();
    const c = validateCorrection(raw(), ctx).correction!;
    const rejected = await m.store.insertCorrection(toCorrectionRow(c, pair, "proposed"));
    await rejectCorrection(m.store, rejected, { decidedBy: "user-2" });

    // The same argument raised again by a different pair carries the same hash.
    const again = toCorrectionRow(c, otherPair, "proposed");
    expect(again.evidence_hash).toBe(m.rows[0]!.evidence_hash);
    expect(rejectedOnSameEvidence(again, m.rows)?.id).toBe(rejected);
    expect(await rejectionBlocking(m.store, again)).toMatchObject({ id: rejected });

    // A row written before this PR's migration has no hash column; hashing its `evidence` gives the same answer.
    const legacyRows: CorrectionRow[] = m.rows.map((r) => ({ ...r, evidence_hash: undefined }));
    expect(rejectedOnSameEvidence(again, legacyRows)?.id).toBe(rejected);
    expect(hashOf(legacyRows[0]!)).toBe(again.evidence_hash);

    // Different evidence, or a different value, is a different argument and is proposable.
    expect(rejectedOnSameEvidence(toCorrectionRow({ ...c, evidence_ids: ["PMID:31000001"] }, pair, "proposed"), m.rows)).toBeNull();
    expect(rejectedOnSameEvidence(toCorrectionRow({ ...c, to: 0.8 }, pair, "proposed"), m.rows)).toBeNull();
  });

  it("the store's indexed lookup is asked when it has one, and falls back to listCorrections otherwise", async () => {
    const m = memoryStore();
    const c = validateCorrection(raw(), ctx).correction!;
    const id = await m.store.insertCorrection(toCorrectionRow(c, pair, "proposed"));
    await rejectCorrection(m.store, id);
    const asked: Array<Record<string, unknown>> = [];
    const indexed: CorrectionStore = { ...m.store, listRejected: async (f) => (asked.push(f), m.rows.filter((r) => r.status === "rejected" && r.target === f.target && r.target_id === f.target_id && (!f.path || r.path === f.path))) };
    expect(await rejectionBlocking(indexed, toCorrectionRow(c, pair, "proposed"))).toMatchObject({ id });
    expect(asked).toEqual([{ target: "investigator_profile", target_id: "inv-lupus", path: "design.rct" }]);
  });
});

describe("judge/corrections · reverseCorrection (PR 3.3: rejecting an applied correction puts the patch back)", () => {
  const pair = { investigator_id: "inv-lupus", opportunity_id: "opp-sle" };

  it("restores from_value, marks the row rejected and re-scores — only while the stored value is still the one it wrote", async () => {
    const m = memoryStore();
    const id = await m.store.insertCorrection(toCorrectionRow(validateCorrection(raw(), ctx).correction!, pair, "proposed"));
    await applyCorrection(m.store, id, { decidedBy: "user-1" });
    expect((m.profiles.investigator as typeof TRIALIST).design.rct).toBe(0.9);

    const rescored: string[] = [];
    const r = await reverseCorrection(m.store, id, { decidedBy: "user-2", now: () => new Date("2026-09-08T10:00:00.000Z"), rescore: async (t, i) => (rescored.push(`${t}:${i}`), "ok") });
    expect(r).toMatchObject({ ok: true, target: "investigator_profile", target_id: "inv-lupus", restored: 0.7, rescored: "ok" });
    expect((m.profiles.investigator as typeof TRIALIST).design.rct).toBe(0.7);
    expect(m.rows[0]).toMatchObject({ status: "rejected", decided_by: "user-2", decided_at: "2026-09-08T10:00:00.000Z" });
    expect(rescored).toEqual(["investigator_profile:inv-lupus"]);
    // Reversing twice, or reversing a row that was never applied, is refused.
    expect(await reverseCorrection(m.store, id)).toMatchObject({ ok: false, error: "correction is rejected, not applied" });
  });

  it("refuses — writing nothing — when the stored value has moved on since the correction was applied", async () => {
    const m = memoryStore();
    const id = await m.store.insertCorrection(toCorrectionRow(validateCorrection(raw(), ctx).correction!, pair, "proposed"));
    await applyCorrection(m.store, id);
    // Something else moved the same path after the correction was applied (a profile rebuild, a later correction).
    await m.store.saveProfile("investigator_profile", pair.investigator_id, applyCorrectionToProfile(m.profiles.investigator, { target: "investigator", path: "design.rct", to: 0.5 }));
    const savedBefore = m.saved.length;
    const r = await reverseCorrection(m.store, id, { decidedBy: "user-2" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("is 0.5, not the 0.9 this correction wrote") });
    expect(m.saved).toHaveLength(savedBefore);
    expect(m.rows[0]).toMatchObject({ status: "applied" });
    expect((m.profiles.investigator as typeof TRIALIST).design.rct).toBe(0.5);
  });

  it("puts a weight the correction had removed (to 0) back, and restores a notice list", async () => {
    const m = memoryStore();
    const zero = await m.store.insertCorrection(toCorrectionRow(validateCorrection(raw({ to: 0, confidence: "high" }), ctx).correction!, pair, "proposed"));
    await applyCorrection(m.store, zero);
    expect((m.profiles.investigator as typeof TRIALIST).design).not.toHaveProperty("rct");
    expect(await reverseCorrection(m.store, zero)).toMatchObject({ ok: true, restored: 0.7 });
    expect((m.profiles.investigator as typeof TRIALIST).design.rct).toBe(0.7);

    const list = validateCorrection({ target: "notice", path: "unit.required", from: ["L3"], to: ["L3", "L4"], quote: "Applications must propose a clinical trial in participants with SLE.", section: "I", kind: "misread_requirement", confidence: "high" }, ctx).correction!;
    const listId = await m.store.insertCorrection(toCorrectionRow(list, pair, "proposed"));
    await applyCorrection(m.store, listId);
    expect((m.profiles.notice as typeof SLE_TRIAL).unit.required).toEqual(["L3", "L4"]);
    expect(await reverseCorrection(m.store, listId)).toMatchObject({ ok: true });
    expect((m.profiles.notice as typeof SLE_TRIAL).unit.required).toEqual(["L3"]);
  });
});

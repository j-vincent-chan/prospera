/**
 * Rationale, gap sentence and "Why not?" from component provenance (spec §7
 * stage 9 "Emit the rationale from component provenance"; §10 Exploratory
 * and Poor paragraphs). Plain, deterministic text; stage 8 may replace the
 * rationale later.
 */
import { categoryLabel, levelLabel } from "@/lib/fit/taxonomy";
import type { StageResults, TierResult } from "@/lib/fit/engine/tier";
import { fmt } from "@/lib/fit/engine/util";

const list = (xs: readonly string[]) => xs.join(", ");
const labels = (xs: readonly string[]) => list(xs.map((c) => categoryLabel(c)));
const level = (l: string) => `${l} (${levelLabel(l)})`;

function requirementWord(r: "required" | "allowed" | "none"): string {
  return r === "required" ? "required" : r === "allowed" ? "allowed" : "unspecified";
}

/** "notice requires Genetic epidemiology, Epidemiology; yours is Clinical trials (support 0.38)". */
function paradigmClause(x: StageResults): string {
  const P = x.P;
  const notice = P.terms.flatMap((t) => t.notice);
  const yours = P.dominant ? `${categoryLabel(P.dominant.category)} (${fmt(P.dominant.weight)}, ${P.view} view)` : "no paradigm evidence";
  if (P.requirement === "none") return `notice names no paradigm requirement; yours is ${yours}`;
  const head = P.cross_cutting ? `cross-cutting investigator, compatibility from unit and design` : `notice ${P.requirement === "required" ? "requires" : "allows"} ${labels(notice)}; yours is ${yours}`;
  return `${head} (support ${fmt(P.P)})${P.excluded_hit ? `; the notice excludes ${categoryLabel(P.excluded_hit)}` : ""}`;
}

function designGroupsClause(x: StageResults): string {
  if (!x.D.groups.length) return "no design requirement";
  return x.D.groups.map((g) => `${g.designs.join(" | ")} required, ${g.best ? `${g.best} ${fmt(g.support)}` : "none in the evidence"}`).join("; ");
}

export function rationale(x: StageResults, t: TierResult): string {
  const c = x.components;
  const parts: string[] = [];
  const pair = x.P.best_pair;
  parts.push(`Paradigm ${fmt(c.P)} — ${x.P.cross_cutting ? "cross-cutting, from unit and design" : pair ? `${categoryLabel(pair.investigator)} (yours ${fmt(x.P.weights[pair.investigator] ?? 0)}) vs. ${requirementWord(x.P.requirement)} ${categoryLabel(pair.notice)}` : x.P.requirement === "none" ? "no requirement" : "no supporting paradigm"}${x.P.excluded_hit ? ` · ${categoryLabel(x.P.excluded_hit)} excluded` : ""}`);
  const up = x.U.best_pair;
  parts.push(`Unit ${fmt(c.U)} — ${up ? `${up.investigator} vs. ${requirementWord(x.U.requirement)} ${up.notice}` : x.U.requirement === "none" ? "no requirement" : "no supporting level"}`);
  parts.push(`Design ${fmt(c.D)} — ${designGroupsClause(x)}${x.D.penalized && x.D.dominant_prohibited ? `; ${x.D.dominant_prohibited} prohibited (${Math.round(x.D.prohibited_share * 100)}% of design mass)` : ""}`);
  const specific = x.T.coded.matches.filter((m) => m.depth === x.T.coded.max_depth)[0];
  parts.push(`Topic ${fmt(c.T)} — ${x.T.coded.matches.length} coded match${x.T.coded.matches.length === 1 ? "" : "es"}${specific ? ` (${specific.code} at depth ${specific.depth})` : ""}${x.T.overridden ? ", score supplied" : `; ${x.T.compatible.length} compatible item${x.T.compatible.length === 1 ? "" : "s"}${x.T.top_items.length ? ` (${list(x.T.top_items)})` : ""}`}`);
  parts.push(`Methods ${fmt(c.M)} — ${x.M.items.length ? `${x.M.met.length} of ${x.M.items.length}${x.M.missing.length ? `; missing ${list(x.M.missing)}` : ""}` : "notice names no methods"}`);
  parts.push(`Objective ${fmt(c.O)}`);
  parts.push(`Track record ${fmt(c.K)} — ${x.K.mechanisms_held.length ? `${list(x.K.mechanisms_held)} held` : "no NIH mechanism held"} vs. ${x.K.activity_code ?? "unknown code"}${x.K.far ? " (far above readiness)" : ""}`);
  const a = x.A.inputs;
  parts.push(`Actionability ${fmt(c.A)} — ${a.runway_weeks === null ? "deadline not on file" : `${a.runway_weeks} weeks to the deadline`}${a.in_pipeline ? ", in the pipeline" : ""}${a.recently_dismissed ? ", recently dismissed" : ""}${x.A.load ? ", heavy load" : ""}`);
  if (t.caps.length) parts.push(`Caps — ${t.caps.map((cap) => `${cap.id} (${cap.max_tier}: ${cap.reason})`).join("; ")}`);
  return parts.join(" · ");
}

/** The sentences naming each gap and, where possible, the fix (§10 Exploratory: "the rationale must name the gap"). */
export function gapSentences(x: StageResults, t: TierResult): string[] {
  const out: string[] = [];
  const nextTier = t.tier_by_floors === "moderate" ? "Strong" : t.tier_by_floors === "exploratory" ? "Moderate" : "Exploratory";
  const missed = new Map(t.missed_next.map((c) => [c.key, c]));
  const capIds = new Set(t.caps.map((c) => c.id));
  const collab = t.collaborators.length ? ` Collaborators in the directory who do this: ${list(t.collaborators)}.` : "";

  if (t.exception || t.aspiration_relaxed || capIds.has("paradigm_gate") || missed.has("P")) {
    out.push(`Paradigm: ${paradigmClause(x)}.${collab}`);
  }
  if (capIds.has("unit_gate") || missed.has("U")) {
    const notice = x.U.terms.flatMap((u) => u.notice);
    out.push(`Unit: notice works at ${notice.length ? list(notice.map(level)) : "an unspecified level"}; yours is ${x.U.dominant ? level(x.U.dominant.level) : "unknown"} (${fmt(x.U.U)}).`);
  }
  if (x.D.unmet_required.length) out.push(`Design: ${x.D.unmet_required.map((g) => `${g.join(" | ")} required, none in the evidence`).join("; ")}.${collab && !out.some((s) => s.includes("Collaborators")) ? collab : ""}`);
  else if (missed.has("D") || missed.has("D_required_group_min")) {
    const m = missed.get("D") ?? missed.get("D_required_group_min")!;
    out.push(`Design ${fmt(x.D.D)} is below the ${nextTier} floor ${m.floor}; ${designGroupsClause(x)}.`);
  }
  if (x.D.penalized && x.D.dominant_prohibited) out.push(`The notice prohibits ${x.D.dominant_prohibited}, ${Math.round(x.D.prohibited_share * 100)}% of the design evidence; the application, not the person, is constrained.`);
  if (missed.has("T") || missed.has("T_specific_depth")) {
    const m = missed.get("T") ?? missed.get("T_specific_depth")!;
    const why = m.key === "T_specific_depth" ? `no coded match at depth ≥ ${m.floor}` : `below the ${nextTier} floor ${m.floor}`;
    const unmatched = x.T.coded.unmatched.concat(x.opp.topic.terms).slice(0, 6);
    out.push(`Topic ${fmt(x.T.T)} is ${why}${unmatched.length ? `; not in the evidence: ${list(unmatched)}` : ""}.`);
  }
  if (missed.has("M")) out.push(`Methods ${fmt(x.M.M)} is below the ${nextTier} floor ${missed.get("M")!.floor}${x.M.missing.length ? `; missing ${list(x.M.missing)}` : ""}.`);
  if (missed.has("K") || capIds.has("readiness_far")) out.push(`Track record ${fmt(x.K.K)}: ${x.K.mechanisms_held.length ? `${list(x.K.mechanisms_held)} held` : "no NIH mechanism held"} against ${x.K.activity_code ?? "an unknown code"}${x.K.far ? " — far above readiness; consider as project lead, not PI" : ""}.`);
  if (missed.has("A") || capIds.has("runway_short")) {
    const a = x.A.inputs;
    const reasons = [a.runway_weeks === null ? "deadline not on file" : !x.A.runway_sufficient ? `${a.runway_weeks} weeks to the deadline, ${x.A.runway_needed_weeks} needed` : null, a.in_pipeline ? "already in the Outreach pipeline" : null, a.recently_dismissed ? "recently dismissed" : null].filter((r): r is string => r !== null);
    out.push(`Actionability: ${reasons.length ? list(reasons) : "insufficient"}.`);
  }
  if (missed.has("E") || capIds.has("eligibility_unknown")) out.push(`Eligibility not confirmed: ${list(x.E.unknown)}.`);
  if (missed.has("confidence") || capIds.has("low_profile_confidence") || capIds.has("low_notice_confidence")) {
    const bits = [`investigator profile ${t.profile_confidence}${x.ctx.investigator_pending_items > 0 ? ` (partial, ${x.ctx.investigator_pending_items} pending)` : ""}`, `notice profile ${x.opp.confidence}${x.ctx.notice_complete ? "" : " (incomplete)"}`];
    out.push(`Confidence: ${list(bits)}.`);
  }
  return out;
}

/** The "Why not?" line for a Poor pair (§10): the gates and floors that put it there. */
export function whyNot(x: StageResults, t: TierResult): string {
  const out: string[] = [];
  if (x.E.failed.length) out.push(`Ineligible: ${list(x.E.failed)}.`);
  const capIds = new Set(t.caps.map((c) => c.id));
  const missed = new Map(t.missed_next.map((c) => [c.key, c]));
  if (capIds.has("paradigm_gate") || t.exception || t.aspiration_relaxed || missed.has("P")) out.push(`Paradigm: ${paradigmClause(x)}.`);
  if (capIds.has("unit_gate") || missed.has("U")) {
    const notice = x.U.terms.flatMap((u) => u.notice);
    out.push(`Unit: notice works at ${notice.length ? list(notice.map(level)) : "an unspecified level"}; yours is ${x.U.dominant ? level(x.U.dominant.level) : "unknown"} (${fmt(x.U.U)}).`);
  }
  if (x.D.unmet_required.length) out.push(`Design: ${x.D.unmet_required.map((g) => `${g.join(" | ")} required, none in the evidence`).join("; ")}.`);
  if (missed.has("T")) out.push(`Topic ${fmt(x.T.T)} is below the Exploratory floor ${missed.get("T")!.floor}.`);
  if (!out.length) out.push(`Below the Exploratory floors: ${list(t.missed_next.map((c) => c.key))}.`);
  return out.join(" ");
}

export function explain(x: StageResults, t: TierResult): { rationale: string; gap: string | null; why_not: string | null } {
  const r = rationale(x, t);
  if (t.tier === "poor") return { rationale: r, gap: null, why_not: whyNot(x, t) };
  if (t.tier === "strong") return { rationale: r, gap: null, why_not: null };
  const sentences = gapSentences(x, t);
  return { rationale: r, gap: sentences.length ? sentences.join(" ") : null, why_not: null };
}

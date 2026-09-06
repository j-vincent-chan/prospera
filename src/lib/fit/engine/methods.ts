/**
 * Stage 6 · methods and capability alignment score (spec §7 stage 6).
 *
 *   M = share of the notice's required methods and capabilities with
 *       investigator evidence ≥ `compose.methods.evidence_min`
 *
 * The capabilities a notice names are its required design groups (any-of
 * within a group), its required materials (each), its any-of materials set
 * (one item) and its expected materials (each); infrastructure the notice
 * names (`ctx.infrastructure`) joins the same pool, with what the
 * investigator has at 1, what UCSF has institutionally at
 * `institutional_infrastructure_credit`, and the rest at 0 — the spec's
 * "blended with infrastructure fit where the notice names it". A notice
 * that names nothing has no capability gap: M = 1.
 */
import { methodsParams } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile, ScoreContext } from "@/lib/fit/types";
import { foldName, uniq, weightOf } from "@/lib/fit/engine/util";

export type CapabilityItem = {
  key: string;
  kind: "design" | "materials" | "infrastructure";
  label: string;
  /** The investigator's best weight behind it; null for infrastructure. */
  evidence: number | null;
  credit: number;
};

export type MethodsResult = { M: number; items: CapabilityItem[]; met: string[]; missing: string[] };

export function methods(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): MethodsResult {
  const p = methodsParams();
  const items: CapabilityItem[] = [];
  const seen = new Set<string>();
  const push = (item: CapabilityItem) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };
  const credit = (evidence: number) => (evidence >= p.evidence_min ? 1 : 0);

  for (const g of [opp.design.required_any, opp.design.required_any_2]) {
    if (!g.length) continue;
    const evidence = Math.max(0, ...g.map((d) => weightOf(inv.design, d)));
    push({ key: `design:${g.join("|")}`, kind: "design", label: g.join(" | "), evidence, credit: credit(evidence) });
  }
  for (const k of opp.materials.required) {
    const evidence = weightOf(inv.materials, k);
    push({ key: `materials:${k}`, kind: "materials", label: k, evidence, credit: credit(evidence) });
  }
  if (opp.materials.required_any.length) {
    const evidence = Math.max(0, ...opp.materials.required_any.map((k) => weightOf(inv.materials, k)));
    push({ key: `materials:${opp.materials.required_any.join("|")}`, kind: "materials", label: opp.materials.required_any.join(" | "), evidence, credit: credit(evidence) });
  }
  for (const k of opp.materials.expected) {
    const evidence = weightOf(inv.materials, k);
    push({ key: `materials:${k}`, kind: "materials", label: k, evidence, credit: credit(evidence) });
  }
  const infra = ctx.infrastructure;
  if (infra) {
    const has = new Set(infra.investigator.map(foldName));
    const institutional = new Set(infra.institutional.map(foldName));
    for (const name of uniq(infra.named.map((n) => n.trim()).filter((n) => n.length > 0))) {
      const key = foldName(name);
      const c = has.has(key) ? 1 : institutional.has(key) ? p.institutional_infrastructure_credit : 0;
      push({ key: `infrastructure:${key}`, kind: "infrastructure", label: name, evidence: null, credit: c });
    }
  }

  const M = items.length ? items.reduce((s, i) => s + i.credit, 0) / items.length : 1;
  const met = items.filter((i) => i.credit > 0).map((i) => (i.credit < 1 ? `${i.label} (institutional)` : i.label));
  const missing = items.filter((i) => i.credit === 0).map((i) => i.label);
  return { M, items, met, missing };
}

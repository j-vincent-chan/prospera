/**
 * Family placement for the gold set and the confusion matrix (plan § PR
 * 2.4; spec §13 "off-diagonal cells", §14 "paradigm confusion matrix").
 *
 * An investigator sits in the family of the dominant category of the view
 * the engine scores (`chooseView`: recent unless thin, then career — §7
 * stage 2); a notice sits in the family carrying the most `paradigm.required`
 * weight (the engine's `noticeFamilies().dominant`), else the heaviest
 * `required_any` category's family (D14 any-of), else nowhere ("none": a
 * broad notice). Cross-cutting investigators are placed in `cross_cutting`
 * — not a matrix row (§4: their compatibility comes from axes B–D), so they
 * never fill an adversarial cell.
 *
 * Pure: no Supabase, no fetch, no fixture import (the forbidden-cell list
 * comes from engine/fixtures.ts, which the scripts pass in).
 */
import { chooseView } from "@/lib/fit/engine/paradigm";
import { noticeFamilies } from "@/lib/fit/engine/eligibility";
import { heaviest } from "@/lib/fit/engine/util";
import { familyLabel, familyOf, isParadigmCategory, MATRIX_FAMILY_IDS, PARADIGM_CATEGORY_IDS } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, MatrixFamily, OpportunityFitProfile, ParadigmCategory, ParadigmFamily } from "@/lib/fit/types";

/** A family cell coordinate: a matrix family, `cross_cutting`, or `none` (no dominant category / no requirement). */
export type FamilySlot = ParadigmFamily | "none";

export const FAMILY_SLOTS: readonly FamilySlot[] = [...MATRIX_FAMILY_IDS, "cross_cutting", "none"];

export function familySlotLabel(slot: FamilySlot | string): string {
  if (slot === "none") return "none";
  if (slot === "cross_cutting") return "Cross-cutting";
  return familyLabel(slot);
}

export type InvestigatorFamilyView = {
  family: FamilySlot;
  category: ParadigmCategory | null;
  weight: number;
  view: "recent" | "career";
};

/** Pure. The family of the dominant category on the view the engine scores. */
export function investigatorFamily(inv: Pick<InvestigatorFitProfile, "paradigm">): InvestigatorFamilyView {
  const view = chooseView(inv);
  const top = heaviest(inv.paradigm[view], PARADIGM_CATEGORY_IDS);
  if (!top || !isParadigmCategory(top.id)) return { family: "none", category: null, weight: 0, view };
  return { family: familyOf(top.id), category: top.id, weight: top.weight, view };
}

export type NoticeFamilyView = {
  family: FamilySlot;
  /** `required`: the dominant required family; `required_any`: the heaviest any-of category's family; `none`. */
  from: "required" | "required_any" | "none";
  category: ParadigmCategory | null;
};

/** Pure. The family a notice requires. */
export function noticeFamily(opp: Pick<OpportunityFitProfile, "paradigm">): NoticeFamilyView {
  const fam = noticeFamilies(opp as OpportunityFitProfile);
  if (fam.dominant) {
    const inFamily = Object.fromEntries(Object.entries(opp.paradigm.required).filter(([c]) => isParadigmCategory(c) && familyOf(c) === fam.dominant));
    const top = heaviest(inFamily as OpportunityFitProfile["paradigm"]["required"], PARADIGM_CATEGORY_IDS);
    return { family: fam.dominant, from: "required", category: top && isParadigmCategory(top.id) ? top.id : null };
  }
  const any = heaviest(opp.paradigm.required_any, PARADIGM_CATEGORY_IDS);
  if (any && isParadigmCategory(any.id)) return { family: familyOf(any.id), from: "required_any", category: any.id };
  return { family: "none", from: "none", category: null };
}

export type FamilyCell = { investigator: MatrixFamily; notice: MatrixFamily };

export const cellKey = (inv: FamilySlot | string, notice: FamilySlot | string): string => `${inv}->${notice}`;

/** Pure. The 30 off-diagonal cells of the family matrix, investigator family × notice family, taxonomy order. */
export function offDiagonalCells(): FamilyCell[] {
  const out: FamilyCell[] = [];
  for (const a of MATRIX_FAMILY_IDS) for (const b of MATRIX_FAMILY_IDS) if (a !== b) out.push({ investigator: a, notice: b });
  return out;
}

export const isMatrixFamilySlot = (slot: FamilySlot | string): slot is MatrixFamily => (MATRIX_FAMILY_IDS as readonly string[]).includes(slot);

/** Pure. The forbidden-cell set as keys, from the fixture's pairs (engine/fixtures.ts `forbiddenCellPairs()`), so callers pass the list in and this module stays fixture-free. */
export function forbiddenCellKeys(pairs: ReadonlyArray<readonly [string, string]>): Set<string> {
  return new Set(pairs.map(([a, b]) => cellKey(a, b)));
}

/** Discovery and preclinical: the investigator families the primary metric watches (plan § PR 2.4 "evaluation framing"). */
export const BENCH_FAMILIES: readonly ParadigmFamily[] = ["discovery", "preclinical"];

/** Population and health systems: the notice families the primary metric watches, beside Clinical Trial Required notices. */
export const WRONG_TYPE_NOTICE_FAMILIES: readonly ParadigmFamily[] = ["population", "health_systems"];

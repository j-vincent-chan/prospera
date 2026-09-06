/**
 * Shared contract between the rule classifier (PR 1.2) and the LLM classifier
 * (PR 1.3). The shapes are owned by normalize.ts / rules.ts; this module only
 * re-exports them plus the two 1.3-local helpers, so the classifier depends on
 * the real modules and cannot drift from them.
 */
export type { NormalizedItem, NormalizedItemKind, NormalizedMeshHeading as NormalizedMesh } from "@/lib/fit/classify/normalize";
export type { Axis, AxisWeights, RuleClassification } from "@/lib/fit/classify/rules";
export { AXES } from "@/lib/fit/classify/rules";
import type { NormalizedItem } from "@/lib/fit/classify/normalize";
import type { RuleClassification } from "@/lib/fit/classify/rules";

export type RulesFn = (item: NormalizedItem) => RuleClassification;

export const noRules: RulesFn = () => ({ axes: {}, fired: [], firedAxes: [], refinedBy: [] });

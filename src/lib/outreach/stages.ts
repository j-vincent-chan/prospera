import type { OutreachStage, Outcome } from "@/lib/outreach/types";
import { STAGE_LABEL } from "@/lib/outreach/types";

/** Stage moves a person can make from the workspace; Submitted needs an outcome to leave. */
export function canMove(from: OutreachStage, to: OutreachStage, outcome: Outcome | null): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `Already in ${STAGE_LABEL[to]}.` };
  if (from === "submitted" && to !== "outcome" && to !== "parked" && !outcome) return { ok: false, reason: "Record the outcome before leaving Submitted." };
  if (to === "outcome" && !outcome) return { ok: false, reason: "Choose an outcome first." };
  return { ok: true };
}

/** Next stage the card's primary button leads to. */
export function nextStage(stage: OutreachStage): OutreachStage | null {
  switch (stage) {
    case "triage":
      return "contacting";
    case "contacting":
      return "developing";
    case "developing":
      return "submitted";
    case "submitted":
      return "outcome";
    default:
      return null;
  }
}

export function stageChangeText(to: OutreachStage, outcome?: Outcome | null): string {
  if (to === "outcome" && outcome) return `recorded the outcome · ${outcome.replace("_", " ")}`;
  return `moved to ${STAGE_LABEL[to]}`;
}

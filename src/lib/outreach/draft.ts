/**
 * Message drafting for the Compose tab. Templated from the notice brief (no
 * model needed); a per-recipient personal line comes from the strongest
 * verified reason. `{last name}` and the bracketed line are the only
 * placeholders, so what the strategist sees is what each person receives.
 */

import { fmtMonD, fmtMonDYear } from "@/lib/investigators/sources";
import type { SuggestionReason } from "@/lib/outreach/types";

export const PERSONAL_LINE_TOKEN = "[Personal line for each recipient]";
export const LAST_NAME_TOKEN = "{last name}";
export const DEFAULT_PERSONAL_LINE = "Your recent work looks like a strong fit for the scientific scope.";

export type DraftNotice = {
  title: string;
  opportunityNumber: string | null;
  agency: string | null;
  activityCode: string | null;
  clinicalTrialNote: string | null;
  dueDate: string | null;
  awardCeiling: number | null;
  projectYears: number | null;
  multiPi: boolean;
  routingDate: string | null;
};

export type DraftSender = { name: string; title: string | null; signature: string | null };

function money(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `$${Math.round(n / 1000)}K`;
}

export function buildSubject(n: DraftNotice): string {
  const code = n.activityCode ? ` (${n.activityCode})` : "";
  const due = n.dueDate ? ` — due ${fmtMonD(n.dueDate)}` : "";
  return `Funding opportunity: ${n.title.replace(/\s*\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")}${code}${due}`;
}

export function buildBody(n: DraftNotice, sender: DraftSender, mode: "one" | "personalized"): string {
  const sponsor = n.agency ?? "The sponsor";
  const what = [n.opportunityNumber, n.title.replace(/\s*\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")].filter(Boolean).join(", ");
  const mech = [n.activityCode ? `${n.activityCode}` : null, n.clinicalTrialNote ? n.clinicalTrialNote.toLowerCase() : null].filter(Boolean).join(", ");
  const due = n.dueDate ? `, due ${fmtMonDYear(n.dueDate)}` : "";
  const budget = [n.awardCeiling ? `Budgets run to ${money(n.awardCeiling)} direct per year` : null, n.projectYears ? `for up to ${n.projectYears} years` : null].filter(Boolean).join(" ");
  const team = n.multiPi ? "multi-PI applications are welcome" : null;
  const second = [budget, team].filter(Boolean).join(", and ");
  const personal = mode === "personalized" ? PERSONAL_LINE_TOKEN : DEFAULT_PERSONAL_LINE;
  const routing = n.routingDate ? ` and handle the internal routing (OSR date ${fmtMonDYear(n.routingDate)})` : "";
  const signoff = sender.signature?.trim()
    ? sender.signature.replace(/\{sender name\}/g, sender.name).replace(/\{sender title\}/g, sender.title ?? "Research Development")
    : [sender.name, sender.title ? `${sender.title} · Office of Collaborative Research` : "Office of Collaborative Research"].join("\n");
  return [
    `Dear Dr. ${LAST_NAME_TOKEN},`,
    "",
    `${sponsor} has posted ${what}${mech ? ` (${mech})` : ""}${due}.${second ? ` ${second[0]!.toUpperCase()}${second.slice(1)}.` : ""}`,
    "",
    personal,
    "",
    `If you’d like to pursue it, reply here and I’ll set up a 20-minute scoping call${routing}.`,
    "",
    "Best,",
    signoff,
  ].join("\n");
}

/** A one-line hook from the strongest verified reason. */
export function hookFromReasons(reasons: SuggestionReason[], opts: { contactedAt?: string | null; routingDate?: string | null; communityName?: string | null; facet?: string | null }): string {
  if (opts.contactedAt) return `Following up on my note from ${fmtMonD(opts.contactedAt)}${opts.routingDate ? `; the internal routing date is ${fmtMonD(opts.routingDate)}` : ""}.`;
  if (opts.communityName) return `Sharing with ${opts.communityName} because the notice’s ${opts.facet ?? "focus"} overlaps your curated focus.`;
  const r = reasons[0];
  if (!r) return DEFAULT_PERSONAL_LINE;
  const m = r.text.match(/“([^”]+)”/);
  if (r.source.startsWith("PubMed") && m) return `Your work on “${m[1]!.slice(0, 90)}” is close to what this notice is asking for.`;
  if (r.source.startsWith("RePORTER")) return `Your ${r.source.replace("RePORTER · ", "")} sits squarely in the scope here, and this notice would support a mechanistically distinct project.`;
  if (r.source.startsWith("Biosketch")) return "The focus you describe in your biosketch reads as a direct fit for this notice.";
  if (r.source.startsWith("Reply")) return "You mentioned interest in a similar notice earlier this year; this one is a closer fit.";
  return DEFAULT_PERSONAL_LINE;
}

export function renderForRecipient(input: { subject: string; body: string; lastName: string; personalLine: string | null }): { subject: string; body: string } {
  const body = input.body.replaceAll(LAST_NAME_TOKEN, input.lastName).replaceAll(PERSONAL_LINE_TOKEN, input.personalLine?.trim() || DEFAULT_PERSONAL_LINE);
  return { subject: input.subject.replaceAll(LAST_NAME_TOKEN, input.lastName), body };
}

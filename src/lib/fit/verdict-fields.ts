/**
 * The two fields the verdict row takes from outside the fit model (fit-UX
 * PR 3): the meta line under the title, and the right-hand column's one field
 * — a **deadline** on a notice, a **status** on a person (README §"Screens /
 * views" 2: one field, two captions). Pure.
 *
 * The row component owns the caption and the urgency word (`DUE_CAPTION`,
 * `DUE_URGENT_WORD`); this module owns the text and the tone, which are facts
 * about the notice's cycle or the person's contact history, not about the row.
 *
 * D-l left one question to this PR: **is a people-facing status ever urgent?**
 * It is — a person who was contacted and has not replied inside the reply
 * window is the row a strategist has to do something about, and `urgent` there
 * arrives as "Needs attention" above the line rather than as red alone. A
 * status that is merely uncontacted is `normal`; one that is finished
 * (declined, do-not-contact) is `quiet`.
 */
import { daysBetween, dueDisplay, fmtMonD, isoToday, type CycleFacts } from "@/lib/funding-opportunities/receipt-cycles";

/** Structurally `DueTone` from `components/fit/verdict-row-view.ts`; declared here so nothing under `lib/` imports a component module. */
export type FieldTone = "normal" | "urgent" | "quiet";

// ---------------------------------------------------------------------------
// Why a pair was ruled out (§3f — the footer's parenthetical)
// ---------------------------------------------------------------------------

/** The four things that rule a pair out, in the engine's own precedence. */
export type RuledOutReason = "eligibility" | "a different field" | "unit of analysis" | "the floors";

type RuledOutRow = { caps?: readonly string[] | null; components?: { E?: number } | null };

/**
 * Pure. One row's exclusion: the eligibility gate first (a fact about the
 * person), then the paradigm gate, then the unit gate, then the floors — the
 * same order `caveatOf` reads them in, so the footer's word and the row's
 * caveat can never name different things.
 */
export function ruledOutReasonOf(row: RuledOutRow): RuledOutReason {
  if (row.components?.E === 0) return "eligibility";
  const caps = new Set(row.caps ?? []);
  if (caps.has("paradigm_gate") || Array.from(caps).some((c) => c.startsWith("paradigm_gate_relaxed_"))) return "a different field";
  if (caps.has("unit_gate")) return "unit of analysis";
  return "the floors";
}

export type DueField = { text: string; tone: FieldTone };

const money = (n: number | null | undefined): string | null => {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}k direct / yr` : `$${new Intl.NumberFormat("en-US").format(Math.round(n))} direct / yr`;
};

export type NoticeMetaRow = {
  agency?: string | null;
  opportunity_number?: string | null;
  activity_code?: string | null;
  award_ceiling?: number | string | null;
};

/**
 * Pure. "NINDS · PAR-26-041 · R01 · $500k direct / yr" — the four facts the
 * prototype's meta line carries, each dropped when the notice does not have
 * it. Never a placeholder: a missing agency reads as one fewer clause, not as
 * "—", because the line is scanned rather than read.
 */
export function noticeMeta(row: NoticeMetaRow): string | null {
  const ceiling = typeof row.award_ceiling === "string" ? Number(row.award_ceiling) : row.award_ceiling;
  const parts = [row.agency?.trim() || null, row.opportunity_number?.trim() || null, row.activity_code?.trim() || null, money(ceiling)].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Pure. The notice's deadline as the row shows it: "Oct 5 · 28 days".
 *
 * `dueDisplay` is the app's own reading of a notice's receipt cycles and is
 * reused whole rather than re-derived — including its 30-day `urgent`
 * boundary, which is the vocabulary `DUE_URGENT_WORD`'s "Closing soon" was
 * written against. What changes is the order: the row's column is 132px and
 * leads with the date, where the page header leads with the countdown.
 */
export function noticeDue(facts: CycleFacts, today: string = isoToday()): DueField {
  const due = dueDisplay(facts, today);
  if (!due.date) return { text: due.primary, tone: "quiet" };
  if (due.tone === "closed" || due.tone === "muted" || due.tone === "forecast") return { text: due.primary, tone: "quiet" };
  const days = daysBetween(today, due.date);
  if (days < 0) return { text: due.primary, tone: "quiet" };
  const countdown = days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`;
  return { text: `${fmtMonD(due.date, today)} · ${countdown}`, tone: due.tone === "urgent" ? "urgent" : "normal" };
}

/** What a people-facing row's status column is built from — the Outreach recipient row, when there is one. */
export type ContactState = {
  /** `outreach_recipients.status`, or null when the person is not a recipient of this notice. */
  status?: string | null;
  /** The line the workspace already composes ("Contacted Sep 4 · no reply"). */
  line?: string | null;
};

/** Statuses that are finished: nothing is owed, so nothing is urgent. */
const SETTLED = new Set(["declined", "bounced", "replied_not_now"]);
/** Statuses waiting on the office rather than on the person. */
const NEEDS_REPLY = new Set(["contacted"]);

/**
 * Pure. The person's status: what the Outreach workspace already says where
 * there is a recipient row, "Not contacted" where there is not.
 *
 * "Not contacted" is a claim, so it is only made when the surface actually
 * looked — a caller with no contact information at all passes `null` and gets
 * no field, and the row draws no status rather than asserting one.
 */
export function personStatus(contact: ContactState | null | undefined): DueField | null {
  if (contact === null || contact === undefined) return null;
  const status = contact.status?.trim() || null;
  if (!status) return { text: "Not contacted", tone: "normal" };
  const text = contact.line?.trim() || status.replace(/_/g, " ");
  if (SETTLED.has(status)) return { text, tone: "quiet" };
  if (NEEDS_REPLY.has(status)) return { text, tone: "urgent" };
  return { text, tone: "normal" };
}

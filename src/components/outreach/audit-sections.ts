/**
 * The audit layer's presentation table (fit-UX PR 4; brief:
 * `docs/fit-ux/README.md` §"Screens / views" 4).
 *
 * Same split as `verdict-row-view.ts`, and for the same reason: there is no
 * DOM test environment in this repo (`vitest.config.ts` is `environment:
 * "node"` over `src/**\/*.test.ts`, tsconfig has `jsx: "preserve"`, no react
 * plugin), so every *decision* the audit view makes — the section order, the
 * class strings, the state words, the headings — lives in this plain `.ts`
 * module and is asserted by value in `audit-sections.test.ts`. What is left in
 * `evidence-view.tsx` is markup.
 *
 * **The section order is normative.** README §"Screens / views" 4 lists eight
 * sections top to bottom, mirroring the row's order, and `AUDIT_SECTIONS` is
 * that list. A test walks the component source and asserts the sections appear
 * in exactly this order — the one property of this view that a reader will
 * notice broken before any class string.
 */
import type { RowSubject } from "@/components/fit/verdict-row-view";
import type { AuditTone, EligibilityState, RequirementState } from "@/lib/fit/audit-view";
import type { CaveatTone, Tone } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// The eight sections, in the brief's order
// ---------------------------------------------------------------------------

export type AuditSectionId =
  | "provenance"
  | "header"
  | "recap"
  | "why"
  | "approach"
  | "rules"
  | "items"
  | "internals";

/** README §"Screens / views" 4, verbatim in order. The marker string is what the source test looks for. */
export const AUDIT_SECTIONS: ReadonlyArray<{ id: AuditSectionId; marker: string }> = [
  { id: "provenance", marker: "AUDIT-SECTION 1 provenance" },
  { id: "header", marker: "AUDIT-SECTION 2 header" },
  { id: "recap", marker: "AUDIT-SECTION 3 recap" },
  { id: "why", marker: "AUDIT-SECTION 4 why" },
  { id: "approach", marker: "AUDIT-SECTION 5 approach" },
  { id: "rules", marker: "AUDIT-SECTION 6 rules" },
  { id: "items", marker: "AUDIT-SECTION 7 items" },
  { id: "internals", marker: "AUDIT-SECTION 8 internals" },
];

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/** The whole view, on the card the list vacated. */
export const AUDIT_CARD = "rounded-card border border-line bg-card";

/** 1 · the provenance strip: back link, and where the evidence came from (§3j — said once). */
export const PROVENANCE_STRIP = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-row bg-footer-bar px-5 py-2.5";

export const BACK_LINK = "whitespace-nowrap text-dense font-medium text-teal hover:text-navy";

export const PROVENANCE_NOTE = "text-meta leading-normal text-ink-muted";

/** The strip's own sentence. Nothing here is the model's unless an item is cited beside it — the claim the whole view rests on. */
export const PROVENANCE_TAIL = "nothing here was written by the model without a cited item";

/** Pure. "Evidence snapshot saved Sep 4, 2026 · …". An unparseable timestamp drops the date rather than printing "Invalid Date". */
export function snapshotLine(iso: string | null | undefined): string {
  const when = iso ? new Date(iso) : null;
  const date = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  return `${date ? `Evidence snapshot saved ${date}` : "Evidence snapshot"} · ${PROVENANCE_TAIL}`;
}

/** 2 · the header. */
export const AUDIT_HEADER = "flex items-start justify-between gap-6 px-5 pb-4 pt-[18px]";

/** The 20px title the brief specifies. */
export const AUDIT_TITLE = "m-0 mt-2.5 text-[20px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink";

export const AUDIT_TITLE_LINK_HOVER = "hover:text-teal";

export const AUDIT_META = "mb-0 mt-1 text-dense text-ink-muted";

export const HEADER_CONTROLS = "flex shrink-0 items-center gap-3";

/** A quiet text control — the flag link, "Not this person", the inspector link. */
export const QUIET_LINK = "whitespace-nowrap rounded-control text-meta font-medium text-teal hover:text-navy";

// ---------------------------------------------------------------------------
// 3 · verdict recap
// ---------------------------------------------------------------------------

/** Three equal columns divided by `border-l border-line-row` (README §4.3). */
export const RECAP_GRID = "grid grid-cols-3 border-t border-line-row";

export const RECAP_COLUMN = "px-5 py-3.5";

/** Every column but the first carries the divider. */
export const RECAP_DIVIDER = "border-l border-line-row";

export const RECAP_LABEL = "mb-[5px] text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";

/** The verdict sentence in its tone colour. `ok` is the ink the rest of the view uses — a verdict that binds nothing must not read as an endorsement. */
export const RECAP_TONE: Record<Tone, string> = {
  ok: "text-ink",
  caution: "font-medium text-warning",
  blocking: "font-medium text-danger",
};

/** The three verdicts, in the order §3a keeps them: approach, eligibility, evidence. */
export const RECAP_ORDER = ["approach", "eligibility", "evidence"] as const;

export const RECAP_HEADING: Record<(typeof RECAP_ORDER)[number], string> = {
  approach: "Approach",
  eligibility: "Eligibility",
  evidence: "Evidence",
};

// ---------------------------------------------------------------------------
// Sections 4–8 · common furniture
// ---------------------------------------------------------------------------

export const SECTION_BOX = "border-t border-line px-5 py-4";

export const SECTION_LABEL = "text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";

/** README §4.4: the prose column is capped at 78ch so a full-width card does not become a full-width line. */
export const PROSE = "max-w-[78ch] text-body leading-relaxed text-ink";

export const BULLETS = "m-0 flex list-disc flex-col gap-[5px] pl-[18px] text-body leading-[1.5] text-ink";

/**
 * The caveat, on the audit view.
 *
 * **A deliberate addition to §4's section 4**, not a reordering of the eight.
 * The row's binding constraint is `caveatOf`'s, and three of the facts it
 * carries reach the reader through no other channel — a passed deadline, a
 * self-declared do-not-suggest family and Strong's `A` floor are stage-1 or
 * stage-9 facts that §3e keeps out of the eligibility table and that the
 * engine's `rationale` / `why_not` prose does not contain (D-f). Without this
 * line the audit view is the one surface in the redesign where the sentence
 * that decides the row is missing.
 */
export const CAVEAT_TONE: Record<CaveatTone, string> = {
  quiet: "text-ink-body",
  caution: "font-medium text-warning",
  blocking: "font-medium text-danger",
};

// ---------------------------------------------------------------------------
// 5 · approach, side by side
// ---------------------------------------------------------------------------

export const APPROACH_LABEL = "Approach, side by side";

export const APPROACH_GRID = "grid grid-cols-2 gap-4";

export const PANEL_BOX = "overflow-hidden rounded-tile border border-line";

export const PANEL_HEADING = "m-0 border-b border-line-row bg-footer-bar px-3 py-2 text-meta font-semibold text-ink";

/** The two panels' headings. */
export const PANEL_TITLE: Record<"notice" | "evidence", string> = {
  notice: "What the notice funds",
  evidence: "What the evidence shows",
};

/** One aligned row: a fixed label track so the two panels read across. */
export const AXIS_ROW = "grid grid-cols-[116px_minmax(0,1fr)] gap-2.5 border-t border-line-row px-3 py-2 text-dense leading-[1.45] first:border-t-0";

export const AXIS_LABEL = "text-ink-muted";

/** A divergent row in `text-warning` or `text-danger` (README §4.5). */
export const AXIS_TONE: Record<AuditTone, string> = {
  ok: "text-ink",
  caution: "font-medium text-warning",
  blocking: "font-medium text-danger",
};

// ---------------------------------------------------------------------------
// 6 · the two rule tables
// ---------------------------------------------------------------------------

export const RULES_GRID = "grid grid-cols-2 gap-4 border-t border-line px-5 py-4";

/** Kept apart in words as well as in derivation (§3e): one heading says who, the other says what. */
export const ELIGIBILITY_HEADING = "Eligibility · who may apply";

export const REQUIREMENTS_HEADING = "Notice requirements · what the application must contain";

export const RULE_TABLE = "rounded-tile border border-line";

/**
 * The two tables' headings, held to two lines' height so the boxes under them
 * start on the same line.
 *
 * **Measured at 1366px**, both surfaces: "Eligibility · who may apply" is one
 * line (13.2px) and "Notice requirements · what the application must contain"
 * is two (26.4px) at 324px and at 387px alike, so the right-hand table began
 * 13.2px lower than the left — two side-by-side tables that do not line up,
 * deterministically, at every width the card is ever drawn at. `text-label` is
 * 11px/1.2, so two lines is exactly `2.4em` whatever the type scale is
 * rebased to.
 */
export const RULE_HEADING = "mb-2.5 flex min-h-[2.4em] items-start";

/** The state column is wider on the requirements table: "Not met by the evidence" is four words, "Fails" is one. */
export const RULE_ROW: Record<"eligibility" | "requirements", string> = {
  eligibility: "grid grid-cols-[minmax(0,1fr)_78px] items-baseline gap-2.5 border-t border-line-row px-3 py-2.5 text-dense leading-[1.45] first:border-t-0",
  requirements: "grid grid-cols-[minmax(0,1fr)_120px] items-baseline gap-2.5 border-t border-line-row px-3 py-2.5 text-dense leading-[1.45] first:border-t-0",
};

export const RULE_NAME = "font-medium text-ink";

export const RULE_QUOTE = "text-ink-body";

export const RULE_STATE = "text-right text-meta";

export const ELIGIBILITY_STATE_CLASS: Record<EligibilityState, string> = {
  met: "font-medium text-success",
  fails: "font-semibold text-danger",
  unknown: "font-medium text-warning",
};

export const REQUIREMENT_STATE_CLASS: Record<RequirementState, string> = {
  met: "font-medium text-success",
  not_met: "font-medium text-warning",
  unknown: "font-medium text-warning",
};

/** What an empty table says. A blank box under a heading reads as a failure to load. */
export const NO_ELIGIBILITY_RULES = "The notice names no investigator restrictions.";

export const NO_REQUIREMENTS = "The notice names no requirement the evidence can be assessed against.";

/** Neither table can be filled without the notice's own record. */
export const NO_NOTICE_PROFILE = "No fit profile is on file for this notice, so nothing in it was checked against this evidence.";

// ---------------------------------------------------------------------------
// 7 · the items
// ---------------------------------------------------------------------------

export const ITEMS_LABEL = "The items this rests on";

export const ITEM_CARD = "rounded-tile border border-line bg-footer-bar px-3 py-2.5";

export const ITEM_TITLE = "m-0 text-dense font-medium leading-[1.4] text-ink";

export const ITEM_META = "mb-0 mt-[3px] text-meta text-ink-muted";

export const ITEM_QUOTE = "m-0 mt-2 border-l-2 border-line-control bg-card px-3 py-2 text-dense leading-normal text-ink-on-tint";

export const ITEM_LINK = "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[5px] border border-line bg-card px-[7px] text-micro font-medium text-ink-body hover:border-teal hover:text-teal";

export const INFERRED_MARK = "mr-1.5 inline-flex h-[18px] items-center rounded-[4px] bg-navy-tint px-1.5 align-middle text-micro font-medium text-navy";

/** C4: the label on a publication's identity control. The mechanism is `reviewIdentityAction`; the words say what it does to *this item*, not to the row. */
export const NOT_THIS_PERSON = "Not this person";

/**
 * B8 — the control an **empty** group offers, restored.
 *
 * The pre-PR-4 evidence view drew `EvidenceGroup.action` beside a group's
 * empty line: "Add profile ID" on a funding group with no RePORTER id,
 * "Request biosketch" / "Send reminder" on an empty self-described group.
 * `AuditItemGroup` had no field for it and `auditItemGroups` dropped it, so
 * both disappeared from the fit-v1 **and** the legacy path — the only
 * in-context prompts to fix the two most common data gaps in the directory.
 * The words are the snapshot's, not this file's; only the button is here.
 */
export const GROUP_ACTION = "inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas";

export const GROUP_EMPTY_ROW = "flex items-center justify-between gap-3";

/**
 * B8 — the footer's evidence link, restored.
 *
 * The pre-PR-4 footer carried "Flag evidence" beside the dismissal controls: a
 * link to the person's own page, where the evidence behind the suggestion can
 * be corrected. The header's flag control is a different mechanism ("Wrong
 * type of research…" opens the correction dialog), so losing this one lost the
 * route to the record itself. Drawn only where the surface supplies a
 * destination.
 */
export const FLAG_EVIDENCE = "Flag evidence";

// ---------------------------------------------------------------------------
// 8 · engine internals
// ---------------------------------------------------------------------------

export const INTERNALS_SUMMARY = "Engine internals · component scores, floors and caps";

export const INTERNALS_SUMMARY_CLASS = "cursor-pointer px-5 py-3 text-dense font-medium text-ink-body marker:text-ink-muted";

export const INTERNALS_BOX = "border-t border-line-row bg-footer-bar px-5 py-3.5";

/**
 * The frame the whole block is read through (README §4.8: "Framed as inputs to
 * the verdicts above, not a second opinion on them"). It also replaces the
 * three sentences of model explanation §2.2 objects to on the decision
 * surface — behind a `<details>`, where explaining the model is the point.
 */
export const INTERNALS_NOTE =
  "These are inputs to the verdicts above, not a second opinion on them. A tier is the set of floors a pair clears; S only orders pairs inside one tier. The floors are the ones in taxonomy.json.";

export const INTERNALS_NOTE_CLASS = "mb-2.5 mt-0 max-w-[78ch] text-meta leading-[1.5] text-ink-muted";

export const BARS_NOTE_CLASS = "mb-0 mt-3 text-meta leading-[1.5] text-ink-body";

/** What a Poor stub says instead of eight zero bars. */
export const NOT_SCORED = "This pair carries no component vector: the engine stopped before scoring it.";

export const INSPECTOR_LINK = "Open the admin fit inspector →";

/**
 * Pure. The admin inspector for the *counterpart* of the row — the person on a
 * people-facing list, the notice on a notice-facing one, which is the record
 * the reader is auditing.
 *
 * Both routes are behind `requireAdmin`, so a surface passes this only for an
 * admin viewer; a non-admin gets no link rather than one that 403s.
 */
export function inspectorHref(subject: RowSubject, id: string): string {
  return subject === "person" ? `/investigators/${id}/fit` : `/opportunities/${id}/fit`;
}

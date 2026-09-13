/**
 * The Review page's presentation table (README §"Design tokens" and §2). Pure:
 * every class string the page's components use, in one place, so the design's
 * measurements are values a test can read and no component carries a colour,
 * size or radius of its own. Same rules as `fit/verdict-row-view.ts`: every
 * class is an existing token (or an arbitrary value the README spells out),
 * and no string names one utility group twice, because `cn` joins and does
 * not merge.
 *
 * Why not `Button` and `Pill` for everything: the design's buttons come in
 * 26 / 28 / 30 / 34px with a 7px radius on the match row, and `Button` offers
 * 28 / 32 / 36 at 6px. Overriding a `Button` height with `h-[34px]` would put
 * two `h-*` classes on one element (rule 3), so the row's buttons are their
 * own strings here. The tier pill is `Pill` — its square variants are the
 * design's own table.
 */
import type { CaveatTone } from "@/lib/fit/verdicts";
import type { StatusTone } from "@/lib/review/reasons";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const PAGE = "mx-auto w-full max-w-[1720px]";
export const PAGE_HEADER = "flex flex-wrap items-center justify-between gap-4";
export const HEADER_ACTIONS_GROUP = "flex flex-wrap items-center gap-2.5";
export const H1 = "m-0 text-h1 font-semibold text-ink";
/** flex nowrap, column gap clamp(12px,1.4vw,20px), margin-top 16. */
export const LAYOUT = "mt-4 flex flex-nowrap items-start gap-[clamp(12px,1.4vw,20px)]";
export const MAIN_COLUMN = "flex min-w-[min(320px,100%)] flex-1 flex-col gap-3.5";

// ---------------------------------------------------------------------------
// The notice list (aside)
// ---------------------------------------------------------------------------

export const ASIDE = "sticky top-[60px] w-[clamp(200px,19vw,340px)] shrink-0 self-start overflow-hidden rounded-card border border-line bg-card";
export const ASIDE_LABEL = "m-0 border-b border-line-row px-4 py-3 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const QUEUE_ITEM = "block w-full border-b border-line-row px-4 py-3 text-left last:border-b-0";
/** The selected item: a 3px teal left rail and the selection tint. */
export const QUEUE_ITEM_SELECTED = "bg-teal-tint/30 shadow-[inset_3px_0_0_theme(colors.teal.DEFAULT)]";
export const QUEUE_ITEM_IDLE = "hover:bg-canvas";
export const QUEUE_NUMBER = "font-mono text-micro text-ink-muted";
export const QUEUE_DUE = "text-micro font-semibold";
export const QUEUE_DUE_TONE = { urgent: "text-danger", normal: "text-ink-body" } as const;
export const QUEUE_TITLE = "mt-1 block text-dense font-medium leading-[1.4] text-ink";
export const QUEUE_LINE = "mt-1.5 block text-micro text-ink-muted";
export const QUEUE_BAR = "mt-[7px] block h-[3px] overflow-hidden rounded-[2px] bg-line-row";
export const QUEUE_BAR_FILL = { partial: "block h-full bg-teal", done: "block h-full bg-line-control" } as const;

// ---------------------------------------------------------------------------
// The notice header card
// ---------------------------------------------------------------------------

export const CARD = "rounded-card border border-line bg-card";
export const HEADER_BOX = "px-5 pb-2 pt-[15px]";
export const HEADER_TOP = "flex flex-wrap items-start justify-between gap-4";
export const HEADER_LINE1 = "m-0 flex min-w-0 flex-wrap items-baseline gap-[9px]";
export const NUMBER = "font-mono text-meta font-semibold text-ink";
export const META = "text-meta text-ink-body";
export const FLAG = "text-meta font-semibold text-danger";
export const TITLE = "mb-0 mt-1.5 text-balance text-[20px] font-semibold leading-[1.25] tracking-[-0.018em] text-ink";
export const HEADER_ACTIONS = "ml-auto flex shrink-0 items-center gap-2.5";

export const PURSUIT_BUTTON = "inline-flex items-baseline gap-[9px] text-left text-body font-semibold text-ink hover:text-teal";
export const PURSUIT_DOT = { good: "h-2 w-2 shrink-0 self-center rounded-full bg-teal", caution: "h-2 w-2 shrink-0 self-center rounded-full bg-warning" } as const;
export const PURSUIT_CARET = "text-[10px] font-normal text-ink-muted";
export const PURSUIT_LINE = "mb-0 ml-[17px] mt-[7px] text-pretty text-dense leading-[1.6] text-ink-body";

export const KEY_DATES = "mt-4 flex flex-wrap gap-x-8 gap-y-2.5";
export const KEY_VALUE = "m-0 text-[18px] font-semibold leading-[1.2] tracking-[-0.015em] tabular-nums";
export const KEY_VALUE_TONE = { urgent: "text-danger", normal: "text-ink" } as const;
export const KEY_LABEL = "mb-0 mt-px text-micro leading-[1.4] text-ink-muted";
export const META_LINE = "mb-0 mt-[9px] text-meta leading-normal text-ink-muted";
export const SUMMARY = "mb-0 mt-[18px] text-pretty text-body leading-[1.65] text-ink";
export const SUMMARY_CLAMPED = "line-clamp-3";
export const TEXT_LINK = "mt-[7px] text-dense font-medium text-teal hover:text-navy";

// ---------------------------------------------------------------------------
// Buttons (README §"Buttons")
// ---------------------------------------------------------------------------

// No weight on the base: the primary match action is 600 and the rest 500, and a base weight plus an override is the double-group bug the test exists to catch.
const BTN = "inline-flex shrink-0 items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
/** 26px, teal text, `#cbd5e1` border — "Open opportunity ↗". */
export const BTN_OPEN = `${BTN} font-medium h-[26px] gap-1 rounded-control border border-line-control bg-card px-2.5 text-meta text-teal hover:border-slate-400 hover:bg-canvas`;
/** 30px primary — "Focus mode". */
export const BTN_PRIMARY_30 = `${BTN} font-medium h-[30px] rounded-control border border-navy bg-navy px-3 text-dense text-white hover:border-navy-hover hover:bg-navy-hover`;
/** 30px secondary — "Dismiss all N matches", "Next notice →", "Undo" in the header. */
export const BTN_SECONDARY_30 = `${BTN} font-medium h-[30px] rounded-control border border-line-control bg-card px-3 text-dense text-ink hover:border-slate-400 hover:bg-canvas`;
/** 30px tertiary: the same box with `#475569` text. */
export const BTN_TERTIARY_30 = `${BTN} font-medium h-[30px] rounded-control border border-line-control bg-card px-3 text-dense text-ink-body hover:border-slate-400 hover:bg-canvas hover:text-ink`;
/** 26px amber-bordered "Undo" / "Leave it with them" inside warn panels. */
export const BTN_WARN_26 = `${BTN} font-medium h-[26px] rounded-control border border-warning-border bg-card px-2.5 text-meta text-warning-dark hover:bg-warning-tint`;

/** Match-row actions: 34px, radius 7. */
const MATCH_BTN = `${BTN} h-[34px] rounded-[7px]`;
export const MATCH_PRIMARY = `${MATCH_BTN} border border-navy bg-navy px-3.5 text-dense font-semibold text-white hover:border-navy-hover hover:bg-navy-hover`;
export const MATCH_SECONDARY = `${MATCH_BTN} font-medium border border-line-control bg-card px-[13px] text-dense text-ink hover:border-slate-400 hover:bg-canvas`;
export const MATCH_WATCH = `${MATCH_BTN} font-medium border border-line-control bg-card px-[13px] text-dense text-ink-body hover:border-slate-400 hover:bg-canvas hover:text-ink`;
export const MATCH_DISCLOSURE = `${MATCH_BTN} font-medium border border-line bg-card px-3 text-meta text-teal hover:border-line-control hover:text-navy`;
/** Decided rows: only "Undo" (30px) beside the disclosure. */
export const MATCH_UNDO = `${BTN} font-medium h-[30px] rounded-[7px] border border-line-control bg-card px-3 text-dense text-ink-body hover:border-slate-400 hover:bg-canvas hover:text-ink`;

/** Reason chip: 27px, `#f0d6a8` border, `#5c3106` text; the hint suffix is 11/600 amber. */
export const REASON_CHIP = `${BTN} font-medium h-[27px] gap-1.5 rounded-control border border-warning-border bg-card px-2.5 text-meta text-warning-dark hover:bg-warning-tint`;
export const REASON_HINT = "text-micro font-semibold text-warning";

/** Strength tag: 24px, radius 5; selected is the accent tint. */
export const STRENGTH_TAG = `${BTN} font-medium h-6 rounded-[5px] border px-[9px] text-micro`;
export const STRENGTH_TAG_STATE = { on: "border-teal-tint bg-teal-tint text-teal", off: "border-line bg-card text-ink-muted hover:text-ink" } as const;

// ---------------------------------------------------------------------------
// The rows card
// ---------------------------------------------------------------------------

export const BULK_BANNER = "flex flex-wrap items-center justify-between gap-3.5 rounded-t-card border-b border-warning-border bg-warning-tint px-5 py-2.5";
export const BULK_TEXT = "m-0 text-dense leading-normal text-warning-dark";
export const ROWS_HEADER = "flex flex-wrap items-center justify-between gap-4 border-b border-line-row px-5 py-3";
export const ROWS_TITLE = "m-0 text-[15px] font-semibold text-ink";
export const ROWS_DECIDED = "text-meta text-ink-muted";
export const ROWS_FOOTER = "flex flex-wrap items-center justify-between gap-4 rounded-b-card border-t border-line-row bg-footer-bar px-5 py-[11px]";
export const FOOTER_NOTE = "m-0 text-meta text-ink-muted";
export const EMPTY_ROWS = "m-0 px-5 py-4 text-dense leading-normal text-ink-muted";

// ---------------------------------------------------------------------------
// A match row (README §2 "Rows")
// ---------------------------------------------------------------------------

/** Row padding by density: comfortable 14px, compact 11px. */
export const ROW_PAD = { comfortable: "px-5 py-3.5", compact: "px-5 py-[11px]" } as const;
export const ROW_BASE = "border-t border-line-row";
/** Backgrounds: focused (with the left rail) · rejected · other decided · default. */
export const ROW_TONE = {
  focused: "bg-teal-tint/30 shadow-[inset_3px_0_0_theme(colors.teal.DEFAULT)]",
  rejected: "bg-footer-bar",
  decided: "bg-footer-bar/50",
  default: "bg-card",
} as const;
export const ROW_GRID = "flex items-start gap-3";
export const AVATAR = "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-line-row text-dense font-semibold text-ink-body";
export const ROW_BODY = "min-w-0 flex-1";
export const ROW_LINE1 = "flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5";
export const ROW_NAME = "m-0 text-[15px] font-semibold leading-[1.3] text-ink";
export const ROW_NAME_LINK = "hover:text-teal";
export const STATUS_TEXT: Record<StatusTone, string> = {
  muted: "m-0 text-micro text-ink-muted",
  confirmed: "m-0 text-micro font-semibold text-teal",
  watching: "m-0 text-micro font-semibold text-warning",
  teammate: "m-0 text-micro font-semibold text-warning",
  dismissed: "m-0 text-micro font-semibold text-ink-body",
};
export const IDENTITY = "mb-0 mt-0.5 text-meta leading-[1.45] text-ink-muted";
export const REASON = "mb-0 mt-[7px] line-clamp-3 text-pretty text-dense leading-normal text-ink";
/** Caveat: 12/1.45, a 2px left border and text colour by tone. */
export const CAVEAT = "mb-0 mt-1.5 line-clamp-3 border-l-2 pl-2.5 text-meta leading-[1.45]";
export const CAVEAT_TONE: Record<CaveatTone, string> = {
  quiet: "border-line text-ink-body",
  caution: "border-warning-border text-warning",
  blocking: "border-danger-border text-danger",
};
export const ACTIONS = "mt-[11px] flex flex-wrap items-center gap-2";

/** Indented panels under the row: reasons, the confirmed note, the clash warning. All sit 50px in, under the text. */
export const REASONS_PANEL = "ml-[50px] mt-3 rounded-tile border border-warning-border bg-warning-tint px-3.5 py-3";
export const REASONS_PROMPT = "mb-[9px] mt-0 text-meta font-semibold text-warning-dark";
export const REASONS_CHIPS = "flex flex-wrap gap-1.5";
export const CONFIRMED_NOTE = "ml-[50px] mt-[11px] flex flex-wrap items-center gap-2.5";
export const CONFIRMED_TEXT = "m-0 text-meta text-ink-muted";
export const CONFIRMED_HINT = "text-micro text-ink-muted";
export const CLASH_PANEL = "ml-[50px] mt-2.5 flex flex-wrap items-center gap-3 rounded-tile border border-warning-border bg-warning-tint px-3 py-[9px]";
export const CLASH_TEXT = "m-0 text-meta leading-normal text-warning-dark";

/** The expanded assessment: full-bleed inside the card, indented past the avatar. */
export const ASSESSMENT = "-mx-5 -mb-3.5 mt-3.5 border-t border-line-row bg-footer-bar py-4 pl-[70px] pr-5";
export const ASSESSMENT_COMPACT = "-mx-5 -mb-[11px] mt-3.5 border-t border-line-row bg-footer-bar py-4 pl-[70px] pr-5";
export const ASSESSMENT_GRID = "grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-[26px]";
export const EYEBROW = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const EYEBROW_WARN = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-warning";
export const ASSESSMENT_WHY = "mb-0 mt-2 text-dense leading-[1.65] text-ink";
export const ASSESSMENT_CHIPS = "mt-[11px] flex flex-wrap gap-1.5";
export const HISTORY = { muted: "mb-0 mt-2.5 text-meta leading-normal text-ink-muted", warn: "mb-0 mt-2.5 text-meta leading-normal font-medium text-warning" } as const;
export const GAP_LIST = "mb-0 mt-2 list-disc pl-[18px] text-dense leading-[1.6] text-ink-body";
export const EVIDENCE_LIST = "mt-2 flex flex-col gap-2";
export const EVIDENCE_CARD = "rounded-tile border border-line bg-card px-3 py-2.5";
export const EVIDENCE_TITLE = "m-0 text-dense font-medium leading-[1.4] text-ink";
export const EVIDENCE_META = "mb-0 mt-[3px] text-micro text-ink-muted";
export const EVIDENCE_LINK = "whitespace-nowrap text-micro font-medium text-teal hover:text-navy";
export const COVERAGE = "mb-0 mt-2.5 text-meta text-ink-muted";

// ---------------------------------------------------------------------------
// The queued bar
// ---------------------------------------------------------------------------

export const QUEUED_BAR = "sticky bottom-4 mt-[18px] flex flex-wrap items-center justify-between gap-4 rounded-card bg-navy px-[18px] py-3 text-white shadow-dialog";
export const QUEUED_TEXT = "m-0 text-body text-white";
export const QUEUED_GHOST = `${BTN} font-medium h-8 rounded-control border border-white/[.28] bg-transparent px-3 text-dense text-white hover:bg-white/10`;
export const QUEUED_WHITE = `${BTN} font-medium h-8 rounded-control border border-white bg-white px-3 text-dense text-navy hover:bg-canvas`;

// ---------------------------------------------------------------------------
// Focus mode (README §3)
// ---------------------------------------------------------------------------

export const FOCUS_PROGRESS_ROW = "mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";
export const FOCUS_PROGRESS = "m-0 text-dense font-medium text-ink";
export const FOCUS_DECISIONS = "m-0 text-meta text-ink-muted";
export const FOCUS_BAR = "mt-2 h-1 w-full overflow-hidden rounded-[2px] bg-line";
export const FOCUS_BAR_FILL = "block h-full bg-teal";
export const FOCUS_TIER_ROW = "mt-4 flex flex-wrap items-center gap-2.5";
/** "Read Prospera's assessment", 34px with teal text. */
export const FOCUS_ASSESSMENT_BTN = `${BTN} h-[34px] font-medium rounded-tile border border-line-control bg-card px-3.5 text-dense text-teal hover:border-slate-400 hover:bg-canvas`;
/** Two cards, `repeat(auto-fit, minmax(420px, 1fr))`, stretched. */
export const FOCUS_GRID = "mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] items-stretch gap-[clamp(12px,1.2vw,20px)]";
export const FOCUS_CARD = "min-w-0 rounded-card border border-line bg-card px-[18px] py-4";
export const FOCUS_CARD_HEAD = "flex items-baseline justify-between gap-3";
export const FOCUS_SECTION = "mt-3.5 border-t border-line-row pt-[13px]";
export const FOCUS_SECTION_HEAD = "flex items-center justify-between gap-3";

export const PHOTO = "h-[108px] w-[108px] shrink-0 overflow-hidden rounded-full border border-line bg-line-row";
export const PHOTO_IMG = "h-full w-full object-cover";
export const FOCUS_NAME = "m-0 text-[20px] font-semibold leading-[1.2] tracking-[-0.018em] text-ink";
export const FOCUS_NAME_LINK = "hover:text-teal";
export const FOCUS_IDENTITY = "mb-0 mt-1 text-dense text-ink-body";
export const MICRO_LABEL = "text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-muted";
export const PARADIGM_VALUE = { known: "text-meta font-medium text-teal", unknown: "text-meta font-medium text-warning" } as const;
export const THEME_CHIP = "inline-flex h-[21px] items-center rounded-[5px] bg-line-row px-2 text-micro font-medium text-ink-on-tint";
export const FOCUS_SUMMARY = "mb-0 text-pretty text-body leading-[1.6] text-ink";
export const FOCUS_SUMMARY_CLAMPED = "line-clamp-6";
export const FOCUS_SUMMARY_SOURCE = "mb-0 mt-1 text-micro text-ink-muted";

export const PAGER_COUNT = "text-micro tabular-nums text-ink-body";
export const PAGER_BTN = "inline-flex h-6 w-6 items-center justify-center rounded-[5px] border bg-card p-0 text-dense leading-none";
export const PAGER_BTN_STATE = { on: "border-line-control text-ink hover:border-slate-400", off: "cursor-default border-line-row text-line-control" } as const;
/** A publication or award as a card-button: radius 8, border, 11px 13px. */
export const ITEM_CARD = "mt-2 block w-full rounded-tile border border-line bg-card px-[13px] py-[11px] text-left hover:border-line-control";
export const ITEM_TITLE = "min-w-0 text-dense font-medium leading-[1.45] text-ink";
export const ITEM_ROLE = { lead: "shrink-0 whitespace-nowrap text-micro font-semibold text-teal", other: "shrink-0 whitespace-nowrap text-micro font-semibold text-ink-muted" } as const;
export const ITEM_META = "mt-1 block text-meta text-ink-muted";
export const ITEM_RELEVANCE = "mt-[7px] block text-meta leading-[1.55] text-ink-body";
export const ITEM_MORE = "mt-[7px] block text-meta font-medium text-teal";
export const ITEM_PANEL = "mt-2 rounded-tile border border-line bg-footer-bar px-[13px] py-[11px]";
export const ITEM_PANEL_TEXT = "m-0 text-meta leading-[1.6] text-ink-body";
export const ITEM_PANEL_MONO = "mb-0 mt-[7px] font-mono text-micro text-ink-muted";
export const GRANT_DOT = { active: "inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-teal", closed: "inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-line-control" } as const;
export const GRANT_NUMBER = "font-mono text-dense font-semibold text-ink";
export const GRANT_SPONSOR = "text-meta text-ink-muted";
export const GRANT_STATE = { active: "shrink-0 text-micro font-semibold text-teal", closed: "shrink-0 text-micro font-semibold text-ink-muted" } as const;
export const GRANT_TITLE = "mt-[5px] block text-dense leading-[1.45] text-ink";
export const GRANT_LINE = "mt-[3px] block text-micro text-ink-muted";
export const EMPTY_WARN = "mb-0 mt-[9px] text-dense leading-[1.55] text-warning";

export const OPP_TITLE = "mb-0 mt-2 text-[20px] font-semibold leading-[1.2] tracking-[-0.018em] text-ink";
export const OPP_META = "mb-0 mt-[3px] text-dense text-ink-body";
export const KEY_FACTS = "mt-3.5 flex flex-wrap gap-x-[26px] gap-y-3.5 border-t border-line-row pt-[13px]";
export const KEY_FACT_VALUE = "m-0 text-[16px] font-semibold leading-[1.2] tabular-nums text-ink";
export const KEY_FACT_LABEL = "mb-0 mt-0.5 text-micro leading-[1.4] text-ink-body";
export const PRIORITY_CHIP = "inline-flex h-[22px] items-center rounded-[5px] bg-line-row px-2 text-micro font-medium text-ink-on-tint";
export const OBJECTIVE_ROW = "mt-2.5 grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5";
export const OBJECTIVE_NUMBER = "mt-px inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-line-row text-micro font-semibold tabular-nums text-ink-body";
export const OBJECTIVE_TITLE = "block text-dense font-medium leading-[1.4] text-ink";
export const OBJECTIVE_DETAIL = "mt-0.5 block text-meta leading-normal text-ink-body";
export const SMALL_TEXT = "mb-0 mt-[7px] text-pretty text-meta leading-[1.55] text-ink-body";
export const DASH_ITEM = "mb-0 mt-1.5 pl-[13px] -indent-[13px] text-meta leading-normal text-ink-body";

export const STRIP = "mt-3.5 rounded-card border border-line bg-card px-[18px] py-[11px]";
export const STRIP_LABEL = "mb-2 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const STRIP_CHIPS = "flex flex-wrap gap-2";
export const STRIP_CHIP = "inline-flex h-[30px] items-center gap-2 whitespace-nowrap rounded-control border px-2.5 text-meta";
export const STRIP_CHIP_STATE = { current: "border-teal bg-teal-tint text-ink", decided: "border-line bg-line-row text-ink", idle: "border-line bg-card text-ink hover:border-line-control" } as const;
export const STRIP_TIER = "text-micro text-ink-body";
export const STRIP_STATE = { undecided: "text-micro font-medium text-warning", decided: "text-micro text-ink-muted" } as const;

/** Sticky bottom 14px, z under the drawers' scrim, white on a `#cbd5e1` border with the shadow above. */
export const DECISION_BAR = "sticky bottom-[14px] z-30 mt-4 rounded-card border border-line-control bg-card shadow-[0_-2px_6px_rgba(11,29,58,0.05),0_6px_20px_rgba(11,29,58,0.13)]";
export const DECISION_ROW = "flex flex-wrap items-center gap-3 px-5 py-3.5";
export const DECISION_EYEBROW = "m-0 mr-1.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
/** 42px, radius 8, padding 0 18px, 15/600, gap 10. */
const FOCUS_BTN = `${BTN} h-[42px] gap-2.5 rounded-tile px-[18px] text-[15px] font-semibold tracking-[-0.005em]`;
export const FOCUS_PRIMARY = `${FOCUS_BTN} border border-navy bg-navy text-white shadow-[0_1px_2px_rgba(11,29,58,0.25)] hover:border-navy-hover hover:bg-navy-hover`;
export const FOCUS_SECONDARY = `${FOCUS_BTN} border border-line-control bg-card text-ink shadow-[0_1px_2px_rgba(11,29,58,0.05)] hover:border-slate-400 hover:bg-canvas`;
/** The keycap: 1px currentColor, radius 4, 1px 6px, Geist Mono 11, half opacity. */
export const KEYCAP = "inline-flex rounded-[4px] border border-current px-1.5 py-px font-mono text-micro font-medium leading-[1.3] opacity-50";
export const SKIP_TEXT = "px-1.5 text-dense font-medium text-ink-body hover:text-ink";
export const SKIP_NOTICE = `${BTN} ml-auto h-[34px] font-medium rounded-control border border-line bg-card px-[13px] text-dense text-ink-body hover:border-line-control hover:text-ink`;
export const FOCUS_REASONS = "border-t border-warning-border bg-warning-tint px-[18px] py-[13px]";
export const FOCUS_REASON_CHIP = `${BTN} h-7 gap-1.5 font-medium rounded-control border border-warning-border bg-card px-[11px] text-meta text-warning-dark hover:bg-warning-tint`;

/** "Every suggestion is decided." — the teal top rail. */
export const ALL_DONE = "mt-3.5 flex flex-wrap items-center justify-between gap-3.5 rounded-card border border-line bg-card px-5 py-4 shadow-[inset_0_2px_0_theme(colors.teal.DEFAULT)]";
export const ALL_DONE_TITLE = "m-0 text-[15px] font-semibold text-ink";
export const ALL_DONE_LINE = "mb-0 mt-1 text-dense leading-[1.55] text-ink-body";
export const ALL_DONE_BTN = `${BTN} h-[34px] font-medium rounded-control border border-navy bg-navy px-3.5 text-dense text-white hover:border-navy-hover hover:bg-navy-hover`;
export const FOCUS_NOTE_TEXT = "mb-0 mt-3 max-w-[74ch] text-meta leading-[1.6] text-ink-muted";

// ---------------------------------------------------------------------------
// The three drawers (README §4)
// ---------------------------------------------------------------------------

export const DRAWER_WIDTH = "min(560px, 94vw)";
export const DRAWER_WIDTH_ASSESSMENT = "min(540px, 94vw)";
export const DRAWER_EYEBROW = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const DRAWER_EYEBROW_TEAL = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-teal";
export const DRAWER_EYEBROW_WARN = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-warning";
export const DRAWER_TITLE = "mb-0 mt-2 text-[17px] font-semibold leading-[1.25] text-ink";
export const DRAWER_TITLE_SM = "mb-0 mt-2 text-[15px] font-semibold leading-[1.35] text-ink";
export const DRAWER_META = "mb-0 mt-[3px] text-dense text-ink-body";
export const DRAWER_BODY = "px-[22px] pb-7 pt-[18px]";
/** Sections after the first: 16px of padding over a hairline, 20px above. */
export const DRAWER_SECTION = "mt-5 border-t border-line-row pt-4";
export const DRAWER_TEXT = "mb-0 mt-2 text-pretty text-body leading-[1.65] text-ink";
export const DRAWER_SOURCE = "mb-0 mt-[5px] text-micro text-ink-muted";
export const FACT_ROW = "mt-2.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1";
export const FACT_KEY = "w-[120px] shrink-0 text-meta font-semibold text-ink";
export const FACT_VALUE = "min-w-0 flex-[1_1_240px] text-meta leading-[1.55] text-ink-body";
export const TERM_ROW = "mt-[11px]";
export const TERM_HEAD = "flex items-baseline justify-between gap-3";
export const TERM_LABEL = "text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted";
export const TERM_SOURCE = "shrink-0 text-right text-micro text-ink-muted";
export const TERM_VALUE = "mb-0 mt-[3px] text-meta leading-[1.55] text-ink-body";
export const DRAWER_FOOTER = "flex flex-wrap items-center justify-between gap-3";
export const DRAWER_FOOTER_NOTE = "m-0 text-micro text-ink-muted";
export const DRAWER_FOOTER_LINK = "text-dense font-medium text-teal hover:text-navy";

export const ASSESS_REASON = "m-0 text-pretty text-[15px] leading-[1.6] text-ink";
export const ASSESS_CAVEAT = "mb-0 mt-2.5 border-l-2 pl-2.5 text-dense leading-[1.5]";
export const ASSESS_DEEP = "mb-0 mt-3.5 border-t border-line-row pt-3.5 text-pretty text-body leading-[1.65] text-ink-body";
export const CHECK_ROW = "mt-[11px] grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5";
/** The 18px mark square: ✓ on the accent tint, ? on the warn tint, ✕ on the danger tint. */
export const CHECK_MARK = { yes: "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-teal-tint text-micro font-bold text-teal", unknown: "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-warning-tint text-micro font-bold text-warning", no: "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-danger-tint text-micro font-bold text-danger" } as const;
export const CHECK_CRITERION = "block text-dense font-medium leading-[1.4] text-ink";
export const CHECK_NOTE = "mt-0.5 block text-meta leading-normal text-ink-body";
export const NOT_CHECKED = "rounded-tile border border-warning-border bg-warning-tint px-3.5 py-3";
export const NOT_CHECKED_TITLE = "m-0 text-dense font-semibold text-warning-dark";
export const NOT_CHECKED_TEXT = "mb-0 mt-1 text-meta leading-[1.55] text-warning-dark";
export const ASSESS_GAP = "mb-0 mt-2 text-dense leading-[1.55] text-ink-body";
export const ASSESS_SIGNALS = "mt-[9px] flex flex-wrap gap-1.5";
export const ASSESS_FOOTER = "flex flex-wrap items-center gap-[9px]";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export const assessmentIdFor = (opportunityId: string, investigatorId: string): string => `review-${opportunityId}-${investigatorId}-assessment`;
export const disclosureLabel = (open: boolean): string => (open ? "Hide assessment" : "Read Prospera's assessment");

// ---------------------------------------------------------------------------
// Compare candidates (the brief's open item; lib/review/compare.ts)
// ---------------------------------------------------------------------------

export const COMPARE_WIDTH = "min(1180px, 94vw)";
export const COMPARE_TITLE = "m-0 text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink";
export const COMPARE_LINE = "mb-0 mt-1.5 text-dense leading-normal text-ink-body";
export const COMPARE_PICKS = "flex flex-wrap items-center gap-2 border-b border-line px-6 py-3";
export const COMPARE_PICK = `${BTN} h-7 rounded-full border px-3 text-dense font-medium`;
export const COMPARE_PICK_TONE = { on: "border-teal bg-teal-tint text-teal", off: "border-line-control bg-card text-ink-body hover:bg-canvas" } as const;
export const COMPARE_PICKS_NOTE = "text-micro text-ink-muted";
export const COMPARE_TABLE = "grid gap-x-4 px-6 py-4";
export const COMPARE_HEAD_CELL = "border-b border-line pb-3";
export const COMPARE_NAME = "m-0 text-body font-semibold text-ink";
export const COMPARE_IDENTITY = "mb-1.5 mt-0.5 text-micro text-ink-muted";
export const COMPARE_LABEL = "border-b border-line-row py-2.5 pr-2 text-micro font-semibold uppercase leading-[1.4] tracking-[0.06em] text-ink-muted";
export const COMPARE_CELL = "border-b border-line-row py-2.5 text-dense leading-[1.5]";
export const COMPARE_CELL_TONE = { good: "text-ink", warn: "text-warning-dark", danger: "text-danger", plain: "text-ink-body" } as const;
export const COMPARE_ACTIONS = "flex flex-wrap items-center gap-2 pt-3";
export const COMPARE_DECIDED = "text-dense text-ink-muted";

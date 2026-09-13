"use client";

import Link from "next/link";
import { useState } from "react";
import { VERDICT_LABEL_TEXT } from "@/components/fit/verdict-row-view";
import {
  ALL_DONE,
  ALL_DONE_BTN,
  ALL_DONE_LINE,
  ALL_DONE_TITLE,
  BTN_OPEN,
  DASH_ITEM,
  DECISION_BAR,
  DECISION_EYEBROW,
  DECISION_ROW,
  EMPTY_WARN,
  EYEBROW,
  FOCUS_ASSESSMENT_BTN,
  FOCUS_BAR,
  FOCUS_BAR_FILL,
  FOCUS_CARD,
  FOCUS_CARD_HEAD,
  FOCUS_DECISIONS,
  FOCUS_GRID,
  FOCUS_IDENTITY,
  FOCUS_NAME,
  FOCUS_NAME_LINK,
  FOCUS_NOTE_TEXT,
  FOCUS_PRIMARY,
  FOCUS_PROGRESS,
  FOCUS_PROGRESS_ROW,
  FOCUS_REASON_CHIP,
  FOCUS_REASONS,
  FOCUS_SECONDARY,
  FOCUS_SECTION,
  FOCUS_SECTION_HEAD,
  FOCUS_SUMMARY,
  FOCUS_SUMMARY_CLAMPED,
  FOCUS_SUMMARY_SOURCE,
  FOCUS_TIER_ROW,
  GRANT_DOT,
  GRANT_LINE,
  GRANT_NUMBER,
  GRANT_SPONSOR,
  GRANT_STATE,
  GRANT_TITLE,
  ITEM_CARD,
  ITEM_META,
  ITEM_MORE,
  ITEM_PANEL,
  ITEM_PANEL_MONO,
  ITEM_PANEL_TEXT,
  ITEM_RELEVANCE,
  ITEM_ROLE,
  ITEM_TITLE,
  KEY_FACT_LABEL,
  KEY_FACT_VALUE,
  KEY_FACTS,
  KEYCAP,
  MICRO_LABEL,
  OBJECTIVE_DETAIL,
  OBJECTIVE_NUMBER,
  OBJECTIVE_ROW,
  OBJECTIVE_TITLE,
  OPP_META,
  OPP_TITLE,
  PAGER_BTN,
  PAGER_BTN_STATE,
  PAGER_COUNT,
  PARADIGM_VALUE,
  PHOTO,
  PHOTO_IMG,
  PRIORITY_CHIP,
  REASON_HINT,
  REASONS_CHIPS,
  REASONS_PROMPT,
  SKIP_NOTICE,
  SKIP_TEXT,
  SMALL_TEXT,
  STRIP,
  STRIP_CHIP,
  STRIP_CHIP_STATE,
  STRIP_CHIPS,
  STRIP_LABEL,
  STRIP_STATE,
  STRIP_TIER,
  TEXT_LINK,
  THEME_CHIP,
} from "@/components/review/review-view";
import { Pill } from "@/components/ui/pill";
import type { VerdictLabel } from "@/lib/fit/verdicts";
import type { MatchDecision } from "@/lib/review/decisions";
import { decisionsLine, doneLine, FOCUS_NOTE, focusActions, PARADIGM_UNKNOWN, pageLabel, progressLine, progressPercentOf, type FocusProfile } from "@/lib/review/focus";
import type { ReviewNoticeHeader, ReviewRow } from "@/lib/review/queries";
import { REVIEW_REASONS, statusText, type DecisionStatus } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";

export type FocusRow = ReviewRow & { decision: MatchDecision | null };

/** The label the row shows: a standing pair flag reads as Ruled out, as on the list. */
export const focusLabelOf = (row: FocusRow): VerdictLabel => (row.flag && !row.decision ? "ruled_out" : row.verdicts.label);

const LARGE_PILL: Record<VerdictLabel, "tier-strong-large" | "tier-moderate-large" | "tier-exploratory-large" | "tier-cannot-assess-large" | "tier-ruled-out-large"> = {
  strong: "tier-strong-large",
  moderate: "tier-moderate-large",
  exploratory: "tier-exploratory-large",
  cannot_assess: "tier-cannot-assess-large",
  ruled_out: "tier-ruled-out-large",
};

export type DrawerKind = "profile" | "opportunity" | "assessment";

export type FocusViewProps = {
  header: ReviewNoticeHeader;
  rows: readonly FocusRow[];
  cursor: number;
  noticeIndex: number;
  noticeCount: number;
  /** Across the queue, after this page's own decisions. */
  queueUndecided: number;
  queueTotal: number;
  confirmedTotal: number;
  profile: FocusProfile | null;
  profileLoading: boolean;
  rejecting: boolean;
  undecidedOnNotice: number;
  canDecide: boolean;
  onDecide: (investigatorId: string, status: DecisionStatus, reason: string | null) => void;
  onOpenReasons: () => void;
  onSkip: () => void;
  onSkipNotice: () => void;
  onJump: (index: number) => void;
  onOpenDrawer: (kind: DrawerKind) => void;
  onExitFocus: () => void;
};

/**
 * Focus mode (README §3): one match at a time, filling the screen — the
 * investigator beside the notice, the other candidates named below, and a
 * keyed decision bar that stays in reach. Modelled on the Calibration card
 * but scoped to the notice: the strip keeps every candidate in view, because
 * on a limited submission the question is which one.
 */
export function FocusView({ header, rows, cursor, noticeIndex, noticeCount, queueUndecided, queueTotal, confirmedTotal, profile, profileLoading, rejecting, undecidedOnNotice, canDecide, onDecide, onOpenReasons, onSkip, onSkipNotice, onJump, onOpenDrawer, onExitFocus }: FocusViewProps) {
  const row = rows[Math.min(cursor, Math.max(0, rows.length - 1))] ?? null;
  const allDone = queueUndecided === 0;
  const label = row ? focusLabelOf(row) : null;
  const actions = label ? focusActions(label) : [];
  const undecided = Boolean(row && !row.decision && !row.doNotContact);

  return (
    <div>
      <div className={FOCUS_PROGRESS_ROW}>
        <p className={FOCUS_PROGRESS}>{row ? progressLine({ match: cursor + 1, matches: rows.length, notice: noticeIndex + 1, notices: noticeCount }) : "No match to review on this notice"}</p>
        <p className={FOCUS_DECISIONS}>{decisionsLine({ undecided: queueUndecided, total: queueTotal })}</p>
      </div>
      <div className={FOCUS_BAR} aria-hidden>
        <span className={FOCUS_BAR_FILL} style={{ width: `${progressPercentOf({ undecided: queueUndecided, total: queueTotal })}%` }} />
      </div>

      {row && label ? (
        <>
          <div className={FOCUS_TIER_ROW}>
            <Pill variant={LARGE_PILL[label]}>{VERDICT_LABEL_TEXT[label]}</Pill>
            {row.decision || row.doNotContact ? <span className="text-meta font-medium text-ink-body">{statusText({ decision: row.decision, doNotContact: row.doNotContact, teammateActive: Boolean(row.clash), contact: row.contact }).text}</span> : null}
            <button type="button" onClick={() => onOpenDrawer("assessment")} className={FOCUS_ASSESSMENT_BTN}>
              Read Prospera&apos;s assessment
            </button>
          </div>

          <div className={FOCUS_GRID}>
            <InvestigatorCard key={row.investigatorId} row={row} profile={profile} loading={profileLoading} onOpenDrawer={() => onOpenDrawer("profile")} />
            <OpportunityCard key={header.id} header={header} onOpenDrawer={() => onOpenDrawer("opportunity")} />
          </div>

          <div className={STRIP}>
            <p className={STRIP_LABEL}>Also on this notice — click to jump</p>
            <div className={STRIP_CHIPS}>
              {rows.map((r, i) => {
                const settled = Boolean(r.decision) || r.doNotContact;
                const state = settled ? statusText({ decision: r.decision, doNotContact: r.doNotContact, teammateActive: false, contact: null }).text : "undecided";
                return (
                  <button key={r.investigatorId} type="button" onClick={() => onJump(i)} aria-current={i === cursor ? "true" : undefined} className={cn(STRIP_CHIP, i === cursor ? STRIP_CHIP_STATE.current : settled ? STRIP_CHIP_STATE.decided : STRIP_CHIP_STATE.idle)}>
                    <span className="font-semibold">{r.name}</span>
                    <span className={STRIP_TIER}>{VERDICT_LABEL_TEXT[focusLabelOf(r)]}</span>
                    <span className={settled ? STRIP_STATE.decided : STRIP_STATE.undecided}>{state}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!allDone ? (
            <section className={DECISION_BAR} aria-label="Your decision">
              <div className={DECISION_ROW}>
                <p className={DECISION_EYEBROW}>Your decision</p>
                {actions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={!canDecide || !undecided}
                    onClick={() => (a.opensReasons ? onOpenReasons() : onDecide(row.investigatorId, a.status, a.reason))}
                    className={a.kind === "primary" ? FOCUS_PRIMARY : FOCUS_SECONDARY}
                    aria-expanded={a.opensReasons ? rejecting : undefined}
                  >
                    <span className={KEYCAP} aria-hidden>
                      {a.key}
                    </span>
                    {a.label}
                  </button>
                ))}
                <button type="button" onClick={onSkip} className={SKIP_TEXT}>
                  Skip this match
                </button>
                <button type="button" onClick={onSkipNotice} className={SKIP_NOTICE}>
                  Skip the rest of this notice →
                </button>
              </div>
              {rejecting && undecided ? (
                <div className={FOCUS_REASONS} role="group" aria-label="Why are you dismissing this?">
                  <p className={REASONS_PROMPT}>Why are you dismissing this?</p>
                  <div className={REASONS_CHIPS}>
                    {REVIEW_REASONS.map((r) => (
                      <button key={r.id} type="button" onClick={() => onDecide(row.investigatorId, "rejected", r.id)} className={FOCUS_REASON_CHIP}>
                        {r.label}
                        {r.hint ? <span className={REASON_HINT}>{r.hint(undecidedOnNotice)}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {allDone ? (
        <div className={ALL_DONE} role="status">
          <div>
            <p className={ALL_DONE_TITLE}>Every suggestion is decided.</p>
            <p className={ALL_DONE_LINE}>{doneLine(confirmedTotal)}</p>
          </div>
          <button type="button" onClick={onExitFocus} className={ALL_DONE_BTN}>
            Review what you confirmed
          </button>
        </div>
      ) : null}

      <p className={FOCUS_NOTE_TEXT}>{FOCUS_NOTE}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The investigator card
// ---------------------------------------------------------------------------

const PER_PAGE = 2;
const SUMMARY_TOGGLE_CHARS = 260;

function InvestigatorCard({ row, profile, loading, onOpenDrawer }: { row: FocusRow; profile: FocusProfile | null; loading: boolean; onOpenDrawer: () => void }) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pubPage, setPubPage] = useState(0);
  const [grantPage, setGrantPage] = useState(0);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const pubs = profile?.publications ?? [];
  const grants = profile?.grants ?? [];
  const pubPages = Math.max(1, Math.ceil(pubs.length / PER_PAGE));
  const grantPages = Math.max(1, Math.ceil(grants.length / PER_PAGE));
  const pp = Math.min(pubPage, pubPages - 1);
  const gp = Math.min(grantPage, grantPages - 1);
  const summary = profile?.summary ?? null;

  return (
    <section className={FOCUS_CARD}>
      <div className={FOCUS_CARD_HEAD}>
        <p className={EYEBROW}>Investigator</p>
        <button type="button" onClick={onOpenDrawer} className={BTN_OPEN}>
          Open profile <span aria-hidden>↗</span>
        </button>
      </div>
      <div className="mt-3 flex items-start gap-4">
        <span className={PHOTO} aria-hidden>
          {profile?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoUrl} alt="" className={PHOTO_IMG} />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className={FOCUS_NAME}>
            <Link href={row.href} className={FOCUS_NAME_LINK}>
              {row.name}
            </Link>
          </p>
          {row.identity || row.card.stage ? <p className={FOCUS_IDENTITY}>{[row.identity, row.card.stage].filter(Boolean).join(" · ")}</p> : null}
          <p className="mb-0 mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={MICRO_LABEL}>Paradigm</span>
            <span className={row.card.paradigm ? PARADIGM_VALUE.known : PARADIGM_VALUE.unknown}>{row.card.paradigm ?? PARADIGM_UNKNOWN}</span>
          </p>
          {row.card.themes.length ? (
            <div className="mt-2 flex flex-wrap gap-[5px]">
              {row.card.themes.map((t) => (
                <span key={t} className={THEME_CHIP}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className={FOCUS_SECTION}>
        {loading && !profile ? (
          <p className={cn(FOCUS_SUMMARY, "text-ink-muted")}>Reading the profile…</p>
        ) : summary ? (
          <>
            <p className={cn(FOCUS_SUMMARY, !summaryOpen && FOCUS_SUMMARY_CLAMPED)}>{summary.text}</p>
            <p className={FOCUS_SUMMARY_SOURCE}>{summary.source}</p>
            {summary.text.length > SUMMARY_TOGGLE_CHARS ? (
              <button type="button" onClick={() => setSummaryOpen((v) => !v)} aria-expanded={summaryOpen} className={TEXT_LINK}>
                {summaryOpen ? "Show less" : "Read the full summary"}
              </button>
            ) : null}
          </>
        ) : (
          <p className={cn(FOCUS_SUMMARY, "text-ink-muted")}>No research summary on file — no award abstract, and no Profiles narrative that reads as research.</p>
        )}
      </div>

      <div className={FOCUS_SECTION}>
        <div className={FOCUS_SECTION_HEAD}>
          <p className={EYEBROW}>Publications</p>
          <Pager count={pageLabel(pp, PER_PAGE, pubs.length)} page={pp} pages={pubPages} onPage={setPubPage} label="publications" />
        </div>
        {loading && !profile ? (
          <p className={cn(ITEM_META, "mt-[9px]")}>Reading…</p>
        ) : pubs.length ? (
          pubs.slice(pp * PER_PAGE, pp * PER_PAGE + PER_PAGE).map((p) => {
            const open = openItem === p.id;
            return (
              <div key={p.id}>
                <button type="button" onClick={() => setOpenItem(open ? null : p.id)} aria-expanded={open} className={ITEM_CARD}>
                  <span className="flex items-start justify-between gap-3">
                    <span className={ITEM_TITLE}>{p.title}</span>
                    {p.role ? <span className={p.roleLead ? ITEM_ROLE.lead : ITEM_ROLE.other}>{p.role}</span> : null}
                  </span>
                  <span className={ITEM_META}>{p.meta}</span>
                  {p.relevance ? <span className={ITEM_RELEVANCE}>{p.relevance}</span> : null}
                  <span className={ITEM_MORE}>{open ? "Hide abstract" : "Abstract and citation"}</span>
                </button>
                {open ? (
                  <div className={ITEM_PANEL}>
                    <p className={ITEM_PANEL_TEXT}>{p.abstract ?? "No abstract on file for this article."}</p>
                    <p className={ITEM_PANEL_MONO}>PMID {p.pmid}</p>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className={EMPTY_WARN}>No publications on file.</p>
        )}
      </div>

      <div className={FOCUS_SECTION}>
        <div className={FOCUS_SECTION_HEAD}>
          <p className={EYEBROW}>Funded awards</p>
          <Pager count={pageLabel(gp, PER_PAGE, grants.length)} page={gp} pages={grantPages} onPage={setGrantPage} label="awards" />
        </div>
        {loading && !profile ? (
          <p className={cn(ITEM_META, "mt-[9px]")}>Reading…</p>
        ) : grants.length ? (
          grants.slice(gp * PER_PAGE, gp * PER_PAGE + PER_PAGE).map((g) => {
            const open = openItem === g.id;
            return (
              <div key={g.id}>
                <button type="button" onClick={() => setOpenItem(open ? null : g.id)} aria-expanded={open} className={ITEM_CARD}>
                  <span className="flex items-baseline justify-between gap-2.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className={g.active ? GRANT_DOT.active : GRANT_DOT.closed} aria-hidden />
                      <span className={GRANT_NUMBER}>{g.number}</span>
                      {g.sponsor ? <span className={GRANT_SPONSOR}>{g.sponsor}</span> : null}
                    </span>
                    <span className={g.active ? GRANT_STATE.active : GRANT_STATE.closed}>{g.active ? "Active" : "Closed"}</span>
                  </span>
                  <span className={GRANT_TITLE}>{g.title}</span>
                  <span className={GRANT_LINE}>{g.line}</span>
                  {g.relevance ? <span className={ITEM_RELEVANCE}>{g.relevance}</span> : null}
                  <span className={ITEM_MORE}>{open ? "Hide detail" : "Full record"}</span>
                </button>
                {open ? (
                  <div className={ITEM_PANEL}>
                    <p className={ITEM_PANEL_TEXT}>{g.detail ?? "No abstract or relevance statement on file for this award."}</p>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className={EMPTY_WARN}>No awards on file.</p>
        )}
      </div>
    </section>
  );
}

function Pager({ count, page, pages, onPage, label }: { count: string; page: number; pages: number; onPage: (p: number) => void; label: string }) {
  const prev = page > 0;
  const next = page < pages - 1;
  return (
    <div className="flex items-center gap-1">
      <span className={PAGER_COUNT}>{count}</span>
      <button type="button" disabled={!prev} onClick={() => onPage(page - 1)} aria-label={`Previous ${label}`} className={cn(PAGER_BTN, prev ? PAGER_BTN_STATE.on : PAGER_BTN_STATE.off)}>
        ‹
      </button>
      <button type="button" disabled={!next} onClick={() => onPage(page + 1)} aria-label={`Next ${label}`} className={cn(PAGER_BTN, next ? PAGER_BTN_STATE.on : PAGER_BTN_STATE.off)}>
        ›
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The opportunity card
// ---------------------------------------------------------------------------

const OPP_SUMMARY_TOGGLE_CHARS = 300;

function OpportunityCard({ header, onOpenDrawer }: { header: ReviewNoticeHeader; onOpenDrawer: () => void }) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const d = header.detail;
  return (
    <section className={FOCUS_CARD}>
      <div className={FOCUS_CARD_HEAD}>
        <p className={EYEBROW}>Opportunity</p>
        <button type="button" onClick={onOpenDrawer} className={BTN_OPEN}>
          Open opportunity <span aria-hidden>↗</span>
        </button>
      </div>
      <h2 className={OPP_TITLE}>{header.title}</h2>
      <p className={OPP_META}>
        <span className="font-mono font-semibold text-ink">{header.number ?? "—"}</span>
        {header.meta ? ` · ${header.meta}` : ""}
        {header.flag ? <span className="font-semibold text-danger"> · {header.flag}</span> : null}
      </p>

      {d.facts.length ? (
        <div className={KEY_FACTS}>
          {d.facts.map((f) => (
            <div key={f.label}>
              <p className={KEY_FACT_VALUE}>{f.value}</p>
              <p className={KEY_FACT_LABEL}>{f.sub ? `${f.label} · ${f.sub}` : f.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className={cn(FOCUS_SECTION, "mt-4 pt-3.5")}>
        {header.summary ? (
          <>
            <p className={cn(FOCUS_SUMMARY, !summaryOpen && FOCUS_SUMMARY_CLAMPED)}>{header.summary}</p>
            {header.summary.length > OPP_SUMMARY_TOGGLE_CHARS ? (
              <button type="button" onClick={() => setSummaryOpen((v) => !v)} aria-expanded={summaryOpen} className={TEXT_LINK}>
                {summaryOpen ? "Show less" : "Read the full purpose"}
              </button>
            ) : null}
          </>
        ) : (
          <p className={cn(FOCUS_SUMMARY, "text-ink-muted")}>No summary in the synced notice.</p>
        )}
        {d.priorities.length ? (
          <div className="mt-[11px] flex flex-wrap gap-1.5">
            {d.priorities.map((t) => (
              <span key={t} className={PRIORITY_CHIP}>
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className={cn(FOCUS_SECTION, "mt-4 pt-3.5")}>
        <p className={EYEBROW}>Research objectives</p>
        {d.objectives.length ? (
          d.objectives.map((o, i) => (
            <div key={o} className={OBJECTIVE_ROW}>
              <span className={OBJECTIVE_NUMBER}>{i + 1}</span>
              <span className="min-w-0">
                <span className={OBJECTIVE_TITLE}>{o}</span>
              </span>
            </div>
          ))
        ) : (
          <p className={SMALL_TEXT}>The notice profile names no objective category.</p>
        )}
        {d.objectiveQuote ? (
          <p className={OBJECTIVE_DETAIL}>
            {d.objectiveQuote.section}: “{d.objectiveQuote.text}”
          </p>
        ) : null}
      </div>

      <div className={cn(FOCUS_SECTION, "mt-4 pt-3.5")}>
        <p className={EYEBROW}>Best fit for</p>
        <p className={SMALL_TEXT}>{d.bestFit}</p>
      </div>

      <div className={cn(FOCUS_SECTION, "mt-4 pt-3.5")}>
        <p className={EYEBROW}>Could kill it</p>
        {d.dealBreakers.length ? d.dealBreakers.map((x) => <p key={x} className={SMALL_TEXT}>{x}</p>) : <p className={SMALL_TEXT}>No eligibility rule, trial designation or submission limit on file for this notice.</p>}
      </div>

      <div className={cn(FOCUS_SECTION, "mt-4 pt-3.5")}>
        <p className={EYEBROW}>What you would need to assemble</p>
        {d.assemble.length ? d.assemble.map((x) => <p key={x} className={DASH_ITEM}>— {x}</p>) : <p className={SMALL_TEXT}>Nothing beyond the standard application is named.</p>}
      </div>
    </section>
  );
}

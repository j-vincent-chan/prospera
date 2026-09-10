import Link from "next/link";
import { GoldLabelForm, HowThisWorks } from "@/components/fit/gold-label-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { requireAdmin } from "@/lib/auth/require-admin";
import { stratumLabel } from "@/lib/fit/goldset/csv";
import { FIT_LABELS_SYNTHETIC_MIGRATION, SLOTS, type Slot } from "@/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "@/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, LABELER_CONFIG_VALUES, LABELERS_PATH } from "@/lib/fit/goldset/manifest";
import { axisCategoryOptions, labelsPageView, type LabelsFilter, type PairView } from "@/lib/fit/goldset/page-view";
import type { Stratum } from "@/lib/fit/goldset/stratify";
import { familySlotLabel } from "@/lib/fit/goldset/families";
import { FIT_LABELS_MIGRATION } from "@/lib/fit/inspect/load";
import { fmtMonDYear } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import type { Tier } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const TIER_VARIANT: Record<Tier, PillVariant> = { strong: "tier-strong", moderate: "tier-potential", exploratory: "tier-exploratory", poor: "status-closed" };

/** The chips, in the order a grader works them; `LABELS_FILTERS` is the parser's order, not the row's. */
const FILTER_ORDER: readonly LabelsFilter[] = ["todo", "disagreements", "done", "all"];

/** Why this pair is in the set, said plainly — the focus card's header chip. */
const WHY_THIS_PAIR: Record<Stratum, string> = {
  current: "The current engine already shows this pair",
  adversarial: "Deliberate near-miss: right topic, wrong kind of research",
  random: "Random check above the cutoff",
  dropped: "Both engines threw this pair away",
  fit_v1: "Only the new engine rates this pair highly",
};

/** The same five strata as the provenance table reads them, one row each. */
const STRATUM_GLOSS: Record<Stratum, string> = {
  current: "Pairs the current engine already puts in front of people",
  adversarial: "Deliberate near-misses: right topic, wrong kind of research",
  random: "A random sample from everything above the cutoff",
  dropped: "Pairs both engines threw away — the check on what we miss",
  fit_v1: "Pairs only the new engine rates highly",
};

const ROLE: Record<Slot, string> = { a: "grader A", b: "grader B", adjudicator: "adjudicator" };

/** The focus card's column eyebrows: 11/600/0.08em (redesign § 1.6). */
const EYEBROW = "m-0 text-label font-semibold uppercase text-ink-muted";
/** The disclosure's block headings: 12/600/0.06em (redesign § 1.3) — a step up from the card's. */
const HEADING = "m-0 text-section font-semibold uppercase text-ink-muted";

function Initials({ children, size }: { children: string; size: 40 | 24 }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === 40 ? "h-10 w-10 bg-teal-tint text-micro font-semibold text-teal" : "h-6 w-6 bg-line-row text-micro font-semibold text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-line-control bg-card px-[5px] py-px font-sans text-micro">{children}</kbd>;
}

/**
 * Calibration (plan § PR 2.4, calibration redesign): two strategists grade
 * the manifest's investigator–notice pairs one at a time and an adjudicator
 * settles the disagreements; the labels are the answer key the fit engine is
 * scored against. One pair fills the focus card — the person on the left,
 * the notice on the right, four tier buttons in the footer — and saving
 * advances to the next pair of the current filter. `?filter=` scopes the
 * queue and `?pair=` holds the place, so a grader can close the tab and come
 * back.
 *
 * Admin-only; the manifest comes from the bundle (a change to it or to
 * labelers.json needs a rebuild and a redeploy), only the labels from the
 * database; no model call. Blind grading is enforced in `labelsPageView`:
 * nothing on this page hides a tier the payload already carries.
 */
export default async function FitLabelsPage({ searchParams }: { searchParams?: { filter?: string; pair?: string } }) {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return <EmptyState title="Admins only" description="The calibration page is for the fit-engine checkpoint. Ask an administrator for the admin role." />;

  const labels = await loadGoldLabels(supabase);
  const identities = await loadLabelerIdentities(supabase, [admin.userId, ...labels.rows.map((r) => r.labeler), ...LABELER_CONFIG_VALUES]);
  const view = labelsPageView(
    { manifest: GOLDSET_MANIFEST, rows: labels.rows, identities, config: LABELER_CONFIG, currentUserId: admin.userId, filter: searchParams?.filter ?? null, pair: searchParams?.pair ?? null, syntheticAvailable: labels.synthetic_available },
    LABELERS_PATH,
  );
  const options = axisCategoryOptions();
  const m = GOLDSET_MANIFEST;
  const p = view.progress;
  const mySlot = view.assignment.current;
  const isAdjudicator = mySlot === "adjudicator";
  const canLabel = view.canLabel && labels.available;
  const adjudicatorName = view.assignment.slots.adjudicator ? view.slotNames.adjudicator.split(" ")[0]! : "the adjudicator";

  const href = (filter: LabelsFilter, pairId?: string | null) => `/admin/fit-labels?filter=${filter}${pairId ? `&pair=${pairId}` : ""}`;
  const filterLabel: Record<LabelsFilter, string> = {
    todo: isAdjudicator ? "Needs your call" : "My queue",
    disagreements: "Disagreements",
    // `done` is `adjudication.tier !== null` — an agreed or adjudicated pair, which is "resolved", not "both graded".
    done: "Resolved",
    all: `All ${p.total}`,
  };

  const cur: PairView | null = view.current;
  const prev = view.currentIndex > 0 ? view.pairs[view.currentIndex - 1]! : null;
  const next = view.currentIndex >= 0 ? (view.pairs[view.currentIndex + 1] ?? null) : null;
  const upNext = view.currentIndex >= 0 ? view.pairs.slice(view.currentIndex + 1, view.currentIndex + 5) : [];
  const graded = mySlot ? p.labeled[mySlot] : p.resolved;

  /** The state of a slot that is not the viewer's: the tier when they may see it, else why not. */
  const otherSlotNote = (pair: PairView, slot: Slot): string => {
    if (isAdjudicator) return "not graded";
    if (slot === "adjudicator") return "settles disagreements";
    return pair.slotLabeled[slot] ? "hidden until you submit" : "hasn't graded this one yet";
  };

  const aboutPanel = (
    <section className="rounded-card border border-line bg-card">
      <div className="grid grid-cols-2 gap-8 px-6 py-5">
        <div className="flex flex-col gap-3.5">
          <div>
            <p className={cn(HEADING, "mb-1")}>What you&rsquo;re doing</p>
            <p className="m-0 text-body text-ink-body">
              For each pair, judge how well the person fits the notice — on your own reading, not on what the engine suggested. Pick a tier. Exploratory and Poor also need a reason; if that reason is &ldquo;wrong type of research&rdquo;, say which part is off (the science, the study design, the data, and so on).
            </p>
            <p className="m-0 mt-2 text-body text-ink-body">
              The two that are easy to mix up: ask whether they would fit <em>if this notice were on their own topic</em>. If yes, it is &ldquo;wrong subject&rdquo;. If they still could not do the work, it is &ldquo;wrong type of research&rdquo; — and that one gates the match, so it needs the axis.
            </p>
          </div>
          <div>
            <p className={cn(HEADING, "mb-1")}>Why it matters</p>
            <p className="m-0 text-body text-ink-body">These grades are the answer key. Every change to the matching engine is measured against them, so a careless grade quietly becomes a wrong target.</p>
          </div>
          <div>
            <p className={cn(HEADING, "mb-1")}>Test pairs</p>
            <p className="m-0 text-body text-ink-body">
              {view.synthetic} pairs use an invented investigator against a real notice, to check the engine rejects a plausible-looking wrong match. They are marked, and you grade them like any other.
            </p>
          </div>
        </div>
        <div>
          <p className={cn(HEADING, "mb-2")}>Where the {p.total} pairs came from</p>
          {view.strata.map((s) => (
            <div key={s.stratum} className="flex gap-3.5 border-t border-line-row py-[9px]">
              <span className="w-[34px] shrink-0 text-body font-semibold tabular-nums text-ink">{s.count}</span>
              <span className="text-dense text-ink-body">{STRATUM_GLOSS[s.stratum]}</span>
            </div>
          ))}
          <p className="m-0 mt-3.5 font-mono text-micro text-ink-muted">
            gold set {m.version} · seed {m.seed} · generated {m.generated_at ? fmtMonDYear(m.generated_at) : "—"} · taxonomy {m.taxonomy_version} · engine {m.engine_version} · labelers from {LABELERS_PATH}
          </p>
        </div>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/fit" className="text-dense text-ink-muted hover:text-ink">
          ← Fit profiles
        </Link>
        {view.assignment.current === "adjudicator" ? (
          <a href="/admin/fit-labels/export" className="text-dense text-ink-muted hover:text-ink">
            Export labels (CSV) ↓
          </a>
        ) : null}
      </div>

      <HowThisWorks panel={aboutPanel}>
        <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Calibration</h1>
        <p className="mb-0 mt-1 max-w-[90ch] text-body text-ink-body">
          Two strategists grade the same {p.total} investigator–notice pairs. Where they disagree, {adjudicatorName} decides. The result is the answer key the matching engine is scored against.
        </p>
      </HowThisWorks>

      {!labels.available ? (
        <p className="m-0 text-dense text-warning">
          <code className="font-mono text-meta">fit_labels</code> is not on the database yet — apply <code className="font-mono text-meta">{FIT_LABELS_MIGRATION}</code> to record labels.
        </p>
      ) : null}
      {labels.available && !labels.synthetic_available && view.synthetic ? (
        <p className="m-0 text-dense text-warning">
          <code className="font-mono text-meta">fit_labels.synthetic_source</code> is not on the database yet — apply <code className="font-mono text-meta">{FIT_LABELS_SYNTHETIC_MIGRATION}</code> to label the {view.synthetic} test pairs here; until then their labels live in the exported CSV (<code className="font-mono text-meta">fit:metrics -- --labels-csv</code>).
        </p>
      ) : null}
      {labels.error ? <p className="m-0 text-dense text-danger">Could not read labels: {labels.error}</p> : null}
      {!view.canLabel ? <p className="m-0 text-dense text-warning">{view.cannotLabelReason}</p> : null}
      {view.assignment.unresolved.length ? <p className="m-0 text-dense text-warning">Configured in {LABELERS_PATH} but not found in profiles: {view.assignment.unresolved.join(", ")}.</p> : null}

      <section className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card px-5 py-3.5">
        {SLOTS.map((s) => (
          <div key={s} className="flex min-w-[220px] flex-1 items-center gap-2.5">
            <Initials size={40}>{view.slotInitials[s]}</Initials>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-dense font-semibold text-ink">
                {view.slotNames[s]}
                <span className="font-normal text-ink-muted">
                  {" · "}
                  {mySlot === s ? "you · " : ""}
                  {ROLE[s]}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <span className="block h-1 flex-1 overflow-hidden rounded-full bg-line-row">
                  <span className="block h-full rounded-full bg-teal" style={{ width: `${p.total ? Math.round((p.labeled[s] / p.total) * 100) : 0}%` }} />
                </span>
                <span className="whitespace-nowrap text-micro tabular-nums text-ink-muted">
                  {p.labeled[s]} / {p.total}
                </span>
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 border-l border-line pl-4">
          <Pill variant="status-overdue">
            {p.awaiting_adjudication} need {adjudicatorName}
          </Pill>
          <Pill variant="status-open">{p.resolved} resolved</Pill>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTER_ORDER.map((f) => (
            <Link
              key={f}
              href={href(f)}
              className={cn(
                "inline-flex h-8 items-center rounded-control border px-3 text-dense font-medium",
                view.filter === f ? "border-teal bg-teal-tint text-teal" : "border-line-control bg-card text-ink hover:bg-canvas",
              )}
            >
              {filterLabel[f]}
            </Link>
          ))}
        </div>
        <p className="m-0 text-dense text-ink-body">
          <span className="font-semibold text-ink">
            {graded} of {p.total}
          </span>{" "}
          graded · <span className="font-semibold text-ink">{p.total - graded}</span> left
        </p>
      </section>

      {m.pairs.length === 0 ? (
        <EmptyState title="The manifest is empty" description="Run `npm run fit:goldset-export -- --seed 1` and rebuild." />
      ) : cur === null ? (
        <EmptyState title="Nothing in this view" description={`No pair matches “${filterLabel[view.filter]}”. Pick another filter above.`} />
      ) : (
        <>
          <section className="rounded-card border border-line bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-dense font-medium text-ink">{cur.pair.id}</span>
                <Pill variant="status-closed" title={stratumLabel(cur.pair.stratum)}>
                  {WHY_THIS_PAIR[cur.pair.stratum]}
                </Pill>
                {cur.pair.synthetic ? <Pill variant="status-needs-review">Test pair · invented profile</Pill> : null}
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-dense tabular-nums text-ink-muted">
                  {view.currentIndex + 1} of {view.shown} in view
                </span>
                <NavChevron href={prev ? href(view.filter, prev.pair.id) : null} direction="left" label="Previous pair" />
                <NavChevron href={next ? href(view.filter, next.pair.id) : null} direction="right" label="Next pair" />
              </div>
            </div>

            <div className="grid grid-cols-2">
              <div className="border-r border-line px-6 pb-6 pt-5">
                <p className={cn(EYEBROW, "mb-2.5")}>The person</p>
                <p className="m-0 text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{cur.pair.investigator.name}</p>
                <p className="m-0 mt-1 text-dense text-ink-body">
                  {cur.pair.investigator.dominant.label} · {familySlotLabel(cur.pair.investigator.dominant.family)} ·{" "}
                  {cur.pair.synthetic ? "no roster evidence (fixture profile)" : `${cur.pair.investigator.item_count} items`} · paradigm {cur.pair.investigator.paradigm_confidence}
                </p>
                {cur.hrefs.investigator ? (
                  <Link href={cur.hrefs.investigator} className="mt-2 inline-block text-dense text-teal hover:text-navy">
                    Open fit profile ↗
                  </Link>
                ) : null}
                <p className={cn(EYEBROW, "mb-1.5 mt-[18px]")}>What they&rsquo;ve published</p>
                {cur.pair.investigator.evidence.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {cur.pair.investigator.evidence.slice(0, 3).map((title, i) => (
                      <li key={i} className="pl-3.5 text-dense text-ink-body [text-indent:-14px]">
                        · {title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-dense text-ink-muted">No paradigm evidence recorded.</p>
                )}
              </div>
              <div className="px-6 pb-6 pt-5">
                <p className={cn(EYEBROW, "mb-2.5")}>The notice</p>
                <p className="m-0 text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{cur.pair.notice.title}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Pill variant="status-closed" className="font-mono">
                    {cur.pair.notice.number}
                  </Pill>
                  <Pill variant="status-closed">{cur.pair.notice.designation}</Pill>
                  {cur.pair.notice.activity_code ? <Pill variant="status-closed">{cur.pair.notice.activity_code}</Pill> : null}
                  <Pill variant="status-closed">requires {familySlotLabel(cur.pair.notice.family)}</Pill>
                </div>
                <Link href={cur.hrefs.notice} className="mt-2 inline-block text-dense text-teal hover:text-navy">
                  Open notice profile ↗
                </Link>
                {cur.pair.notice.excerpt ? (
                  <>
                    <p className={cn(EYEBROW, "mb-1.5 mt-[18px]")}>{cur.pair.notice.excerpt_source}</p>
                    <p className="m-0 border-l-2 border-line-control pl-3 text-dense italic text-ink-body">{cur.pair.notice.excerpt}</p>
                  </>
                ) : null}
              </div>
            </div>

            <div className="border-t border-line bg-footer-bar px-6 pb-5 pt-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="m-0 text-[15px] font-semibold text-ink">{isAdjudicator ? "Your ruling" : "Your call"}</p>
                <p className="m-0 whitespace-nowrap text-meta text-ink-muted">
                  Keys <Key>1</Key>–<Key>4</Key> tier · <Key>↵</Key> save and next · <Key>←</Key> <Key>→</Key> move
                </p>
              </div>

              {canLabel && cur.canLabel ? (
                <GoldLabelForm
                  key={cur.pair.id}
                  pairId={cur.pair.id}
                  investigatorId={cur.pair.synthetic ? null : cur.pair.investigator_id}
                  syntheticSource={cur.pair.synthetic_source}
                  opportunityId={cur.pair.opportunity_id}
                  saved={cur.mine.saved ? { tier: cur.mine.saved.tier, reason: cur.mine.saved.reason, axis_reason: cur.mine.saved.axis_reason } : null}
                  options={options}
                  prevHref={prev ? href(view.filter, prev.pair.id) : null}
                  nextHref={next ? href(view.filter, next.pair.id) : null}
                />
              ) : (
                <p className="m-0 mt-3 text-dense text-warning">
                  {cur.pair.synthetic && labels.available && !labels.synthetic_available
                    ? "This is a test pair — label it in the CSV until the synthetic migration is applied."
                    : (view.cannotLabelReason ?? "You cannot label this pair.")}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-6 border-t border-line pt-3.5">
                {SLOTS.filter((s) => s !== mySlot).map((s) => {
                  const other = cur.slots[s];
                  return (
                    <div key={s} className="flex items-center gap-2.5">
                      <Initials size={24}>{view.slotInitials[s]}</Initials>
                      <span className="text-dense text-ink-muted">{view.slotNames[s]}</span>
                      {other ? <Pill variant={TIER_VARIANT[other.tier]}>{other.tierLabel}</Pill> : <Pill variant="status-closed">{otherSlotNote(cur, s)}</Pill>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {upNext.length ? (
            <section className="flex flex-wrap items-center gap-2.5 px-1">
              <span className="text-dense text-ink-muted">Up next</span>
              {upNext.map((u) => (
                <Link
                  key={u.pair.id}
                  href={href(view.filter, u.pair.id)}
                  className="inline-flex h-[30px] max-w-[260px] items-center gap-2 truncate rounded-control border border-line-control bg-card px-3 text-dense text-ink hover:bg-canvas"
                >
                  <span className="font-mono text-meta text-ink-muted">{u.pair.id}</span>
                  <span className="truncate">{u.pair.investigator.name}</span>
                </Link>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A 28px square step through the queue; disabled at either end, where there is no pair to go to. */
function NavChevron({ href, direction, label }: { href: string | null; direction: "left" | "right"; label: string }) {
  const shape = "inline-flex h-7 w-7 items-center justify-center rounded-control border border-line-control bg-card text-ink-body";
  if (!href) {
    return (
      <span aria-hidden className={cn(shape, "opacity-50")}>
        <Chevron direction={direction} />
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(shape, "hover:bg-canvas")}>
      <Chevron direction={direction} />
    </Link>
  );
}

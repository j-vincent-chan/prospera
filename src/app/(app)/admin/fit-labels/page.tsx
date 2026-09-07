import Link from "next/link";
import { GoldLabelForm } from "@/components/fit/gold-label-form";
import { SectionCard } from "@/components/fit/inspector-ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/require-admin";
import { stratumLabel } from "@/lib/fit/goldset/csv";
import { FIT_LABELS_SYNTHETIC_MIGRATION, SLOT_LABEL, SLOTS, type AdjudicationStatus, type Slot } from "@/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "@/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, LABELER_CONFIG_VALUES, LABELERS_PATH } from "@/lib/fit/goldset/manifest";
import { axisCategoryOptions, LABELS_FILTERS, labelsPageView, type LabelsFilter, type SlotView } from "@/lib/fit/goldset/page-view";
import { familySlotLabel } from "@/lib/fit/goldset/families";
import { FIT_LABELS_MIGRATION } from "@/lib/fit/inspect/load";
import { fmtMonDYear } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import type { Tier } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const TIER_VARIANT: Record<Tier, PillVariant> = { strong: "tier-strong", moderate: "tier-potential", exploratory: "tier-exploratory", poor: "status-closed" };
const STATUS: Record<AdjudicationStatus, { label: string; variant: PillVariant | null }> = {
  agreed: { label: "Agreed", variant: "status-open" },
  adjudicated: { label: "Adjudicated", variant: "status-published" },
  unresolved: { label: "Disagree · needs adjudication", variant: "status-overdue" },
  pending: { label: "One label", variant: "status-needs-review" },
  unlabeled: { label: "—", variant: null },
};
const FILTER_LABEL: Record<LabelsFilter, string> = { all: "All", todo: "My to-do", disagreements: "Disagreements", done: "Resolved" };

function SlotCell({ view }: { view: SlotView | null }) {
  if (!view) return <span className="text-meta text-ink-muted">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <Pill variant={TIER_VARIANT[view.tier]}>{view.tierLabel}</Pill>
      {view.reasonLabel ? <span className="text-micro text-ink-body">{view.reasonLabel}</span> : null}
      {view.axisLabel ? <span className="text-micro text-ink-muted">{view.axisLabel}</span> : null}
      <span className="text-micro text-ink-muted">{fmtMonDYear(view.created_at)}</span>
    </div>
  );
}

/**
 * The gold-set labeling page (plan § PR 2.4): the manifest's pairs (the
 * 200 plus the supplementary fit-v1 stratum) with the summaries a labeler
 * needs and links to the two inspectors — a synthetic pair shows the
 * fixture narrative instead of an investigator link and is labeled like
 * any other once `fit_labels.synthetic_source` exists (until then the page
 * names the migration and its labels stay in the CSV) — a tier / reason /
 * axis sub-reason
 * form in the signed-in admin's own slot (labeler A or B: configured in
 * labelers.json, else by order of first label; the adjudicator: configured
 * only), the other slots' labels, the adjudication status (derived, never
 * stored), progress counts, and a CSV export of the current labels.
 * Admin-only; the manifest comes from the bundle (a change to it or to
 * labelers.json needs a rebuild and a redeploy), only the labels from the
 * database; no model call.
 */
export default async function FitLabelsPage({ searchParams }: { searchParams?: { filter?: string } }) {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return <EmptyState title="Admins only" description="The gold-set labeling page is for the fit-engine checkpoint. Ask an administrator for the admin role." />;

  const labels = await loadGoldLabels(supabase);
  const identities = await loadLabelerIdentities(supabase, [admin.userId, ...labels.rows.map((r) => r.labeler), ...LABELER_CONFIG_VALUES]);
  const view = labelsPageView({ manifest: GOLDSET_MANIFEST, rows: labels.rows, identities, config: LABELER_CONFIG, currentUserId: admin.userId, filter: searchParams?.filter ?? null, syntheticAvailable: labels.synthetic_available }, LABELERS_PATH);
  const options = axisCategoryOptions();
  const m = GOLDSET_MANIFEST;
  const p = view.progress;
  const canLabel = view.canLabel && labels.available;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/fit" className="text-dense text-ink-muted hover:text-ink">
          ← Fit profiles
        </Link>
        <a href="/admin/fit-labels/export" className="text-dense text-ink-muted hover:text-ink">
          Export labels (CSV) ↓
        </a>
      </div>
      <header>
        <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Gold set labels</h1>
        <p className="mb-0 mt-1 text-body text-ink-muted">
          Gold set <span className="font-mono">{m.version}</span> · seed {m.seed} · {m.pairs.length} pairs · generated {m.generated_at ? fmtMonDYear(m.generated_at) : "—"} · taxonomy <span className="font-mono">{m.taxonomy_version}</span>, engine <span className="font-mono">{m.engine_version}</span> ·{" "}
          {view.strata.filter((s) => s.count > 0).map((s) => `${stratumLabel(s.stratum).toLowerCase()} ${s.count}`).join(" · ")}
          {view.synthetic ? ` · ${view.synthetic} synthetic` : ""}. Label the pair, not the engines: a tier for the person against this notice; for Exploratory or Poor, why — “wrong type of research” names the axis.
          {view.synthetic ? " A synthetic pair (a fixture investigator of a family the roster lacks, against a real notice) is labeled here like any other; its row carries the fixture case as synthetic_source instead of an investigator id." : ""}
        </p>
        {!labels.available ? (
          <p className="mb-0 mt-2 text-dense text-warning">
            <code className="font-mono text-meta">fit_labels</code> is not on the database yet — apply <code className="font-mono text-meta">{FIT_LABELS_MIGRATION}</code> to record labels.
          </p>
        ) : null}
        {labels.available && !labels.synthetic_available && view.synthetic ? (
          <p className="mb-0 mt-2 text-dense text-warning">
            <code className="font-mono text-meta">fit_labels.synthetic_source</code> is not on the database yet — apply <code className="font-mono text-meta">{FIT_LABELS_SYNTHETIC_MIGRATION}</code> to label the {view.synthetic} synthetic pairs here; until then their labels live in the exported CSV (<code className="font-mono text-meta">fit:metrics -- --labels-csv</code>).
          </p>
        ) : null}
        {labels.error ? <p className="mb-0 mt-2 text-dense text-danger">Could not read labels: {labels.error}</p> : null}
      </header>

      <SectionCard title="Progress" aside={`${p.resolved} of ${p.total} resolved · ${view.assignment.mode === "configured" ? `labelers from ${LABELERS_PATH}` : "slots by order of first label"}`}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SLOTS.map((s) => (
              <div key={s} className={cn("rounded-card border border-line px-4 py-3", view.assignment.current === s && "border-teal")}>
                <p className="m-0 text-meta text-ink-muted">
                  {SLOT_LABEL[s]}
                  {view.assignment.current === s ? " · you" : ""}
                </p>
                <p className="m-0 text-dense font-medium text-ink">{view.slotNames[s]}</p>
                <p className="m-0 text-dense text-ink-body tabular-nums">
                  {p.labeled[s]} / {p.total} labeled
                </p>
              </div>
            ))}
          </div>
          <p className="m-0 text-dense text-ink-body">
            Agreements {p.agreed} · adjudicated {p.adjudicated} · disagreements awaiting adjudication {p.awaiting_adjudication} · one label {p.pending} · unlabeled {p.unlabeled}
            {view.assignment.unassigned.length ? ` · ${view.assignment.unassigned.length} labeler(s) with rows but no slot` : ""}
            {view.assignment.unresolved.length ? ` · configured but not found in profiles: ${view.assignment.unresolved.join(", ")}` : ""}
          </p>
          {!view.canLabel ? <p className="m-0 text-dense text-warning">{view.cannotLabelReason}</p> : null}
          <p className="m-0 flex flex-wrap gap-2 text-dense">
            {LABELS_FILTERS.map((f) => (
              <Link key={f} href={f === "all" ? "/admin/fit-labels" : `/admin/fit-labels?filter=${f}`} className={cn("rounded-full border px-3 py-0.5", view.filter === f ? "border-teal bg-teal-tint text-teal" : "border-line-control text-ink-body hover:bg-canvas")}>
                {FILTER_LABEL[f]}
              </Link>
            ))}
            <span className="self-center text-meta text-ink-muted">{view.shown} shown</span>
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Pairs" aside={`${view.shown} of ${m.pairs.length}`}>
        {m.pairs.length === 0 ? (
          <p className="m-0 px-5 py-4 text-dense text-ink-muted">The manifest is empty. Run `npm run fit:goldset-export -- --seed 1` and rebuild.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1400px]">
              <TableHead>
                <tr>
                  <TableHeaderCell first className="w-[90px]">Pair</TableHeaderCell>
                  <TableHeaderCell className="w-[300px]">Investigator</TableHeaderCell>
                  <TableHeaderCell className="w-[380px]">Notice</TableHeaderCell>
                  {SLOTS.map((s) => (
                    <TableHeaderCell key={s} className="w-[240px]">
                      {SLOT_LABEL[s]}
                      <span className="block text-micro font-normal text-ink-muted">{view.slotNames[s]}</span>
                    </TableHeaderCell>
                  ))}
                  <TableHeaderCell className="w-[150px]">Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {view.pairs.map((v) => {
                  const pair = v.pair;
                  const status = STATUS[v.adjudication.status];
                  return (
                    <TableRow key={pair.id}>
                      <TableCell first className="align-top">
                        <span className="font-mono text-dense text-ink">{pair.id}</span>
                        <span className="block text-micro text-ink-muted" title={stratumLabel(pair.stratum)}>
                          {pair.stratum}
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        {v.hrefs.investigator ? (
                          <Link href={v.hrefs.investigator} className="text-dense font-medium text-ink hover:text-teal">
                            {pair.investigator.name}
                          </Link>
                        ) : (
                          <span className="text-dense font-medium text-ink">
                            {pair.investigator.name} <Pill variant="tag">synthetic · fixture {pair.synthetic_source}</Pill>
                          </span>
                        )}
                        <span className="block text-micro text-ink-muted">
                          {pair.investigator.dominant.label} · {familySlotLabel(pair.investigator.dominant.family)} · {pair.synthetic ? "no roster evidence (fixture profile)" : `${pair.investigator.item_count} items`} · paradigm {pair.investigator.paradigm_confidence}
                        </span>
                        {pair.investigator.evidence.length ? (
                          <ul className="m-0 mt-1 list-none p-0 text-micro leading-snug text-ink-body">
                            {pair.investigator.evidence.map((t, i) => (
                              <li key={i} className="line-clamp-2">
                                · {t}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="block text-micro text-ink-muted">no paradigm evidence recorded</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Link href={v.hrefs.notice} className="font-mono text-dense font-medium text-ink hover:text-teal">
                          {pair.notice.number}
                        </Link>
                        <span className="block text-dense text-ink">{pair.notice.title}</span>
                        <span className="block text-micro text-ink-muted">
                          {pair.notice.designation}
                          {pair.notice.activity_code ? ` · ${pair.notice.activity_code}` : ""} · requires {familySlotLabel(pair.notice.family)}
                        </span>
                        {pair.notice.excerpt ? (
                          <details className="mt-1 text-micro text-ink-body">
                            <summary className="cursor-pointer text-ink-muted">{pair.notice.excerpt_source}</summary>
                            <p className="m-0 mt-1 leading-snug">{pair.notice.excerpt}</p>
                          </details>
                        ) : null}
                      </TableCell>
                      {SLOTS.map((s) => (
                        <TableCell key={s} className="align-top">
                          {canLabel && v.canLabel && v.mine.slot === s ? (
                            <GoldLabelForm investigatorId={pair.synthetic ? null : pair.investigator_id} syntheticSource={pair.synthetic_source} opportunityId={pair.opportunity_id} saved={v.mine.saved ? { tier: v.mine.saved.tier, reason: v.mine.saved.reason, axis_reason: v.mine.saved.axis_reason } : null} options={options} />
                          ) : (
                            <SlotCell view={v.slots[s as Slot]} />
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="align-top">
                        {pair.synthetic && !labels.synthetic_available ? (
                          <span className="text-micro text-ink-muted">synthetic — label in the CSV until the migration is applied</span>
                        ) : status.variant ? (
                          <Pill variant={status.variant}>{status.label}</Pill>
                        ) : (
                          <span className="text-meta text-ink-muted">{status.label}</span>
                        )}
                        {v.adjudication.tier ? <span className="block text-micro text-ink-muted">→ {v.adjudication.tier}</span> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

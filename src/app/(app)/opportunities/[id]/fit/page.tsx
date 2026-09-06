import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FlagButton } from "@/components/fit/flag-form";
import { FlagList } from "@/components/fit/flag-list";
import { AdminsOnly, BackLink, ConfidencePill, FactTable, LogList, MetaLine, PartialBanner, Quote, SectionCard, TagList, WeightBar } from "@/components/fit/inspector-ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadOpportunityInspection } from "@/lib/fit/inspect/load";
import type { NoticeListView } from "@/lib/fit/inspect/opportunity-view";
import type { Axis } from "@/lib/fit/classify/contracts";
import { fmtMonDYear } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const LIST_TONE: Record<string, string> = {
  "paradigm.excluded": "text-danger",
  "design.prohibited": "text-danger",
};

function NoticeList({ list, axis, target }: { list: NoticeListView; axis: Axis; target: { opportunityId: string } }) {
  return (
    <div className="border-t border-line-row px-5 py-3 first:border-t-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className={cn("m-0 text-label font-semibold uppercase tracking-[0.08em]", LIST_TONE[list.path] ?? "text-ink-muted")}>
          {list.label} <span className="font-mono normal-case tracking-normal text-ink-muted">{list.path}</span>
        </p>
        <span className="text-right text-micro text-ink-muted">{list.semantics}</span>
      </div>
      {list.entries.length === 0 ? (
        <p className="m-0 text-meta text-ink-muted">none</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 text-dense">
              <div className="min-w-0">
                <span className={cn("font-medium", e.known ? "text-ink" : "text-danger")}>{e.label}</span>
                <span className="text-micro text-ink-muted">
                  {" "}
                  {e.group ? `${e.group} · ` : ""}
                  <span className="font-mono">{e.id}</span>
                  {!e.known ? " · not in the taxonomy" : ""}
                </span>
                {e.weight !== null ? (
                  <span className="ml-2">
                    <WeightBar weight={e.weight} />
                  </span>
                ) : null}
                <Quote q={e.quote} compact />
              </div>
              <FlagButton target={target} axis={axis} category={e.id} categoryLabel={e.label} label="Flag" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin-only inspector for one notice's stored fit profile (plan § PR 1.6):
 * required / any-of / allowed / excluded per axis with the verified quote
 * behind each entry, the deterministic fields, eligibility and team, the
 * sources (text, exemplars, blend, completeness, extraction log) and "flag
 * as wrong" on every entry, axis and the whole profile. Reads only; no model.
 */
export default async function OpportunityFitPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return <AdminsOnly />;
  if (!z.string().uuid().safeParse(params.id).success) notFound();

  const { notice, view, profileTableMissing, flags } = await loadOpportunityInspection(supabase, params.id);
  if (!notice) notFound();
  const target = { opportunityId: notice.id } as const;
  const entityHref = `/opportunities/${notice.id}`;
  const number = view?.number || notice.opportunity_number || "—";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={entityHref} label={notice.opportunity_number ?? "Opportunity"} />
        <Link href="/admin/fit" className="text-dense text-ink-muted hover:text-ink">
          All profiles →
        </Link>
      </div>
      <header>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-dense text-ink-muted">{number}</span>
          {view ? <ConfidencePill confidence={view.confidence} prefix="Confidence" /> : null}
          {view?.needs_review ? <Pill variant="status-needs-review">Needs review</Pill> : null}
          {view && !view.sources.complete ? <Pill variant="status-needs-review">Incomplete build</Pill> : null}
        </div>
        <h1 className="m-0 text-[26px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">{notice.title}</h1>
        <MetaLine
          parts={[
            "Fit profile · admin inspector",
            view ? `computed ${fmtMonDYear(view.computed_at)}` : null,
            view ? <span key="tax" className="font-mono">{view.taxonomy_version}</span> : null,
            notice.clinical_trial_designation ? `designation: ${notice.clinical_trial_designation.replaceAll("_", " ")}` : null,
          ]}
        />
      </header>

      {!view ? (
        <EmptyState
          title="No fit profile yet"
          description={
            profileTableMissing
              ? "opportunity_fit_profiles is not on the database yet; apply the PR 1.5 migration, then run the nightly fit-opportunity-profiles job or scripts/fit-build-opportunity-profiles.ts."
              : "The nightly fit-opportunity-profiles job has not built this notice yet. It profiles open NIH-like notices with Guide sections; a notice with no Guide text or a closed notice is not a candidate."
          }
          actions={
            <Link href={entityHref} className="text-dense font-medium text-teal hover:text-navy">
              Back to the opportunity
            </Link>
          }
        />
      ) : (
        <>
          {view.partial ? <PartialBanner title="Incomplete build" message={view.partial.message} items={view.partial.reasons} /> : null}
          {view.needs_review ? <PartialBanner title="Needs review" message="A category was both required and excluded across section groups; the exclusion won (or a prior yielded). Read the merge log under Sources and flag what is wrong." /> : null}

          <div className="grid items-start gap-5 xl:grid-cols-2">
            <SectionCard title="Mechanism" aside={<FlagButton target={target} label="Flag" />}>
              <FactTable rows={view.mechanism} />
              {view.population ? (
                <div className="border-t border-line-row px-5 py-3 text-dense">
                  <span className="text-ink-muted">Required population · </span>
                  {view.population}
                </div>
              ) : null}
            </SectionCard>
            <SectionCard title="Eligibility and team">
              <FactTable rows={[...view.eligibility, ...view.team]} />
            </SectionCard>
          </div>

          {view.axes.map((axis) => (
            <SectionCard key={axis.axis} title={axis.label} aside={<FlagButton target={target} axis={axis.axis} categories={axis.categories} label="Flag axis" />}>
              <p className="mb-0 mt-0 border-b border-line-row px-5 py-2 text-meta text-ink-muted">
                {axis.description}
                {axis.axis === "materials" ? (
                  <>
                    {" "}
                    · Human subjects required: <span className="font-medium text-ink">{axis.human_required === null ? "not stated" : axis.human_required ? "yes" : "no"}</span>
                  </>
                ) : null}
              </p>
              {axis.lists.map((list) => (
                <NoticeList key={list.path} list={list} axis={axis.axis} target={target} />
              ))}
            </SectionCard>
          ))}

          <SectionCard title="Topic" aside={<FlagButton target={target} axis="topic" label="Flag axis" />}>
            <div className="flex flex-col gap-3 px-5 py-4 text-dense">
              <div>
                <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Distinguishing terms</p>
                <TagList tags={view.topic.terms} empty="None extracted." />
              </div>
              <div>
                <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">RCDC categories (from the funded exemplars)</p>
                <TagList tags={view.topic.rcdc} empty="No exemplars with RCDC categories." />
              </div>
              {view.topic.mesh.length ? (
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">MeSH</p>
                  <TagList tags={view.topic.mesh} mono />
                </div>
              ) : null}
              {view.topic.free_text ? (
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Purpose (Part 1)</p>
                  <p className="m-0 max-h-48 overflow-y-auto whitespace-pre-line leading-normal text-ink-body">{view.topic.free_text}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Non-responsive (verbatim)" aside={`${view.non_responsive.length}`}>
            {view.non_responsive.length === 0 ? (
              <p className="m-0 px-5 py-4 text-dense text-ink-muted">No non-responsive items verified.</p>
            ) : (
              <ul className="m-0 flex list-disc flex-col gap-1 py-4 pl-10 pr-5 text-dense text-ink-body">
                {view.non_responsive.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Evidence quotes" aside={`${view.quotes.length} verified`}>
            {view.quotes.length === 0 ? (
              <p className="m-0 px-5 py-4 text-dense text-ink-muted">No verified quotes — this profile rests on the deterministic overlays alone.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 px-5 py-4 p-0">
                {view.quotes.map((q) => (
                  <li key={q.field} className="flex flex-col gap-0.5">
                    <span className="font-mono text-meta text-ink">{q.field}</span>
                    <Quote q={q} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Sources" aside={view.sources.complete ? "complete" : "incomplete"}>
            <FactTable rows={view.sources.facts} />
            <div className="grid gap-4 border-t border-line-row px-5 py-4 text-dense md:grid-cols-2">
              <div>
                <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Extraction groups</p>
                {view.sources.groups.length === 0 ? (
                  <p className="m-0 text-meta text-ink-muted">No extractor run recorded.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {view.sources.groups.map((g, i) => (
                      <li key={i} className="text-meta">
                        <span className="font-medium text-ink">{g.label}</span>
                        <span className="text-ink-muted">
                          {" "}
                          · {new Intl.NumberFormat("en-US").format(g.chars)} chars · cache {g.cache} · {g.model_called ? "model called" : "no call"}
                          {g.skipped ? ` · skipped (${g.skipped})` : ""}
                          {g.usable === false ? " · reply unusable" : ""}
                        </span>
                        {g.dropped.length ? (
                          <details className="mt-0.5">
                            <summary className="cursor-pointer text-micro text-ink-muted">{g.dropped.length} dropped / noted claims</summary>
                            <LogList lines={g.dropped} />
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Overlays applied</p>
                  <LogList lines={[...view.sources.overlays_applied, ...view.sources.overlay_notes]} empty="No deterministic overlay fired." />
                </div>
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Verified overrides</p>
                  <LogList lines={view.sources.overrides_applied} empty="None." />
                </div>
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Merge log</p>
                  <LogList lines={view.sources.merge_log} empty="Nothing to reconcile." />
                </div>
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Blend log</p>
                  <LogList lines={view.sources.blend_log} empty="No exemplar blend." />
                </div>
              </div>
            </div>
          </SectionCard>

          <FlagList flags={flags} target={target} />
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CorrectionList } from "@/components/fit/correction-list";
import { FlagButton } from "@/components/fit/flag-form";
import { FlagList } from "@/components/fit/flag-list";
import { AdminsOnly, BackLink, ConfidencePill, EvidenceList, FactTable, MetaLine, PartialBanner, SectionCard, TagList, WeightBar } from "@/components/fit/inspector-ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadCorrectionsFor } from "@/lib/fit/feedback/load";
import { loadInvestigatorInspection } from "@/lib/fit/inspect/load";
import { fmtMonDYear } from "@/lib/investigators/sources";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

/**
 * Admin-only inspector for one investigator's stored fit profile (plan § PR
 * 1.6): every axis by weight with display labels, career beside recent for
 * the paradigm, confidence per axis, the top evidence behind each category,
 * evidence counts, characteristics, aspirations, collaborators, and "flag as
 * wrong" on every row, axis and the whole profile. Reads only; no model.
 */
export default async function InvestigatorFitPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return <AdminsOnly />;
  if (!z.string().uuid().safeParse(params.id).success) notFound();

  const [{ investigator, view, profileTableMissing, flags }, corrections] = await Promise.all([loadInvestigatorInspection(supabase, params.id), loadCorrectionsFor(supabase, "investigator_profile", params.id)]);
  if (!investigator) notFound();
  const target = { investigatorId: investigator.id } as const;
  const entityHref = `/investigators/${investigator.id}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={entityHref} label={investigator.full_name} />
        <Link href="/admin/fit" className="text-dense text-ink-muted hover:text-ink">
          All profiles →
        </Link>
      </div>
      <header>
        <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">{investigator.full_name}</h1>
        <MetaLine
          parts={[
            "Fit profile · admin inspector",
            view ? `computed ${fmtMonDYear(view.computed_at)}` : null,
            view ? <span key="tax" className="font-mono">{view.taxonomy_version}</span> : null,
            view ? `${view.item_count} items` : null,
            view?.pending_items ? `${view.pending_items} pending` : null,
          ]}
        />
      </header>

      {!view ? (
        <EmptyState
          title="No fit profile yet"
          description={
            profileTableMissing
              ? "investigator_fit_profiles is not on the database yet; apply the PR 1.4 migration, then run the nightly fit-profiles job or scripts/fit-build-profiles.ts."
              : "The nightly fit-profiles job has not built this investigator yet. Refreshing the investigator's sources also queues a rules-and-cache build."
          }
          actions={
            <Link href={entityHref} className="text-dense font-medium text-teal hover:text-navy">
              Back to the investigator
            </Link>
          }
        />
      ) : (
        <>
          {view.partial ? <PartialBanner title={`Partial profile — ${view.partial.pending_items} pending`} message={view.partial.message} /> : null}

          <SectionCard title="At a glance" aside={<span className="flex flex-wrap justify-end gap-1">{view.confidenceRows.map((c) => <ConfidencePill key={c.axis} confidence={c.confidence} prefix={c.label} />)}</span>}>
            <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
              <div>
                <p className="mb-1.5 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Dominant paradigm</p>
                <dl className="m-0 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-dense">
                  <dt className="text-ink-muted">Career</dt>
                  <dd className="m-0">
                    {view.dominant.career ? (
                      <>
                        <span className={cn("font-medium", view.dominant.career.known ? "text-ink" : "text-danger")}>{view.dominant.career.label}</span> <span className="text-ink-muted">({view.dominant.career.family})</span> <WeightBar weight={view.dominant.career.weight} />
                        {!view.dominant.career.known ? <span className="text-micro text-danger"> · not in the taxonomy</span> : null}
                      </>
                    ) : (
                      <span className="text-ink-muted">no paradigm evidence</span>
                    )}
                  </dd>
                  <dt className="text-ink-muted">Recent</dt>
                  <dd className="m-0">
                    {view.dominant.recent ? (
                      <>
                        <span className={cn("font-medium", view.dominant.recent.known ? "text-ink" : "text-danger")}>{view.dominant.recent.label}</span> <span className="text-ink-muted">({view.dominant.recent.family})</span> <WeightBar weight={view.dominant.recent.weight} />
                        {!view.dominant.recent.known ? <span className="text-micro text-danger"> · not in the taxonomy</span> : null}
                      </>
                    ) : (
                      <span className="text-ink-muted">nothing within the recent window</span>
                    )}
                  </dd>
                </dl>
              </div>
              <div>
                <p className="mb-1.5 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Evidence</p>
                <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-dense">
                  {view.evidence.summary.map((s) => (
                    <div key={s.label} className="contents">
                      <dt className="text-ink-muted">{s.label}</dt>
                      <dd className="m-0 text-right tabular-nums">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mb-0 mt-2 text-meta text-ink-muted">
                  Top evidence cited across categories: {view.evidence.distinctIds} distinct items
                  {view.evidence.byKind.length ? ` — ${view.evidence.byKind.map((b) => `${b.label.toLowerCase()} ${b.count}`).join(", ")}` : ""}.
                </p>
              </div>
            </div>
          </SectionCard>

          {view.axes.map((axis) => (
            <SectionCard
              key={axis.axis}
              title={axis.label}
              aside={
                <>
                  <ConfidencePill confidence={axis.confidence} />
                  <FlagButton target={target} axis={axis.axis} categories={axis.categories} label="Flag axis" />
                </>
              }
            >
              <p className="mb-0 mt-0 border-b border-line-row px-5 py-2 text-meta text-ink-muted">{axis.description}</p>
              {axis.rows.length === 0 ? (
                <p className="m-0 px-5 py-4 text-dense text-ink-muted">No evidence decided this axis yet{view.partial ? " — items are still pending" : ""}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0 text-dense">
                    <thead className="text-left text-meta text-ink-muted">
                      <tr>
                        <th scope="col" className="py-2 pl-5 pr-3 font-medium">Category</th>
                        <th scope="col" className="px-3 py-2 font-medium">{axis.axis === "paradigm" ? "Career" : "Weight"}</th>
                        {axis.axis === "paradigm" ? <th scope="col" className="px-3 py-2 font-medium">Recent</th> : null}
                        <th scope="col" className="px-3 py-2 font-medium">Top evidence (career view)</th>
                        <th scope="col" className="py-2 pl-3 pr-5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {axis.rows.map((row) => (
                        <tr key={row.id} className="align-top">
                          <td className="border-t border-line-row py-2.5 pl-5 pr-3">
                            <div className={cn("font-medium", row.known ? "text-ink" : "text-danger")}>{row.label}</div>
                            <div className="text-micro text-ink-muted">
                              {row.group ? `${row.group} · ` : ""}
                              <span className="font-mono">{row.id}</span>
                              {!row.known ? " · not in the taxonomy" : ""}
                              {row.thin ? " · thin evidence" : ""}
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-t border-line-row px-3 py-2.5">
                            <WeightBar weight={row.weight} muted={row.weight === 0} />
                          </td>
                          {axis.axis === "paradigm" ? (
                            <td className="whitespace-nowrap border-t border-line-row px-3 py-2.5">
                              <WeightBar weight={row.recent} muted={!row.recent} />
                            </td>
                          ) : null}
                          <td className="min-w-[280px] border-t border-line-row px-3 py-2.5">
                            <EvidenceList items={row.evidence} />
                          </td>
                          <td className="border-t border-line-row py-2 pl-3 pr-5 text-right">
                            <FlagButton target={target} axis={axis.axis} category={row.id} categoryLabel={row.label} label="Flag" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          ))}

          <SectionCard
            title="Topic"
            aside={
              <>
                <ConfidencePill confidence={view.topic.confidence} />
                <FlagButton target={target} axis="topic" label="Flag axis" />
              </>
            }
          >
            <div className="flex flex-col gap-3 px-5 py-4 text-dense">
              <div>
                <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">RCDC categories</p>
                <TagList tags={view.topic.rcdc} empty="No RCDC categories on the grants." />
              </div>
              <div>
                <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">MeSH major-topic trees ({view.topic.mesh_major.length})</p>
                <TagList tags={view.topic.mesh_major.slice(0, 40)} empty="No MeSH major topics on the publications." mono />
                {view.topic.mesh_major.length > 40 ? <p className="mb-0 mt-1 text-meta text-ink-muted">and {view.topic.mesh_major.length - 40} more</p> : null}
              </div>
              {view.topic.free_text ? <p className="m-0 text-ink-body">{view.topic.free_text}</p> : null}
            </div>
          </SectionCard>

          <div className="grid items-start gap-5 xl:grid-cols-2">
            <SectionCard title="Characteristics">
              <FactTable rows={view.characteristics} />
            </SectionCard>
            <SectionCard title="Aspirations, exclusions, collaborators">
              <div className="flex flex-col gap-3 px-5 py-4 text-dense">
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Aspirations (open Exploratory, never Strong)</p>
                  <TagList tags={view.aspirations.map((a) => a.label)} empty="None declared." />
                </div>
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Do not suggest (families)</p>
                  <TagList tags={view.do_not_suggest.map((d) => d.label)} empty="None." />
                </div>
                <div>
                  <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Collaborators with a known paradigm</p>
                  {view.collaborators.length === 0 ? (
                    <span className="text-meta text-ink-muted">None yet — filled in as co-authors&apos; profiles are built.</span>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {view.collaborators.map((co) => (
                        <li key={co.id} className="flex flex-wrap items-center gap-2">
                          <Link href={`/investigators/${co.id}/fit`} className="font-medium text-ink hover:text-teal">
                            {co.name}
                          </Link>
                          <Pill variant="tag">{co.family}</Pill>
                          {co.categories.length ? <span className="text-meta text-ink-muted">{co.categories.join(", ")}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>

          <CorrectionList corrections={corrections} />
          <FlagList flags={flags} target={target} />
        </>
      )}
    </div>
  );
}

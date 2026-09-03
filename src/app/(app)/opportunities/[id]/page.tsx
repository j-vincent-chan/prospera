import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { OpenInOutreachButton } from "@/components/outreach/open-in-outreach";
import { formatApplicationDocumentSize } from "@/lib/funding-opportunities/funding-opportunity-application-materials";
import { loadFundingOpportunityPeek } from "@/lib/funding-opportunities/funding-opportunity-peek";
import { describeRoutingRule, dueDisplay, dueWithTime, fmtMonDY, followingDueDatesLabel, internalRoutingDate, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { cn } from "@/lib/utils/cn";

function money(n: number | null): string {
  return n == null ? "Not stated" : `$${new Intl.NumberFormat("en-US").format(Math.round(n))} / yr`;
}

function SectionCard({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 whitespace-nowrap text-section font-semibold uppercase text-ink">{title}</h2>
        {aside ? <span className="text-meta text-ink-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Facet({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "excluded" }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-meta", tone === "excluded" ? "bg-danger-tint text-danger-dark" : "border border-line bg-card text-ink-on-tint")}>{children}</span>
  );
}

export default async function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [data, context] = await Promise.all([loadFundingOpportunityPeek(supabase, params.id), loadWorkspaceContext(supabase, user.id)]);
  const outreachTeamId = context?.current?.teamId ?? null;
  const { data: outreachRow } = outreachTeamId
    ? await supabase.from("outreach_items").select("id").eq("team_id", outreachTeamId).eq("opportunity_id", params.id).maybeSingle()
    : { data: null };
  const outreachItemId = (outreachRow as { id?: string } | null)?.id ?? null;
  if (!data) notFound();

  const team = context?.current?.team ?? null;
  const routing: RoutingRule | null = team ? { days: team.routingDays, dayType: team.routingDayType, holidayCalendar: team.routingHolidayCalendar } : null;
  const due = dueDisplay(data.cycleFacts);
  const following = followingDueDatesLabel(data.cycleFacts);
  const nextDueIso = due.date ?? data.nextDue;
  const routingDate = routing && nextDueIso && due.tone !== "closed" && due.tone !== "muted" && due.tone !== "forecast" ? internalRoutingDate(nextDueIso, routing) : null;
  const statusVariant = data.statusBucket === "open" ? "status-open" : data.statusBucket === "forecasted" ? "status-forecasted" : "status-closed";
  const noticeUrl = data.guideUrl ?? data.sourceUrl;
  const facts: Array<[string, string]> = [
    ["Mechanism", data.piBrief.mechanismLabel],
    ["Award ceiling", money(data.awardCeiling)],
    ["Expected awards", data.expectedNumberOfAwards != null ? String(data.expectedNumberOfAwards) : "Not stated"],
    ["Career stage", data.piBrief.careerStageLabel],
    ["Collaboration", data.piBrief.collaborationLabel],
    ["Clinical trials", data.piBrief.clinicalTrialLabel],
    ["Human subjects", data.piBrief.humanSubjectsLabel],
    ["Institutes", data.piBrief.nihInstitutes.length ? data.piBrief.nihInstitutes.join(", ") : "—"],
  ];
  const buckets = data.quickTags as { research_focal_areas: string[]; disease_areas: string[]; technical_expertise: string[] };

  return (
    <div className="flex flex-col gap-5">
      <Link href="/opportunities" className="text-dense text-ink-muted hover:text-navy">← Opportunities</Link>

      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 max-w-[820px]">
          <div className="mb-2.5 flex items-center gap-2">
            <Pill variant={statusVariant}>{data.statusBucket === "open" ? "Open" : data.statusBucket === "forecasted" ? "Forecasted" : "Closed"}</Pill>
            <span className={cn("text-dense font-medium", due.tone === "urgent" ? "text-danger" : due.tone === "closed" || due.tone === "muted" ? "text-ink-muted" : "text-ink")}>{due.primary}</span>
            {data.postedDate ? <span className="text-dense text-ink-muted">· Posted {fmtMonDY(data.postedDate)}</span> : null}
          </div>
          <h1 className="m-0 text-[26px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">{data.title}</h1>
          <p className="mb-0 mt-2 text-body text-ink-muted">
            {data.agency}
            {data.opportunityNumber ? <> · <span className="font-mono text-dense">{data.opportunityNumber}</span></> : null}
            {data.fundingInstrument ? ` · ${data.fundingInstrument.replace(/_/g, " ")}` : ""}
            {data.piBrief.announcementLabel ? ` · ${data.piBrief.announcementLabel}` : ""}
            {data.reissueOf ? <> · <span className="text-teal">Reissue of {data.reissueOf}</span></> : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {noticeUrl ? <a href={noticeUrl} target="_blank" rel="noreferrer"><Button variant="secondary">Agency site ↗</Button></a> : null}
          <OpenInOutreachButton opportunityId={data.id} itemId={outreachItemId} />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card p-5">
            <p className="mb-2.5 mt-0 text-label font-semibold uppercase text-ink-muted">Should I pursue this?</p>
            {data.piBrief.highlights.length ? (
              <ul className="m-0 flex flex-col gap-1 pl-[18px] text-body leading-relaxed text-ink">
                {data.piBrief.highlights.slice(0, 4).map((h) => <li key={h}>{h}</li>)}
              </ul>
            ) : (
              <p className="m-0 text-body text-ink-muted">No summary facts could be extracted from this notice.</p>
            )}
            <dl className="mb-0 mt-4 grid grid-cols-4 gap-x-4 gap-y-3 border-t border-line-row pt-4 text-dense">
              {facts.map(([k, v]) => (
                <div key={k}><dt className="text-meta text-ink-muted">{k}</dt><dd className="mb-0 mt-0.5 font-medium text-ink">{v}</dd></div>
              ))}
            </dl>
          </section>

          <SectionCard title="Summary">
            <div className="px-5 py-4"><p className="m-0 max-w-[72ch] text-body leading-[1.65] text-ink">{data.description || "No summary in the synced notice."}</p></div>
          </SectionCard>

          <SectionCard title="Application materials" aside={data.applicationMaterials.documents.length ? `${data.applicationMaterials.documents.length} attachment${data.applicationMaterials.documents.length === 1 ? "" : "s"}` : undefined}>
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-col gap-2.5 rounded-card border border-line bg-canvas p-3">
                <div className="flex max-w-[520px] flex-wrap gap-2">
                  <Tile href={data.applicationMaterials.previewPackageUrl} title="Preview required forms" subtitle="Grants.gov package" />
                  <Tile href={data.applicationMaterials.startApplicationUrl} title="Start application" subtitle={data.applicationMaterials.startApplicationSubtitle} primary />
                </div>
                {data.applicationMaterials.assistUrl ? (
                  <p className="m-0 text-meta text-ink-muted">NIH submission: <a href={data.applicationMaterials.assistUrl} target="_blank" rel="noreferrer" className="font-medium text-teal">Open ASSIST ↗</a> · Grants.gov Workspace also accepted</p>
                ) : data.applicationMaterials.statusMessage ? (
                  <p className="m-0 text-meta text-ink-muted">{data.applicationMaterials.statusMessage}</p>
                ) : null}
              </div>
              {data.applicationMaterials.documents.length ? (
                <div className="rounded-card border border-line">
                  {data.applicationMaterials.documents.map((doc, i) => (
                    <div key={`${doc.downloadUrl}-${i}`} className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-line-row")}>
                      <span className="text-ink-muted"><FileIcon /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate font-mono text-dense text-ink">{doc.fileName}</p>
                        <p className="mb-0 mt-px text-meta text-ink-muted">{doc.folderType ?? "Attachment"} · from {doc.downloadUrl.includes("simpler.grants.gov") ? "Simpler.Grants.gov" : "Grants.gov"}</p>
                      </div>
                      <span className="whitespace-nowrap text-meta tabular text-ink-muted">{formatApplicationDocumentSize(doc.fileSizeBytes) ?? ""}</span>
                      <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-dense font-medium text-teal">Download</a>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="m-0 text-meta leading-normal text-ink-muted">
                Narrative, biosketch and other attachments are prepared per the notice&apos;s instructions; they are not blank templates.{" "}
                {data.applicationMaterials.nihStandardFormsUrl ? <><a href={data.applicationMaterials.nihStandardFormsUrl} target="_blank" rel="noreferrer" className="font-medium text-teal">NIH standard forms ↗</a> · </> : null}
                {noticeUrl ? <a href={noticeUrl} target="_blank" rel="noreferrer" className="font-medium text-teal">Full notice on agency site ↗</a> : null}
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Prior awardees in your directory">
            {data.similarAwardees.length === 0 ? (
              <div className="px-5 py-4 text-dense text-ink-muted">No prior awards under this activity code in your directory.</div>
            ) : (
              data.similarAwardees.slice(0, 5).map((a, i) => (
                <div key={`${a.investigatorId}-${a.projectNum}`} className={cn("flex justify-between gap-4 px-5 py-3.5", i > 0 && "border-t border-line-row")}>
                  <div className="min-w-0">
                    <Link href={`/investigators/${a.investigatorId}`} className="text-body font-medium text-ink hover:text-teal">{a.fullName}</Link>
                    <p className="mb-0 mt-0.5 text-meta text-ink-muted">{a.department ?? "—"}</p>
                    <p className="mb-0 mt-1.5 text-dense"><span className="font-mono text-meta">{a.projectNum}</span> · {a.projectTitle}{a.icName ? ` · ${a.icName}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Pill variant={a.grantActivityCode === a.opportunityActivityCode ? "status-open" : "tag"}>{a.grantActivityCode === a.opportunityActivityCode ? "Same mechanism" : "Related"}</Pill>
                    <p className="mb-0 mt-1 text-meta text-ink-muted">FY {a.fiscalYear}</p>
                  </div>
                </div>
              ))
            )}
          </SectionCard>
        </div>

        <aside className="flex flex-col gap-4">
          <SectionCard title="Suggested recipients" aside={<span className="inline-flex h-[22px] items-center rounded-full bg-teal-tint px-2 text-micro font-semibold text-teal">Best fit</span>}>
            {data.investigatorMatches.length === 0 ? (
              <div className="px-5 py-3 text-dense text-ink-muted">No investigators in your directory overlap this notice yet.</div>
            ) : (
              data.investigatorMatches.slice(0, 3).map((m, i) => (
                <div key={m.investigatorId} className={cn("flex items-center justify-between gap-2 px-5 py-3", i > 0 && "border-t border-line-row")}>
                  <div className="min-w-0">
                    <Link href={`/investigators/${m.investigatorId}`} className="text-body font-medium text-ink hover:text-teal">{m.fullName}</Link>
                    <p className="m-0 text-meta text-ink-muted">{m.department ?? "—"}</p>
                  </div>
                  <span className="text-dense font-semibold text-teal">{Math.round(m.matchScore)}</span>
                </div>
              ))
            )}
            <div className="flex flex-col gap-2 border-t border-line-row px-5 py-3">
              <OpenInOutreachButton opportunityId={data.id} itemId={outreachItemId} label="Review in Outreach" size={32} className="w-full" />
              <p className="m-0 text-meta leading-normal text-ink-muted">From your directory only. The Outreach workspace ranks everyone with tiers and evidence; nothing is contacted until you decide.</p>
            </div>
          </SectionCard>

          <SectionCard title="UCSF track record" aside={<Pill variant="trust-osr">OSR-verified</Pill>}>
            <div className="px-5 py-3.5 text-dense leading-normal text-ink-muted">
              Success rates and funded UCSF examples under this family appear here once OSR award history is synced (institutional layer). Declines are counted, never named.
            </div>
          </SectionCard>

          <SectionCard title="Opportunity profile" aside="Extracted from the notice · v1">
            <div className="flex flex-col gap-2.5 px-5 py-3.5">
              {([
                ["Scientific topics", buckets.research_focal_areas],
                ["Disease · population", buckets.disease_areas],
                ["Methods", buckets.technical_expertise],
              ] as Array<[string, string[]]>).map(([label, tags]) => (
                <div key={label}>
                  <p className="mb-1.5 mt-0 text-meta text-ink-muted">{label}</p>
                  <div className="flex flex-wrap gap-1">{tags.length ? tags.slice(0, 8).map((t) => <Facet key={t}>{t}</Facet>) : <span className="text-meta text-ink-muted">—</span>}</div>
                </div>
              ))}
              <div>
                <p className="mb-1.5 mt-0 text-meta text-ink-muted">Mechanism · eligibility</p>
                <div className="flex flex-wrap gap-1">
                  <Facet>{data.piBrief.mechanismLabel}{data.awardCeiling != null ? ` · ${money(data.awardCeiling).replace(" / yr", " direct / yr")}` : ""}</Facet>
                  <Facet>{data.piBrief.careerStageLabel}</Facet>
                </div>
              </div>
              {data.piBrief.clinicalTrialLabel.toLowerCase().includes("not allowed") ? (
                <div>
                  <p className="mb-1.5 mt-0 text-meta text-ink-muted">Excluded · nonresponsive</p>
                  <div className="flex flex-wrap gap-1"><Facet tone="excluded">not: clinical trials</Facet></div>
                </div>
              ) : null}
              <p className="mb-0 mt-0.5 text-meta leading-normal text-ink-muted">Facets are extracted from the notice text. Edit the profile in Outreach to re-rank suggestions.</p>
            </div>
          </SectionCard>

          <section className="flex flex-col gap-2 rounded-card border border-line bg-card px-5 py-4">
            <h2 className="m-0 text-section font-semibold uppercase text-ink">Key dates</h2>
            {([
              ["Posted", data.postedDate ? fmtMonDY(data.postedDate) : "—", ""],
              ["Letter of intent", data.loiDue ? fmtMonDY(data.loiDue) : data.loiNote ?? "Not required", ""],
              ["Application due", nextDueIso && due.tone !== "muted" ? dueWithTime(nextDueIso, data.isNih) : due.primary, due.tone === "urgent" ? "text-danger font-medium" : ""],
              ["Following due dates", following ?? "—", ""],
              ["Earliest start", data.earliestStart ?? "—", ""],
              ["Internal OSR routing", routingDate ? fmtMonDY(routingDate) : "—", routingDate ? "text-warning font-medium" : ""],
              ["Expiration", data.expirationDate ? fmtMonDY(data.expirationDate) : data.isNih && data.closeDate ? fmtMonDY(data.closeDate) : "—", ""],
              ["Last updated", data.updatedAt ? fmtMonDY(data.updatedAt.slice(0, 10)) : "—", ""],
            ] as Array<[string, string, string]>).map(([k, v, cls]) => (
              <div key={k} className="flex justify-between gap-3 text-dense"><span className="text-ink-muted">{k}</span><span className={cn("text-right", cls)}>{v}</span></div>
            ))}
            <p className="mb-0 mt-1.5 text-meta leading-normal text-ink-muted">
              Source: {data.cycleFacts.cyclesSource === "nih_guide" ? "NIH Guide" : "Simpler.Grants.gov"}{data.guideFetchedAt ? ` · checked ${fmtMonDY(data.guideFetchedAt.slice(0, 10))}` : ""}.
              {routing ? ` Internal date follows your team's routing rule (${describeRoutingRule(routing)}).` : ""}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Tile({ href, title, subtitle, primary }: { href: string | null; title: string; subtitle: string; primary?: boolean }) {
  const cls = cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-tile border px-3 py-2.5", primary ? "border-navy bg-navy text-white hover:bg-navy-hover" : "border-line-control bg-card text-ink hover:border-teal", !href && "cursor-not-allowed opacity-50");
  const inner = (
    <>
      <span className={cn("inline-flex shrink-0", primary ? "text-white" : "text-teal")}>{primary ? <ArrowIcon /> : <FileIcon />}</span>
      <span className="min-w-0"><span className="block whitespace-nowrap text-dense font-medium">{title}</span><span className={cn("block whitespace-nowrap text-meta", primary ? "text-white/75" : "text-ink-muted")}>{subtitle}</span></span>
    </>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a> : <span className={cls}>{inner}</span>;
}
function FileIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><path d="M14 2v6h6" /></svg>;
}
function ArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>;
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadFundingOpportunityPeekAction } from "@/app/actions/funding-search-saves";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SlideOver } from "@/components/ui/slide-over";
import { formatApplicationDocumentSize } from "@/lib/funding-opportunities/funding-opportunity-application-materials";
import type { FundingOpportunityPeekData } from "@/lib/funding-opportunities/funding-opportunity-peek";
import { dueDisplay, dueWithTime, fmtMonDY, followingDueDatesLabel, internalRoutingDate, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import type { OpportunityRowModel } from "@/lib/opportunities/list-model";
import { cn } from "@/lib/utils/cn";

type Props = {
  id: string;
  routing: RoutingRule | null;
  onClose: () => void;
  onDismiss: () => void;
  onWatch: (watching: boolean) => void;
  onSave: (saved: boolean) => void;
  flags: OpportunityRowModel | null;
};

function money(n: number | null): string | null {
  if (n == null) return null;
  return `$${new Intl.NumberFormat("en-US").format(Math.round(n))}`;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-0 text-label font-semibold uppercase text-ink-muted">{children}</p>;
}

function Dl({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 text-dense">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="m-0 font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OpportunityPeek({ id, routing, onClose, onDismiss, onWatch, onSave, flags }: Props) {
  const [data, setData] = useState<FundingOpportunityPeekData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    loadFundingOpportunityPeekAction(id).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const due = data ? dueDisplay(data.cycleFacts) : null;
  const following = data ? followingDueDatesLabel(data.cycleFacts) : null;
  const nextDueIso = due?.date ?? data?.nextDue ?? null;
  const routingDate = routing && nextDueIso && due?.tone !== "closed" && due?.tone !== "muted" ? internalRoutingDate(nextDueIso, routing) : null;
  const statusVariant = data?.statusBucket === "open" ? "status-open" : data?.statusBucket === "forecasted" ? "status-forecasted" : "status-closed";

  return (
    <SlideOver
      open
      onClose={onClose}
      label="Opportunity peek"
      width={560}
      header={
        data ? (
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Pill variant={statusVariant}>{data.statusBucket === "open" ? "Open" : data.statusBucket === "forecasted" ? "Forecasted" : "Closed"}</Pill>
              {due ? (
                <span className={cn("text-meta font-medium", due.tone === "urgent" ? "text-danger" : due.tone === "closed" || due.tone === "muted" ? "text-ink-muted" : "text-ink")}>
                  {due.primary}{due.date && data.isNih && due.tone !== "muted" && due.tone !== "forecast" ? ", 5:00 PM PT" : ""}
                </span>
              ) : null}
              {due?.secondary ? <span className="text-meta text-ink-muted">· {due.secondary}</span> : null}
            </div>
            <h2 className="m-0 text-title font-semibold text-ink">{data.title}</h2>
            <p className="mb-0 mt-1.5 text-meta text-ink-muted">
              {data.agency}
              {data.opportunityNumber ? ` · ${data.opportunityNumber}` : ""}
              {data.fundingInstrument ? ` · ${data.fundingInstrument.replace(/_/g, " ")}` : ""}
              {data.activityCode ? ` · ${data.activityCode}` : ""}
              {data.reissueOf ? <> · <span className="text-teal">Reissue of {data.reissueOf}</span></> : null}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-5 w-[80%]" /><Skeleton className="h-3 w-48" /></div>
        )
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Link href={`/opportunities/${id}`}><Button variant="secondary" size={32}>Full page</Button></Link>
            {data?.sourceUrl || data?.guideUrl ? (
              <a href={data.guideUrl ?? data.sourceUrl ?? "#"} target="_blank" rel="noreferrer"><Button variant="secondary" size={32}>Full notice ↗</Button></a>
            ) : null}
          </div>
          <div className="flex gap-2">
            {flags?.dismissed ? null : <Button variant="secondary" size={32} onClick={onDismiss}>Dismiss</Button>}
            <Button variant="secondary" size={32} onClick={() => onWatch(!(flags?.watching ?? false))}>{flags?.watching ? "Stop watching" : "Watch next cycle"}</Button>
            <Button variant="primary" size={32} onClick={() => onSave(!(flags?.saved ?? false))}>{flags?.saved ? "Saved to outreach" : "Save to outreach"}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-5">
        {error ? <p className="m-0 text-dense text-danger">{error}</p> : null}
        {!data && !error ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[90%]" /><Skeleton className="h-3.5 w-[70%]" />
          </div>
        ) : null}

        {data ? (
          <>
            <section>
              <Label>At a glance</Label>
              <Dl
                items={[
                  ["Award ceiling", data.awardCeiling != null ? `${money(data.awardCeiling)} / yr` : "Not stated"],
                  ["Expected awards", data.expectedNumberOfAwards != null ? String(data.expectedNumberOfAwards) : "Not stated"],
                  ["Career stage", data.piBrief.careerStageLabel],
                  ["Clinical trials", data.piBrief.clinicalTrialLabel],
                  ["Collaboration", data.piBrief.collaborationLabel],
                  ["Institutes", data.piBrief.nihInstitutes.length ? data.piBrief.nihInstitutes.join(", ") : data.isNih ? "Not stated" : "—"],
                ]}
              />
            </section>

            <section>
              <Label>Key dates</Label>
              <Dl
                items={[
                  ["Posted", data.postedDate ? fmtMonDY(data.postedDate) : "—"],
                  ["Letter of intent", data.loiDue ? fmtMonDY(data.loiDue) : data.loiNote ? data.loiNote : "Not required"],
                  ["Next due", <span key="nd" className={due?.tone === "urgent" ? "text-danger" : undefined}>{nextDueIso && due?.tone !== "muted" ? dueWithTime(nextDueIso, data.isNih) : due?.primary ?? "—"}</span>],
                  ["Following due dates", following ?? (data.cycleFacts.cycles.length > 1 ? "None after this" : due?.secondary || "—")],
                  ["Internal routing (OSR)", routingDate ? fmtMonDY(routingDate) : "—"],
                  ["Expiration", data.expirationDate ? fmtMonDY(data.expirationDate) : data.isNih && data.closeDate ? fmtMonDY(data.closeDate) : "—"],
                  ["Earliest start", data.earliestStart ?? "—"],
                ]}
              />
              {data.isNih && data.cycleFacts.cyclesSource === "simpler" ? (
                <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">Receipt dates for this notice aren&apos;t on the NIH Guide yet; the date above is the notice&apos;s expiration from Simpler.Grants.gov.</p>
              ) : null}
            </section>

            <section>
              <Label>Summary</Label>
              <p className="m-0 text-body leading-relaxed text-ink">{data.description ? `${data.description.slice(0, 700)}${data.description.length > 700 ? "…" : ""}` : "No summary in the synced notice."}</p>
            </section>

            <section>
              <Label>Application materials</Label>
              <div className="flex flex-col gap-2.5 rounded-card border border-line bg-canvas p-3">
                <div className="flex flex-wrap gap-2">
                  <MaterialTile href={data.applicationMaterials.previewPackageUrl} title="Preview required forms" subtitle="Grants.gov package" />
                  <MaterialTile href={data.applicationMaterials.startApplicationUrl} title="Start application" subtitle={data.applicationMaterials.startApplicationSubtitle} primary />
                </div>
                {data.applicationMaterials.assistUrl ? (
                  <p className="m-0 text-meta text-ink-muted">NIH submission: <a href={data.applicationMaterials.assistUrl} target="_blank" rel="noreferrer" className="font-medium text-teal">Open ASSIST ↗</a> · Grants.gov Workspace also accepted</p>
                ) : data.applicationMaterials.statusMessage ? (
                  <p className="m-0 text-meta text-ink-muted">{data.applicationMaterials.statusMessage}</p>
                ) : null}
              </div>
              {data.applicationMaterials.documents.length > 0 ? (
                <div className="mt-2 rounded-card border border-line bg-card">
                  {data.applicationMaterials.documents.slice(0, 6).map((doc, i) => (
                    <div key={`${doc.downloadUrl}-${i}`} className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-line-row")}>
                      <FileIcon />
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
              <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">
                Narrative, biosketch and other attachments are prepared per the notice&apos;s instructions; they are not blank templates.{" "}
                {data.applicationMaterials.nihStandardFormsUrl ? <a href={data.applicationMaterials.nihStandardFormsUrl} target="_blank" rel="noreferrer" className="font-medium text-teal">NIH standard forms ↗</a> : null}
              </p>
            </section>

            {tagsOf(data).length > 0 ? (
              <section>
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-1">
                  {tagsOf(data).map((t) => <Pill key={t} variant="tag">{t}</Pill>)}
                </div>
              </section>
            ) : null}

            <section>
              <Label>Best fit in your directory</Label>
              {data.investigatorMatches.length === 0 ? (
                <p className="m-0 text-dense text-ink-muted">No investigators in your directory overlap this notice yet.</p>
              ) : (
                data.investigatorMatches.slice(0, 3).map((m) => (
                  <Link key={m.investigatorId} href={`/investigators/${m.investigatorId}`} className="flex items-center justify-between border-t border-line-row py-2.5 first:border-t-0">
                    <span>
                      <span className="block text-body font-medium text-ink">{m.fullName}</span>
                      <span className="block text-meta text-ink-muted">{m.department ?? "—"}</span>
                    </span>
                    <span className="text-dense font-semibold text-teal">{Math.round(m.matchScore)}</span>
                  </Link>
                ))
              )}
            </section>

            <section>
              <Label>Prior awardees in your directory</Label>
              {data.similarAwardees.length === 0 ? (
                <p className="m-0 text-dense text-ink-muted">No prior awards under this activity code in your directory.</p>
              ) : (
                data.similarAwardees.slice(0, 3).map((a) => (
                  <Link key={`${a.investigatorId}-${a.projectNum}`} href={`/investigators/${a.investigatorId}`} className="flex justify-between gap-3 border-t border-line-row py-2.5 first:border-t-0">
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-ink">{a.fullName}</span>
                      <span className="block truncate text-meta text-ink-muted"><span className="font-mono">{a.projectNum}</span> · {a.projectTitle}{a.icName ? ` · ${a.icName}` : ""} · FY {a.fiscalYear}</span>
                    </span>
                    <Pill variant={a.grantActivityCode === a.opportunityActivityCode ? "status-open" : "tag"} className="self-center">{a.grantActivityCode === a.opportunityActivityCode ? "Same mechanism" : "Related"}</Pill>
                  </Link>
                ))
              )}
            </section>
          </>
        ) : null}
      </div>
    </SlideOver>
  );
}

function tagsOf(data: FundingOpportunityPeekData): string[] {
  const q = data.quickTags as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["research_focal_areas", "disease_areas", "technical_expertise"]) {
    const v = q?.[key];
    if (Array.isArray(v)) for (const t of v) if (typeof t === "string" && out.length < 8 && !out.includes(t)) out.push(t);
  }
  return out;
}

function MaterialTile({ href, title, subtitle, primary }: { href: string | null; title: string; subtitle: string; primary?: boolean }) {
  const cls = cn(
    "flex min-w-0 flex-1 items-center gap-2.5 rounded-tile border px-3 py-2.5",
    primary ? "border-navy bg-navy text-white hover:bg-navy-hover" : "border-line-control bg-card text-ink hover:border-teal",
    !href && "cursor-not-allowed opacity-50",
  );
  const inner = (
    <>
      <span className={cn("inline-flex shrink-0", primary ? "text-white" : "text-teal")}>{primary ? <ArrowIcon /> : <FileIcon />}</span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-dense font-medium">{title}</span>
        <span className={cn("block whitespace-nowrap text-meta", primary ? "text-white/75" : "text-ink-muted")}>{subtitle}</span>
      </span>
    </>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a> : <span className={cls} aria-disabled>{inner}</span>;
}

function FileIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><path d="M14 2v6h6" /></svg>;
}
function ArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>;
}

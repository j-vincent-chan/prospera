"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { reviewIdentityAction } from "@/app/actions/investigator-actions";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { WorkspaceSuggestion } from "@/lib/outreach/queries";
import { COVERAGE_HELP, TIER_HELP, TIER_LABEL } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

const TIER_VARIANT = { strong: "tier-strong", potential: "tier-potential", exploratory: "tier-exploratory" } as const;
const MARK: Record<string, [string, string]> = { yes: ["Matched", "font-medium text-success"], no: ["Not matched", "text-ink-muted"], conflict: ["Conflict", "font-medium text-danger"], unclear: ["Unclear", "font-medium text-warning"] };

export function EvidenceDots({ coverage }: { coverage: "strong" | "partial" | "limited" }) {
  const on = coverage === "strong" ? 3 : coverage === "partial" ? 2 : 1;
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className={cn("inline-block h-1.5 w-1.5 rounded-full", i < on ? "bg-teal" : "bg-line-control")} />)}
    </span>
  );
}

export function EvidenceView({ s, itemId, onBack, onAdd, onDismiss, onWrongPerson }: { s: WorkspaceSuggestion; itemId: string; onBack: () => void; onAdd: () => void; onDismiss: () => void; onWrongPerson: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const notMe = (publicationId: string, heading: string) =>
    startTransition(async () => {
      const r = await reviewIdentityAction({ investigatorId: s.investigatorId, kind: "publication", itemId: publicationId, decision: "reject" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `Marked “${heading.slice(0, 40)}…” as not this person · profile updated` });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
      <button type="button" onClick={onBack} className="self-start text-meta text-ink-muted hover:text-ink">← Back to recipients</button>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-tint text-dense font-semibold text-teal">{s.initials}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 whitespace-nowrap text-[16px] font-semibold text-ink">{s.name}</h3>
              <Pill variant={TIER_VARIANT[s.tier]} title={TIER_HELP[s.tier]}>{TIER_LABEL[s.tier]}</Pill>
              {s.isNew ? <span className="inline-flex h-5 items-center whitespace-nowrap rounded-full border border-dashed border-teal px-[7px] text-micro font-medium text-teal">New to you</span> : null}
            </div>
            <p className="mb-0 mt-[3px] text-dense text-ink-muted">{s.dept} · {s.rank}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3.5">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-ink-muted" title={COVERAGE_HELP[s.coverage]}><EvidenceDots coverage={s.coverage} />Evidence: {s.coverage}</span>
              <span className={cn("whitespace-nowrap text-meta", s.freshWarn ? "text-warning" : "text-ink-muted")}>{s.freshLine}</span>
              <span className="whitespace-nowrap text-meta text-ink-muted">Identity: {s.identityLine}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {s.status === "added" ? (
            <span className="inline-flex h-7 items-center rounded-control bg-success-tint px-2.5 text-dense font-medium text-success">Added</span>
          ) : (
            <>
              <Button variant="primary" size={28} onClick={onAdd}>Add to recipients</Button>
              <Button variant="secondary" size={28} onClick={onDismiss}>Dismiss</Button>
            </>
          )}
        </div>
      </header>

      {s.flags.length ? (
        <div className="rounded-tile border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">
          {s.flags.map((f) => <p key={f.kind} className="m-0">{f.text}</p>)}
        </div>
      ) : null}

      <section className="rounded-card border border-line bg-canvas px-4 py-3.5">
        <p className="mb-1.5 mt-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Summary · generated from the items below</p>
        <p className="m-0 text-body leading-[1.55] text-ink">{s.summary ?? "No summary yet."}</p>
      </section>

      <section>
        <p className="mb-2 mt-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Opportunity profile match</p>
        <div className="grid grid-cols-2 rounded-card border border-line">
          {s.checklist.map((k, i) => (
            <div key={k.facet} className={cn("flex justify-between gap-2.5 px-3.5 py-2 text-dense", i >= 2 && "border-t border-line-row", i % 2 === 1 && "border-l border-line-row")}>
              <span className="min-w-0"><span className="text-ink-muted">{k.facet} · </span>{k.value}</span>
              <span className={cn("whitespace-nowrap text-meta", MARK[k.mark]?.[1])}>{MARK[k.mark]?.[0]}</span>
            </div>
          ))}
        </div>
      </section>

      {s.groups.map((grp) => (
        <section key={grp.key}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{grp.title}</p>
            <span className="text-meta text-ink-muted">{grp.meta}</span>
          </div>
          <div className="rounded-card border border-line">
            {grp.items.length ? (
              grp.items.map((it, i) => (
                <div key={it.id} className={cn("flex flex-col gap-1.5 px-3.5 py-2.5 text-dense", i > 0 && "border-t border-line-row")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 font-medium leading-[1.4] text-ink">{it.heading}</p>
                      {it.sub ? <p className="mb-0 mt-0.5 text-meta text-ink-muted">{it.sub}</p> : null}
                    </div>
                    {it.link ? <a href={it.link.href} target="_blank" rel="noreferrer" className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[5px] border border-line bg-card px-[7px] text-micro font-medium text-ink-body hover:border-teal hover:text-teal">{it.link.label}</a> : null}
                  </div>
                  {it.quote ? <blockquote className="m-0 border-l-2 border-line-control bg-canvas px-3 py-2 text-dense leading-normal text-[#334155]">“{it.quote}”</blockquote> : null}
                  {it.tags ? <p className="m-0 text-meta text-ink-body"><span className="text-ink-muted">Matched: </span>{it.tags}</p> : null}
                  {it.inferred ? <p className="m-0 text-meta text-ink-body"><span className="mr-1.5 inline-flex h-[18px] items-center rounded-[4px] bg-navy-tint px-1.5 align-middle text-micro font-medium text-navy">Inferred</span>{it.inferred}</p> : null}
                  {it.identity ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-meta", it.identity.kind === "ok" ? "text-success" : "text-warning")}>{it.identity.text}</span>
                      {it.publicationId ? <button type="button" disabled={pending} onClick={() => notMe(it.publicationId!, it.heading)} className="whitespace-nowrap text-meta text-teal hover:text-navy">Not this person</button> : null}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-dense text-ink-muted">
                <span>{grp.empty}</span>
                {grp.action ? <a href={`/investigators/${s.investigatorId}`} className="inline-flex h-7 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">{grp.action.label}</a> : null}
              </div>
            )}
          </div>
        </section>
      ))}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
        <p className="m-0 text-meta leading-normal text-ink-muted">Evidence snapshot saved with this suggestion on {new Date(s.snapshotAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Source text is quoted; “Inferred” marks Prospera’s reading of it.</p>
        <div className="flex gap-3">
          <button type="button" onClick={onWrongPerson} className="whitespace-nowrap text-meta text-teal hover:text-navy">Wrong person</button>
          <button type="button" onClick={onDismiss} className="whitespace-nowrap text-meta text-teal hover:text-navy">Not relevant</button>
          <a href={`/investigators/${s.investigatorId}`} className="whitespace-nowrap text-meta text-teal hover:text-navy">Flag evidence</a>
        </div>
      </footer>
      <span className="hidden">{itemId}</span>
    </div>
  );
}

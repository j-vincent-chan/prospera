import Link from "next/link";
import { EvidenceChips } from "@/components/fit/evidence-chips";
import { JudgedMark } from "@/components/fit/judged-mark";
import { TierPill } from "@/components/fit/tier-pill";
import type { InvestigatorFitRow, InvestigatorFitSurface } from "@/lib/fit/investigator-fits";
import { cn } from "@/lib/utils/cn";

const fmtN = (n: number) => new Intl.NumberFormat("en-US").format(n);

function GroupHeading({ title, count, note }: { title: string; count: number; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line-row bg-footer-bar px-5 py-2">
      <p className="m-0 whitespace-nowrap text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title} · {count}
      </p>
      {note ? <span className="text-meta text-ink-muted">{note}</span> : null}
    </div>
  );
}

function FitRow({ row, first }: { row: InvestigatorFitRow; first: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 py-3.5", !first && "border-t border-line-row")}>
      <div className="min-w-0">
        <Link href={`/opportunities/${row.opportunityId}`} className="text-body font-medium text-ink hover:text-teal">
          {row.title}
        </Link>
        {row.lead ? <p className="mb-0 mt-1 text-dense font-medium leading-normal text-ink">{row.lead}</p> : null}
        <p className="mb-0 mt-1 text-meta leading-normal text-ink-muted">{row.rationale.text}</p>
        <EvidenceChips items={row.rationale.evidence} prefix={row.rationale.fallback === "profile" ? "Behind the paradigm match:" : "Evidence:"} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <TierPill tier={row.tier} engine="fit-v1" />
        <JudgedMark judged={row.judged} />
      </div>
    </div>
  );
}

/**
 * "Opportunities that fit" under fit-v1 (plan § PR 3.2): Recommended (Strong,
 * Moderate), Exploratory with the gap sentence first, and a "Why not?"
 * disclosure over the Poor pairs nearest the bar — the last two for
 * strategists only (D7). Every row's rationale cites at least one evidence
 * item; a judged pair carries the stage-8 marker. Server component.
 */
export function FitOpportunities({ surface }: { surface: InvestigatorFitSurface }) {
  const strategist = surface.audience === "strategist";
  if (surface.unavailable) return <div className="px-5 py-4 text-dense text-ink-muted">Fit results are not available yet; the team is on fit-v1.</div>;
  if (!surface.scored) return <div className="px-5 py-4 text-dense text-ink-muted">No fit results yet against the {fmtN(surface.openNotices)} profiled open notices. The nightly fit-results run scores this profile once it has been built.</div>;
  return (
    <div>
      <GroupHeading title="Recommended" count={surface.recommended.length} note="Strong and Moderate fits · a tier is a set of floors, not a score" />
      {surface.recommended.length ? surface.recommended.map((r, i) => <FitRow key={r.opportunityId} row={r} first={i === 0} />) : <p className="m-0 px-5 py-3 text-dense text-ink-muted">{strategist ? "No open notice reaches Moderate for this profile." : "No open notice reaches Moderate for your profile yet — the list refreshes nightly."}</p>}
      {strategist ? (
        <>
          <GroupHeading title="Exploratory" count={surface.exploratory.length} note="Leads to check, not recommendations · the first line names the gap" />
          {surface.exploratory.length ? surface.exploratory.map((r, i) => <FitRow key={r.opportunityId} row={r} first={i === 0} />) : <p className="m-0 px-5 py-3 text-dense text-ink-muted">No Exploratory lead: nothing scientifically close with a nameable gap.</p>}
          {surface.poorTotal > 0 ? (
            <details className="border-t border-line-row">
              <summary className="cursor-pointer px-5 py-2.5 text-dense font-medium text-ink-muted hover:text-ink">
                Why not? {fmtN(surface.poorTotal)} notice{surface.poorTotal === 1 ? "" : "s"} hidden as Poor
              </summary>
              <div className="border-t border-line-row bg-footer-bar px-5 py-3">
                <p className="mb-2 mt-0 text-meta text-ink-muted">The {surface.whyNot.length} nearest the bar and the gate or floor that put them there. Poor is hidden, never deleted; a person, not the score, decides whether a gap is worth closing.</p>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-dense">
                  {surface.whyNot.map((w) => (
                    <li key={w.opportunityId} className="flex flex-col gap-0.5">
                      <Link href={`/opportunities/${w.opportunityId}`} className="font-medium text-ink hover:text-teal">
                        {w.title}
                      </Link>
                      <span className="text-meta leading-normal text-ink-body">{w.whyNot}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

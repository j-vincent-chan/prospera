import { SectionCard } from "@/components/fit/inspector-ui";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { CORRECTIONS_MIGRATION, type CorrectionsRead } from "@/lib/fit/feedback/load";
import type { CorrectionStatus } from "@/lib/fit/types";
import { fmtMonDYear } from "@/lib/investigators/sources";

const STATUS_VARIANT: Record<CorrectionStatus, PillVariant> = { proposed: "status-needs-review", applied: "status-open", rejected: "status-closed" };
const STATUS_LABEL: Record<CorrectionStatus, string> = { proposed: "Proposed", applied: "Applied", rejected: "Rejected" };
const VIA_LABEL: Record<string, string> = { judge: "the AI judge", dismissal: "a dismissal" };

/**
 * "Proposed corrections" on the inspector pages (plan § PR 3.2): every
 * `fit_corrections` row on this profile — the judge's (PR 3.1) and the
 * one-click confirmations from dismissals — with path, values, who proposed
 * it, what it rests on and its status. Reads only: PR 3.3's queue decides.
 */
export function CorrectionList({ corrections, title = "Proposed corrections" }: { corrections: CorrectionsRead; title?: string }) {
  const open = corrections.rows.filter((r) => r.status === "proposed").length;
  return (
    <SectionCard title={title} aside={corrections.available ? `${corrections.rows.length} on this profile${open ? ` · ${open} awaiting review` : ""}` : "unavailable"}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {!corrections.available ? (
          <p className="m-0 text-dense text-ink-muted">
            <code className="font-mono text-meta">fit_corrections</code> is not on the database yet — apply <code className="font-mono text-meta">{CORRECTIONS_MIGRATION}</code> to record corrections.
          </p>
        ) : corrections.error ? (
          <p className="m-0 text-dense text-danger">Could not read corrections: {corrections.error}</p>
        ) : corrections.rows.length === 0 ? (
          <p className="m-0 text-dense text-ink-muted">No corrections yet. The AI judge proposes them from the evidence; a “wrong type of research” dismissal proposes one with a click.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {corrections.rows.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 border-b border-line-row pb-2.5 text-dense last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-ink">{c.pathLabel}</span>
                  <span className="font-mono text-meta text-ink-body">
                    {c.from} → {c.to}
                  </span>
                  <Pill variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                  <span className="text-meta text-ink-muted">
                    {c.kind.replace(/_/g, " ")} · proposed by {c.proposedBy === "judge" ? "the AI judge" : `a${c.proposedBy === "investigator" ? "n" : ""} ${c.proposedBy}`}
                    {VIA_LABEL[c.via] && c.proposedBy !== "judge" ? ` via ${VIA_LABEL[c.via]}` : ""} · {fmtMonDYear(c.createdAt)}
                    {c.decidedAt ? ` · decided ${fmtMonDYear(c.decidedAt)}` : ""}
                  </span>
                </div>
                <p className="m-0 text-meta leading-normal text-ink-body">
                  <span className="text-ink-muted">Rests on: </span>
                  {c.evidenceLine}
                  <span className="text-ink-muted"> · </span>
                  <code className="font-mono text-micro text-ink-muted">{c.path}</code>
                </p>
              </li>
            ))}
          </ul>
        )}
        {corrections.available && open ? <p className="m-0 text-meta text-ink-muted">Proposed corrections wait for a strategist’s review before they change the stored profile; the review queue is PR 3.3.</p> : null}
      </div>
    </SectionCard>
  );
}

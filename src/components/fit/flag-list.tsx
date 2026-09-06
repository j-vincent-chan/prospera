import { FlagButton } from "@/components/fit/flag-form";
import { SectionCard } from "@/components/fit/inspector-ui";
import type { FlagTarget } from "@/lib/fit/inspect/flags";
import { FIT_LABELS_MIGRATION, type InspectorFlags } from "@/lib/fit/inspect/load";
import { fmtMonDYear } from "@/lib/investigators/sources";

/** The flags already on a profile (who, when, axis, reason) and the whole-profile flag button. */
export function FlagList({ flags, target }: { flags: InspectorFlags; target: FlagTarget }) {
  return (
    <SectionCard title="Flags" aside={flags.available ? `${flags.rows.length} on this profile` : "unavailable"}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {!flags.available ? (
          <p className="m-0 text-dense text-ink-muted">
            <code className="font-mono text-meta">fit_labels</code> is not on the database yet — apply <code className="font-mono text-meta">{FIT_LABELS_MIGRATION}</code> to record flags.
          </p>
        ) : flags.error ? (
          <p className="m-0 text-dense text-danger">Could not read flags: {flags.error}</p>
        ) : flags.rows.length === 0 ? (
          <p className="m-0 text-dense text-ink-muted">No flags yet. Use “Flag as wrong” on a category, an axis, or the whole profile.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {flags.rows.map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 border-b border-line-row pb-2.5 text-dense last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{f.scope}</span>
                  <span className="text-meta text-ink-muted">
                    {f.who} · {fmtMonDYear(f.created_at)}
                    {f.engine_version ? ` · ${f.engine_version}` : ""}
                  </span>
                </div>
                {f.reason ? <p className="m-0 leading-normal text-ink-body">{f.reason}</p> : <p className="m-0 text-meta text-ink-muted">No reason given.</p>}
              </li>
            ))}
          </ul>
        )}
        {flags.available ? (
          <div>
            <FlagButton target={target} label="Flag the whole profile as wrong" size={32} variant="secondary" />
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

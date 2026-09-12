import { NIH_IC_SOURCE_LABEL, type NihIcSourceColumn } from "@/lib/funding-opportunities/nih-ic-resolution";

type Props = {
  institutes: string[];
  source: NihIcSourceColumn | null;
  reason: string | null;
  isNih: boolean;
};

/**
 * The "Institutes" fact: the resolved institutes with the option that produced them
 * underneath, or the explicit "Not determined" flag with the reason no option could.
 * The full reason is always on the tooltip. Non-NIH notices show a dash.
 */
export function InstitutesValue({ institutes, source, reason, isNih }: Props) {
  if (!isNih && institutes.length === 0) return <>—</>;
  if (institutes.length === 0) {
    return (
      <span title={reason ?? undefined}>
        {NIH_IC_SOURCE_LABEL.unresolved}
        {reason ? <span className="mt-0.5 block text-meta font-normal leading-snug text-ink-muted">{reason}</span> : null}
      </span>
    );
  }
  return (
    <span title={reason ?? undefined}>
      {institutes.join(", ")}
      {source && source !== "unresolved" ? <span className="mt-0.5 block text-meta font-normal leading-snug text-ink-muted">{NIH_IC_SOURCE_LABEL[source]}</span> : null}
    </span>
  );
}

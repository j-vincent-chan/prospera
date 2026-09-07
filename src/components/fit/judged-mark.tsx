import type { JudgedView } from "@/lib/fit/explain-view";
import { cn } from "@/lib/utils/cn";

/**
 * The small "judged" marker beside a tier stage 8 adjudicated (plan § PR
 * 3.2): the row's tier is the judged one; the tooltip names the engine's
 * tier before it, the confidence and the date. Server-safe.
 */
export function JudgedMark({ judged, className }: { judged: JudgedView | null; className?: string }) {
  if (!judged) return null;
  return (
    <span title={judged.title} className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-full border border-dashed border-navy/50 px-[7px] text-micro font-medium text-navy", className)}>
      {judged.label}
      {judged.changed ? <span className="ml-1 text-ink-muted">· was {judged.from}</span> : null}
    </span>
  );
}

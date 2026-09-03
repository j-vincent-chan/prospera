import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One empty shape, always with the next action (States v2). Dashed control
 * border, centred, title 15/600, description capped at 280px.
 */
export function EmptyState({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** One or two buttons; primary first. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-dashed border-line-control bg-card px-6 py-8 text-center",
        className,
      )}
    >
      <p className="m-0 text-[15px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mb-0 mt-1.5 max-w-[280px] text-dense text-ink-muted">{description}</p>
      ) : null}
      {actions ? <div className="mt-3.5 flex justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

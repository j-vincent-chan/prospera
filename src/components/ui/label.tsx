import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Sentence-case label above a field. 13/500 on forms (Onboarding, Team
 * settings), 12/500 secondary in dense panels.
 */
export function Label({
  children,
  hint,
  size = 13,
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
  /** Muted trailing note, e.g. "(shown to people who find the team)". */
  hint?: ReactNode;
  size?: 13 | 12;
}) {
  return (
    <label
      className={cn(
        "mb-1.5 block font-medium",
        size === 13 ? "text-dense text-ink" : "text-meta text-ink-body",
        className,
      )}
      {...rest}
    >
      {children}
      {hint ? <span className="font-normal text-ink-muted"> {hint}</span> : null}
    </label>
  );
}

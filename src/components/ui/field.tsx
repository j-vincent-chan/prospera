import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Label } from "@/components/ui/label";

/**
 * Label + control + help/error. Passes a generated id to the control via
 * the `render` callback so the label association is always correct.
 */
export function Field({
  label,
  hint,
  help,
  error,
  labelSize,
  className,
  labelAside,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** 12px note under the control. */
  help?: ReactNode;
  /** Replaces `help`, in red, and marks the control invalid. */
  error?: ReactNode;
  labelSize?: 13 | 12;
  className?: string;
  /** Right-aligned element on the label row (e.g. "Forgot password?"). */
  labelAside?: ReactNode;
  children: (props: { id: string; invalid: boolean; describedBy?: string }) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const hasNote = Boolean(error ?? help);
  return (
    <div className={className}>
      {labelAside ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <Label htmlFor={id} hint={hint} size={labelSize} className="mb-0">
            {label}
          </Label>
          {labelAside}
        </div>
      ) : (
        <Label htmlFor={id} hint={hint} size={labelSize}>
          {label}
        </Label>
      )}
      {children({ id, invalid: Boolean(error), describedBy: hasNote ? helpId : undefined })}
      {hasNote ? (
        <p
          id={helpId}
          className={cn("mb-0 mt-1.5 text-meta leading-normal", error ? "text-danger" : "text-ink-muted")}
        >
          {error ?? help}
        </p>
      ) : null}
    </div>
  );
}

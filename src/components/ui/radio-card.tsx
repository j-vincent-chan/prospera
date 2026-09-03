import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Bordered radio option with title + description. Selected: teal border on
 * the #f3fafb tint (Onboarding "Who can find this team", Team settings).
 */
export function RadioCard({
  title,
  description,
  suffix,
  checked,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Muted note after the title, e.g. "· recommended". */
  suffix?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-tile border px-3 py-2.5",
        checked ? "border-teal bg-[#f3fafb]" : "border-line-control bg-card",
        rest.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input type="radio" checked={checked} className="mt-[3px] accent-navy" {...rest} />
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">
          {title}
          {suffix ? <span className="font-normal text-ink-muted"> {suffix}</span> : null}
        </span>
        {description ? (
          <span className="block text-meta leading-normal text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

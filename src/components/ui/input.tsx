import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** 36px control (32 in panels). Invalid state: red border + soft red halo. */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; size?: 36 | 32 }
>(function Input({ className, invalid, size = 36, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-control border bg-card px-3 text-body text-ink placeholder:text-ink-muted",
        "disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted",
        size === 32 ? "h-8 text-dense" : "h-9",
        invalid
          ? "border-danger shadow-[0_0_0_3px_rgba(180,35,24,0.12)] focus-visible:shadow-[0_0_0_3px_rgba(180,35,24,0.12)]"
          : "border-line-control",
        className,
      )}
      {...rest}
    />
  );
});

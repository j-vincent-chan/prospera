import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full min-h-16 resize-y rounded-control border bg-card px-3 py-2 text-body leading-normal text-ink placeholder:text-ink-muted",
        "disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted",
        invalid ? "border-danger shadow-[0_0_0_3px_rgba(180,35,24,0.12)]" : "border-line-control",
        className,
      )}
      {...rest}
    />
  );
});

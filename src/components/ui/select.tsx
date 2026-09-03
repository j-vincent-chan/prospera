import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { size?: 36 | 32 | 30 }
>(function Select({ className, size = 36, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "rounded-control border border-line-control bg-card pl-3 pr-8 text-ink",
        "select-chevron appearance-none",
        "disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted",
        size === 36 ? "h-9 text-body" : size === 32 ? "h-8 text-dense" : "h-[30px] text-dense",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

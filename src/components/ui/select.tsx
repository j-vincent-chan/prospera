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
        "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat",
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

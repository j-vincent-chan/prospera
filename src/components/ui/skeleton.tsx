import { cn } from "@/lib/utils/cn";

/**
 * Loading placeholder. A skeleton always mirrors the layout it stands in for;
 * page content never shows a centred spinner (States v2).
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "block rounded-[4px] bg-[length:200%_100%] animate-skeleton",
        "bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)]",
        className,
      )}
    />
  );
}

/** The table-shaped skeleton from States v2: title bar plus N 56px rows. */
export function SkeletonTable({ rows = 4 }: { rows?: number }) {
  const widths = ["78%", "62%", "84%", "55%", "70%", "66%"];
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-card border border-line bg-card"
    >
      <div className="flex justify-between border-b border-line px-5 py-3">
        <Skeleton className="h-3.5 w-[180px]" />
        <Skeleton className="h-3.5 w-[90px]" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid h-14 grid-cols-[44%_11%_14%_11%_10%_10%] items-center gap-3 border-t border-line-row px-5"
        >
          <span>
            <Skeleton className="h-3.5" style={{ width: widths[index % widths.length] }} />
            <Skeleton className="mt-1.5 h-2.5 w-[120px]" />
          </span>
          <Skeleton className="h-[22px] w-14 rounded-full" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-[70px]" />
          <Skeleton className="h-3.5 w-[50px]" />
          <span />
        </div>
      ))}
    </div>
  );
}

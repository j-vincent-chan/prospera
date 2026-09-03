import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Table grammar from Foundations / Opportunities v2: sticky 12px header on the
 * canvas tint, 56px rows split by hairlines, first cell indented 20px, all
 * others 12px. `border-collapse: separate` so the sticky header keeps its
 * bottom rule while scrolling. The wrapper must not set `overflow: hidden`.
 */
export function Table({
  className,
  ...rest
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full table-fixed border-separate border-spacing-0 text-body", className)}
      {...rest}
    />
  );
}

export function TableHead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("text-left text-meta text-ink-muted", className)} {...rest} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({
  className,
  selected,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "group/row h-14 hover:bg-canvas",
        selected && "bg-teal-tint hover:bg-teal-tint",
        className,
      )}
      {...rest}
    />
  );
}

export type SortDirection = "ascending" | "descending";

type HeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  /** Present on sortable columns. `null` = sortable but not the active sort. */
  sort?: SortDirection | null;
  onSort?: () => void;
  /** First column gets the 20px page indent. */
  first?: boolean;
  align?: "left" | "right";
};

export function TableHeaderCell({
  sort,
  onSort,
  first,
  align = "left",
  className,
  children,
  ...rest
}: HeaderCellProps) {
  const sortable = sort !== undefined;
  return (
    <th
      scope="col"
      aria-sort={sortable ? (sort ?? "none") : undefined}
      className={cn(
        "sticky top-0 z-[2] bg-canvas py-2.5 font-medium",
        "shadow-[inset_0_-1px_0_#e2e8f0]",
        first ? "pl-5 pr-3" : "px-3",
        align === "right" && "text-right",
        className,
      )}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex items-center gap-1 rounded-[3px] font-medium",
            sort ? "text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          {children}
          <SortGlyph direction={sort ?? null} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({
  first,
  align = "left",
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  first?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "border-t border-line-row align-middle",
        first ? "pl-5 pr-3" : "px-3",
        align === "right" && "text-right",
        className,
      )}
      {...rest}
    />
  );
}

/** Card-style frame around a table: title bar, then the scroll region. */
export function TableFrame({
  title,
  aside,
  children,
  className,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-card border border-line bg-card", className)}>
      {title || aside ? (
        <div className="flex items-center justify-between gap-3 rounded-t-card border-b border-line bg-card px-5 py-3">
          <div className="text-body">{title}</div>
          <div className="flex items-center gap-3 text-dense text-ink-muted">{aside}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function SortGlyph({ direction }: { direction: SortDirection | null }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "shrink-0",
  };
  if (direction === "ascending") {
    return (
      <svg {...common}>
        <path d="m5 12 7-7 7 7M12 19V5" />
      </svg>
    );
  }
  if (direction === "descending") {
    return (
      <svg {...common}>
        <path d="M12 5v14m7-7-7 7-7-7" />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0 text-line-control">
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

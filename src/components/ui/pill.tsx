import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Three pill families only — status, tier, tag — plus the trust marks used by
 * the institutional layer. The variant union is flat on purpose: a new colour
 * combination has to be added here, not improvised at a call site.
 *
 * Colour never carries meaning alone; every pill renders its label as text.
 */
export type PillVariant =
  // status — Open / Forecasted / Closed / Overdue, and the curated lifecycle
  | "status-open"
  | "status-forecasted"
  | "status-closed"
  | "status-overdue"
  | "status-published"
  | "status-draft"
  | "status-needs-review"
  // tier — match strength, shown instead of a numeric score
  | "tier-strong"
  | "tier-potential"
  | "tier-exploratory"
  // tier, square — the same strengths as the fit row's 6px label (fit-UX PR 2),
  // plus the two states a tier cannot express: "Can't assess" and "Ruled out"
  | "tier-strong-square"
  | "tier-moderate-square"
  | "tier-exploratory-square"
  | "tier-cannot-assess-square"
  | "tier-ruled-out-square"
  // tag — neutral descriptive labels
  | "tag"
  | "tag-selected"
  // trust — provenance of a library item or curated record
  | "trust-osr"
  | "trust-curated"
  | "trust-community"
  | "trust-synced";

const variants: Record<PillVariant, string> = {
  "status-open": "h-[22px] text-meta font-medium bg-success-tint text-success",
  "status-forecasted": "h-[22px] text-meta font-medium bg-warning-tint text-warning",
  "status-closed": "h-[22px] text-meta font-medium bg-line-row text-ink-body",
  "status-overdue": "h-[22px] text-meta font-medium bg-danger-tint text-danger",
  "status-published": "h-[22px] text-meta font-medium bg-success-tint text-success",
  "status-draft": "h-[22px] text-meta font-medium bg-line-row text-ink-body",
  "status-needs-review": "h-[22px] text-meta font-medium bg-warning-tint text-warning",

  "tier-strong": "h-5 text-micro font-medium bg-teal text-white",
  "tier-potential": "h-5 text-micro font-medium bg-teal-tint text-teal",
  "tier-exploratory": "h-5 text-micro font-medium bg-card text-ink-muted border border-line-control",

  "tier-strong-square": "py-[3px] text-meta font-semibold bg-teal text-white",
  "tier-moderate-square": "py-[3px] text-meta font-semibold bg-teal-tint text-teal",
  "tier-exploratory-square": "py-[3px] text-meta font-semibold bg-card text-ink-body border border-line-control",
  "tier-cannot-assess-square": "py-[3px] text-meta font-semibold bg-warning-tint text-warning",
  "tier-ruled-out-square": "py-[3px] text-meta font-semibold bg-line-row text-ink-muted",

  tag: "h-5 text-micro font-medium bg-line-row text-ink-body",
  "tag-selected": "h-5 text-micro font-medium bg-teal-tint text-teal",

  "trust-osr": "h-5 text-micro font-semibold bg-teal text-white",
  "trust-curated": "h-5 text-micro font-semibold bg-navy-tint text-navy",
  "trust-community": "h-5 text-micro font-semibold bg-card text-ink-body border border-line-control",
  "trust-synced": "h-5 text-micro font-semibold bg-success-tint text-success",
};

/**
 * The square tier labels the fit row uses (fit-UX PR 2): 6px radius and 9px of
 * side padding rather than a full pill, per the redesign's row table. `cn` is
 * a plain join, not a class merger, so the base cannot simply be overridden
 * from the variant string — the shape is chosen here and each variant carries
 * colour and type only, leaving every existing variant's output untouched.
 */
const SQUARE: ReadonlySet<PillVariant> = new Set<PillVariant>([
  "tier-strong-square",
  "tier-moderate-square",
  "tier-exploratory-square",
  "tier-cannot-assess-square",
  "tier-ruled-out-square",
]);

export function Pill({
  variant,
  children,
  className,
  title,
}: {
  variant: PillVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap",
        SQUARE.has(variant) ? "rounded-control px-[9px]" : "rounded-full px-2",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Buttons come in four families and three heights (36 page / 32 panel / 28 row).
 * One primary per view. See Foundations.dc.html.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "link"
  | "destructive"
  | "destructive-outline";

export type ButtonSize = 36 | 32 | 28;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading 16px icon. */
  icon?: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary: "border border-navy bg-navy text-white hover:bg-navy-hover hover:border-navy-hover",
  secondary: "border border-line-control bg-card text-ink hover:bg-canvas",
  ghost: "border border-transparent bg-transparent text-ink hover:bg-line-row",
  link: "border border-transparent bg-transparent text-teal hover:text-navy",
  destructive: "border border-danger bg-danger text-white hover:bg-danger-dark hover:border-danger-dark",
  "destructive-outline": "border border-line-control bg-card text-danger hover:bg-danger-tint",
};

const sizes: Record<ButtonSize, string> = {
  36: "h-9 px-3.5 text-body",
  32: "h-8 px-3 text-dense",
  28: "h-7 px-2.5 text-dense",
};

// Link-style buttons sit inline with text: no box, no padding reservation.
const linkSizes: Record<ButtonSize, string> = {
  36: "h-9 text-body",
  32: "h-8 text-dense",
  28: "h-7 text-dense",
};

export function Button({
  variant = "primary",
  size = 36,
  icon,
  type = "button",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "link" ? linkSizes[size] : sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

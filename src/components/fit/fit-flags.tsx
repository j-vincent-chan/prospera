import { cn } from "@/lib/utils/cn";

/**
 * The engine's plain-language flags under a row (plan § PR 3.2, follow-up "3.2b"):
 * "mechanism far above readiness; consider as project lead, not PI",
 * "deadline runway short; show the next cycle if the notice has one". They
 * used to reach the reader only inside the rationale dump, buried after nine
 * component scores.
 *
 * A caveat is text, never a colour on its own — the dot is decorative and the
 * words carry the meaning.
 */
export function FitFlags({ flags, className }: { flags: readonly string[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <ul className={cn("mb-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-meta leading-normal text-warning-dark", className)}>
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span aria-hidden className="mt-[5px] inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-warning" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

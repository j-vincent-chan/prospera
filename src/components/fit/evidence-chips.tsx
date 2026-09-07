import { cn } from "@/lib/utils/cn";

export type EvidenceChip = { id: string; title: string; href?: string | null; /** "Publication", "NIH grant" … */ kind?: string | null; /** Journal · year, project number … */ meta?: string | null };

/**
 * The evidence items a rationale cites (plan § PR 3.2 "every tier shown has
 * a rationale that cites at least one evidence item"): small chips, a link
 * where the id carries a public identifier. Server-safe.
 */
export function EvidenceChips({ items, prefix = "Evidence:", className }: { items: readonly EvidenceChip[]; prefix?: string | null; className?: string }) {
  if (!items.length) return null;
  const chip = "inline-flex h-5 max-w-[320px] items-center truncate rounded-[5px] border border-line bg-card px-[7px] text-micro font-medium text-ink-body";
  return (
    <p className={cn("mb-0 mt-1 flex flex-wrap items-center gap-1.5 text-meta text-ink-muted", className)}>
      {prefix ? <span className="whitespace-nowrap">{prefix}</span> : null}
      {items.map((it) => {
        const title = [it.kind, it.meta].filter(Boolean).join(" · ") || undefined;
        return it.href ? (
          <a key={it.id} href={it.href} target="_blank" rel="noreferrer" title={title} className={cn(chip, "hover:border-teal hover:text-teal")}>
            {it.title}
          </a>
        ) : (
          <span key={it.id} title={title} className={chip}>
            {it.title}
          </span>
        );
      })}
    </p>
  );
}

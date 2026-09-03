import { EmptyState } from "@/components/ui/empty-state";

/**
 * Stands in for a v2 screen until its build step lands, so the shell's
 * navigation resolves everywhere from step 1. Replaced per route in steps 2-7.
 */
export function PlaceholderPage({
  title,
  step,
  description,
}: {
  title: string;
  step: number;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="m-0 text-h1 font-semibold text-ink">{title}</h1>
        <p className="mb-0 mt-2 max-w-[640px] text-body text-ink-body">{description}</p>
      </header>
      <EmptyState
        title={`${title} arrives in step ${step}`}
        description="This route is reserved so the sidebar resolves. Nothing here is wired to data yet."
      />
    </div>
  );
}

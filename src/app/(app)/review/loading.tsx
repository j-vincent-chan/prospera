import { Skeleton } from "@/components/ui/skeleton";

/** The page's shape while the queue and the selected notice load: the aside, the header card, three rows. */
export default function ReviewLoading() {
  return (
    <div className="mx-auto w-full max-w-[1720px]" aria-busy>
      <Skeleton className="h-8 w-32" />
      <div className="mt-4 flex flex-nowrap items-start gap-[clamp(12px,1.4vw,20px)]">
        <Skeleton className="h-[360px] w-[clamp(200px,19vw,340px)] shrink-0 rounded-card" />
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Skeleton className="h-[280px] rounded-card" />
          <Skeleton className="h-[520px] rounded-card" />
        </div>
      </div>
    </div>
  );
}

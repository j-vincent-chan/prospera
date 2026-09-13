import { Skeleton } from "@/components/ui/skeleton";

/** The page's shape while the day loads: the date, its line, three cards, the aside. */
export default function HomeLoading() {
  return (
    <div className="mx-auto w-full max-w-[1720px]" aria-busy>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2.5 h-4 w-[520px]" />
      <div className="mt-[18px] flex flex-nowrap items-start gap-[clamp(12px,1.4vw,20px)]">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Skeleton className="h-[220px] rounded-card" />
          <Skeleton className="h-[160px] rounded-card" />
          <Skeleton className="h-[160px] rounded-card" />
        </div>
        <Skeleton className="h-[300px] w-[clamp(200px,19vw,340px)] shrink-0 rounded-card" />
      </div>
    </div>
  );
}

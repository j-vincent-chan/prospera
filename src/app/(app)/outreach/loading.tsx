import { Skeleton } from "@/components/ui/skeleton";

export default function OutreachLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2.5 h-4 w-[560px]" />
      </div>
      <div className="grid grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[140px] rounded-card" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-card" />
      </div>
    </div>
  );
}

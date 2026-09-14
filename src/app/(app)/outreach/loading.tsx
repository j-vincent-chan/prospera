import { Skeleton } from "@/components/ui/skeleton";

export default function OutreachLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2.5 h-4 w-[min(560px,100%)]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
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

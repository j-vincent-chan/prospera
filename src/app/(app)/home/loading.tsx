import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div className="flex max-w-[1240px] flex-col gap-5" aria-busy>
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2.5 h-4 w-[460px]" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-card" />)}</div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4"><Skeleton className="h-[320px] rounded-card" /><Skeleton className="h-[220px] rounded-card" /></div>
        <div className="flex flex-col gap-4"><Skeleton className="h-[180px] rounded-card" /><Skeleton className="h-[160px] rounded-card" /></div>
      </div>
    </div>
  );
}

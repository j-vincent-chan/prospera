import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function InvestigatorsLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <div>
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-2.5 h-4 w-[520px]" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-[480px]" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/** The page's shape while the draft set loads: the back link, the title, the recipients aside, the message card. */
export default function DraftOutreachLoading() {
  return (
    <div className="mx-auto w-full max-w-[1480px]" aria-busy>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-[18px] flex flex-nowrap items-start gap-[clamp(12px,1.4vw,20px)]">
        <Skeleton className="h-[280px] w-[clamp(220px,21vw,320px)] shrink-0 rounded-card" />
        <Skeleton className="h-[560px] flex-1 rounded-card" />
      </div>
    </div>
  );
}

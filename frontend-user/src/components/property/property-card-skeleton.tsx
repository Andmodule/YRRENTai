import { Skeleton } from '@/components/ui/skeleton';

export function PropertyCardSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm">
      <div className="flex items-start gap-4 p-5">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
      <div className="border-t px-5 py-3">
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

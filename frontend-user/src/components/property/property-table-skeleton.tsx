import { Skeleton } from '@/components/ui/skeleton';

export function PropertyTableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 max-w-xs rounded-md bg-muted" />
      <div className="overflow-hidden rounded-lg border border-border/50 bg-card/40">
        <div className="border-b border-border/50 bg-muted/20 px-3 py-2.5">
          <Skeleton className="h-3 w-full max-w-md rounded bg-muted" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/35 px-3 py-3 last:border-0"
          >
            <Skeleton className="h-4 w-6 rounded bg-muted" />
            <Skeleton className="h-8 w-8 shrink-0 rounded-md bg-muted" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/5 max-w-[200px] rounded bg-muted" />
              <Skeleton className="h-3 w-3/5 max-w-xs rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

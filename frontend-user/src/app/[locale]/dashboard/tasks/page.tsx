'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';

/** Code-split: full kanban graph is heavy; avoids dev compile OOM on low-RAM machines. */
const ManagerKanban = dynamic(
  () =>
    import('@/modules/tasks/components/manager/ManagerKanban').then((m) => ({
      default: m.ManagerKanban,
    })),
  { loading: () => <TasksBoardFallback /> },
);

function TasksBoardFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const filters = useTasksFiltersStore((s) => s.filters);

  return (
    <div className="tasks-theme flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background max-md:-mx-4 max-md:px-2 max-md:pb-2 max-md:pt-0 md:space-y-4">
      <Suspense fallback={<TasksBoardFallback />}>
        <ManagerKanban filters={filters} />
      </Suspense>
    </div>
  );
}

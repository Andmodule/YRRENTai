'use client';

import { useMemo } from 'react';
import type { Task, TaskFilters } from '../types';

export function useTaskFilters(
  tasks: Task[],
  filters: Pick<TaskFilters, 'statusFilter' | 'priorityFilter' | 'propertyQuery' | 'dateRangeEnabled'>,
): Task[] {
  return useMemo(() => {
    const q = filters.propertyQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      const statusOk =
        filters.statusFilter === 'all'
          ? filters.dateRangeEnabled
            ? true
            : t.status !== 'done'
          : t.status === filters.statusFilter;
      const priorityOk = filters.priorityFilter === 'all' || t.priority === filters.priorityFilter;
      const queryOk =
        !q ||
        (t.propertyTitle ?? '').toLowerCase().includes(q) ||
        (t.title ?? '').toLowerCase().includes(q);
      return statusOk && priorityOk && queryOk;
    });
  }, [tasks, filters.statusFilter, filters.priorityFilter, filters.propertyQuery, filters.dateRangeEnabled]);
}

'use client';

import { useMemo } from 'react';
import type { Task, TaskFilters } from '../types';

export function useTaskFilters(
  tasks: Task[],
  filters: Pick<TaskFilters, 'statusFilter' | 'priorityFilter' | 'propertyQuery'>,
): Task[] {
  return useMemo(() => {
    const q = filters.propertyQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      let statusOk = false;
      if (filters.statusFilter === 'all') {
        /** «Все» теперь скрывает выполненные задачи и решенные инциденты по просьбе пользователя. */
        statusOk = t.status !== 'done';
      } else {
        statusOk = t.status === filters.statusFilter;
      }
      const priorityOk = filters.priorityFilter === 'all' || t.priority === filters.priorityFilter;
      const queryOk =
        !q ||
        (t.propertyTitle ?? '').toLowerCase().includes(q) ||
        (t.title ?? '').toLowerCase().includes(q);
      return statusOk && priorityOk && queryOk;
    });
  }, [tasks, filters.statusFilter, filters.priorityFilter, filters.propertyQuery]);
}

import { create } from 'zustand';
import type { TaskFilters } from '@/modules/tasks/types';

const WIDE_START = new Date('2000-01-01T12:00:00');
const WIDE_END = new Date('2100-12-31T12:00:00');

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  dateRangeEnabled: false,
  dateRange: { start: WIDE_START, end: WIDE_END },
  statusFilter: 'all',
  priorityFilter: 'all',
  assigneeId: 'all',
  propertyQuery: '',
};

interface TasksFiltersState {
  filters: TaskFilters;
  setFilters: (f: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
}

export const useTasksFiltersStore = create<TasksFiltersState>((set) => ({
  filters: DEFAULT_TASK_FILTERS,
  setFilters: (updater) =>
    set((s) => ({
      filters: typeof updater === 'function' ? updater(s.filters) : updater,
    })),
}));

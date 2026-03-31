import type { TaskStatus } from './types';

export const KANBAN_COLUMNS = [
  { status: 'pending', headerKey: 'pending', headerClass: 'text-gray-600', emptyKey: 'emptyPending' },
  { status: 'in_progress', headerKey: 'in_progress', headerClass: 'text-blue-600', emptyKey: 'emptyProgress' },
  { status: 'done', headerKey: 'done', headerClass: 'text-green-600', emptyKey: 'emptyDone' },
  { status: 'issue', headerKey: 'issue', headerClass: 'text-red-600', emptyKey: 'emptyIssue' },
] as const satisfies readonly {
  status: TaskStatus;
  headerKey: 'pending' | 'in_progress' | 'done' | 'issue';
  headerClass: string;
  emptyKey: 'emptyPending' | 'emptyProgress' | 'emptyDone' | 'emptyIssue';
}[];

export type KanbanColumnDef = (typeof KANBAN_COLUMNS)[number];

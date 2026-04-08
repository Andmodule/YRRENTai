import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import type { TaskStatus } from '../types';

/** Maps incident workflow to Kanban columns (manager board shows open + in_review only). */
export function incidentStatusToKanbanColumn(status: Incident['status']): TaskStatus {
  switch (status) {
    case 'awaiting_dispatch':
    case 'assigned':
    case 'in_review':
      return 'pending';
    case 'open':
      return 'in_progress';
    case 'resolved':
    case 'closed':
      return 'done';
  }
}

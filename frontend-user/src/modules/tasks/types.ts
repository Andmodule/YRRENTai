export type TaskType = 'checkout_cleaning' | 'checkin_prep' | 'mid_stay_cleaning' | 'manual';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'issue';

export type TaskPriority = 'urgent' | 'normal' | 'low';

export interface Task {
  uuid: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  streetAddress?: string;
  reservationId: string | null;
  contextLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string;
  dueTime: string | null;
  notes: string;
  issueDescription: string | null;
  photoUrls: string[];
  hasVerificationPhoto?: boolean;
  inProgressStartedAt?: string | null;
  lastManagerSeenAt?: string | null;
  unseenNotesCount?: number;
  createdAt: string;
  completedAt: string | null;
  checklistSummary?: {
    total: number;
    checked: number;
    requiredUnchecked: number;
  } | null;
}

export interface TaskNote {
  uuid: string;
  taskId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl: string | null;
  createdAt: string;
}

export interface TasksApiResponse {
  tasks: Task[];
}

export interface TaskFilters {
  dateRange: { start: Date; end: Date };
  statusFilter: TaskStatus | 'all';
  priorityFilter: TaskPriority | 'all';
  propertyQuery: string;
  assigneeId: string | 'all';
}

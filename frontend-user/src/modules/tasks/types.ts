export type TaskType =
  | 'checkout_cleaning'
  | 'mid_stay_cleaning'
  | 'checkin_prep'
  | 'maintenance'
  | 'other';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'issue';

export type TaskPriority = 'urgent' | 'normal' | 'critical';

export interface Task {
  uuid: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  /** Nullable when the API returns no property (rare); empty string also treated as unassigned in list grouping. */
  propertyId: string | null;
  /** Task applies to all listings; list groups under "General tasks" (API may still send a fallback propertyId). */
  isGeneralTask?: boolean;
  propertyTitle: string;
  propertyAddress: string;
  streetAddress?: string;
  reservationId: string | null;
  contextLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Present when task was created after creator tracking; manager who created the task. */
  creatorId?: string | null;
  creatorName?: string | null;
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
  /** Present when this task was created from an incident (dispatch / drawer). */
  incidentId?: string | null;
}

export interface TaskChecklistItem {
  uuid: string;
  text: string;
  required: boolean;
  sortOrder: number;
  checked: boolean;
  checkedAt: string | null;
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
  /** When false, API uses a wide due-date window; list shows all non-done tasks when status is "all". */
  dateRangeEnabled: boolean;
  dateRange: { start: Date; end: Date };
  statusFilter: TaskStatus | 'all';
  priorityFilter: TaskPriority | 'all';
  propertyQuery: string;
  assigneeId: string | 'all';
}

export interface StaffMember {
  id: string;
  displayName: string;
  role: string;
}

/** POST /tasks/voice-parse — STT + LLM extraction (backend mock until Whisper + LLM). */
export interface VoiceParseResult {
  entityType: 'task' | 'incident';
  transcript: string;
  /** Task */
  isGeneralTask?: boolean;
  propertyIds?: string[];
  title?: string;
  type?: TaskType;
  assigneeId?: string | null;
  dueDate?: string;
  priority?: TaskPriority;
  /** Incident */
  incidentType?: 'damage' | 'lost_item' | 'rule_violation' | 'emergency';
  propertyId?: string | null;
  estimatedCost?: number | null;
}

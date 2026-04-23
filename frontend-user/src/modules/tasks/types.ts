export type TaskType =
  | 'checkout_cleaning'
  | 'mid_stay_cleaning'
  | 'checkin_prep'
  | 'maintenance'
  | 'other';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'issue';

export type TaskPriority = 'urgent' | 'normal';

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
  /** Present after API exposes task update time (older clients may omit). */
  updatedAt?: string;
  completedAt: string | null;
  checklistSummary?: {
    total: number;
    checked: number;
    requiredUnchecked: number;
  } | null;
  /** Present when this task was created from an incident (dispatch / drawer). */
  incidentId?: string | null;
  /** Incidents reported in context of this task (`incidents.taskId`). Manager API; newest first. */
  linkedIncidentIdsFromTask?: string[];
  /** Supply/shortage queue events for this task (pending manager). Manager API. */
  pendingSupplyInterpretationIds?: string[];
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

/** GET /tasks/manager/staff-notes-feed */
export interface TaskNoteFeedItem extends TaskNote {
  taskTitle: string;
  propertyTitle: string;
  taskStatus: string;
  isUnseen: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface TasksApiResponse {
  tasks: Task[];
}

/** GET /tasks/manager/supply-interpretations — rows awaiting manager review (supply-related). */
export interface SupplyInterpretationItemRow {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  supplyItemId?: string | null;
  lineStatus?: string;
}

/** GET /tasks/manager/supply-matrix — сводная матрица нехваток. */
export interface SupplyMatrixRow {
  groupKey: string;
  supplyItemId: string | null;
  displayName: string;
  defaultUnit: string | null;
  totalQuantity: number;
  quantityIsPartial: boolean;
  /** Агрегат по строкам позиции: не отдано водителю / в пути / доставлено. */
  fulfillmentStatus: 'pending' | 'in_delivery' | 'delivered';
  /** Сколько разных событий (отчётов) слилось в эту строку сводки. */
  sourceEventCount: number;
  /** Все недоставленные строки группы на одном маршруте — только PATCH assign-driver. */
  deliveryRouteIdForHandoff: string | null;
  /** Строки группы размазаны по пулу и маршруту или по разным маршрутам. */
  deliveryRouteHandoffMixed: boolean;
  byProperty: Array<{
    propertyId: string;
    propertyTitle: string;
    /** Адрес объекта (новые ответы API). */
    propertyAddress?: string | null;
    quantitySum: number;
    quantityIsPartial: boolean;
    requestLineIds: string[];
    /** По строкам этой ячейки; если нет в ответе — берётся `fulfillmentStatus` строки. */
    fulfillmentStatus?: 'pending' | 'in_delivery' | 'delivered';
  }>;
}

export interface PendingSupplyInterpretationEvent {
  id: string;
  entryPoint: string;
  targetType: string;
  targetId: string;
  /** Объект — для сводки (группировка с матрицей). */
  propertyId: string;
  textRaw: string;
  propertyTitle: string;
  authorName: string;
  createdAt: string;
  llmStatus: string;
  workflowState: string;
  /** Truncated server error when LLM failed (`manual_review`). */
  llmError?: string | null;
  /** Intent из ответа LLM после успешного разбора. */
  llmIntent?: string | null;
  /** Снабжение/логистика vs текст про поломку/риск (сервер + эвристика по `textRaw`). */
  managerBucket: 'supply' | 'incident';
  items: SupplyInterpretationItemRow[];
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

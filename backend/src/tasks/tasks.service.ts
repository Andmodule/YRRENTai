import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { addDays, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { TaskEntity } from './entities/task.entity';
import { IncidentEntity, type IncidentType } from '../incidents/entities/incident.entity';
import type { IncidentSuggestedTaskDraftDto } from '../incidents/incidents.service';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyService } from '../property/property.service';
import { PropertyEntity } from '../property/entities/property.entity';
import { UserService } from '../user/user.service';
import type { StaffMemberDto } from '../user/interfaces/public-user.interface';
import { TaskNoteEntity } from './entities/task-note.entity';
import { TasksGateway } from './tasks.gateway';
import { ChecklistService } from './checklist.service';
import { StaffNotificationService } from '../telegram/staff-notification.service';
import { IncidentsService } from '../incidents/incidents.service';
import { StaffInterpretationService } from './staff-interpretation.service';
import { DeliveryRoutesService } from './delivery-routes.service';

export type StaffMiniAppButtonPressed = 'TASK' | 'INCIDENT';
export type StaffMiniAppDetectedMode = 'TASK_ONLY' | 'INCIDENT_ONLY' | 'MIXED';

/** POST /tasks/staff-miniapp/voice-preview */
export interface StaffMiniAppVoicePreviewDto {
  buttonPressed: StaffMiniAppButtonPressed;
  detectedMode: StaffMiniAppDetectedMode;
  confidence: number;
  transcript: string;
  task: {
    suggestedStatus: string | null;
    comment: string;
    shortages: string | null;
  };
  incident: {
    include: boolean;
    type: IncidentType | null;
    title: string | null;
    description: string | null;
    risk: 'low' | 'medium' | 'high' | null;
  };
  needsClarification: boolean;
  clarificationQuestions: string[];
  mismatchHint: string | null;
  overridePropertyId?: string | null;
  overridePropertyTitle?: string | null;
}

/** POST /tasks/staff-miniapp/voice-submit */
export interface StaffMiniAppVoiceSubmitDto {
  /** Либо задача, либо объект маршрута (водитель без задачи уборки). */
  taskUuid?: string;
  propertyId?: string;
  overridePropertyId?: string | null;
  clientRequestId?: string;
  buttonPressed: StaffMiniAppButtonPressed;
  transcript: string;
  detectedMode: StaffMiniAppDetectedMode;
  task: { suggestedStatus: string | null; comment: string; shortages?: string | null };
  incident: {
    include: boolean;
    type?: string | null;
    title?: string | null;
    description?: string | null;
    risk?: string | null;
    /** Загружены через POST /incidents/upload-photos до submit. */
    photoUrls?: string[];
  };
}

export interface TaskDto {
  uuid: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  /** Applies to all properties; propertyId is a technical fallback for FK/notifications. */
  isGeneralTask: boolean;
  propertyId: string;
  propertyTitle: string;
  /** City + address (manager / summary). */
  propertyAddress: string;
  /** Property.address column only (staff checklist). */
  streetAddress: string;
  reservationId: string | null;
  contextLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  creatorId: string | null;
  creatorName: string | null;
  dueDate: string;
  dueTime: string | null;
  notes: string;
  issueDescription: string | null;
  photoUrls: string[];
  hasVerificationPhoto: boolean;
  inProgressStartedAt: string | null;
  lastManagerSeenAt: string | null;
  unseenNotesCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** null if no checklist rows for this task */
  checklistSummary: {
    total: number;
    checked: number;
    requiredUnchecked: number;
  } | null;
  /** Set when task was created from an incident (dispatch / Smart Create from drawer). */
  incidentId: string | null;
  /** Incidents filed with this task as context (`incidents.taskId`); newest first. Manager/owner. */
  linkedIncidentIdsFromTask: string[];
  /** Supply/shortage interpretation rows targeting this task (awaiting manager). Manager/owner. */
  pendingSupplyInterpretationIds: string[];
}

export interface TaskNoteDto {
  uuid: string;
  taskId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl: string | null;
  createdAt: string;
}

/** Response from POST /tasks/voice-parse (Whisper STT + LLM extraction). */
export interface VoiceParseResultDto {
  entityType: 'task' | 'incident';
  transcript: string;
  /** Task shape */
  isGeneralTask?: boolean;
  propertyIds?: string[];
  title?: string;
  type?: string;
  assigneeId?: string | null;
  dueDate?: string;
  priority?: string;
  /** Incident shape */
  incidentType?: IncidentType;
  propertyId?: string | null;
  estimatedCost?: number | null;
}

const VOICE_TASK_TYPES = [
  'checkout_cleaning',
  'mid_stay_cleaning',
  'checkin_prep',
  'maintenance',
  'other',
] as const;

const VOICE_PRIORITIES = ['normal', 'urgent', 'critical'] as const;

interface LlmVoiceParseJson {
  entityType?: string;
  title?: string;
  type?: string;
  priority?: string;
  propertyIds?: string[];
  assigneeId?: string | null;
  dueDate?: string | null;
  isGeneralTask?: boolean;
  incidentType?: string;
  propertyId?: string | null;
  estimatedCost?: number | null;
}

/** Staff bot: Groq STT → DeepSeek routing (complete task vs incident). */
export interface StaffVoiceParseResultDto {
  action: 'complete' | 'incident' | 'fallback' | 'ambiguous_incident' | 'unmapped_voice';
  taskId?: string;
  title?: string;
  propertyId?: string;
  transcript: string;
  candidatePropertyIds?: string[];
  suggestedTaskDraft?: IncidentSuggestedTaskDraftDto;
}

interface LlmStaffVoiceJson {
  action: 'complete' | 'incident' | 'fallback' | 'ambiguous_incident';
  taskId?: string | null;
  title?: string | null;
  propertyId?: string | null;
  candidatePropertyIds?: string[] | null;
  suggestedTask?: {
    title?: string | null;
    type?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    dueDate?: string | null;
    notes?: string | null;
  } | null;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentRepo: Repository<IncidentEntity>,
    @InjectRepository(TaskNoteEntity)
    private readonly taskNoteRepo: Repository<TaskNoteEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    private readonly tasksGateway: TasksGateway,
    private readonly checklistService: ChecklistService,
    private readonly propertyService: PropertyService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => StaffNotificationService))
    private readonly staffNotification: StaffNotificationService,
    @Inject(forwardRef(() => IncidentsService))
    private readonly incidentsService: IncidentsService,
    @Inject(forwardRef(() => StaffInterpretationService))
    private readonly staffInterpretation: StaffInterpretationService,
    private readonly deliveryRoutesService: DeliveryRoutesService,
  ) {}

  /** Контекст для LLM голоса по объекту маршрута (без записи в БД). */
  private buildPseudoTaskForRouteVoice(property: PropertyEntity): TaskEntity {
    const t = new TaskEntity();
    t.id = property.id;
    t.title = 'Маршрут доставки';
    t.type = 'manual';
    t.status = 'in_progress';
    t.priority = 'normal';
    t.propertyId = property.id;
    t.companyId = property.companyId;
    t.dueDate = format(new Date(), 'yyyy-MM-dd');
    t.dueTime = null;
    t.property = property;
    return t;
  }

  private toDto(
    t: TaskEntity,
    extras: {
      unseenNotesCount: number;
      checklistSummary: TaskDto['checklistSummary'];
      linkedIncidentIdsFromTask?: string[];
      pendingSupplyInterpretationIds?: string[];
    },
  ): TaskDto {
    const isGen = t.isGeneralTask ?? false;
    const addr = t.property
      ? [t.property.city, t.property.address].filter(Boolean).join(', ')
      : '';
    return {
      uuid: t.id,
      title: t.title ?? '',
      type: t.type,
      status: t.status,
      priority: t.priority,
      isGeneralTask: isGen,
      propertyId: t.propertyId,
      propertyTitle: isGen ? 'Общая задача' : (t.property?.name ?? ''),
      propertyAddress: isGen ? '' : addr,
      streetAddress: isGen ? '' : (t.property?.address ?? ''),
      reservationId: t.reservationId,
      contextLabel: t.contextLabel,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee
        ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim()
        : null,
      creatorId: t.createdById ?? null,
      creatorName: t.createdBy
        ? `${t.createdBy.firstName} ${t.createdBy.lastName}`.trim()
        : null,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      notes: t.notes,
      issueDescription: t.issueDescription,
      photoUrls: t.photoUrls ?? [],
      hasVerificationPhoto: t.hasVerificationPhoto ?? false,
      inProgressStartedAt: t.inProgressStartedAt ? t.inProgressStartedAt.toISOString() : null,
      lastManagerSeenAt: t.lastManagerSeenAt ? t.lastManagerSeenAt.toISOString() : null,
      unseenNotesCount: extras.unseenNotesCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      checklistSummary: extras.checklistSummary,
      incidentId: t.incidentId ?? null,
      linkedIncidentIdsFromTask: extras.linkedIncidentIdsFromTask ?? [],
      pendingSupplyInterpretationIds: extras.pendingSupplyInterpretationIds ?? [],
    };
  }

  /** Incidents + supply queue rows for manager task badges (batched for list). */
  private async loadManagerTaskLinkExtras(taskIds: string[]): Promise<{
    incidentsByTask: Map<string, string[]>;
    supplyByTask: Map<string, string[]>;
  }> {
    const incidentsByTask = new Map<string, string[]>();
    const supplyByTask = new Map<string, string[]>();
    if (taskIds.length === 0) return { incidentsByTask, supplyByTask };

    const incidentRows = await this.incidentRepo.find({
      where: { taskId: In(taskIds) },
      select: ['id', 'taskId', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    for (const r of incidentRows) {
      if (!r.taskId) continue;
      const list = incidentsByTask.get(r.taskId) ?? [];
      list.push(r.id);
      incidentsByTask.set(r.taskId, list);
    }

    const supplyRows = (await this.taskRepo.manager.query(
      `SELECT e.id AS id, e."targetId" AS "targetId"
       FROM staff_interpretation_events e
       INNER JOIN tasks t ON t.id = e."targetId" AND e."targetType" = 'task'
       WHERE e."targetId" = ANY($1::uuid[])
         AND t.status <> 'done'
         AND (
           e."workflowState" IN ('pending_manager', 'manual_review')
           OR (
             e."workflowState" = 'manager_acknowledged'
             AND EXISTS (
               SELECT 1 FROM supply_request_items sri
               WHERE sri."interpretationEventId" = e.id
                 AND sri."lineStatus" IN ('pending', 'handed_to_driver')
             )
           )
         )
       ORDER BY e."createdAt" DESC`,
      [taskIds],
    )) as { id: string; targetId: string }[];
    for (const r of supplyRows) {
      const list = supplyByTask.get(r.targetId) ?? [];
      list.push(r.id);
      supplyByTask.set(r.targetId, list);
    }

    return { incidentsByTask, supplyByTask };
  }

  private async unseenNoteCounts(taskIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (taskIds.length === 0) return map;
    const rows = (await this.taskRepo.manager.query(
      `SELECT t.id AS "taskId",
        (SELECT COUNT(*)::int FROM task_notes n
         WHERE n."taskId" = t.id
         AND n."createdAt" > COALESCE(t."lastManagerSeenAt", '1970-01-01'::timestamptz)) AS unseen
      FROM tasks t WHERE t.id = ANY($1::uuid[])`,
      [taskIds],
    )) as { taskId: string; unseen: string }[];
    for (const r of rows) {
      map.set(r.taskId, Number(r.unseen));
    }
    return map;
  }

  async findForUser(
    userId: string,
    role: string,
    from: string,
    to: string,
    assigneeId?: string,
  ): Promise<TaskDto[]> {
    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.property', 'p')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to });

    if (assigneeId && assigneeId !== 'all') {
      qb.andWhere('t.assigneeId = :assigneeId', { assigneeId });
    }

    const rows = await qb.orderBy('t.dueDate', 'ASC').addOrderBy('t.dueTime', 'ASC').getMany();
    const unseen = await this.unseenNoteCounts(rows.map((r) => r.id));
    const summaries = await this.checklistService.summariesForTasks(rows.map((r) => r.id));
    const linkExtras =
      role === 'MANAGER' || role === 'OWNER'
        ? await this.loadManagerTaskLinkExtras(rows.map((r) => r.id))
        : null;
    return rows.map((r) =>
      this.toDto(r, {
        unseenNotesCount: unseen.get(r.id) ?? 0,
        checklistSummary: summaries.get(r.id) ?? null,
        linkedIncidentIdsFromTask: linkExtras?.incidentsByTask.get(r.id),
        pendingSupplyInterpretationIds: linkExtras?.supplyByTask.get(r.id),
      }),
    );
  }

  async findForStaff(userId: string, from: string, to: string): Promise<TaskDto[]> {
    const rows = await this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.property', 'p')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .where('t.assigneeId = :userId', { userId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to })
      .orderBy('t.dueDate', 'ASC')
      .addOrderBy('t.dueTime', 'ASC')
      .getMany();
    const summaries = await this.checklistService.summariesForTasks(rows.map((r) => r.id));
    return rows.map((r) =>
      this.toDto(r, {
        unseenNotesCount: 0,
        checklistSummary: summaries.get(r.id) ?? null,
      }),
    );
  }

  async ensureTaskAccess(taskId: string, userId: string, role: string): Promise<TaskEntity> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['property', 'assignee', 'createdBy'],
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (role === 'STAFF') {
      if (task.assigneeId !== userId) {
        throw new ForbiddenException('You are not assigned to this task');
      }
      return task;
    }
    if (role === 'SUPERADMIN') {
      return task;
    }
    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    if (task.property.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    return task;
  }

  /** Пустая строка от клиента не должна попадать в UUID-колонку — иначе задача не находится по assigneeId. */
  private static normalizeAssigneeIdInput(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
  }

  private static readonly PATCHABLE_PRIORITIES = new Set(['urgent', 'normal', 'critical']);

  private static readonly PATCHABLE_TASK_TYPES = new Set([
    'checkout_cleaning',
    'mid_stay_cleaning',
    'checkin_prep',
    'maintenance',
    'other',
  ]);

  /** Staff Telegram notifications: only for active work, not done/issue. */
  private static isStaffNotifiableTaskStatus(status: string): boolean {
    return status === 'pending' || status === 'in_progress';
  }

  /**
   * LLM/voice often sets status "issue" for довоз/замена; the red Kanban badge "Инцидент" maps to task.status issue.
   * Downgrade when text is supply/logistics only, not a real escalation (damage, flood, theft, …).
   */
  private static isSupplyOrLogisticsNotStrongIncident(
    shortages: string | null,
    comment: string,
    transcript: string,
  ): boolean {
    const combined = [shortages, comment, transcript].filter(Boolean).join('\n').toLowerCase();
    if (!combined.trim()) return false;
    const supply =
      /довоз|замен|достав|забрать|курьер|логистик|бумаг|полотен|расход|снабж|стирк|бель|водител|немиг|restock|supply|replacement|pickup/i;
    const strongIncident =
      /слом|полом|тресн|потоп|затоп|краж|пожар|авар|травм|угроз|утеря|утерян|аварий|damage|flood|theft|emergency/i;
    return supply.test(combined) && !strongIncident.test(combined);
  }

  async getOneForUser(taskId: string, userId: string, role: string): Promise<TaskDto> {
    const task = await this.ensureTaskAccess(taskId, userId, role);
    return this.toDtoForRole(task, role);
  }

  async deleteForUser(taskId: string, userId: string, role: string): Promise<void> {
    const task = await this.ensureTaskAccess(taskId, userId, role);
    await this.taskRepo.manager.query(
      `UPDATE incidents SET "taskId" = NULL WHERE "taskId" = $1`,
      [task.id],
    );
    await this.taskRepo.manager.query(
      `UPDATE incidents SET "dispatchedTaskId" = NULL WHERE "dispatchedTaskId" = $1`,
      [task.id],
    );
    await this.taskRepo.delete({ id: task.id });
    this.tasksGateway.emitTaskUpdated({ uuid: task.id, status: task.status });
  }

  async update(
    taskId: string,
    userId: string,
    role: string,
    patch: Partial<{
      status: string;
      assigneeId: string | null;
      notes: string;
      issueDescription: string | null;
      title: string;
      priority: string;
      propertyId: string;
      type: string;
      dueDate: string;
      dueTime: string | null;
    }>,
    forceComplete?: boolean,
    /** Только из `staffMiniappVoiceSubmit` — не передаётся с HTTP PATCH. */
    options?: { bypassChecklistForStaffVoiceClose?: boolean },
  ): Promise<TaskDto> {
    const task = await this.ensureTaskAccess(taskId, userId, role);
    const prevStatus = task.status;
    const prevAssignee = task.assigneeId;
    const prevDue = task.dueDate;
    const prevTime = task.dueTime;

    if (role !== 'STAFF') {
      if (patch.title !== undefined) {
        task.title = patch.title.trim().slice(0, 255);
      }
      if (patch.priority !== undefined) {
        if (!TasksService.PATCHABLE_PRIORITIES.has(patch.priority)) {
          throw new BadRequestException('Invalid priority');
        }
        task.priority = patch.priority;
      }
      if (patch.propertyId !== undefined) {
        const p = await this.propertyService.findOneForUser(patch.propertyId, userId, role);
        task.propertyId = p.id;
        task.companyId = p.companyId;
        task.isGeneralTask = false;
      }
      if (patch.dueDate !== undefined) {
        const d = patch.dueDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          throw new BadRequestException('Invalid dueDate');
        }
        task.dueDate = d;
      }
      if (patch.dueTime !== undefined) {
        task.dueTime = patch.dueTime?.trim() ? patch.dueTime.trim().slice(0, 8) : null;
      }
      if (patch.type !== undefined) {
        if (!TasksService.PATCHABLE_TASK_TYPES.has(patch.type)) {
          throw new BadRequestException('Invalid type');
        }
        task.type = patch.type;
      }
    }

    if (patch.status === 'done') {
      const result = await this.checklistService.assertCanCompleteTask(taskId);
      if (!result.ok) {
        if (forceComplete && (role === 'OWNER' || role === 'MANAGER')) {
          /* allow */
        } else if (options?.bypassChecklistForStaffVoiceClose && role === 'STAFF') {
          /* Голосовой отчёт в miniapp подтверждён с экрана ревью — закрываем задачу, инцидент/нехватка отдельно. */
        } else if (forceComplete) {
          throw new ForbiddenException('forceComplete is only for owner/manager');
        } else {
          throw new UnprocessableEntityException({
            message: 'Не все обязательные пункты выполнены',
            uncheckedRequired: result.unchecked,
          });
        }
      }
    }

    if (patch.status !== undefined) task.status = patch.status;
    if (patch.assigneeId !== undefined && role === 'STAFF') {
      const want = patch.assigneeId?.trim() ? patch.assigneeId.trim() : null;
      const have = task.assigneeId?.trim() ? task.assigneeId.trim() : null;
      if (want !== have) {
        throw new ForbiddenException('Staff cannot change task assignee');
      }
    }
    if (patch.assigneeId !== undefined && role !== 'STAFF') {
      const raw = patch.assigneeId;
      if (raw === null || (typeof raw === 'string' && !raw.trim())) {
        task.assigneeId = null;
      } else if (typeof raw === 'string') {
        task.assigneeId = raw.trim();
      } else {
        task.assigneeId = null;
      }
    }
    if (patch.notes !== undefined) task.notes = patch.notes;
    if (patch.issueDescription !== undefined) task.issueDescription = patch.issueDescription;

    if (patch.status === 'in_progress') {
      task.inProgressStartedAt = new Date();
    } else if (patch.status !== undefined) {
      task.inProgressStartedAt = null;
    }

    if (patch.status === 'done') {
      task.completedAt = new Date();
    } else if (patch.status && patch.status !== 'done') {
      task.completedAt = null;
    }

    await this.taskRepo.save(task);

    const reloaded = await this.reloadTask(task.id);
    this.tasksGateway.emitTaskUpdated({ uuid: reloaded.id, status: reloaded.status });

    if (
      reloaded.incidentId &&
      patch.status !== undefined &&
      prevStatus !== patch.status &&
      (patch.status === 'done' ||
        patch.status === 'issue' ||
        patch.status === 'in_progress' ||
        patch.status === 'pending')
    ) {
      await this.syncLinkedIncidentAfterTaskStatus(reloaded, patch.status);
    }

    if (
      (role === 'OWNER' || role === 'MANAGER') &&
      reloaded.assigneeId &&
      TasksService.isStaffNotifiableTaskStatus(reloaded.status)
    ) {
      const assigneeChanged =
        patch.assigneeId !== undefined && patch.assigneeId !== prevAssignee;
      const deadlineChanged =
        (patch.dueDate !== undefined && patch.dueDate !== prevDue) ||
        (patch.dueTime !== undefined && patch.dueTime !== prevTime);
      if (assigneeChanged) {
        void this.staffNotification.notifyTaskAssignOrDeadline(reloaded, 'assign', reloaded.assigneeId);
      } else if (deadlineChanged) {
        void this.staffNotification.notifyTaskAssignOrDeadline(reloaded, 'deadline', reloaded.assigneeId);
      }
    }

    return this.toDtoForRole(reloaded, role);
  }

  /**
   * When a dispatched task completes or is flagged as issue, bump parent incident so the manager dashboard stays in sync.
   */
  private async syncLinkedIncidentAfterTaskStatus(
    task: TaskEntity,
    newStatus: string,
  ): Promise<void> {
    if (!task.incidentId) return;
    const inc = await this.incidentRepo.findOne({
      where: { id: task.incidentId },
      relations: ['property'],
    });
    if (!inc || inc.dispatchedTaskId !== task.id) return;

    if (newStatus === 'done') {
      inc.status = 'in_review';
    } else if (newStatus === 'issue') {
      inc.status = 'open';
    } else if (newStatus === 'in_progress') {
      inc.status = 'open';
    } else if (newStatus === 'pending') {
      inc.status = 'assigned';
    }

    await this.incidentRepo.save(inc);
    const ownerId = inc.property?.ownerId;
    if (ownerId) {
      this.tasksGateway.emitIncidentUpdated({
        incidentId: inc.id,
        propertyOwnerId: ownerId,
      });
    }
  }

  private async reloadTask(id: string): Promise<TaskEntity> {
    const t = await this.taskRepo.findOne({
      where: { id },
      relations: ['property', 'assignee', 'createdBy'],
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  private async toDtoForRole(t: TaskEntity, role: string): Promise<TaskDto> {
    const unseen =
      role === 'STAFF' ? 0 : (await this.unseenNoteCounts([t.id])).get(t.id) ?? 0;
    const summaries = await this.checklistService.summariesForTasks([t.id]);
    const linkExtras =
      role === 'MANAGER' || role === 'OWNER' ? await this.loadManagerTaskLinkExtras([t.id]) : null;
    return this.toDto(t, {
      unseenNotesCount: unseen,
      checklistSummary: summaries.get(t.id) ?? null,
      linkedIncidentIdsFromTask: linkExtras?.incidentsByTask.get(t.id),
      pendingSupplyInterpretationIds: linkExtras?.supplyByTask.get(t.id),
    });
  }

  async appendPhotoUrls(taskId: string, userId: string, role: string, urls: string[]): Promise<TaskDto> {
    const task = await this.ensureTaskAccess(taskId, userId, role);
    task.photoUrls = [...(task.photoUrls ?? []), ...urls];
    if (task.status === 'done') {
      task.hasVerificationPhoto = true;
    }
    await this.taskRepo.save(task);

    const reloaded = await this.reloadTask(task.id);
    this.tasksGateway.emitTaskUpdated({ uuid: reloaded.id, status: reloaded.status });
    return this.toDtoForRole(reloaded, role);
  }

  async listNotes(taskId: string, userId: string, role: string): Promise<TaskNoteDto[]> {
    await this.ensureTaskAccess(taskId, userId, role);
    const notes = await this.taskNoteRepo.find({
      where: { taskId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
    return notes.map((n) => ({
      uuid: n.id,
      taskId: n.taskId,
      authorId: n.authorId,
      authorName: `${n.author.firstName} ${n.author.lastName}`.trim(),
      text: n.text,
      photoUrl: n.photoUrl,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async addNote(
    taskId: string,
    userId: string,
    role: string,
    text: string,
    photoUrl: string | null,
  ): Promise<TaskNoteDto> {
    if (role !== 'STAFF') {
      throw new ForbiddenException('Only staff can add task notes');
    }
    const task = await this.ensureTaskAccess(taskId, userId, role);
    const row = this.taskNoteRepo.create({
      taskId: task.id,
      authorId: userId,
      text: text.trim(),
      photoUrl: photoUrl ?? null,
    });
    const saved = await this.taskNoteRepo.save(row);
    const withAuthor = await this.taskNoteRepo.findOne({
      where: { id: saved.id },
      relations: ['author'],
    });
    if (!withAuthor) throw new NotFoundException();

    this.tasksGateway.emitTaskNoteAdded({
      taskId: task.id,
      propertyOwnerId: task.property.ownerId,
    });

    return {
      uuid: withAuthor.id,
      taskId: withAuthor.taskId,
      authorId: withAuthor.authorId,
      authorName: `${withAuthor.author.firstName} ${withAuthor.author.lastName}`.trim(),
      text: withAuthor.text,
      photoUrl: withAuthor.photoUrl,
      createdAt: withAuthor.createdAt.toISOString(),
    };
  }

  async markManagerSeenRole(taskId: string, userId: string, role: string): Promise<TaskDto> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const task = await this.ensureTaskAccess(taskId, userId, role);
    task.lastManagerSeenAt = new Date();
    await this.taskRepo.save(task);
    const reloaded = await this.reloadTask(task.id);
    return this.toDtoForRole(reloaded, role);
  }

  async seedDemoIfEmpty(userId: string, role: string): Promise<void> {
    const count = await this.taskRepo.count();
    if (count > 0) return;

    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    const props = await this.taskRepo.manager.query(
      `SELECT id, "companyId" FROM properties WHERE "ownerId" = $1 LIMIT 2`,
      [ownerId],
    );
    if (!props?.length) return;

    const today = format(new Date(), 'yyyy-MM-dd');
    const rows: Partial<TaskEntity>[] = [
      {
        title: 'Уборка после выезда',
        type: 'checkout_cleaning',
        status: 'pending',
        priority: 'urgent',
        companyId: props[0].companyId,
        propertyId: props[0].id,
        reservationId: null,
        contextLabel: 'Выезд 12:00 → Заезд 15:00. Окно: 3ч',
        assigneeId: null,
        dueDate: today,
        dueTime: '14:00',
        notes: '',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: null,
      },
      {
        title: 'Подготовка к заезду',
        type: 'checkin_prep',
        status: 'pending',
        priority: 'normal',
        companyId: props[0].companyId,
        propertyId: props[0].id,
        reservationId: null,
        contextLabel: 'Заезд гостя 16:00',
        assigneeId: null,
        dueDate: today,
        dueTime: '15:00',
        notes: '',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: null,
      },
    ];

    if (props[1]) {
      rows.push({
        title: 'Ручная задача',
        type: 'other',
        status: 'in_progress',
        priority: 'normal',
        companyId: props[1].companyId,
        propertyId: props[1].id,
        reservationId: null,
        contextLabel: null,
        assigneeId: null,
        dueDate: today,
        dueTime: null,
        notes: '',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: new Date(),
      });
    }

    for (const r of rows) {
      const saved = await this.taskRepo.save(this.taskRepo.create(r));
      await this.checklistService.applyAutoTemplateIfAny(saved.id);
    }
  }

  /**
   * Creates one or more identical tasks in a single DB transaction (one request from the client).
   * `propertyIds: []` (explicit) resolves to one task on the owner’s first property (general-task fallback).
   */
  async createTasksBulkForManager(
    userId: string,
    role: string,
    body: {
      propertyIds: string[];
      title: string;
      type: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      dueTime?: string | null;
      reservationId?: string | null;
      notes?: string;
      /** When set, links the new task to this incident and updates incident dispatch fields. */
      incidentId?: string | null;
    },
  ): Promise<TaskDto[]> {
    let ids = [...new Set(body.propertyIds.filter(Boolean))];
    const isGeneralTask = ids.length === 0;
    if (ids.length === 0) {
      const fb = await this.resolveFallbackPropertyId(userId, role);
      if (!fb) {
        throw new BadRequestException('No property available to attach the task');
      }
      ids = [fb];
    }

    const companyByPropertyId = new Map<string, string>();
    for (const pid of ids) {
      const p = await this.propertyService.findOneForUser(pid, userId, role);
      companyByPropertyId.set(pid, p.companyId);
    }

    let resolvedDueDate = body.dueDate?.trim() || format(new Date(), 'yyyy-MM-dd');
    let reservationId: string | null = null;
    let contextLabel: string | null = null;

    const rid = body.reservationId?.trim();
    if (rid) {
      if (ids.length > 1) {
        throw new BadRequestException('reservationId applies only when creating a task for a single property');
      }
      const booking = await this.bookingRepo.findOne({ where: { id: rid } });
      if (!booking || booking.propertyId !== ids[0]) {
        throw new BadRequestException('Invalid reservation for this property');
      }
      reservationId = booking.id;
      contextLabel = `${booking.guestName}`;
      if (!body.dueDate) {
        resolvedDueDate = format(booking.checkOut, 'yyyy-MM-dd');
      }
    }

    const incId = body.incidentId?.trim();
    let linkIncident: IncidentEntity | null = null;
    /** First task linked to an incident updates dispatch fields; further tasks only set `task.incidentId`. */
    let linkIncidentIsFirstDispatch = false;
    if (incId) {
      if (rid) {
        throw new BadRequestException('incidentId cannot be combined with reservationId');
      }
      if (ids.length !== 1 || isGeneralTask) {
        throw new BadRequestException('incidentId applies only when creating a task for a single property');
      }
      const incident = await this.incidentRepo.findOne({
        where: { id: incId },
        relations: ['property'],
      });
      if (!incident) {
        throw new BadRequestException('Invalid incidentId');
      }
      await this.propertyService.findOneForUser(incident.propertyId, userId, role);
      if (incident.propertyId !== ids[0]) {
        throw new BadRequestException('incident does not match property');
      }
      linkIncident = incident;
      linkIncidentIsFirstDispatch = !incident.dispatchedTaskId;
    }

    const notes = body.notes?.trim() ?? '';
    const createdIds: string[] = [];
    const assigneeId = TasksService.normalizeAssigneeIdInput(body.assigneeId);

    await this.taskRepo.manager.transaction(async (manager) => {
      for (const propertyId of ids) {
        const companyId = companyByPropertyId.get(propertyId);
        if (!companyId) {
          throw new BadRequestException('Property company scope missing');
        }
        const row = manager.create(TaskEntity, {
          title: body.title.trim(),
          type: body.type || 'other',
          status: 'pending',
          priority: body.priority || 'normal',
          isGeneralTask,
          propertyId,
          companyId,
          reservationId,
          contextLabel,
          assigneeId,
          createdById: userId,
          dueDate: resolvedDueDate,
          dueTime: body.dueTime?.trim() || null,
          notes,
          issueDescription: null,
          photoUrls: [],
          hasVerificationPhoto: false,
          completedAt: null,
          lastManagerSeenAt: null,
          inProgressStartedAt: null,
          incidentId: linkIncident?.id ?? null,
        });
        const saved = await manager.save(TaskEntity, row);
        createdIds.push(saved.id);
        if (linkIncident && linkIncidentIsFirstDispatch) {
          linkIncident.dispatchedTaskId = saved.id;
          linkIncident.taskId = saved.id;
          /** Исполнитель назначен, но задача ещё в pending — «В работе» только после in_progress на задаче. */
          linkIncident.status = 'assigned';
          linkIncident.suggestedTaskDraft = null;
          await manager.save(IncidentEntity, linkIncident);
        }
      }
    });

    if (notes.length >= 3 && createdIds.length > 0) {
      void this.staffInterpretation
        .queueFromTaskCreate(userId, role, createdIds[0]!, notes)
        .catch((err: unknown) =>
          this.logger.warn(`interpret task_create queue: ${(err as Error).message}`),
        );
    }

    if (linkIncident) {
      this.tasksGateway.emitIncidentUpdated({
        incidentId: linkIncident.id,
        propertyOwnerId: linkIncident.property.ownerId,
      });
    }

    const out: TaskDto[] = [];
    let lastCreatedForSocket: { uuid: string; status: string } | null = null;
    for (const id of createdIds) {
      await this.checklistService.applyAutoTemplateIfAny(id);
      const row = await this.reloadTask(id);
      lastCreatedForSocket = { uuid: row.id, status: row.status };
      if (row.assigneeId && TasksService.isStaffNotifiableTaskStatus(row.status)) {
        void this.staffNotification.notifyTaskAssignOrDeadline(row, 'assign', row.assigneeId);
      }
      out.push(await this.toDtoForRole(row, 'MANAGER'));
    }
    /** Staff / TMA listen for `task_updated` to refetch lists — without this, new assignments never appear live. */
    if (lastCreatedForSocket) {
      this.tasksGateway.emitTaskUpdated(lastCreatedForSocket);
    }
    return out;
  }

  private async resolveFallbackPropertyId(userId: string, role: string): Promise<string | null> {
    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    const props = await this.propertyService.findAllByOwner(ownerId);
    return props[0]?.id ?? null;
  }

  /** @deprecated Prefer createTasksBulkForManager; kept for internal single-id call sites. */
  async createForManager(
    userId: string,
    role: string,
    body: {
      propertyId: string;
      title: string;
      type: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      dueTime?: string | null;
      reservationId?: string | null;
      notes?: string;
    },
  ): Promise<TaskDto> {
    const tasks = await this.createTasksBulkForManager(userId, role, {
      propertyIds: [body.propertyId],
      title: body.title,
      type: body.type,
      priority: body.priority,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      reservationId: body.reservationId,
      notes: body.notes,
    });
    return tasks[0]!;
  }

  /**
   * Voice task pipeline (2026): **Groq** `whisper-large-v3` STT → **DeepSeek** `deepseek-chat` JSON extraction.
   * Sequential: await Groq transcription → await DeepSeek semantic parse.
   * Without `GROQ_API_KEY`, falls back to `voiceParseHeuristicMock`. Without `DEEPSEEK_API_KEY` or on LLM failure,
   * returns transcript with empty `propertyIds` so the UI can still fill Notes.
   */
  async voiceParse(
    userId: string,
    role: string,
    file: Express.Multer.File,
    contextPropertyId?: string,
    languageHint?: string,
  ): Promise<VoiceParseResultDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }

    const ownerId = await this.userService.resolveTenantOwnerId(userId, role);
    const props = await this.propertyService.findAllByOwner(ownerId);
    const staff = await this.userService.findStaffByOwner(ownerId);
    const now = new Date();
    const propertyLocalTimeContext = props
      .map(
        (p) =>
          `${p.id} (${p.name}): ${formatInTimeZone(now, p.timezone, 'yyyy-MM-dd HH:mm')} [${p.timezone}]`,
      )
      .join('\n');

    const groqKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    if (!groqKey) {
      this.logger.warn('GROQ_API_KEY unset; voice-parse using heuristic mock (no Groq STT).');
      return this.voiceParseHeuristicMock(file, contextPropertyId, props);
    }

    let transcript = '';
    try {
      transcript = await this.transcribeWithGroqWhisper(file, groqKey, languageHint);
    } catch (e) {
      this.logger.warn(`Groq Whisper transcription failed: ${(e as Error).message}`);
      return this.voiceParseHeuristicMock(file, contextPropertyId, props);
    }

    const trimmed = this.stripVoiceSilenceHallucinations(transcript);
    if (!trimmed) {
      return this.voiceParseTranscriptOnlyFallback('');
    }

    const llm = this.getVoiceParseDeepseekClient();
    if (!llm) {
      this.logger.warn('DEEPSEEK_API_KEY unset; returning transcript without semantic JSON extraction.');
      return this.voiceParseTranscriptOnlyFallback(trimmed);
    }

    try {
      const raw = await this.llmParseVoiceTranscript(
        llm,
        trimmed,
        props,
        staff,
        propertyLocalTimeContext,
      );
      return this.normalizeLlmVoiceResult(raw, trimmed, props, staff, contextPropertyId);
    } catch (e) {
      this.logger.warn(`DeepSeek voice semantic parse failed: ${(e as Error).message}`);
      return this.voiceParseTranscriptOnlyFallback(trimmed);
    }
  }

  /**
   * Staff Telegram bot: STT + LLM to complete a task or report an incident (narrow context).
   */
  /** Active tasks for staff Telegram photo/voice routing. */
  async findActiveTasksForStaff(staffUserId: string): Promise<TaskEntity[]> {
    return this.taskRepo.find({
      where: {
        assigneeId: staffUserId,
        status: In(['pending', 'in_progress']),
      },
      relations: ['property'],
      order: { dueDate: 'ASC', dueTime: 'ASC' },
      take: 20,
    });
  }

  async voiceParseForStaff(
    telegramChatId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<StaffVoiceParseResultDto> {
    if (!buffer?.length) {
      throw new BadRequestException('audio is required');
    }
    const staffUser = await this.userService.findByTelegramChatId(telegramChatId.trim());
    if (!staffUser || staffUser.role !== 'STAFF' || !staffUser.employerOwnerId) {
      return { action: 'fallback', transcript: '' };
    }
    const ownerId = staffUser.employerOwnerId;
    const props = await this.propertyService.findAllByOwner(ownerId);
    const activeTasks = await this.taskRepo.find({
      where: {
        assigneeId: staffUser.id,
        status: In(['pending', 'in_progress']),
      },
      relations: ['property'],
      order: { dueDate: 'ASC', dueTime: 'ASC' },
      take: 40,
    });

    const file = {
      buffer,
      mimetype: mimeType || 'audio/ogg',
      originalname: 'voice.ogg',
    } as Express.Multer.File;

    const groqKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    let transcript = '';
    if (!groqKey) {
      return {
        action: 'fallback',
        transcript: '',
      };
    }
    try {
      transcript = await this.transcribeWithGroqWhisper(
        file,
        groqKey,
        staffUser.language?.slice(0, 2),
      );
    } catch (e) {
      this.logger.warn(`Staff voice STT failed: ${(e as Error).message}`);
      return { action: 'fallback', transcript: '' };
    }
    const trimmed = transcript.trim();
    if (!trimmed) {
      return { action: 'fallback', transcript: '' };
    }

    if (activeTasks.length === 0) {
      return { action: 'unmapped_voice', transcript: trimmed };
    }

    const llm = this.getVoiceParseDeepseekClient();
    if (!llm) {
      return { action: 'fallback', transcript: trimmed };
    }

    try {
      const staff = await this.userService.findStaffByOwner(ownerId);
      const staffIds = new Set(staff.map((s) => s.id));
      const raw = await this.llmParseStaffVoiceTranscript(llm, trimmed, activeTasks, props, staff);
      const validTaskIds = new Set(activeTasks.map((t) => t.id));
      const validPropIds = new Set(props.map((p) => p.id));
      const activePropertyIds = [...new Set(activeTasks.map((t) => t.propertyId))];
      const suggestedTaskDraft = this.normalizeStaffVoiceSuggestedTask(raw.suggestedTask, staffIds);

      if (raw.action === 'complete' && raw.taskId && validTaskIds.has(raw.taskId)) {
        return { action: 'complete', taskId: raw.taskId, transcript: trimmed };
      }

      if (raw.action === 'ambiguous_incident' && raw.title?.trim()) {
        const cand = (raw.candidatePropertyIds ?? [])
          .filter((id) => validPropIds.has(id))
          .filter((id) => activePropertyIds.includes(id));
        const uniq = [...new Set(cand)];
        if (uniq.length >= 2) {
          return {
            action: 'ambiguous_incident',
            title: raw.title.trim(),
            candidatePropertyIds: uniq,
            transcript: trimmed,
            ...(suggestedTaskDraft ? { suggestedTaskDraft } : {}),
          };
        }
      }

      if (
        raw.action === 'incident' &&
        raw.title?.trim() &&
        raw.propertyId &&
        validPropIds.has(raw.propertyId)
      ) {
        return {
          action: 'incident',
          title: raw.title.trim(),
          propertyId: raw.propertyId,
          transcript: trimmed,
          ...(suggestedTaskDraft ? { suggestedTaskDraft } : {}),
        };
      }
      return { action: 'fallback', transcript: trimmed };
    } catch (e) {
      this.logger.warn(`Staff voice LLM failed: ${(e as Error).message}`);
      return { action: 'fallback', transcript: trimmed };
    }
  }

  /**
   * Groq Whisper STT only — used when persisting unmapped voice notes outside `voiceParseForStaff`.
   */
  async transcribeStaffVoiceBuffer(
    buffer: Buffer,
    mimeType: string,
    languageHint?: string,
  ): Promise<string> {
    const groqKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    if (!groqKey) return '';
    const file = {
      buffer,
      mimetype: mimeType || 'audio/ogg',
      originalname: 'voice.ogg',
    } as Express.Multer.File;
    try {
      return (
        await this.transcribeWithGroqWhisper(file, groqKey, languageHint?.slice(0, 2))
      ).trim();
    } catch (e) {
      this.logger.warn(`transcribeStaffVoiceBuffer: ${(e as Error).message}`);
      return '';
    }
  }

  private normalizeStaffVoiceSuggestedTask(
    raw: LlmStaffVoiceJson['suggestedTask'],
    staffIds: Set<string>,
  ): IncidentSuggestedTaskDraftDto | undefined {
    const TASK_TYPES = new Set([
      'checkout_cleaning',
      'mid_stay_cleaning',
      'checkin_prep',
      'maintenance',
      'other',
    ]);
    const PRIOS = new Set(['normal', 'urgent', 'critical']);
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!raw || typeof raw !== 'object') return undefined;
    const out: IncidentSuggestedTaskDraftDto = {};
    if (typeof raw.title === 'string' && raw.title.trim()) {
      out.title = raw.title.trim().slice(0, 500);
    }
    if (typeof raw.type === 'string' && TASK_TYPES.has(raw.type)) {
      out.type = raw.type as IncidentSuggestedTaskDraftDto['type'];
    }
    if (typeof raw.priority === 'string' && PRIOS.has(raw.priority)) {
      out.priority = raw.priority as IncidentSuggestedTaskDraftDto['priority'];
    }
    if (typeof raw.assigneeId === 'string' && uuidRe.test(raw.assigneeId) && staffIds.has(raw.assigneeId)) {
      out.assigneeId = raw.assigneeId;
    } else if (raw.assigneeId === null) {
      out.assigneeId = null;
    }
    if (typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate)) {
      out.dueDate = raw.dueDate;
    }
    if (typeof raw.notes === 'string' && raw.notes.trim()) {
      out.notes = raw.notes.trim().slice(0, 8000);
    }
    if (
      out.title === undefined &&
      out.type === undefined &&
      out.priority === undefined &&
      out.assigneeId === undefined &&
      out.dueDate === undefined &&
      out.notes === undefined
    ) {
      return undefined;
    }
    return out;
  }

  private async llmParseStaffVoiceTranscript(
    llm: { client: OpenAI; model: string },
    transcript: string,
    activeTasks: TaskEntity[],
    props: PropertyEntity[],
    staff: StaffMemberDto[],
  ): Promise<LlmStaffVoiceJson> {
    const now = new Date();
    const tasksJson = JSON.stringify(
      activeTasks.map((t) => ({
        id: t.id,
        title: t.title,
        propertyId: t.propertyId,
        propertyName: t.property?.name ?? '',
        status: t.status,
        dueDate: t.dueDate,
        propertyLocalNow: t.property
          ? `${formatInTimeZone(now, t.property.timezone, 'yyyy-MM-dd HH:mm')} (${t.property.timezone})`
          : null,
      })),
    );
    const propsJson = JSON.stringify(
      props.map((p) => ({
        id: p.id,
        name: p.name,
        localDateTime: `${formatInTimeZone(now, p.timezone, 'yyyy-MM-dd HH:mm')} (${p.timezone})`,
      })),
    );
    const staffJson = JSON.stringify(
      staff.map((s) => ({
        id: s.id,
        name: s.displayName,
      })),
    );

    const distinctActivePropertyCount = new Set(activeTasks.map((t) => t.propertyId)).size;

    const systemPrompt = `You help frontline staff (cleaners, maintenance) via voice.
Use each property's localDateTime for interpreting "today", "tomorrow", and deadlines — never assume UTC.

Their ACTIVE tasks (only these task ids are valid for "complete"):
${tasksJson}

Properties catalog (valid property UUIDs for incidents):
${propsJson}

Staff directory (use only these ids for suggestedTask.assigneeId):
${staffJson}

Return a single JSON object:
- If they clearly finished a specific active task: { "action": "complete", "taskId": "<uuid>" }
- If they report damage, breakage, lost item, emergency AND you can pick exactly one property: { "action": "incident", "title": "short title", "propertyId": "<uuid>" }
- If they report an incident but the staff member has active work in ${distinctActivePropertyCount} different properties and you CANNOT confidently choose one property: { "action": "ambiguous_incident", "title": "short title", "candidatePropertyIds": ["<uuid>", "<uuid>"] } with 2–4 ids from active tasks' propertyIds only.
- If unclear or small talk: { "action": "fallback", "taskId": null }

For "incident" and "ambiguous_incident" only: if the same message also assigns follow-up work (what to do, who, when), add optional "suggestedTask": {
  "title": string or null (task title, can differ from incident title),
  "type": "checkout_cleaning"|"mid_stay_cleaning"|"checkin_prep"|"maintenance"|"other" or null,
  "priority": "normal"|"urgent"|"critical" or null,
  "assigneeId": "<uuid from staff list>" or null,
  "dueDate": "YYYY-MM-DD" or null (use property local dates),
  "notes": string or null
}. If they did not mention follow-up work, omit "suggestedTask" or set it null.

Reply with JSON only, no markdown.`;

    const createParams = {
      model: llm.model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: `Voice transcript:\n"""${transcript.replace(/"""/g, '"')}\n"""`,
        },
      ],
      temperature: 0.2,
      max_tokens: 512,
      response_format: { type: 'json_object' as const },
    };

    let completion;
    try {
      completion = await llm.client.chat.completions.create(createParams);
    } catch {
      completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: createParams.messages,
        temperature: 0.2,
        max_tokens: 512,
      });
    }

    const rawText = completion.choices[0]?.message?.content?.trim();
    if (!rawText) {
      throw new Error('empty LLM response');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('invalid JSON from LLM');
      parsed = JSON.parse(m[0]);
    }
    return parsed as LlmStaffVoiceJson;
  }

  /**
   * Safe fallback when DeepSeek is unavailable or JSON extraction fails: user still gets dictated text in Notes.
   */
  private voiceParseTranscriptOnlyFallback(transcript: string): VoiceParseResultDto {
    const trimmed = transcript.trim();
    if (!trimmed) {
      return {
        entityType: 'task',
        transcript: '',
        isGeneralTask: true,
        propertyIds: [],
        title: '',
        type: 'other',
        assigneeId: null,
        dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        priority: 'normal',
      };
    }
    return {
      entityType: 'task',
      transcript: trimmed,
      isGeneralTask: true,
      propertyIds: [],
      title: this.deriveVoiceTaskTitle(trimmed) || '',
      type: 'other',
      assigneeId: null,
      dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      priority: 'normal',
    };
  }

  /** Dev/offline: optional `VOICE_PARSE_STT_TRANSCRIPT` + token matching (no API keys). Empty transcript → empty form fields. */
  private voiceParseHeuristicMock(
    file: Express.Multer.File,
    contextPropertyId: string | undefined,
    props: PropertyEntity[],
  ): Promise<VoiceParseResultDto> {
    const allIds = new Set(props.map((p) => p.id));
    const ctxOk = contextPropertyId && allIds.has(contextPropertyId) ? contextPropertyId : undefined;

    const transcriptText = this.resolveVoiceTranscriptPlaceholder(file);
    if (!transcriptText.trim()) {
      return Promise.resolve(this.voiceParseTranscriptOnlyFallback(''));
    }
    const tNorm = this.normVoiceText(transcriptText);

    if (this.detectIncidentFromTranscript(tNorm)) {
      let propertyIds = this.matchPropertyIdsFromTranscript(tNorm, props);
      if (propertyIds.length === 0 && ctxOk) {
        propertyIds = [ctxOk];
      } else if (propertyIds.length === 0 && props.length === 1) {
        propertyIds = [props[0]!.id];
      }
      const lost = this.detectLostItemFromTranscript(tNorm);
      const emergency = this.detectEmergencyFromTranscript(tNorm);
      const ruleViolation = this.detectRuleViolationFromTranscript(tNorm);
      const incidentType: IncidentType = emergency
        ? 'emergency'
        : lost
          ? 'lost_item'
          : ruleViolation
            ? 'rule_violation'
            : 'damage';
      return Promise.resolve({
        entityType: 'incident',
        transcript: transcriptText.trim(),
        title: this.deriveVoiceTaskTitle(transcriptText),
        incidentType,
        propertyId: propertyIds[0] ?? null,
        estimatedCost: this.extractCostHintFromTranscript(tNorm),
      });
    }

    if (this.detectGeneralTaskFromTranscript(tNorm)) {
      return Promise.resolve({
        entityType: 'task',
        transcript: transcriptText.trim(),
        isGeneralTask: true,
        propertyIds: [],
        title: this.deriveVoiceTaskTitle(transcriptText),
        type: 'other',
        assigneeId: null,
        dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        priority: 'normal',
      });
    }

    let propertyIds = this.matchPropertyIdsFromTranscript(tNorm, props);
    if (propertyIds.length === 0 && ctxOk) {
      propertyIds = [ctxOk];
    } else if (propertyIds.length === 0 && props.length === 1) {
      propertyIds = [props[0]!.id];
    }

    return Promise.resolve({
      entityType: 'task',
      transcript: transcriptText.trim(),
      isGeneralTask: false,
      propertyIds,
      title: this.deriveVoiceTaskTitle(transcriptText),
      type: 'checkout_cleaning',
      assigneeId: null,
      dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      priority: 'urgent',
    });
  }

  private static readonly GROQ_OPENAI_BASE = 'https://api.groq.com/openai/v1';

  /** Groq Cloud — OpenAI-compatible Whisper (`whisper-large-v3`), minimal latency. */
  private async transcribeWithGroqWhisper(
    file: Express.Multer.File,
    groqApiKey: string,
    languageHint?: string,
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: groqApiKey, baseURL: TasksService.GROQ_OPENAI_BASE });
    const ext = this.extensionForMime(file.mimetype);
    const upload = await toFile(file.buffer, `voice.${ext}`, {
      type: file.mimetype || 'audio/webm',
    });
    const lang =
      (languageHint || this.configService.get<string>('VOICE_PARSE_LANGUAGE') || 'ru').trim().slice(0, 2) || 'ru';
    const model = this.configService.get<string>('VOICE_PARSE_GROQ_WHISPER_MODEL') || 'whisper-large-v3';

    const res = await openai.audio.transcriptions.create({
      file: upload,
      model,
      language: lang,
    });
    return res.text ?? '';
  }

  /** DeepSeek-only client for voice semantic extraction (decoupled from `AI_PROVIDER`). */
  private getVoiceParseDeepseekClient(): { client: OpenAI; model: string } | null {
    const key = this.configService.get<string>('DEEPSEEK_API_KEY')?.trim();
    if (!key) return null;
    const base = this.configService.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
    const model = this.configService.get<string>('VOICE_PARSE_LLM_MODEL') || 'deepseek-chat';
    return { client: new OpenAI({ apiKey: key, baseURL: base }), model };
  }

  private extensionForMime(mime: string | undefined): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('wav')) return 'wav';
    if (m.includes('webm')) return 'webm';
    return 'webm';
  }

  /** DeepSeek chat.completions with JSON mode; falls back without `response_format` if the API rejects it. */
  private async llmParseVoiceTranscript(
    llm: { client: OpenAI; model: string },
    transcript: string,
    props: PropertyEntity[],
    staff: StaffMemberDto[],
    propertyLocalTimeContext: string,
  ): Promise<LlmVoiceParseJson> {
    const propertiesJson = JSON.stringify(
      props.map((p) => ({
        id: p.id,
        name: p.name,
        address: [p.city, p.address].filter((x) => x && x !== '-').join(', '),
      })),
    );
    const staffJson = JSON.stringify(
      staff.map((s) => ({
        id: s.id,
        name: s.displayName,
        role: s.role,
      })),
    );

    const systemPrompt = `You are a PMS assistant. Analyze the manager's voice transcript.

Do NOT use server UTC for "today" / "tomorrow". For each property, use its local date/time from the block below.
Per-property local date/time (IANA timezone in brackets):
${propertyLocalTimeContext || '(no properties)'}

Available properties (JSON array — use only these ids):
${propertiesJson}

Available staff (JSON array — assigneeId must be one of these ids or null):
${staffJson}

ENTITY ROUTING RULES:
First set "entityType": "task" OR "incident".

Choose "task" ONLY for routine operations:
- Normal cleaning (e.g. clean the room, checkout clean).
- Routine maintenance / wear-and-tear (e.g. fix a leaking pipe, replace a bulb).

Choose "incident" FOR escalations, guest issues, theft, or unexpected problems requiring manager review.
Semantic triggers (any language — RU, EN, PL, ES, DE and mixed speech):
- Damage / vandalism / theft: e.g. проблема, сломали, разбили, ущерб, украли, испортили, broken, damaged, ruined, zepsute, uszkodzone, rotura, daño, vandalismo, Beschädigung, beschädigt, Diebstahl.
- Lost & found: забыли, оставили, нашли вещь, left behind, found item, zostawili, zgubiono, olvidado, olvidaron, Fund, vergessen, vergessen haben.
- Severe complaints: жалоба, скандал, complaint, skarga, reclamación, Beschwerde.

If the user explicitly starts with the word "incident" / "инцидент" / "incydent" / "incidente" / "Vorfall" in any supported language, prefer "incident" when it matches the situation.

If "entityType" is "task", return:
- "title", "type" (checkout_cleaning | mid_stay_cleaning | checkin_prep | maintenance | other), "priority" (normal | urgent | critical),
- "propertyIds" (array of UUIDs; empty if general / unknown listing), "isGeneralTask" (boolean),
- "assigneeId" (uuid or null), "dueDate" ("YYYY-MM-DD" or null).

If "entityType" is "incident", return:
- "title": short description in the transcript language,
- "incidentType": "damage" | "lost_item" | "rule_violation" | "emergency"
  - "rule_violation": smoking in room, party, neighbor noise complaints, pets without permission — policy / fine context.
  - "emergency": burst pipe, building-wide power outage, police/fire — highest severity.
- "propertyId": one UUID from the properties list, or null if truly unknown,
- "estimatedCost": a number (e.g. 5000) or null if not stated.

Reply with JSON only, no markdown.`;

    const userContent = `Voice transcript:\n"""${transcript.replace(/"""/g, '"')}\n"""`;

    const createParams = {
      model: llm.model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' as const },
    };

    let completion;
    try {
      completion = await llm.client.chat.completions.create(createParams);
    } catch {
      completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: createParams.messages,
        temperature: 0.2,
        max_tokens: 1024,
      });
    }

    const rawText = completion.choices[0]?.message?.content?.trim();
    if (!rawText) {
      throw new Error('empty LLM response');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('invalid JSON from LLM');
      parsed = JSON.parse(m[0]);
    }
    return parsed as LlmVoiceParseJson;
  }

  /** Map LLM / STT output to stored incident type. */
  private normalizeIncidentVoiceType(raw: string | undefined): IncidentType {
    const it = (raw || '').toLowerCase().trim();
    if (it === 'lost_item' || it === 'lost item' || it === 'lostitem') return 'lost_item';
    if (it === 'rule_violation' || it === 'rule violation' || it === 'ruleviolation') return 'rule_violation';
    if (it === 'emergency') return 'emergency';
    if (it === 'damage') return 'damage';
    return 'damage';
  }

  private normalizeLlmIncidentVoiceResult(
    raw: LlmVoiceParseJson,
    transcript: string,
    props: PropertyEntity[],
    contextPropertyId?: string,
  ): VoiceParseResultDto {
    const validProp = new Set(props.map((p) => p.id));
    let propertyId =
      raw.propertyId && validProp.has(raw.propertyId) ? raw.propertyId : null;
    if (!propertyId && contextPropertyId && validProp.has(contextPropertyId)) {
      propertyId = contextPropertyId;
    }
    if (!propertyId && props.length === 1) {
      propertyId = props[0]!.id;
    }

    const incidentType = this.normalizeIncidentVoiceType(raw.incidentType);

    let estimatedCost: number | null = null;
    if (typeof raw.estimatedCost === 'number' && Number.isFinite(raw.estimatedCost)) {
      estimatedCost = raw.estimatedCost;
    }

    const title =
      this.stripVoiceSilenceHallucinations(raw.title?.trim() || '') ||
      this.deriveVoiceTaskTitle(transcript) ||
      '';

    return {
      entityType: 'incident',
      transcript: transcript.trim(),
      title,
      incidentType,
      propertyId,
      estimatedCost,
    };
  }

  private normalizeLlmVoiceResult(
    raw: LlmVoiceParseJson,
    transcript: string,
    props: PropertyEntity[],
    staff: StaffMemberDto[],
    contextPropertyId?: string,
  ): VoiceParseResultDto {
    const et = (raw.entityType || 'task').toLowerCase().trim();
    if (et === 'incident') {
      return this.normalizeLlmIncidentVoiceResult(raw, transcript, props, contextPropertyId);
    }

    const validProp = new Set(props.map((p) => p.id));
    const validStaff = new Set(staff.map((s) => s.id));

    let propertyIds = (raw.propertyIds ?? []).filter((id) => validProp.has(id));
    let isGeneralTask = raw.isGeneralTask === true;

    if (isGeneralTask) {
      propertyIds = [];
    } else if (propertyIds.length === 0 && contextPropertyId && validProp.has(contextPropertyId)) {
      propertyIds = [contextPropertyId];
    }

    const type = this.normalizeTaskType(raw.type ?? '');
    const priority = VOICE_PRIORITIES.includes(raw.priority as (typeof VOICE_PRIORITIES)[number])
      ? raw.priority
      : 'normal';

    let assigneeId = raw.assigneeId && validStaff.has(raw.assigneeId) ? raw.assigneeId : null;

    let dueDate =
      raw.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate.trim())
        ? raw.dueDate.trim()
        : format(addDays(new Date(), 1), 'yyyy-MM-dd');

    const title =
      this.stripVoiceSilenceHallucinations(raw.title?.trim() || '') ||
      this.deriveVoiceTaskTitle(transcript) ||
      '';

    if (!isGeneralTask && propertyIds.length === 0 && props.length === 1) {
      propertyIds = [props[0]!.id];
    }

    if (propertyIds.length === 0) {
      isGeneralTask = true;
    }

    return {
      entityType: 'task',
      transcript: transcript.trim(),
      isGeneralTask,
      propertyIds,
      title,
      type,
      assigneeId,
      dueDate,
      priority,
    };
  }

  private normalizeTaskType(t: string): string {
    const s = (t || '').toLowerCase().trim();
    const aliases: Record<string, string> = {
      cleaning: 'checkout_cleaning',
      checkout: 'checkout_cleaning',
      checkout_cleaning: 'checkout_cleaning',
      mid_stay: 'mid_stay_cleaning',
      midstay: 'mid_stay_cleaning',
      preparation: 'checkin_prep',
      checkin: 'checkin_prep',
      prep: 'checkin_prep',
      maintenance: 'maintenance',
      repair: 'maintenance',
      other: 'other',
    };
    const mapped = aliases[s] || s;
    return VOICE_TASK_TYPES.includes(mapped as (typeof VOICE_TASK_TYPES)[number]) ? mapped : 'other';
  }

  /**
   * Whisper often hallucinates short captions on silence (e.g. RU «Продолжение следует»).
   * If the transcript is only such noise, treat as empty.
   */
  private stripVoiceSilenceHallucinations(transcript: string): string {
    const t = transcript.trim();
    if (!t) return '';
    const firstLine = t.split(/\n/)[0]?.trim() ?? t;
    if (firstLine !== t) return t;
    const onlyNoise =
      /^продолжение\s+следует[\s.…]*$/iu.test(firstLine) ||
      /^to be continued[\s.…]*$/iu.test(firstLine) ||
      /^\[Music\]$/i.test(firstLine) ||
      /^\[музыка\]$/iu.test(firstLine) ||
      /^[\s.…]{2,}$/u.test(firstLine);
    return onlyNoise ? '' : t;
  }

  private resolveVoiceTranscriptPlaceholder(_file: Express.Multer.File): string {
    const fromEnv = process.env.VOICE_PARSE_STT_TRANSCRIPT?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    return '';
  }

  private normVoiceText(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFC')
      .replace(/["'`«»\u201c\u201d\u2018\u2019]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectGeneralTaskFromTranscript(tNorm: string): boolean {
    const phrases = [
      'общая задача',
      'для всех объектов',
      'по всем объектам',
      'по всем апартамент',
      'все объекты',
      'всем объектам',
      'на всех объектах',
    ];
    return phrases.some((p) => tNorm.includes(p));
  }

  /** Heuristic incident detection for offline mock / keyword routing (RU/EN/PL/ES/DE). */
  private detectIncidentFromTranscript(tNorm: string): boolean {
    const hints = [
      'инцидент',
      'incident',
      'incydent',
      'incidente',
      'vorfall',
      'ущерб',
      'ukrad',
      'краж',
      'vandal',
      'поврежд',
      'разбил',
      'осколк',
      'жалоб',
      'skandal',
      'complaint',
      'skarga',
      'reclamación',
      'reclamacion',
      'beschwerde',
      'damage',
      'broken',
      'stolen',
      'theft',
      'diebstahl',
      'uszkodz',
      'zepsut',
      'zgub',
      'zostaw',
      'lost item',
      'left behind',
      'rotura',
      'daño',
      'dano',
      'beschädig',
      'beschadig',
    ];
    return hints.some((h) => tNorm.includes(h));
  }

  private detectLostItemFromTranscript(tNorm: string): boolean {
    const hints = [
      'lost',
      'забыли',
      'забыл',
      'нашли',
      'вещь',
      'полотенц',
      'left behind',
      'found item',
      'zgub',
      'zostaw',
      'olvid',
      'vergessen',
      'objetolvidado',
    ];
    return hints.some((h) => tNorm.includes(h));
  }

  private detectEmergencyFromTranscript(tNorm: string): boolean {
    const hints = [
      'emergency',
      'авари',
      'прорвало',
      'прорвала',
      'нет света',
      'полиция',
      'пожар',
      'скорая',
      'burst pipe',
      'blackout',
      'power outage',
      'notfall',
      'notruf',
      'polizei',
      'feuerwehr',
      'urgencia',
      'emergencia',
      'awaria',
    ];
    return hints.some((h) => tNorm.includes(h));
  }

  private detectRuleViolationFromTranscript(tNorm: string): boolean {
    const hints = [
      'rule_violation',
      'нарушен',
      'нарушение',
      'курени',
      'вечеринк',
      'шум',
      'сосед',
      'животн',
      'штраф',
      'smoking',
      'party',
      'noise complaint',
      'pets',
      'regelversto',
      'hausordnung',
      'normas',
    ];
    return hints.some((h) => tNorm.includes(h));
  }

  /** Rough EUR/RUB/PLN-style amount from spoken text (mock / fallback). */
  private extractCostHintFromTranscript(tNorm: string): number | null {
    const m = tNorm.match(/(?:^|\s)(\d[\d\s]*(?:[.,]\d+)?)(?:\s*(?:руб|₽|rub|eur|€|usd|\$|pln|zł|zl))?(?:\s|$)/i);
    if (!m?.[1]) return null;
    const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  /**
   * Match owner properties whose name, city, address or significant words appear in the transcript.
   */
  private matchPropertyIdsFromTranscript(
    transcriptNorm: string,
    properties: PropertyEntity[],
  ): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const stop = new Set([
      'апартаменты',
      'апартамент',
      'апаратаменты',
      'квартира',
      'объект',
      'на',
      'в',
      'для',
      'по',
      'и',
      'или',
    ]);

    for (const p of properties) {
      const pn = this.normVoiceText(p.name);
      if (pn.length >= 4 && transcriptNorm.includes(pn)) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p.id);
        }
        continue;
      }

      const city = this.normVoiceText(p.city || '');
      if (city.length >= 3 && city !== '-' && transcriptNorm.includes(city)) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p.id);
        }
        continue;
      }

      const addr = this.normVoiceText(p.address || '');
      for (const w of addr.split(/[\s,.;/]+/).filter((x) => x.length >= 4)) {
        if (transcriptNorm.includes(w)) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            out.push(p.id);
          }
          break;
        }
      }
      if (seen.has(p.id)) continue;

      for (const w of pn.split(/[\s,.;/]+/).filter((x) => x.length >= 4 && !stop.has(x))) {
        if (transcriptNorm.includes(w)) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            out.push(p.id);
          }
          break;
        }
      }
    }
    return out;
  }

  /**
   * Staff Mini App: Groq STT + DeepSeek JSON — черновик отчёта по конкретной задаче (кнопка TASK/INCIDENT = prior).
   */
  async staffMiniappVoicePreview(
    staffUserId: string,
    role: string,
    file: Express.Multer.File,
    taskUuid: string | undefined,
    buttonPressed: StaffMiniAppButtonPressed,
    clarificationText?: string,
    languageHint?: string,
    propertyId?: string,
  ): Promise<StaffMiniAppVoicePreviewDto> {
    if (role !== 'STAFF') {
      throw new ForbiddenException();
    }
    const tid = taskUuid?.trim();
    const pid = propertyId?.trim();
    if (!tid && !pid) {
      throw new BadRequestException('taskUuid or propertyId required');
    }
    if (tid && pid) {
      throw new BadRequestException('Provide only one of taskUuid or propertyId');
    }

    let task: TaskEntity;
    if (tid) {
      task = await this.ensureTaskAccess(tid, staffUserId, role);
    } else {
      const prop = await this.propertyService.findOneForUser(pid!, staffUserId, role);
      const hasTask = await this.taskRepo.exist({
        where: { propertyId: prop.id, assigneeId: staffUserId },
      });
      if (!hasTask) {
        const onRoute = await this.deliveryRoutesService.isDriverPropertyOnActiveRoute(staffUserId, prop.id);
        if (!onRoute) throw new ForbiddenException();
      }
      task = this.buildPseudoTaskForRouteVoice(prop);
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }

    const groqKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    let transcript = '';
    if (!groqKey) {
      this.logger.warn('GROQ_API_KEY unset; staff voice preview using heuristic only.');
      return this.heuristicStaffMiniAppPreview('', task, buttonPressed, 'Нет распознавания речи (GROQ_API_KEY).');
    }
    try {
      transcript = await this.transcribeWithGroqWhisper(
        file,
        groqKey,
        languageHint?.slice(0, 2),
      );
    } catch (e) {
      this.logger.warn(`staff voice STT: ${(e as Error).message}`);
      throw new BadRequestException('Не удалось распознать аудио');
    }
    const trimmed = transcript.trim();
    const merged = [trimmed, clarificationText?.trim()].filter(Boolean).join('\n\n— Уточнение: ');

    if (!merged.trim()) {
      return this.heuristicStaffMiniAppPreview('', task, buttonPressed, 'Пустая запись');
    }

    const llm = this.getVoiceParseDeepseekClient();
    if (!llm) {
      return this.heuristicStaffMiniAppPreview(merged, task, buttonPressed, null);
    }

    try {
      let candidateProps: { id: string; name: string }[] = [];
      if (task.property?.companyId) {
        const props = await this.propertyService.findAllForCompany(task.property.companyId);
        candidateProps = props.map((p) => ({ id: p.id, name: p.name }));
      }
      const raw = await this.llmParseStaffMiniAppVoice(llm, merged, task, buttonPressed, candidateProps);
      return this.normalizeStaffMiniAppLlmResult(raw, merged, task, buttonPressed, candidateProps);
    } catch (e) {
      this.logger.warn(`staff miniapp voice LLM: ${(e as Error).message}`);
      return this.heuristicStaffMiniAppPreview(merged, task, buttonPressed, null);
    }
  }

  /**
   * Staff Mini App: только STT — голосовой ответ на уточняющие вопросы (без повторного LLM-разбора всего отчёта).
   */
  async staffMiniappVoiceTranscribe(
    role: string,
    file: Express.Multer.File,
    languageHint?: string,
  ): Promise<{ transcript: string }> {
    if (role !== 'STAFF') {
      throw new ForbiddenException();
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }
    const transcript = await this.transcribeStaffVoiceBuffer(
      file.buffer,
      file.mimetype || 'audio/webm',
      languageHint,
    );
    return { transcript };
  }

  /**
   * Подтверждение: обновление задачи + заметка + инцидент (последовательно; createForStaff шлёт socket/Telegram).
   */
  async staffMiniappVoiceSubmit(
    staffUserId: string,
    role: string,
    body: StaffMiniAppVoiceSubmitDto,
  ): Promise<{ ok: boolean; taskUuid: string }> {
    if (role !== 'STAFF') {
      throw new ForbiddenException();
    }
    const taskUuidIn = body.taskUuid?.trim();
    const propertyIdIn = body.propertyId?.trim();
    if (!taskUuidIn && !propertyIdIn) {
      throw new BadRequestException('taskUuid or propertyId required');
    }
    if (taskUuidIn && propertyIdIn) {
      throw new BadRequestException('Provide only one of taskUuid or propertyId');
    }

    const fromRouteProperty = Boolean(propertyIdIn);
    let task: TaskEntity;
    let realTaskUuid: string | null = null;
    if (!fromRouteProperty) {
      task = await this.ensureTaskAccess(taskUuidIn!, staffUserId, role);
      realTaskUuid = task.id;
    } else {
      const prop = await this.propertyService.findOneForUser(propertyIdIn!, staffUserId, role);
      const hasTask = await this.taskRepo.exist({
        where: { propertyId: prop.id, assigneeId: staffUserId },
      });
      if (!hasTask) {
        const onRoute = await this.deliveryRoutesService.isDriverPropertyOnActiveRoute(staffUserId, prop.id);
        if (!onRoute) throw new ForbiddenException();
      }
      task = this.buildPseudoTaskForRouteVoice(prop);
    }

    const comment = (body.task?.comment ?? '').trim();
    const shortages = (body.task?.shortages ?? '').trim();
    const interpretParts = [comment, shortages].filter(Boolean);
    const interpretText = interpretParts.join('\n\n').trim();
    const incidentIncluded = body.incident?.include === true;

    let want = body.task?.suggestedStatus?.trim() || null;
    const allowed = new Set(['pending', 'in_progress', 'done', 'issue']);
    if (want && !allowed.has(want)) {
      throw new BadRequestException('Invalid suggestedStatus');
    }
    /** Довоз/замена — не переводим задачу в «в работе» с голоса; статус задаёт менеджер. */
    const hasShortages = shortages.length > 0;
    if (want === 'in_progress' && hasShortages) {
      want = null;
    }
    if (!fromRouteProperty) {
      if (want === 'issue' && !incidentIncluded) {
        if (
          TasksService.isSupplyOrLogisticsNotStrongIncident(
            shortages || null,
            comment,
            (body.transcript ?? '').trim(),
          )
        ) {
          want =
            task.status === 'done'
              ? null
              : body.buttonPressed === 'TASK'
                ? 'done'
                : 'in_progress';
        }
      }
      /** Очистка задачи у менеджера — «готово»; инцидент / нехватка ведутся отдельно. */
      if (incidentIncluded && task.status !== 'done') {
        want = 'done';
      }
      /** Только нехватка/довоз (очередь снабжения), без блока инцидента — уборку всё равно закрываем. */
      if (
        !incidentIncluded &&
        interpretText.length >= 3 &&
        task.status !== 'done' &&
        body.buttonPressed === 'TASK' &&
        TasksService.isSupplyOrLogisticsNotStrongIncident(shortages || null, comment, (body.transcript ?? '').trim())
      ) {
        want = 'done';
      }
      if (want && want !== task.status) {
        await this.update(taskUuidIn!, staffUserId, role, { status: want }, false, {
          bypassChecklistForStaffVoiceClose: want === 'done',
        });
      }

      if (comment) {
        await this.addNote(taskUuidIn!, staffUserId, role, comment, null);
      }
    }

    /** Создаём инцидент до очереди LLM — иначе setImmediate(process) может обогнать конец хендлера и создать второй инцидент. */
    let voiceLinkedIncidentId: string | null = null;
    const overridePropertyId = body.overridePropertyId?.trim() || null;
    const targetPropertyId = overridePropertyId || task.propertyId;

    if (incidentIncluded) {
      const itype = this.mapSubmitIncidentType(body.incident.type);
      const description =
        (body.incident.description ?? body.transcript ?? '').trim() || 'Инцидент (голосовой отчёт)';
      const rawUrls = Array.isArray(body.incident.photoUrls) ? body.incident.photoUrls : [];
      const photoUrls = rawUrls
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim())
        .slice(0, 5);
      const created = await this.incidentsService.createForStaff(staffUserId, {
        type: itype,
        propertyId: targetPropertyId,
        taskId: overridePropertyId ? null : (fromRouteProperty ? null : task.id),
        description: description.slice(0, 8000),
        photoUrls,
        damageLocation: body.incident.title?.trim()?.slice(0, 500) || null,
      });
      voiceLinkedIncidentId = created.uuid;
    }

    if (interpretText.length >= 3) {
      try {
        if (fromRouteProperty || overridePropertyId) {
          // If overridden, always treat it as a property report, not a task report
          await this.staffInterpretation.queueFromVoicePropertyReport(staffUserId, targetPropertyId, interpretText, {
            skipAutoIncident: incidentIncluded,
            voiceLinkedIncidentId,
          });
        } else {
          await this.staffInterpretation.queueFromVoiceTaskReport(staffUserId, realTaskUuid!, interpretText, {
            skipAutoIncident: incidentIncluded,
            voiceLinkedIncidentId,
          });
        }
      } catch (e) {
        this.logger.warn(`voice interpret queue: ${(e as Error).message}`);
      }
    }

    return { ok: true, taskUuid: fromRouteProperty ? task.propertyId : realTaskUuid! };
  }

  private mapSubmitIncidentType(raw: string | null | undefined): IncidentType {
    const x = (raw || 'damage').toLowerCase().trim();
    if (x === 'lost_item' || x === 'lost') return 'lost_item';
    if (x === 'emergency') return 'emergency';
    if (x === 'rule_violation') return 'rule_violation';
    if (x === 'task_report') return 'task_report';
    return 'damage';
  }

  private async llmParseStaffMiniAppVoice(
    llm: { client: OpenAI; model: string },
    transcript: string,
    task: TaskEntity,
    buttonPressed: StaffMiniAppButtonPressed,
    candidateProperties: { id: string; name: string }[] = [],
  ): Promise<Record<string, unknown>> {
    const taskJson = JSON.stringify({
      id: task.id,
      title: task.title,
      status: task.status,
      propertyId: task.propertyId,
      propertyName: task.property?.name ?? '',
      dueDate: task.dueDate,
    });
    const systemPrompt = `You analyze voice reports from cleaning staff about ONE specific task (RentAI).
The UI button context is a PRIOR, not a hard filter:
- buttonPressed TASK: expect work status / shortages; BUT if they mention breakage, water leak, lost item, emergency — you MUST still fill the incident block.
- buttonPressed INCIDENT: expect problem report; BUT if they only report normal progress, set detectedMode TASK_ONLY or MIXED and reflect work status.

Return ONE JSON object only (no markdown):
{
  "detectedMode": "TASK_ONLY" | "INCIDENT_ONLY" | "MIXED",
  "confidence": 0.0-1.0,
  "task": {
    "suggestedStatus": "pending" | "in_progress" | "done" | "issue" | null,
    "comment": "short summary for manager (RU)",
    "shortages": "supply/replace line or null — see Shortages wording below"
  },
  "incident": {
    "include": boolean,
    "type": "damage" | "lost_item" | "emergency" | "rule_violation" | "task_report",
    "title": "short",
    "description": "details",
    "risk": "low" | "medium" | "high"
  },
  "needsClarification": boolean,
  "clarificationQuestions": ["..."],
  "mismatchHint": null,
  "overridePropertyId": "uuid or null"
}

Rules:
- suggestedStatus must be realistic vs current task.status (${task.status}).
- If "shortages" is non-empty (довоз, замена, нехватка): set suggestedStatus to "pending" only — staff does NOT put logistics work "in_progress"; the manager assigns later. Never use "in_progress" when shortages is filled.
- NEVER set suggestedStatus to "issue" for supply/delivery/replacement only. Reserve "issue" ONLY for real escalations: damage, safety, theft, flood, guest conflict, or when incident.include should be true.
- If incident.include is true, type/description must be meaningful.
- Use Russian for comment/title/description fields where natural.
- Always set "mismatchHint" to null (UI no longer shows button/speech warnings).
- Shortages wording (critical): when the staff needs materials delivered OR something replaced, fill "shortages" using fixed Russian stems with correct declensions:
  - For delivery/restock: start with "Нужно довезти" (e.g. "Нужно довезти полотенца", "Нужно довезти туалетную бумагу").
  - For replacement: start with "Нужно заменить" (e.g. "Нужно заменить лампочку в ванной", "Нужно заменить смеситель").
  If there is no supply/replace need, set "shortages" to null or empty.
- If the user message includes a separate "— Уточнение:" block, treat it as answers to clarification questions and merge into comment/shortages/incident as appropriate.
- overridePropertyId (CRITICAL for logistics): If the speaker explicitly mentions a DIFFERENT property name in the transcript (e.g., "на Немиге", "в Зодомусе") while talking from the current property card, find the best match in the candidate list and output its UUID here. Otherwise, output null.

Candidate properties for override (id -> name):
${candidateProperties.map((p) => `${p.id} -> ${p.name}`).join('\n')}

Task context:
${taskJson}
buttonPressed: ${buttonPressed}`;

    const createParams = {
      model: llm.model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: `Transcript:\n"""${transcript.replace(/"""/g, '"')}\n"""`,
        },
      ],
      temperature: 0.15,
      max_tokens: 900,
      response_format: { type: 'json_object' as const },
    };

    let completion;
    try {
      completion = await llm.client.chat.completions.create(createParams);
    } catch {
      completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: createParams.messages,
        temperature: 0.15,
        max_tokens: 900,
      });
    }
    const rawText = completion.choices[0]?.message?.content?.trim();
    if (!rawText) throw new Error('empty LLM response');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('invalid JSON from LLM');
      parsed = JSON.parse(m[0]);
    }
    return parsed as Record<string, unknown>;
  }

  private normalizeStaffMiniAppLlmResult(
    raw: Record<string, unknown>,
    transcript: string,
    task: TaskEntity,
    buttonPressed: StaffMiniAppButtonPressed,
    candidateProperties: { id: string; name: string }[] = [],
  ): StaffMiniAppVoicePreviewDto {
    const conf =
      typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
        ? raw.confidence
        : 0.7;
    const modeRaw = String(raw.detectedMode || 'TASK_ONLY').toUpperCase();
    const detectedMode: StaffMiniAppDetectedMode =
      modeRaw === 'INCIDENT_ONLY' || modeRaw === 'MIXED' || modeRaw === 'TASK_ONLY'
        ? (modeRaw as StaffMiniAppDetectedMode)
        : 'TASK_ONLY';

    const taskBlock = (raw.task && typeof raw.task === 'object' ? raw.task : {}) as Record<string, unknown>;
    const incBlock = (raw.incident && typeof raw.incident === 'object' ? raw.incident : {}) as Record<
      string,
      unknown
    >;

    const st = typeof taskBlock.suggestedStatus === 'string' ? taskBlock.suggestedStatus.trim() : null;
    const allowed = new Set(['pending', 'in_progress', 'done', 'issue']);

    const comment =
      typeof taskBlock.comment === 'string' && taskBlock.comment.trim()
        ? taskBlock.comment.trim().slice(0, 4000)
        : transcript.slice(0, 2000);
    const shortages =
      typeof taskBlock.shortages === 'string' && taskBlock.shortages.trim()
        ? taskBlock.shortages.trim().slice(0, 1000)
        : null;

    const include = incBlock.include === true;

    let suggestedStatus = st && allowed.has(st) ? st : null;
    if (suggestedStatus === 'issue' && !include) {
      if (TasksService.isSupplyOrLogisticsNotStrongIncident(shortages, comment, transcript)) {
        suggestedStatus =
          task.status === 'done'
            ? null
            : buttonPressed === 'TASK'
              ? 'done'
              : 'in_progress';
      }
    }
    if (shortages && shortages.trim().length > 0) {
      if (suggestedStatus === 'in_progress') suggestedStatus = 'pending';
    }
    const itypeRaw = typeof incBlock.type === 'string' ? incBlock.type.trim() : 'damage';
    const itypes = new Set(['damage', 'lost_item', 'emergency', 'rule_violation', 'task_report']);
    const itype = itypes.has(itypeRaw) ? (itypeRaw as IncidentType) : 'damage';

    const title =
      typeof incBlock.title === 'string' && incBlock.title.trim()
        ? incBlock.title.trim().slice(0, 500)
        : include
          ? this.deriveVoiceTaskTitle(transcript)
          : null;
    const desc =
      typeof incBlock.description === 'string' && incBlock.description.trim()
        ? incBlock.description.trim().slice(0, 8000)
        : include
          ? transcript
          : null;
    const riskRaw = String(incBlock.risk || 'medium').toLowerCase();
    const risk =
      riskRaw === 'low' || riskRaw === 'medium' || riskRaw === 'high' ? (riskRaw as 'low' | 'medium' | 'high') : 'medium';

    const needsClarification = raw.needsClarification === true;
    const qs = Array.isArray(raw.clarificationQuestions)
      ? (raw.clarificationQuestions as unknown[])
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => (x as string).trim().slice(0, 500))
          .slice(0, 4)
      : [];

    let overridePropertyId: string | null = null;
    let overridePropertyTitle: string | null = null;
    const overridePropertyIdRaw =
      typeof raw.overridePropertyId === 'string' ? raw.overridePropertyId.trim() : '';
    if (overridePropertyIdRaw) {
      const match = candidateProperties.find((p) => p.id === overridePropertyIdRaw);
      if (match) {
        overridePropertyId = match.id;
        overridePropertyTitle = match.name;
      }
    }

    return {
      buttonPressed,
      detectedMode,
      confidence: conf,
      transcript: transcript.slice(0, 12000),
      task: {
        suggestedStatus,
        comment,
        shortages,
      },
      incident: {
        include,
        type: include ? itype : null,
        title,
        description: desc,
        risk: include ? risk : null,
      },
      needsClarification,
      clarificationQuestions: qs,
      mismatchHint: null,
      overridePropertyId,
      overridePropertyTitle,
    };
  }

  private heuristicStaffMiniAppPreview(
    transcript: string,
    task: TaskEntity,
    buttonPressed: StaffMiniAppButtonPressed,
    extraHint: string | null,
  ): StaffMiniAppVoicePreviewDto {
    const t = transcript.toLowerCase();
    const doneHints = /готов|сделал|закончил|выполнил|убрал|готово/;
    const incHints =
      /сломан|тресн|потоп|вода|утерян|утеря|забыл|инцидент|пожар|авар|порван|разбит|теч[её]т|затоп/;
    const includeIncident = incHints.test(t) || buttonPressed === 'INCIDENT';
    const done = doneHints.test(t);
    const mixed = includeIncident && (done || /убрал|помыл|уборк/i.test(t));

    let detectedMode: StaffMiniAppDetectedMode = 'TASK_ONLY';
    if (includeIncident && mixed) detectedMode = 'MIXED';
    else if (includeIncident) detectedMode = 'INCIDENT_ONLY';

    let suggestedStatus: string | null = task.status;
    if (done) suggestedStatus = 'done';
    else if (task.status === 'pending' && t.length > 5) suggestedStatus = 'in_progress';

    return {
      buttonPressed,
      detectedMode,
      confidence: 0.42,
      transcript: transcript.slice(0, 12000),
      task: {
        suggestedStatus,
        comment: transcript ? transcript.slice(0, 2000) : extraHint || '—',
        shortages: null,
      },
      incident: {
        include: includeIncident,
        type: includeIncident ? 'damage' : null,
        title: includeIncident ? this.deriveVoiceTaskTitle(transcript) || 'Инцидент' : null,
        description: includeIncident ? transcript.slice(0, 8000) : null,
        risk: /вода|потоп|огонь|травм|скорая/i.test(t) ? 'high' : includeIncident ? 'medium' : null,
      },
      needsClarification: false,
      clarificationQuestions: [],
      mismatchHint: null,
    };
  }

  /** Until LLM returns a one-line summary, derive a short title from the transcript. */
  private deriveVoiceTaskTitle(transcript: string): string {
    let t = transcript.trim();
    if (!t) return '';
    t = t.replace(/^слушай,?\s*/i, '').trim();
    const oneLine = t.split(/\n/)[0]?.trim() ?? t;
    const cut = oneLine.length > 100 ? `${oneLine.slice(0, 97)}…` : oneLine;
    return cut;
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { format } from 'date-fns';
import { IncidentEntity, IncidentStatus, IncidentType } from './entities/incident.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { TelegramService } from '../telegram/telegram.service';
import { TasksGateway } from '../tasks/tasks.gateway';
import { UserService } from '../user/user.service';
import { TasksService } from '../tasks/tasks.service';
import { DeliveryRoutesService } from '../tasks/delivery-routes.service';

const SUGGESTED_TASK_TYPES = new Set([
  'checkout_cleaning',
  'mid_stay_cleaning',
  'checkin_prep',
  'maintenance',
  'other',
]);
const SUGGESTED_PRIORITIES = new Set(['normal', 'urgent', 'critical']);

/** Task prefill from staff voice (stored on incident for manager UI). */
export interface IncidentSuggestedTaskDraftDto {
  title?: string;
  type?: 'checkout_cleaning' | 'mid_stay_cleaning' | 'checkin_prep' | 'maintenance' | 'other';
  priority?: 'normal' | 'urgent' | 'critical';
  assigneeId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

/** Tasks linked via `task.incidentId` (includes dispatch + follow-ups). */
export interface IncidentRelatedTaskDto {
  uuid: string;
  title: string;
  status: string;
  type: string;
  assigneeName: string | null;
}

export interface IncidentDto {
  uuid: string;
  type: IncidentType;
  status: IncidentStatus;
  propertyId: string;
  propertyTitle: string;
  taskId: string | null;
  reservationId: string | null;
  reportedBy: string;
  reporterName: string;
  description: string;
  photoUrls: string[];
  guestName: string | null;
  itemDescription: string | null;
  damageLocation: string | null;
  estimatedCost: string | null;
  managerNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** Most recent non-cancelled stay for this property (by checkout), for manager context. */
  lastStayGuestName: string | null;
  lastStayGuestPhone: string | null;
  lastStayCheckOut: string | null;
  /** Booking id for last stay (open in calendar / task-from-booking). */
  lastStayBookingId: string | null;
  /** From last stay booking when available. */
  lastStayPaymentStatus: 'unpaid' | 'partial' | 'paid' | null;
  dispatchedTaskId: string | null;
  /** Technician assigned to the dispatched maintenance task (when any). */
  dispatchedAssigneeId: string | null;
  dispatchedAssigneeName: string | null;
  /** All tasks pointing at this incident (`task.incidentId`). */
  relatedTasks: IncidentRelatedTaskDto[];
  suggestedTaskDraft: IncidentSuggestedTaskDraftDto | null;
}

/** Staff mini-app: own reported incidents (history + append photos). */
export interface StaffIncidentHistoryItemDto {
  uuid: string;
  type: IncidentType;
  status: IncidentStatus;
  propertyId: string;
  propertyTitle: string;
  taskId: string | null;
  descriptionPreview: string;
  photoUrls: string[];
  createdAt: string;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(IncidentEntity)
    private readonly incidentRepo: Repository<IncidentEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly tasksGateway: TasksGateway,
    private readonly userService: UserService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    @Inject(forwardRef(() => DeliveryRoutesService))
    private readonly deliveryRoutesService: DeliveryRoutesService,
  ) {}

  /** Latest stay per property (by check-out), excluding cancelled/declined. */
  private async loadLastStayByPropertyIds(propertyIds: string[]): Promise<Map<string, BookingEntity>> {
    const map = new Map<string, BookingEntity>();
    const ids = [...new Set(propertyIds)].filter(Boolean);
    if (ids.length === 0) return map;

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.propertyId IN (:...ids)', { ids })
      .andWhere('b.status NOT IN (:...bad)', { bad: ['CANCELLED', 'DECLINED'] })
      .orderBy('b.checkOut', 'DESC')
      .getMany();

    for (const b of bookings) {
      if (!map.has(b.propertyId)) map.set(b.propertyId, b);
    }
    return map;
  }

  private sanitizeSuggestedTaskDraft(
    input: unknown,
    validStaffIds: Set<string> | null,
  ): IncidentSuggestedTaskDraftDto | null {
    if (!input || typeof input !== 'object') return null;
    const o = input as Record<string, unknown>;
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const out: IncidentSuggestedTaskDraftDto = {};
    if (typeof o.title === 'string' && o.title.trim()) {
      out.title = o.title.trim().slice(0, 500);
    }
    if (typeof o.type === 'string' && SUGGESTED_TASK_TYPES.has(o.type)) {
      out.type = o.type as IncidentSuggestedTaskDraftDto['type'];
    }
    if (typeof o.priority === 'string' && SUGGESTED_PRIORITIES.has(o.priority)) {
      out.priority = o.priority as IncidentSuggestedTaskDraftDto['priority'];
    }
    if (typeof o.assigneeId === 'string' && uuidRe.test(o.assigneeId)) {
      if (validStaffIds === null || validStaffIds.has(o.assigneeId)) {
        out.assigneeId = o.assigneeId;
      }
    } else if (o.assigneeId === null) {
      out.assigneeId = null;
    }
    if (typeof o.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)) {
      out.dueDate = o.dueDate;
    }
    if (typeof o.notes === 'string' && o.notes.trim()) {
      out.notes = o.notes.trim().slice(0, 8000);
    }
    if (
      out.title === undefined &&
      out.type === undefined &&
      out.priority === undefined &&
      out.assigneeId === undefined &&
      out.dueDate === undefined &&
      out.notes === undefined
    ) {
      return null;
    }
    return out;
  }

  private draftFromEntity(row: IncidentEntity): IncidentSuggestedTaskDraftDto | null {
    return this.sanitizeSuggestedTaskDraft(row.suggestedTaskDraft, null);
  }

  private toDto(
    row: IncidentEntity,
    lastStay: BookingEntity | null | undefined,
    relatedTasks: IncidentRelatedTaskDto[],
  ): IncidentDto {
    return {
      uuid: row.id,
      type: row.type,
      status: row.status,
      propertyId: row.propertyId,
      propertyTitle: row.property?.name ?? '',
      taskId: row.taskId,
      reservationId: row.reservationId,
      reportedBy: row.reportedBy,
      reporterName: row.reporter
        ? `${row.reporter.firstName} ${row.reporter.lastName}`.trim()
        : '',
      description: row.description,
      photoUrls: row.photoUrls ?? [],
      guestName: row.guestName,
      itemDescription: row.itemDescription,
      damageLocation: row.damageLocation,
      estimatedCost: row.estimatedCost,
      managerNote: row.managerNote,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      lastStayGuestName: lastStay?.guestName ?? null,
      lastStayGuestPhone: lastStay?.guestPhone?.trim() || null,
      lastStayCheckOut: lastStay?.checkOut ? lastStay.checkOut.toISOString() : null,
      lastStayBookingId: lastStay?.id ?? null,
      lastStayPaymentStatus: lastStay?.paymentStatus ?? null,
      dispatchedTaskId: row.dispatchedTaskId ?? null,
      dispatchedAssigneeId: row.dispatchedTask?.assigneeId ?? null,
      dispatchedAssigneeName: row.dispatchedTask?.assignee
        ? `${row.dispatchedTask.assignee.firstName} ${row.dispatchedTask.assignee.lastName}`.trim()
        : null,
      relatedTasks,
      suggestedTaskDraft: this.draftFromEntity(row),
    };
  }

  private async loadRelatedTasksForIncidentIds(ids: string[]): Promise<Map<string, IncidentRelatedTaskDto[]>> {
    const map = new Map<string, IncidentRelatedTaskDto[]>();
    const uniq = [...new Set(ids)].filter(Boolean);
    if (uniq.length === 0) return map;
    const tasks = await this.taskRepo.find({
      where: { incidentId: In(uniq) },
      relations: ['assignee'],
      order: { createdAt: 'ASC' },
    });
    for (const t of tasks) {
      if (!t.incidentId) continue;
      const assigneeName = t.assignee
        ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim() || null
        : null;
      const item: IncidentRelatedTaskDto = {
        uuid: t.id,
        title: t.title,
        status: t.status,
        type: t.type,
        assigneeName,
      };
      const list = map.get(t.incidentId) ?? [];
      list.push(item);
      map.set(t.incidentId, list);
    }
    return map;
  }

  /**
   * Manager dashboard: create an incident without staff assignment checks.
   * Reporter is the acting manager/owner user.
   */
  async createForManager(
    actingUserId: string,
    actingRole: string,
    body: {
      type: IncidentType;
      propertyId: string;
      description: string;
      estimatedCost?: string | null;
      photoUrls?: string[];
    },
  ): Promise<IncidentDto> {
    const ownerId = await this.userService.resolveTenantOwnerId(actingUserId, actingRole);

    const property = await this.propertyRepo.findOne({ where: { id: body.propertyId } });
    if (!property) throw new NotFoundException('Property not found');
    if (property.ownerId !== ownerId) throw new ForbiddenException();

    let estimatedCost: string | null = null;
    if (body.estimatedCost != null && String(body.estimatedCost).trim() !== '') {
      const n = Number(String(body.estimatedCost).replace(',', '.').trim());
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException('Invalid estimatedCost');
      }
      estimatedCost = n.toFixed(2);
    }

    const row = this.incidentRepo.create({
      type: body.type,
      status: 'open',
      propertyId: body.propertyId,
      companyId: property.companyId,
      taskId: null,
      reservationId: null,
      reportedBy: actingUserId,
      description: body.description.trim(),
      photoUrls: body.photoUrls?.length ? body.photoUrls : [],
      guestName: null,
      itemDescription: null,
      damageLocation: null,
      estimatedCost,
      managerNote: null,
      resolvedBy: null,
      resolvedAt: null,
    });
    const saved = await this.incidentRepo.save(row);

    const full = await this.incidentRepo.findOne({
      where: { id: saved.id },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!full) throw new NotFoundException();

    this.tasksGateway.emitIncidentCreated({
      incidentId: full.id,
      propertyOwnerId: property.ownerId,
    });

    const lastByProp = await this.loadLastStayByPropertyIds([full.propertyId]);
    const relatedByInc = await this.loadRelatedTasksForIncidentIds([full.id]);
    return this.toDto(full, lastByProp.get(full.propertyId), relatedByInc.get(full.id) ?? []);
  }

  async createForStaff(
    staffId: string,
    body: {
      type: IncidentType;
      propertyId: string;
      taskId: string | null;
      description: string;
      photoUrls: string[];
      guestName?: string | null;
      itemDescription?: string | null;
      damageLocation?: string | null;
      reservationId?: string | null;
      suggestedTaskDraft?: unknown;
    },
  ): Promise<IncidentDto> {
    const property = await this.propertyRepo.findOne({ where: { id: body.propertyId } });
    if (!property) throw new NotFoundException('Property not found');
    if (body.type === 'task_report' && !body.taskId) {
      throw new BadRequestException('task_report requires taskId');
    }

    const staffList = await this.userService.findStaffByOwner(property.ownerId);
    const staffIds = new Set(staffList.map((s) => s.id));
    const suggestedDraft = this.sanitizeSuggestedTaskDraft(body.suggestedTaskDraft, staffIds);

    let linkedTask: TaskEntity | null = null;
    if (body.taskId) {
      linkedTask = await this.taskRepo.findOne({
        where: { id: body.taskId },
        relations: ['property'],
      });
      if (!linkedTask) throw new NotFoundException('Task not found');
      if (linkedTask.assigneeId !== staffId) throw new ForbiddenException();
      if (linkedTask.propertyId !== body.propertyId) throw new BadRequestException('taskId does not match property');
    } else {
      const hasTaskOnProperty = await this.taskRepo.exist({
        where: { propertyId: body.propertyId, assigneeId: staffId },
      });
      const onDriverRoute = await this.deliveryRoutesService.isDriverPropertyOnActiveRoute(
        staffId,
        body.propertyId,
      );
      if (!hasTaskOnProperty && !onDriverRoute) {
        throw new ForbiddenException('No assignment on this property');
      }
    }

    const row = this.incidentRepo.create({
      type: body.type,
      status: 'awaiting_dispatch',
      propertyId: body.propertyId,
      companyId: property.companyId,
      taskId: body.taskId,
      reservationId: body.reservationId ?? null,
      reportedBy: staffId,
      description: body.description.trim(),
      photoUrls: body.photoUrls,
      guestName: body.guestName?.trim() || null,
      itemDescription: body.itemDescription?.trim() || null,
      damageLocation: body.damageLocation?.trim() || null,
      estimatedCost: null,
      managerNote: null,
      resolvedBy: null,
      resolvedAt: null,
      suggestedTaskDraft: suggestedDraft ? { ...suggestedDraft } : null,
    });
    const saved = await this.incidentRepo.save(row);

    const full = await this.incidentRepo.findOne({
      where: { id: saved.id },
      relations: ['property', 'reporter'],
    });
    if (!full) throw new NotFoundException();

    const title = property.name;
    const reporterLabel = full.reporter
      ? `${full.reporter.firstName} ${full.reporter.lastName}`.trim()
      : staffId;
    const descriptionForManager =
      body.type === 'lost_item'
        ? [body.itemDescription, body.description, body.guestName ? `Гость: ${body.guestName}` : '']
            .filter(Boolean)
            .join('\n')
            .trim() || body.description.trim()
        : body.type === 'task_report'
          ? [linkedTask?.title ? `Задача: ${linkedTask.title}` : '', body.description.trim()]
              .filter(Boolean)
              .join('\n')
              .trim()
          : [body.description, body.damageLocation ? `Где: ${body.damageLocation}` : '']
              .filter(Boolean)
              .join('\n')
              .trim();

    const tgMsgId = await this.telegramService.notifyIncident({
      incidentId: saved.id,
      ownerId: property.ownerId,
      reporterName: reporterLabel,
      propertyName: title,
      description: descriptionForManager,
      photoUrls: body.photoUrls?.length ? body.photoUrls : undefined,
    });
    if (tgMsgId != null) {
      await this.incidentRepo.update(saved.id, { telegramNotifyMessageId: String(tgMsgId) });
    }

    this.tasksGateway.emitIncidentCreated({
      incidentId: full.id,
      propertyOwnerId: property.ownerId,
    });

    const lastByProp = await this.loadLastStayByPropertyIds([full.propertyId]);
    const relatedByInc = await this.loadRelatedTasksForIncidentIds([full.id]);
    return this.toDto(full, lastByProp.get(full.propertyId), relatedByInc.get(full.id) ?? []);
  }

  private mergeIncidentPhotoUrls(row: IncidentEntity, additional: string[]): void {
    const cur = Array.isArray(row.photoUrls) ? row.photoUrls : [];
    const seen = new Set(cur);
    for (const u of additional) {
      const s = typeof u === 'string' ? u.trim() : '';
      if (s && !seen.has(s)) {
        cur.push(s);
        seen.add(s);
      }
    }
    row.photoUrls = cur;
  }

  private toStaffHistoryItem(row: IncidentEntity): StaffIncidentHistoryItemDto {
    const desc = row.description ?? '';
    const descriptionPreview = desc.length > 200 ? `${desc.slice(0, 200)}…` : desc;
    return {
      uuid: row.id,
      type: row.type,
      status: row.status,
      propertyId: row.propertyId,
      propertyTitle: row.property?.name ?? '',
      taskId: row.taskId,
      descriptionPreview,
      photoUrls: row.photoUrls ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForStaffReported(staffUserId: string, take = 80): Promise<StaffIncidentHistoryItemDto[]> {
    const rows = await this.incidentRepo.find({
      where: { reportedBy: staffUserId },
      relations: ['property'],
      order: { createdAt: 'DESC' },
      take,
    });
    return rows.map((r) => this.toStaffHistoryItem(r));
  }

  async appendPhotoUrlsForStaff(
    incidentId: string,
    staffUserId: string,
    urls: string[],
  ): Promise<StaffIncidentHistoryItemDto> {
    if (!urls.length) {
      throw new BadRequestException('No photos');
    }
    const row = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property'],
    });
    if (!row) throw new NotFoundException();
    if (row.reportedBy !== staffUserId) throw new ForbiddenException();

    this.mergeIncidentPhotoUrls(row, urls);
    await this.incidentRepo.save(row);

    this.tasksGateway.emitIncidentUpdated({
      incidentId: row.id,
      propertyOwnerId: row.property.ownerId,
    });

    const reloaded = await this.incidentRepo.findOne({
      where: { id: row.id },
      relations: ['property'],
    });
    if (!reloaded) throw new NotFoundException();
    return this.toStaffHistoryItem(reloaded);
  }

  async listForOwner(
    ownerId: string,
    q: { propertyId?: string; type?: IncidentType; status?: IncidentStatus },
  ): Promise<IncidentDto[]> {
    const qb = this.incidentRepo
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.property', 'p')
      .leftJoinAndSelect('i.reporter', 'r')
      .leftJoinAndSelect('i.dispatchedTask', 'dispatchedTask')
      .leftJoinAndSelect('dispatchedTask.assignee', 'dispatchedAssignee')
      .where('p.ownerId = :ownerId', { ownerId })
      .orderBy('i.createdAt', 'DESC');

    if (q.propertyId) qb.andWhere('i.propertyId = :propertyId', { propertyId: q.propertyId });
    if (q.type) qb.andWhere('i.type = :type', { type: q.type });
    if (q.status) qb.andWhere('i.status = :status', { status: q.status });

    const rows = await qb.getMany();
    const lastByProp = await this.loadLastStayByPropertyIds(rows.map((r) => r.propertyId));
    const relatedByInc = await this.loadRelatedTasksForIncidentIds(rows.map((r) => r.id));
    return rows.map((row) =>
      this.toDto(row, lastByProp.get(row.propertyId), relatedByInc.get(row.id) ?? []),
    );
  }

  async findOneForOwner(incidentId: string, ownerId: string): Promise<IncidentDto> {
    const row = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!row || row.property.ownerId !== ownerId) throw new NotFoundException();
    const lastByProp = await this.loadLastStayByPropertyIds([row.propertyId]);
    const relatedByInc = await this.loadRelatedTasksForIncidentIds([row.id]);
    return this.toDto(row, lastByProp.get(row.propertyId), relatedByInc.get(row.id) ?? []);
  }

  async patchForOwner(
    incidentId: string,
    ownerId: string,
    actorUserId: string,
    patch: Partial<{
      status: IncidentStatus;
      managerNote: string | null;
      estimatedCost: string | null;
      appendPhotoUrls: string[];
    }>,
  ): Promise<IncidentDto> {
    const row = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property', 'reporter'],
    });
    if (!row || row.property.ownerId !== ownerId) throw new NotFoundException();

    if (patch.status !== undefined) row.status = patch.status;
    if (patch.managerNote !== undefined) row.managerNote = patch.managerNote;
    if (patch.estimatedCost !== undefined) row.estimatedCost = patch.estimatedCost;
    if (patch.appendPhotoUrls !== undefined && patch.appendPhotoUrls.length > 0) {
      this.mergeIncidentPhotoUrls(row, patch.appendPhotoUrls);
    }
    if (patch.status === 'resolved' || patch.status === 'closed') {
      row.resolvedAt = new Date();
      row.resolvedBy = actorUserId;
    } else if (patch.status !== undefined) {
      row.resolvedAt = null;
      row.resolvedBy = null;
    }

    await this.incidentRepo.save(row);
    const reloaded = await this.incidentRepo.findOne({
      where: { id: row.id },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!reloaded) throw new NotFoundException();
    const lastByProp = await this.loadLastStayByPropertyIds([reloaded.propertyId]);
    const relatedByInc = await this.loadRelatedTasksForIncidentIds([reloaded.id]);
    return this.toDto(reloaded, lastByProp.get(reloaded.propertyId), relatedByInc.get(reloaded.id) ?? []);
  }

  /**
   * After manager verifies the incident in the dashboard: create a maintenance task and notify the technician.
   */
  async dispatchMaintenanceTask(
    incidentId: string,
    actingUserId: string,
    actingRole: string,
    assigneeId: string,
  ): Promise<IncidentDto> {
    const ownerId = await this.userService.resolveTenantOwnerId(actingUserId, actingRole);
    const incident = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property', 'reporter'],
    });
    if (!incident || incident.property.ownerId !== ownerId) {
      throw new NotFoundException();
    }
    if (incident.dispatchedTaskId) {
      throw new BadRequestException('Incident already has a dispatched task');
    }
    const assignee = await this.userService.findById(assigneeId);
    if (!assignee || assignee.role !== 'STAFF' || assignee.employerOwnerId !== ownerId) {
      throw new BadRequestException('Invalid assignee');
    }

    await this.tasksService.createTasksBulkForManager(actingUserId, actingRole, {
      propertyIds: [incident.propertyId],
      title: `Инцидент: ${incident.description.slice(0, 120)}`,
      type: 'maintenance',
      assigneeId,
      dueDate: format(new Date(), 'yyyy-MM-dd'),
      notes: incident.description,
      incidentId: incident.id,
    });

    const reloaded = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!reloaded) throw new NotFoundException();
    const lastByProp = await this.loadLastStayByPropertyIds([reloaded.propertyId]);
    const relatedByInc = await this.loadRelatedTasksForIncidentIds([reloaded.id]);
    return this.toDto(reloaded, lastByProp.get(reloaded.propertyId), relatedByInc.get(reloaded.id) ?? []);
  }

  async countOpenForOwner(ownerId: string): Promise<number> {
    return this.incidentRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('i.status IN (:...st)', {
        st: ['awaiting_dispatch', 'assigned', 'open', 'in_review'],
      })
      .getCount();
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { format } from 'date-fns';
import { IncidentEntity, IncidentStatus, IncidentType } from './entities/incident.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { TelegramService } from '../telegram/telegram.service';
import { TasksGateway } from '../tasks/tasks.gateway';
import { UserService } from '../user/user.service';
import { TasksService } from '../tasks/tasks.service';

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
  dispatchedTaskId: string | null;
  /** Technician assigned to the dispatched maintenance task (when any). */
  dispatchedAssigneeId: string | null;
  dispatchedAssigneeName: string | null;
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

  private toDto(row: IncidentEntity, lastStay?: BookingEntity | null): IncidentDto {
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
      dispatchedTaskId: row.dispatchedTaskId ?? null,
      dispatchedAssigneeId: row.dispatchedTask?.assigneeId ?? null,
      dispatchedAssigneeName: row.dispatchedTask?.assignee
        ? `${row.dispatchedTask.assignee.firstName} ${row.dispatchedTask.assignee.lastName}`.trim()
        : null,
    };
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

    const title = property.name;
    const reporterLabel = full.reporter
      ? `${full.reporter.firstName} ${full.reporter.lastName}`.trim()
      : actingUserId;
    const descriptionForManager = body.description.trim();

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
    return this.toDto(full, lastByProp.get(full.propertyId));
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
    },
  ): Promise<IncidentDto> {
    const property = await this.propertyRepo.findOne({ where: { id: body.propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    if (body.taskId) {
      const task = await this.taskRepo.findOne({
        where: { id: body.taskId },
        relations: ['property'],
      });
      if (!task) throw new NotFoundException('Task not found');
      if (task.assigneeId !== staffId) throw new ForbiddenException();
      if (task.propertyId !== body.propertyId) throw new BadRequestException('taskId does not match property');
    } else {
      const hasAccess = await this.taskRepo.exist({
        where: { propertyId: body.propertyId, assigneeId: staffId },
      });
      if (!hasAccess) throw new ForbiddenException('No assignment on this property');
    }

    const row = this.incidentRepo.create({
      type: body.type,
      status: 'open',
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
    return this.toDto(full, lastByProp.get(full.propertyId));
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
    return rows.map((row) => this.toDto(row, lastByProp.get(row.propertyId)));
  }

  async findOneForOwner(incidentId: string, ownerId: string): Promise<IncidentDto> {
    const row = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!row || row.property.ownerId !== ownerId) throw new NotFoundException();
    const lastByProp = await this.loadLastStayByPropertyIds([row.propertyId]);
    return this.toDto(row, lastByProp.get(row.propertyId));
  }

  async patchForOwner(
    incidentId: string,
    ownerId: string,
    patch: Partial<{
      status: IncidentStatus;
      managerNote: string | null;
      estimatedCost: string | null;
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
    if (patch.status === 'resolved' || patch.status === 'closed') {
      row.resolvedAt = new Date();
    }

    await this.incidentRepo.save(row);
    const reloaded = await this.incidentRepo.findOne({
      where: { id: row.id },
      relations: ['property', 'reporter', 'dispatchedTask', 'dispatchedTask.assignee'],
    });
    if (!reloaded) throw new NotFoundException();
    const lastByProp = await this.loadLastStayByPropertyIds([reloaded.propertyId]);
    return this.toDto(reloaded, lastByProp.get(reloaded.propertyId));
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
    return this.toDto(reloaded, lastByProp.get(reloaded.propertyId));
  }

  async countOpenForOwner(ownerId: string): Promise<number> {
    return this.incidentRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('i.status IN (:...st)', { st: ['open', 'in_review'] })
      .getCount();
  }
}

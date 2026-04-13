import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, DataSource, EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { TaskEntity } from './entities/task.entity';
import { IncidentEntity, IncidentType } from '../incidents/entities/incident.entity';
import { IncidentsService } from '../incidents/incidents.service';
import { StaffInterpretationEventEntity } from './entities/staff-interpretation-event.entity';
import { SupplyRequestItemEntity } from './entities/supply-request-item.entity';
import { TasksService } from './tasks.service';
import { TasksGateway } from './tasks.gateway';
import { PropertyService } from '../property/property.service';
import { UserService } from '../user/user.service';
import { SupplyCatalogService } from './supply-catalog.service';
import { DeliveryRoutesService } from './delivery-routes.service';
import { PropertyEntity } from '../property/entities/property.entity';

export type StaffInterpretEntryPoint =
  | 'history_supplement'
  | 'task_create'
  | 'voice_task_report'
  | 'manager_supply_create';

/** Одна строка ленты менеджера (GET supply-interpretations и тело `event` после POST create). */
export interface ManagerSupplyInterpretationListItem {
  id: string;
  entryPoint: string;
  targetType: string;
  targetId: string;
  /** Объект интерпретации — для группировки в сводке. */
  propertyId: string;
  textRaw: string;
  propertyTitle: string;
  authorName: string;
  createdAt: string;
  llmStatus: string;
  workflowState: string;
  llmError: string | null;
  llmIntent: string | null;
  managerBucket: 'supply' | 'incident';
  items: Array<{
    id: string;
    name: string;
    quantity: string | null;
    unit: string | null;
    supplyItemId: string | null;
    lineStatus: string;
  }>;
}
export type StaffInterpretTargetType = 'task' | 'incident' | 'property';

export interface StaffSubmitInterpretDto {
  entryPoint: StaffInterpretEntryPoint;
  targetType: StaffInterpretTargetType;
  targetId: string;
  text: string;
}

interface InterpretLlmJson {
  intent: string;
  confidence?: number;
  extracted?: {
    items?: Array<{ name: string; quantity?: number | null; unit?: string | null }>;
    staff_facing_summary?: string;
  };
}

const SUPPLY_INTENTS = new Set(['RESTOCK_REQUEST', 'SUPPLY_SHORTAGE', 'LOGISTICS_HANDOFF']);

/** Расходники / логистика / довоз / замена — если LLM вернёт NOTE_ONLY, без подъёма intent запись не попадёт в очередь менеджера (`no_action`). */
const SUPPLY_OR_LOGISTICS_HINTS =
  /бель|полотен|бумаг|шампун|мыл|расход|ершик|стирк|забрать|достав|довоз|замен|комплект|подмен|ввоз|вывоз|курьер|логистик|ключ|no\s+linen|towel|toilet\s+paper|paper|replacement|replenish|supply|stock/i;

/** Сообщения про поломку/ущерб/аварийность — не очередь расходников (как в голосовом miniapp). */
const INCIDENT_LIKE_HINTS =
  /слом|полом|разбил|разбит|разбита|разбито|разбили|тресн|трещин|картин|ущерб|краж|пожар|затоп|задымл|капает|течь|течёт|течет|протеч|инцидент|поврежд|исколот|damage|broken|broke|shatter|cracked|flood|theft|emergency|leak|drip/i;

const EMERGENCY_INCIDENT_HINTS =
  /пожар|задымл|дым|загазов|экстрен|скорая|реаним|угроза\s*жизн|evacuat|evacuation|\b(fire|smoke|emergency|gas\s*leak)\b/i;

const LOST_ITEM_HINTS = /утеря|потерял|потеряла|пропал|пропала|missing\b|\blost\s+item/i;

const RULE_VIOLATION_HINTS = /нарушен|нарушила|агрессив|драк|шумов|rule\s*violat/i;

@Injectable()
export class StaffInterpretationService {
  private readonly logger = new Logger(StaffInterpretationService.name);

  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentRepo: Repository<IncidentEntity>,
    @InjectRepository(StaffInterpretationEventEntity)
    private readonly eventRepo: Repository<StaffInterpretationEventEntity>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    private readonly propertyService: PropertyService,
    private readonly userService: UserService,
    private readonly tasksGateway: TasksGateway,
    @Inject(forwardRef(() => IncidentsService))
    private readonly incidentsService: IncidentsService,
    private readonly supplyCatalog: SupplyCatalogService,
    private readonly deliveryRoutesService: DeliveryRoutesService,
  ) {}

  async submitText(
    staffUserId: string,
    role: string,
    dto: StaffSubmitInterpretDto,
  ): Promise<{ id: string; createdAt: string; llmStatus: string }> {
    if (role !== 'STAFF') {
      throw new ForbiddenException();
    }
    const ep = dto.entryPoint?.trim();
    if (ep !== 'history_supplement') {
      throw new BadRequestException('Unsupported entryPoint');
    }
    const targetType = dto.targetType?.trim() as StaffInterpretTargetType;
    if (targetType !== 'task' && targetType !== 'incident' && targetType !== 'property') {
      throw new BadRequestException('targetType must be task, incident, or property');
    }
    const targetId = dto.targetId?.trim();
    const text = dto.text?.trim() ?? '';
    if (text.length < 3) {
      throw new BadRequestException('Text too short');
    }
    if (text.length > 8000) {
      throw new BadRequestException('Text too long');
    }

    let propertyId: string;
    let companyId: string;

    if (targetType === 'task') {
      const task = await this.taskRepo.findOne({
        where: { id: targetId },
        relations: ['property'],
      });
      if (!task) throw new NotFoundException('Task not found');
      if (task.assigneeId !== staffUserId) throw new ForbiddenException();
      propertyId = task.propertyId;
      companyId = task.companyId;
      await this.tasksService.addNote(targetId, staffUserId, 'STAFF', text, null);
    } else if (targetType === 'property') {
      const property = await this.taskRepo.manager
        .getRepository(PropertyEntity)
        .findOne({ where: { id: targetId } });
      if (!property) throw new NotFoundException('Property not found');
      const hasTask = await this.taskRepo.exist({
        where: { propertyId: property.id, assigneeId: staffUserId },
      });
      if (!hasTask) {
        const onRoute = await this.deliveryRoutesService.isDriverPropertyOnActiveRoute(
          staffUserId,
          property.id,
        );
        if (!onRoute) throw new ForbiddenException();
      }
      propertyId = property.id;
      companyId = property.companyId;
    } else {
      const inc = await this.incidentRepo.findOne({
        where: { id: targetId },
        relations: ['property'],
      });
      if (!inc) throw new NotFoundException('Incident not found');
      if (inc.reportedBy !== staffUserId) throw new ForbiddenException();
      propertyId = inc.propertyId;
      companyId = inc.companyId;
    }

    const persistedTargetId = targetType === 'property' ? propertyId : targetId!;

    const row = this.eventRepo.create({
      authorId: staffUserId,
      entryPoint: ep,
      targetType,
      targetId: persistedTargetId,
      propertyId,
      companyId,
      textRaw: text,
      llmStatus: 'pending',
      workflowState: 'pending_llm',
      llmPayload: null,
      llmError: null,
      processedAt: null,
      skipAutoIncident: false,
      voiceLinkedIncidentId: null,
      createdIncidentId: null,
    });
    const saved = await this.eventRepo.save(row);

    this.scheduleProcess(saved.id);

    return {
      id: saved.id,
      createdAt: saved.createdAt.toISOString(),
      llmStatus: 'pending',
    };
  }

  /**
   * Менеджер: явная карточка довоза/снабжения по объекту (текст или голос → тот же LLM-пайплайн).
   * Без автосоздания инцидента — `createForStaff` не подходит для роли OWNER/MANAGER.
   */
  async queueManagerSupplyCreate(
    actorUserId: string,
    role: string,
    propertyId: string,
    text: string,
  ): Promise<ManagerSupplyInterpretationListItem> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const pid = propertyId?.trim();
    const raw = text?.trim() ?? '';
    if (!pid) {
      throw new BadRequestException('propertyId required');
    }
    if (raw.length < 3) {
      throw new BadRequestException('Text too short');
    }
    if (raw.length > 8000) {
      throw new BadRequestException('Text too long');
    }

    const property = await this.propertyService.findOneForUser(pid, actorUserId, role);

    const row = this.eventRepo.create({
      authorId: actorUserId,
      entryPoint: 'manager_supply_create',
      targetType: 'property',
      targetId: property.id,
      propertyId: property.id,
      companyId: property.companyId,
      textRaw: raw,
      llmStatus: 'pending',
      workflowState: 'pending_llm',
      llmPayload: null,
      llmError: null,
      processedAt: null,
      skipAutoIncident: true,
      voiceLinkedIncidentId: null,
      createdIncidentId: null,
    });
    const saved = await this.eventRepo.save(row);
    this.scheduleProcess(saved.id);

    const full = await this.eventRepo.findOne({
      where: { id: saved.id },
      relations: ['property', 'author', 'supplyItems'],
    });
    if (!full) {
      throw new NotFoundException('Interpretation event not found after create');
    }
    return this.mapEntityToManagerSupplyListItem(full);
  }

  /**
   * После POST /tasks (менеджер): разбор поля `notes` — тот же LLM, без второй заметки.
   * При bulk-создании анализируется первая задача (тот же текст notes для всех).
   */
  async queueFromTaskCreate(actorUserId: string, role: string, taskId: string, notesText: string): Promise<void> {
    if (role !== 'OWNER' && role !== 'MANAGER') return;
    const text = notesText.trim();
    if (text.length < 3) return;

    const task = await this.taskRepo.findOne({ where: { id: taskId }, relations: ['property'] });
    if (!task) return;
    try {
      await this.propertyService.findOneForUser(task.propertyId, actorUserId, role);
    } catch {
      return;
    }

    const row = this.eventRepo.create({
      authorId: actorUserId,
      entryPoint: 'task_create',
      targetType: 'task',
      targetId: taskId,
      propertyId: task.propertyId,
      companyId: task.companyId,
      textRaw: text,
      llmStatus: 'pending',
      workflowState: 'pending_llm',
      llmPayload: null,
      llmError: null,
      processedAt: null,
      skipAutoIncident: false,
      voiceLinkedIncidentId: null,
      createdIncidentId: null,
    });
    const saved = await this.eventRepo.save(row);
    this.scheduleProcess(saved.id);
  }

  /**
   * Голосовой отчёт по задаче (miniapp): заметка уже сохранена в `TasksService.staffMiniappVoiceSubmit` —
   * здесь только событие для LLM / очереди снабжения, без второй заметки.
   */
  async queueFromVoiceTaskReport(
    staffUserId: string,
    taskId: string,
    textRaw: string,
    opts?: { skipAutoIncident?: boolean; voiceLinkedIncidentId?: string | null },
  ): Promise<void> {
    const text = textRaw.trim();
    if (text.length < 3 || text.length > 8000) return;

    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['property'],
    });
    if (!task) return;
    if (task.assigneeId !== staffUserId) {
      throw new ForbiddenException();
    }

    const linked =
      typeof opts?.voiceLinkedIncidentId === 'string' && opts.voiceLinkedIncidentId.trim()
        ? opts.voiceLinkedIncidentId.trim()
        : null;

    const row = this.eventRepo.create({
      authorId: staffUserId,
      entryPoint: 'voice_task_report',
      targetType: 'task',
      targetId: taskId,
      propertyId: task.propertyId,
      companyId: task.companyId,
      textRaw: text,
      llmStatus: 'pending',
      workflowState: 'pending_llm',
      llmPayload: null,
      llmError: null,
      processedAt: null,
      skipAutoIncident: opts?.skipAutoIncident === true,
      voiceLinkedIncidentId: linked,
      createdIncidentId: null,
    });
    const saved = await this.eventRepo.save(row);
    this.scheduleProcess(saved.id);
  }

  /** Голос с экрана маршрута: привязка к объекту, без задачи уборки. */
  async queueFromVoicePropertyReport(
    staffUserId: string,
    propertyId: string,
    textRaw: string,
    opts?: { skipAutoIncident?: boolean; voiceLinkedIncidentId?: string | null },
  ): Promise<void> {
    const text = textRaw.trim();
    if (text.length < 3 || text.length > 8000) return;

    const property = await this.taskRepo.manager
      .getRepository(PropertyEntity)
      .findOne({ where: { id: propertyId } });
    if (!property) return;

    const hasTask = await this.taskRepo.exist({
      where: { propertyId: property.id, assigneeId: staffUserId },
    });
    if (!hasTask) {
      const onRoute = await this.deliveryRoutesService.isDriverPropertyOnActiveRoute(staffUserId, property.id);
      if (!onRoute) throw new ForbiddenException();
    }

    const linked =
      typeof opts?.voiceLinkedIncidentId === 'string' && opts.voiceLinkedIncidentId.trim()
        ? opts.voiceLinkedIncidentId.trim()
        : null;

    const row = this.eventRepo.create({
      authorId: staffUserId,
      entryPoint: 'voice_task_report',
      targetType: 'property',
      targetId: property.id,
      propertyId: property.id,
      companyId: property.companyId,
      textRaw: text,
      llmStatus: 'pending',
      workflowState: 'pending_llm',
      llmPayload: null,
      llmError: null,
      processedAt: null,
      skipAutoIncident: opts?.skipAutoIncident === true,
      voiceLinkedIncidentId: linked,
      createdIncidentId: null,
    });
    const saved = await this.eventRepo.save(row);
    this.scheduleProcess(saved.id);
  }

  async listPendingSupplyForManager(
    actorUserId: string,
    role: string,
    limit = 50,
  ): Promise<ManagerSupplyInterpretationListItem[]> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const ownerId = await this.userService.resolveTenantOwnerId(actorUserId, role);
    const take = Math.min(Math.max(1, limit), 100);

    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .innerJoinAndSelect('e.property', 'p')
      .leftJoinAndSelect('e.supplyItems', 'si')
      .leftJoinAndSelect('e.author', 'a')
      .leftJoin(TaskEntity, 'task', 'task.id = e.targetId AND e.targetType = :taskT', { taskT: 'task' })
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('e.workflowState IN (:...ws1)', { ws1: ['pending_manager', 'manual_review'] })
            .orWhere('e.workflowState = :wsLlm', { wsLlm: 'pending_llm' })
            .orWhere(
              new Brackets((qb2) => {
                qb2
                  .where('e.workflowState = :ack', { ack: 'manager_acknowledged' })
                  .andWhere(
                    `EXISTS (SELECT 1 FROM supply_request_items sri2 WHERE sri2."interpretationEventId" = e.id AND sri2."lineStatus" IN ('pending', 'handed_to_driver'))`,
                  );
              }),
            );
        }),
      )
      .andWhere(
        new Brackets((qb) => {
          qb.where('e.targetType != :tt', { tt: 'task' })
            .orWhere('task.id IS NULL')
            .orWhere('task.status != :done', { done: 'done' })
            .orWhere(
              `EXISTS (SELECT 1 FROM supply_request_items sri_open WHERE sri_open."interpretationEventId" = e.id AND sri_open."lineStatus" IN ('pending', 'handed_to_driver'))`,
            );
        }),
      )
      .orderBy('e.workflowState', 'ASC')
      .addOrderBy('e.createdAt', 'DESC')
      .take(take)
      .getMany();

    return rows.map((e) => this.mapEntityToManagerSupplyListItem(e));
  }

  /**
   * Разделение очереди для UI: текст staff уходит в тот же LLM, что и цепочка interpret-text;
   * при споре «поломка vs довоз» приоритет у признаков инцидента в сыром тексте.
   */
  private managerBucketForManagerList(
    textRaw: string,
    intentFromPayload: string,
    itemCount: number,
    entryPoint?: string,
  ): { managerBucket: 'supply' | 'incident'; llmIntent: string | null } {
    const ep = entryPoint?.trim();
    if (ep === 'manager_supply_create') {
      const intent = intentFromPayload.trim();
      return { managerBucket: 'supply', llmIntent: intent || null };
    }
    const intent = intentFromPayload.trim();
    const lower = textRaw.trim().toLowerCase();
    const textIncident = INCIDENT_LIKE_HINTS.test(lower);
    const textSupply = SUPPLY_OR_LOGISTICS_HINTS.test(lower);

    let managerBucket: 'supply' | 'incident';
    if (textIncident && !textSupply) {
      managerBucket = 'incident';
    } else if (textIncident && textSupply) {
      managerBucket = 'incident';
    } else if (textSupply) {
      managerBucket = 'supply';
    } else if (SUPPLY_INTENTS.has(intent)) {
      managerBucket = 'supply';
    } else if (intent === 'INCIDENT_FOLLOWUP' || intent === 'NEEDS_CLARIFICATION') {
      managerBucket = 'incident';
    } else if (itemCount > 0) {
      managerBucket = 'supply';
    } else {
      managerBucket = 'incident';
    }

    return { managerBucket, llmIntent: intent || null };
  }

  private mapEntityToManagerSupplyListItem(e: StaffInterpretationEventEntity): ManagerSupplyInterpretationListItem {
    const items = [...(e.supplyItems ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        supplyItemId: i.supplyItemId ?? null,
        lineStatus: i.lineStatus ?? 'pending',
      }));
    const intentFromPayload =
      e.llmPayload && typeof e.llmPayload['intent'] === 'string'
        ? String(e.llmPayload['intent']).trim()
        : '';
    const { managerBucket, llmIntent } = this.managerBucketForManagerList(
      e.textRaw,
      intentFromPayload,
      items.length,
      e.entryPoint,
    );
    return {
      id: e.id,
      entryPoint: e.entryPoint,
      targetType: e.targetType,
      targetId: e.targetId,
      propertyId: e.propertyId,
      textRaw: e.textRaw,
      propertyTitle: e.property?.name ?? '',
      authorName: e.author ? `${e.author.firstName} ${e.author.lastName}`.trim() : '',
      createdAt: e.createdAt.toISOString(),
      llmStatus: e.llmStatus,
      workflowState: e.workflowState,
      llmError: e.llmError ? e.llmError.slice(0, 500) : null,
      llmIntent,
      managerBucket,
      items,
    };
  }

  /**
   * Manager closes a queue item (`pending_manager` after LLM, or `manual_review` after LLM failure).
   * Does not create logistics tasks — marks review outcome only.
   */
  async resolveManagerQueueItem(
    actorUserId: string,
    role: string,
    eventId: string,
    action: 'acknowledge' | 'dismiss',
  ): Promise<{ id: string; workflowState: string }> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const ownerId = await this.userService.resolveTenantOwnerId(actorUserId, role);
    const ev = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['property'],
    });
    if (!ev) throw new NotFoundException();
    if (ev.property.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    if (ev.workflowState !== 'pending_manager' && ev.workflowState !== 'manual_review') {
      throw new BadRequestException('Event is not awaiting manager review');
    }
    ev.workflowState = action === 'dismiss' ? 'manager_dismissed' : 'manager_acknowledged';
    await this.eventRepo.save(ev);
    this.tasksGateway.emitSupplyInterpretationsChanged();
    return { id: ev.id, workflowState: ev.workflowState };
  }

  /** Повторный асинхронный прогон LLM для записи после сбоя (`manual_review`). */
  async retryLlmForManager(
    actorUserId: string,
    role: string,
    eventId: string,
  ): Promise<{ id: string; llmStatus: string }> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const ownerId = await this.userService.resolveTenantOwnerId(actorUserId, role);
    const ev = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['property'],
    });
    if (!ev) throw new NotFoundException();
    if (ev.property.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    if (ev.workflowState !== 'manual_review') {
      throw new BadRequestException('Only failed interpretations can be retried');
    }

    await this.dataSource.transaction(async (m: EntityManager) => {
      await m.delete(SupplyRequestItemEntity, { interpretationEventId: eventId });
      await m.getRepository(StaffInterpretationEventEntity).update(eventId, {
        llmPayload: null,
        llmError: null,
        llmStatus: 'pending',
        workflowState: 'pending_llm',
        processedAt: null,
        createdIncidentId: null,
      });
    });

    this.scheduleProcess(eventId);
    return { id: eventId, llmStatus: 'pending' };
  }

  private scheduleProcess(eventId: string): void {
    setImmediate(() => {
      void this.processEventAsync(eventId).catch((e) =>
        this.logger.error(`interpret process ${eventId}: ${(e as Error).message}`),
      );
    });
  }

  private async processEventAsync(eventId: string): Promise<void> {
    const take = await this.eventRepo.update(
      { id: eventId, workflowState: 'pending_llm' },
      { llmStatus: 'processing' },
    );
    if (!take.affected) return;

    const ev = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!ev) return;

    let parsed: InterpretLlmJson;
    try {
      parsed = await this.runLlmOrHeuristic(ev.textRaw, ev.companyId);
      parsed = this.correctIncidentOverSupply(parsed, ev.textRaw);
      parsed = this.boostSupplyIntentIfNoteOnly(parsed, ev.textRaw);
      parsed = this.ensureSupplyFallbackItems(parsed, ev);
    } catch (e) {
      const msg = (e as Error).message;
      await this.eventRepo.update(eventId, {
        llmStatus: 'failed',
        llmError: msg.slice(0, 2000),
        workflowState: 'manual_review',
        processedAt: new Date(),
      });
      this.tasksGateway.emitSupplyInterpretationsChanged();
      return;
    }

    let workflowState = this.mapWorkflowState(parsed.intent);
    let createdIncidentId: string | null = ev.createdIncidentId;
    let llmError: string | null = null;

    const description = (
      parsed.extracted?.staff_facing_summary?.trim() || ev.textRaw
    )
      .trim()
      .slice(0, 8000);

    const tryStaffIncident =
      parsed.intent === 'INCIDENT_FOLLOWUP' &&
      !ev.skipAutoIncident &&
      ev.entryPoint !== 'task_create';

    if (tryStaffIncident) {
      if (ev.targetType === 'task') {
        const linkedId =
          typeof ev.voiceLinkedIncidentId === 'string' && ev.voiceLinkedIncidentId.trim()
            ? ev.voiceLinkedIncidentId.trim()
            : null;
        if (linkedId) {
          createdIncidentId = linkedId;
          workflowState = 'converted_incident';
        } else {
          try {
            const dto = await this.incidentsService.createForStaff(ev.authorId, {
              type: this.inferIncidentTypeFromText(ev.textRaw),
              propertyId: ev.propertyId,
              taskId: ev.targetId,
              description:
                description.length > 0 ? description : 'Инцидент (сообщение сотрудника)',
              photoUrls: [],
            });
            createdIncidentId = dto.uuid;
            workflowState = 'converted_incident';
          } catch (e) {
            const msg = (e as Error).message;
            this.logger.error(`interpret ${eventId} createForStaff: ${msg}`, (e as Error).stack);
            workflowState = 'manual_review';
            llmError = `incident_create: ${msg}`.slice(0, 2000);
          }
        }
      } else if (ev.targetType === 'incident') {
        try {
          await this.appendStaffSupplementToIncident(ev.targetId, ev.authorId, description);
          createdIncidentId = ev.targetId;
          workflowState = 'converted_incident';
        } catch (e) {
          const msg = (e as Error).message;
          this.logger.error(`interpret ${eventId} append incident: ${msg}`);
          workflowState = 'manual_review';
          llmError = `incident_append: ${msg}`.slice(0, 2000);
        }
      } else if (ev.targetType === 'property') {
        const linkedId =
          typeof ev.voiceLinkedIncidentId === 'string' && ev.voiceLinkedIncidentId.trim()
            ? ev.voiceLinkedIncidentId.trim()
            : null;
        if (linkedId) {
          createdIncidentId = linkedId;
          workflowState = 'converted_incident';
        } else {
          try {
            const dto = await this.incidentsService.createForStaff(ev.authorId, {
              type: this.inferIncidentTypeFromText(ev.textRaw),
              propertyId: ev.propertyId,
              taskId: null,
              description:
                description.length > 0 ? description : 'Инцидент (сообщение сотрудника, маршрут)',
              photoUrls: [],
            });
            createdIncidentId = dto.uuid;
            workflowState = 'converted_incident';
          } catch (e) {
            const msg = (e as Error).message;
            this.logger.error(`interpret ${eventId} createForStaff property: ${msg}`, (e as Error).stack);
            workflowState = 'manual_review';
            llmError = `incident_create: ${msg}`.slice(0, 2000);
          }
        }
      }
    }

    /** Голосовой submit уже создал инцидент; при skipAutoIncident LLM не заходил в tryStaffIncident — проставляем связь. */
    const linkedPersist =
      typeof ev.voiceLinkedIncidentId === 'string' && ev.voiceLinkedIncidentId.trim()
        ? ev.voiceLinkedIncidentId.trim()
        : null;
    if (
      !createdIncidentId &&
      linkedPersist &&
      ev.entryPoint === 'voice_task_report' &&
      parsed.intent === 'INCIDENT_FOLLOWUP'
    ) {
      createdIncidentId = linkedPersist;
    }

    ev.llmPayload = parsed as unknown as Record<string, unknown>;
    ev.llmStatus = 'done';
    ev.workflowState = workflowState;
    ev.processedAt = new Date();
    ev.llmError = llmError;
    ev.createdIncidentId = createdIncidentId;

    const rawItems = parsed.extracted?.items?.filter((x) => x?.name?.trim()) ?? [];

    const savedSupplyLineIds: string[] = [];
    const persistSupplyLines =
      rawItems.length > 0 &&
      (SUPPLY_INTENTS.has(parsed.intent) || ev.entryPoint === 'manager_supply_create');

    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.delete(SupplyRequestItemEntity, { interpretationEventId: ev.id });
      if (persistSupplyLines) {
        for (let i = 0; i < rawItems.length; i++) {
          const it = rawItems[i]!;
          const nm = it.name.trim().slice(0, 500);
          const row = manager.create(SupplyRequestItemEntity, {
            interpretationEventId: ev.id,
            sortOrder: i,
            name: nm,
            llmRawName: nm,
            supplyItemId: null,
            quantity:
              it.quantity != null && Number.isFinite(Number(it.quantity))
                ? String(Number(it.quantity))
                : null,
            unit: it.unit?.trim()?.slice(0, 32) || null,
            trafficLight: null,
            lineStatus: 'pending',
          });
          const saved = await manager.save(row);
          savedSupplyLineIds.push(saved.id);
        }
      }
      await manager.save(ev);
    });

    if (savedSupplyLineIds.length > 0) {
      await this.supplyCatalog.applyResolutionToRequestLines(ev.companyId, savedSupplyLineIds);
    }

    this.tasksGateway.emitSupplyInterpretationsChanged();
  }

  private inferIncidentTypeFromText(textRaw: string): IncidentType {
    const lower = textRaw.trim().toLowerCase();
    if (EMERGENCY_INCIDENT_HINTS.test(lower)) return 'emergency';
    if (LOST_ITEM_HINTS.test(lower)) return 'lost_item';
    if (RULE_VIOLATION_HINTS.test(lower)) return 'rule_violation';
    if (INCIDENT_LIKE_HINTS.test(lower)) return 'damage';
    return 'task_report';
  }

  private async appendStaffSupplementToIncident(
    incidentId: string,
    staffId: string,
    addition: string,
  ): Promise<void> {
    const row = await this.incidentRepo.findOne({
      where: { id: incidentId },
      relations: ['property'],
    });
    if (!row) throw new NotFoundException('Incident not found');
    if (row.reportedBy !== staffId) throw new ForbiddenException();
    const add = addition.trim();
    if (!add) return;
    const base = (row.description || '').trim();
    row.description = (base ? `${base}\n\n${add}` : add).slice(0, 20000);
    await this.incidentRepo.save(row);
    this.tasksGateway.emitIncidentUpdated({
      incidentId: row.id,
      propertyOwnerId: row.property.ownerId,
    });
  }

  private mapWorkflowState(intent: string): string {
    if (SUPPLY_INTENTS.has(intent)) return 'pending_manager';
    if (intent === 'INCIDENT_FOLLOWUP') return 'pending_manager';
    if (intent === 'NEEDS_CLARIFICATION') return 'pending_manager';
    return 'no_action';
  }

  /**
   * Если модель перепутала поломку/ущерб с довозом — приоритет как у голосового отчёта: инцидент, не снабжение.
   */
  private correctIncidentOverSupply(parsed: InterpretLlmJson, textRaw: string): InterpretLlmJson {
    const t = textRaw.trim();
    if (!t) return parsed;
    const lower = t.toLowerCase();
    if (!INCIDENT_LIKE_HINTS.test(lower)) return parsed;
    const intent = (parsed.intent || '').trim();
    if (!SUPPLY_INTENTS.has(intent)) return parsed;
    const summary =
      parsed.extracted?.staff_facing_summary?.trim() || t.slice(0, 300);
    return {
      ...parsed,
      intent: 'INCIDENT_FOLLOWUP',
      confidence: Math.max(Number(parsed.confidence) || 0, 0.82),
      extracted: {
        items: [],
        staff_facing_summary: summary,
      },
    };
  }

  /**
   * Если модель вернула NOTE_ONLY, а текст явно про снабжение/логистику (напр. «довоз замены»),
   * переводим в LOGISTICS_HANDOFF и добавляем строку в items — иначе workflowState = no_action.
   */
  private boostSupplyIntentIfNoteOnly(parsed: InterpretLlmJson, textRaw: string): InterpretLlmJson {
    const t = textRaw.trim();
    if (!t) return parsed;
    const intent = (parsed.intent || 'NOTE_ONLY').trim();
    if (intent !== 'NOTE_ONLY') return parsed;
    const lower = t.toLowerCase();
    if (INCIDENT_LIKE_HINTS.test(lower)) return parsed;
    if (!SUPPLY_OR_LOGISTICS_HINTS.test(lower)) return parsed;
    const existing = parsed.extracted?.items?.filter((x) => x?.name?.trim()) ?? [];
    return {
      ...parsed,
      intent: 'LOGISTICS_HANDOFF',
      confidence: Math.max(Number(parsed.confidence) || 0, 0.55),
      extracted: {
        items:
          existing.length > 0
            ? existing
            : [{ name: t.slice(0, 200), quantity: null, unit: null }],
        staff_facing_summary:
          parsed.extracted?.staff_facing_summary?.trim() || t.slice(0, 300),
      },
    };
  }

  /**
   * Строка в пуле снабжения должна появляться всегда, если менеджер/модель указали довоз,
   * но не выделили позиции (или номенклатуры нет в каталоге — модель могла вернуть пустой items).
   * Иначе «ваза» и прочие произвольные названия не попадают в матрицу.
   */
  private ensureSupplyFallbackItems(parsed: InterpretLlmJson, ev: StaffInterpretationEventEntity): InterpretLlmJson {
    const t = ev.textRaw.trim();
    if (t.length < 3) return parsed;

    const named = parsed.extracted?.items?.filter((x) => x?.name?.trim()) ?? [];
    if (named.length > 0) {
      return { ...parsed, extracted: { ...parsed.extracted, items: named } };
    }

    const fallback = {
      name: this.fallbackSupplyLineName(t),
      quantity: null as number | null,
      unit: null as string | null,
    };

    if (ev.entryPoint === 'manager_supply_create') {
      const intentIn = (parsed.intent || 'NOTE_ONLY').trim();
      const intentOut = SUPPLY_INTENTS.has(intentIn) ? intentIn : 'LOGISTICS_HANDOFF';
      return {
        ...parsed,
        intent: intentOut,
        confidence: Math.max(Number(parsed.confidence) || 0, 0.5),
        extracted: {
          ...parsed.extracted,
          items: [fallback],
          staff_facing_summary: parsed.extracted?.staff_facing_summary?.trim() || t.slice(0, 300),
        },
      };
    }

    if (SUPPLY_INTENTS.has((parsed.intent || '').trim())) {
      return {
        ...parsed,
        extracted: {
          ...parsed.extracted,
          items: [fallback],
          staff_facing_summary: parsed.extracted?.staff_facing_summary?.trim() || t.slice(0, 300),
        },
      };
    }

    return parsed;
  }

  private fallbackSupplyLineName(textRaw: string): string {
    const t = textRaw.trim();
    if (!t) return 'Позиция';
    const firstLine = t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return (firstLine ?? t).slice(0, 500);
  }

  private getDeepseek(): { client: OpenAI; model: string } | null {
    const key = this.configService.get<string>('DEEPSEEK_API_KEY')?.trim();
    if (!key) return null;
    const base = this.configService.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
    const model = this.configService.get<string>('VOICE_PARSE_LLM_MODEL') || 'deepseek-chat';
    return { client: new OpenAI({ apiKey: key, baseURL: base }), model };
  }

  private async runLlmOrHeuristic(text: string, companyId?: string): Promise<InterpretLlmJson> {
    const llm = this.getDeepseek();
    if (!llm) {
      return this.heuristicParse(text);
    }

    let catalogFragment = '';
    if (companyId) {
      try {
        catalogFragment = await this.supplyCatalog.getCatalogPromptFragment(companyId);
      } catch (err) {
        this.logger.warn(`catalog prompt fragment: ${(err as Error).message}`);
      }
    }

    const system = `You classify staff free-text for a property management app (same priorities as voice reports). Reply JSON only, no markdown.
Fields:
- "intent": one of INCIDENT_FOLLOWUP | RESTOCK_REQUEST | SUPPLY_SHORTAGE | LOGISTICS_HANDOFF | NEEDS_CLARIFICATION | NOTE_ONLY
  - RESTOCK_REQUEST / SUPPLY_SHORTAGE: missing consumables only (toilet paper, towels, shampoo, soap, linens).
  - LOGISTICS_HANDOFF: pickup/delivery of supplies or keys, laundry rounds, trash removal — e.g. Russian: довоз белья, замена комплекта расходников, забрать/привезти ключи, стирка, вывоз мусора. NOT for broken fixtures or damaged decor.
  - INCIDENT_FOLLOWUP: damage, breakage, leaks, smoke, theft, emergency, guest conflict, anything unsafe or requiring repair beyond restocking. Russian examples that MUST be INCIDENT_FOLLOWUP (never supply): "разбилась картина", "капает вода с крана", "задымление", "сломался замок", "трещина на стекле".
  - NOTE_ONLY: neutral note with no supply, logistics, or incident.
- "confidence": number 0..1
- "extracted": { "items": [ { "name": string, "quantity": number or null, "unit": string or null } ], "staff_facing_summary": string }
Rules:
- If the message describes broken, shattered, leaking, or damaged property or items → INCIDENT_FOLLOWUP even if they also say "нужна замена" (replacement after damage is still incident follow-up for the manager queue).
- Use Russian or English in staff_facing_summary matching the input language.
- Prefer LOGISTICS_HANDOFF over NOTE_ONLY only when the text is clearly about delivery/restock/logistics, not damage.${catalogFragment}`;

    const user = `Staff message:\n"""${text.replace(/"""/g, '"')}"""`;

    let completion;
    try {
      completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });
    } catch {
      completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });
    }

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return this.heuristicParse(text);
    }
    try {
      const j = JSON.parse(raw) as InterpretLlmJson;
      if (!j.intent) {
        j.intent = 'NOTE_ONLY';
      }
      return j;
    } catch {
      return this.heuristicParse(text);
    }
  }

  private heuristicParse(text: string): InterpretLlmJson {
    const lower = text.toLowerCase();

    let intent: InterpretLlmJson['intent'] = 'NOTE_ONLY';
    if (INCIDENT_LIKE_HINTS.test(lower)) intent = 'INCIDENT_FOLLOWUP';
    else if (SUPPLY_OR_LOGISTICS_HINTS.test(lower)) intent = 'RESTOCK_REQUEST';

    const items: NonNullable<InterpretLlmJson['extracted']>['items'] = [];
    if (
      intent !== 'INCIDENT_FOLLOWUP' &&
      (intent === 'RESTOCK_REQUEST' || intent === 'SUPPLY_SHORTAGE' || intent === 'LOGISTICS_HANDOFF')
    ) {
      items.push({ name: text.trim().slice(0, 200), quantity: null, unit: null });
    }

    return {
      intent,
      confidence: 0.4,
      extracted: {
        items,
        staff_facing_summary: text.trim().slice(0, 300),
      },
    };
  }
}

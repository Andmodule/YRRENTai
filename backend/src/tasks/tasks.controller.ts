import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { addDays, format } from 'date-fns';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TasksService, type StaffMiniAppVoiceSubmitDto } from './tasks.service';
import { StaffInterpretationService } from './staff-interpretation.service';
import { SupplyCatalogService } from './supply-catalog.service';
import { DeliveryRoutesService } from './delivery-routes.service';
import { ChecklistService } from './checklist.service';
import { UserService } from '../user/user.service';
import { IncidentsService } from '../incidents/incidents.service';
import type { IncidentType } from '../incidents/entities/incident.entity';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly staffInterpretationService: StaffInterpretationService,
    private readonly supplyCatalogService: SupplyCatalogService,
    private readonly deliveryRoutesService: DeliveryRoutesService,
    private readonly checklistService: ChecklistService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => IncidentsService))
    private readonly incidentsService: IncidentsService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async list(
    @Query('from') fromParam: string | undefined,
    @Query('to') toParam: string | undefined,
    @Query('assigneeId') assigneeId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const from = fromParam?.trim() || format(new Date(), 'yyyy-MM-dd');
    const to = toParam?.trim() || format(addDays(new Date(), 7), 'yyyy-MM-dd');

    if (user.role === 'STAFF') {
      const tasks = await this.tasksService.findForStaff(user.sub, from, to);
      return { data: { tasks } };
    }

    if (process.env.NODE_ENV === 'development') {
      await this.tasksService.seedDemoIfEmpty(user.sub, user.role);
    }

    const tasks = await this.tasksService.findForUser(user.sub, user.role, from, to, assigneeId);
    return { data: { tasks } };
  }

  /** Очередь менеджера: после LLM (`pending_manager`) и сбой парсинга (`manual_review`). */
  @Get('manager/supply-interpretations')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyInterpretations(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limitParam?: string,
  ) {
    const n = limitParam ? parseInt(limitParam, 10) : 50;
    const events = await this.staffInterpretationService.listPendingSupplyForManager(
      user.sub,
      user.role,
      Number.isFinite(n) ? n : 50,
    );
    return { data: { events } };
  }

  /** Менеджер: создать запись довоза/снабжения по объекту (текст или расшифровка голоса). */
  @Post('manager/supply-interpretations')
  @Roles('OWNER', 'MANAGER')
  async createManagerSupplyInterpretation(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId?: string; text?: string },
  ) {
    const event = await this.staffInterpretationService.queueManagerSupplyCreate(
      user.sub,
      user.role,
      body?.propertyId ?? '',
      body?.text ?? '',
    );
    return { data: { event } };
  }

  /** Снять запись с очереди менеджера: учтено / не актуально (без создания логистических задач). */
  @Patch('manager/supply-interpretations/:eventId')
  @Roles('OWNER', 'MANAGER')
  async resolveManagerSupplyInterpretation(
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { action?: string },
  ) {
    const action = body?.action?.trim();
    if (action !== 'acknowledge' && action !== 'dismiss') {
      throw new BadRequestException('action must be "acknowledge" or "dismiss"');
    }
    const result = await this.staffInterpretationService.resolveManagerQueueItem(
      user.sub,
      user.role,
      eventId,
      action,
    );
    return { data: result };
  }

  @Post('manager/supply-interpretations/:eventId/retry-llm')
  @Roles('OWNER', 'MANAGER')
  async retryManagerSupplyLlm(
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.staffInterpretationService.retryLlmForManager(
      user.sub,
      user.role,
      eventId,
    );
    return { data: result };
  }

  /** Сводная матрица нехваток по справочнику и объектам. */
  @Get('manager/supply-matrix')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyMatrix(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.supplyCatalogService.getMatrixForOwner(ownerId);
    return { data };
  }

  @Post('manager/supply-matrix/detail-lines')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyMatrixDetail(
    @CurrentUser() user: JwtPayload,
    @Body() body: { requestLineIds?: string[] },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const lines = await this.supplyCatalogService.getRequestLinesDetail(ownerId, body?.requestLineIds ?? []);
    return { data: { lines } };
  }

  /**
   * Передача водителю: по SKU справочника (все pending-строки) и/или по id строк `supply_request_items`
   * (в т.ч. без сопоставления с каталогом).
   */
  @Post('manager/supply-matrix/handoff')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyHandoff(
    @CurrentUser() user: JwtPayload,
    @Body() body: { supplyItemIds?: string[]; requestLineIds?: string[] },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.supplyCatalogService.handoffForOwner(ownerId, {
      supplyItemIds: body?.supplyItemIds,
      requestLineIds: body?.requestLineIds,
    });
    return { data };
  }

  /** Отметить доставленным строки, переданные водителю (`handed_to_driver` → `delivered`). */
  @Post('manager/supply-matrix/mark-delivered')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyMarkDelivered(
    @CurrentUser() user: JwtPayload,
    @Body() body: { requestLineIds?: string[] },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.supplyCatalogService.markDeliveredForOwner(ownerId, body?.requestLineIds ?? []);
    return { data };
  }

  @Get('manager/supply-catalog/items')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyCatalogItems(@CurrentUser() user: JwtPayload) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const items = await this.supplyCatalogService.listItemsForCompany(companyId);
    return { data: { items } };
  }

  @Post('manager/supply-catalog/items')
  @Roles('OWNER', 'MANAGER')
  async managerSupplyCatalogCreate(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; synonyms?: string; defaultUnit?: string | null; category?: string },
  ) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const item = await this.supplyCatalogService.createCustomItem(companyId, user.sub, {
      name: body?.name ?? '',
      synonyms: body?.synonyms ?? '',
      defaultUnit: body?.defaultUnit,
      category: body?.category,
    });
    return { data: { id: item.id, name: item.name } };
  }

  /** Маршрут доставки из выбранных pending-строк (как handoff, но с Route + Stop по объектам). */
  @Post('manager/delivery-routes/from-pool')
  @Roles('OWNER', 'MANAGER')
  async managerDeliveryRoutesFromPool(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      supplyItemIds?: string[];
      requestLineIds?: string[];
      scheduledDate?: string;
      warehouseLabel?: string | null;
    },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const data = await this.deliveryRoutesService.createFromPool(ownerId, companyId, body);
    return { data };
  }

  @Get('manager/delivery-routes')
  @Roles('OWNER', 'MANAGER')
  async managerDeliveryRoutesList(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    /** `active` — без завершённых; `completed` — только завершённые; иначе все. */
    @Query('completion') completionRaw?: string,
  ) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const completion =
      completionRaw === 'active' || completionRaw === 'completed' || completionRaw === 'all'
        ? completionRaw
        : 'all';
    const routes = await this.deliveryRoutesService.listForManagerRange(companyId, from, to, completion);
    return { data: { routes } };
  }

  @Get('manager/delivery-routes/:routeId')
  @Roles('OWNER', 'MANAGER')
  async managerDeliveryRoutesOne(
    @CurrentUser() user: JwtPayload,
    @Param('routeId') routeId: string,
  ) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const route = await this.deliveryRoutesService.getDetailForCompany(routeId, companyId);
    return { data: { route } };
  }

  @Patch('manager/delivery-routes/:routeId/assign-driver')
  @Roles('OWNER', 'MANAGER')
  async managerDeliveryRoutesAssign(
    @CurrentUser() user: JwtPayload,
    @Param('routeId') routeId: string,
    @Body() body: { driverUserId?: string; allowReassignWhileActive?: boolean },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const driverUserId = body?.driverUserId?.trim();
    if (!driverUserId) throw new BadRequestException('driverUserId required');
    const data = await this.deliveryRoutesService.assignDriver(ownerId, companyId, routeId, driverUserId, {
      allowReassignWhileActive: body.allowReassignWhileActive === true,
    });
    return { data };
  }

  /** Расформировать маршрут: строки снабжения снова в пуле, маршрут удаляется (только draft / assigned). */
  @Post('manager/delivery-routes/:routeId/disband')
  @Roles('OWNER', 'MANAGER')
  async managerDeliveryRoutesDisband(@CurrentUser() user: JwtPayload, @Param('routeId') routeId: string) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const data = await this.deliveryRoutesService.disbandRoute(companyId, routeId);
    return { data };
  }

  @Patch('manager/delivery-routes/:routeId/stops/reorder')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async deliveryRoutesReorder(
    @CurrentUser() user: JwtPayload,
    @Param('routeId') routeId: string,
    @Body() body: { orderedPropertyStopIds?: string[] },
  ) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const ids = body?.orderedPropertyStopIds;
    if (!ids?.length) throw new BadRequestException('orderedPropertyStopIds required');
    const data = await this.deliveryRoutesService.reorderStops(companyId, routeId, ids, {
      userId: user.sub,
      role: user.role,
    });
    return { data };
  }

  /** Активный маршрут, назначенный водителю (STAFF). @deprecated Используйте staff/delivery-routes — список всех. */
  @Get('staff/delivery-route/active')
  @Roles('STAFF', 'MANAGER')
  async staffDeliveryRouteActive(@CurrentUser() user: JwtPayload) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const route = await this.deliveryRoutesService.getActiveRouteForDriver(companyId, user.sub);
    return { data: { route } };
  }

  /** Все назначенные и незавершённые маршруты текущего водителя (могут быть несколько за день). */
  @Get('staff/delivery-routes')
  @Roles('STAFF', 'MANAGER')
  async staffDeliveryRoutesList(@CurrentUser() user: JwtPayload) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const routes = await this.deliveryRoutesService.listAllActiveRoutesForDriver(companyId, user.sub);
    return { data: { routes } };
  }

  @Post('delivery-routes/:routeId/start')
  @Roles('STAFF', 'MANAGER')
  async deliveryRoutesStart(@CurrentUser() user: JwtPayload, @Param('routeId') routeId: string) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const data = await this.deliveryRoutesService.startRoute(companyId, routeId, user.sub);
    return { data };
  }

  /** Водитель: следующая остановка-объект (после склада), без статуса «в пути» в БД. */
  @Post('delivery-routes/:routeId/next-stop')
  @Roles('STAFF', 'MANAGER')
  async deliveryRoutesSetNextStop(
    @CurrentUser() user: JwtPayload,
    @Param('routeId') routeId: string,
    @Body() body: { stopId?: string },
  ) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const stopId = body?.stopId?.trim();
    if (!stopId) throw new BadRequestException('stopId required');
    const data = await this.deliveryRoutesService.setDriverNextStop(companyId, routeId, user.sub, stopId);
    return { data };
  }

  @Post('delivery-routes/stops/:stopId/arrive')
  @Roles('STAFF', 'MANAGER')
  async deliveryRoutesStopArrive(@CurrentUser() user: JwtPayload, @Param('stopId') stopId: string) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const data = await this.deliveryRoutesService.arriveStop(companyId, stopId, user.sub);
    return { data };
  }

  @Post('delivery-routes/stops/:stopId/complete')
  @Roles('STAFF', 'MANAGER')
  async deliveryRoutesStopComplete(@CurrentUser() user: JwtPayload, @Param('stopId') stopId: string) {
    const companyId = await this.supplyCatalogService.resolveActorCompanyId(user.sub);
    const data = await this.deliveryRoutesService.completeStop(companyId, stopId, user.sub);
    return { data };
  }

  @Get(':uuid')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async getOne(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    const task = await this.tasksService.getOneForUser(uuid, user.sub, user.role);
    return { data: { task } };
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      /** Prefer: array of property UUIDs (empty = general task → one task on fallback property). */
      propertyIds?: string[];
      /** Legacy single property (same as `propertyIds: [propertyId]`). */
      propertyId?: string;
      title: string;
      type: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      dueTime?: string | null;
      reservationId?: string | null;
      notes?: string;
      /** Links the new task to an incident (single property only); sets task.incidentId and incident dispatch fields. */
      incidentId?: string | null;
    },
  ) {
    let propertyIds: string[];
    if (Array.isArray(body.propertyIds)) {
      propertyIds = [...new Set(body.propertyIds.filter((id) => typeof id === 'string' && id.trim()))];
    } else if (body.propertyId?.trim()) {
      propertyIds = [body.propertyId.trim()];
    } else {
      throw new BadRequestException('propertyId or propertyIds is required');
    }

    const tasks = await this.tasksService.createTasksBulkForManager(user.sub, user.role, {
      propertyIds,
      title: body.title,
      type: body.type,
      priority: body.priority,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      reservationId: body.reservationId,
      notes: body.notes,
      incidentId: body.incidentId,
    });
    return { data: { tasks } };
  }

  /**
   * Voice task: Groq Whisper STT → DeepSeek JSON extraction (`VoiceParseResultDto`).
   */
  @Post('voice-parse')
  @Roles('OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async voiceParse(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('contextPropertyId') contextPropertyId?: string,
    @Body('language') language?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }
    const data = await this.tasksService.voiceParse(
      user.sub,
      user.role,
      file,
      contextPropertyId?.trim(),
      language?.trim(),
    );
    return { data };
  }

  /**
   * Staff Mini App: голос → STT + LLM → черновик отчёта (задача + опционально инцидент).
   */
  @Post('staff-miniapp/voice-preview')
  @Roles('STAFF')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async staffMiniappVoicePreview(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('taskUuid') taskUuid: string | undefined,
    @Body('propertyId') propertyId: string | undefined,
    @Body('buttonPressed') buttonPressed: string | undefined,
    @Body('clarificationText') clarificationText?: string,
    @Body('language') language?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }
    const tid = taskUuid?.trim();
    const pid = propertyId?.trim();
    if (!tid && !pid) {
      throw new BadRequestException('taskUuid or propertyId is required');
    }
    if (tid && pid) {
      throw new BadRequestException('Provide only one of taskUuid or propertyId');
    }
    const bp = buttonPressed?.trim().toUpperCase() === 'INCIDENT' ? 'INCIDENT' : 'TASK';
    const data = await this.tasksService.staffMiniappVoicePreview(
      user.sub,
      user.role,
      file,
      tid,
      bp,
      clarificationText?.trim(),
      language?.trim(),
      pid,
    );
    return { data };
  }

  /** Staff Mini App: только распознавание речи (ответ голосом на уточняющие вопросы). */
  @Post('staff-miniapp/voice-transcribe')
  @Roles('STAFF')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async staffMiniappVoiceTranscribe(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('language') language?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio is required');
    }
    const data = await this.tasksService.staffMiniappVoiceTranscribe(user.role, file, language?.trim());
    return { data };
  }

  /** Подтверждение черновика: обновление задачи + заметка + опционально инцидент. */
  @Post('staff-miniapp/voice-submit')
  @Roles('STAFF')
  async staffMiniappVoiceSubmit(
    @CurrentUser() user: JwtPayload,
    @Body() body: StaffMiniAppVoiceSubmitDto,
  ) {
    const tid = body?.taskUuid?.trim();
    const pid = body?.propertyId?.trim();
    if (!tid && !pid) {
      throw new BadRequestException('taskUuid or propertyId is required');
    }
    if (tid && pid) {
      throw new BadRequestException('Provide only one of taskUuid or propertyId');
    }
    const data = await this.tasksService.staffMiniappVoiceSubmit(user.sub, user.role, {
      ...body,
      taskUuid: tid,
      propertyId: pid,
    });
    return { data };
  }

  /**
   * Staff: доп. текст к задаче/инциденту (История и др.). HTTP отвечает сразу; LLM — асинхронно на бэкенде.
   */
  @Post('staff/interpret-text')
  @Roles('STAFF')
  async staffInterpretText(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      entryPoint?: string;
      targetType?: string;
      targetId?: string;
      text?: string;
    },
  ) {
    const data = await this.staffInterpretationService.submitText(user.sub, user.role, {
      entryPoint: (body.entryPoint ?? 'history_supplement') as 'history_supplement',
      targetType: body.targetType as 'task' | 'incident' | 'property',
      targetId: body.targetId ?? '',
      text: body.text ?? '',
    });
    return { data };
  }

  /** Staff: same handlers as POST /incidents (some dev setups never register IncidentsController). */
  @Post('incidents/upload-photos')
  @Roles('STAFF', 'OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadIncidentPhotos(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<{ data: { photoUrls: string[] } }> {
    if (!files?.length) {
      return { data: { photoUrls: [] } };
    }
    const sessionId = randomUUID();
    const dir = join(process.cwd(), 'uploads', 'incidents', sessionId);
    await fs.mkdir(dir, { recursive: true });
    const apiBase =
      this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.configService.get<number>('PORT', 3010)}`;
    const urls: string[] = [];
    for (const file of files) {
      const name = `${randomUUID()}.jpg`;
      const full = join(dir, name);
      await fs.writeFile(full, file.buffer);
      urls.push(`${apiBase}/uploads/incidents/${sessionId}/${name}`);
    }
    return { data: { photoUrls: urls } };
  }

  @Post('incidents')
  @Roles('STAFF')
  async createIncident(
    @CurrentUser() user: JwtPayload,
    @Body()
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
  ) {
    const incident = await this.incidentsService.createForStaff(user.sub, body);
    return { data: { incident } };
  }

  @Get(':uuid/checklist')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async getChecklist(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    await this.tasksService.ensureTaskAccess(uuid, user.sub, user.role);
    const items = await this.checklistService.listForTask(uuid);
    return { data: { items } };
  }

  @Patch(':uuid/checklist/:itemId')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async patchChecklistItem(
    @Param('uuid') uuid: string,
    @Param('itemId') itemId: string,
    @Body() body: { checked: boolean },
    @CurrentUser() user: JwtPayload,
  ) {
    const item = await this.checklistService.patchItem(
      uuid,
      itemId,
      user.sub,
      user.role,
      !!body.checked,
    );
    return { data: { item } };
  }

  @Get(':uuid/notes')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async listNotes(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    const notes = await this.tasksService.listNotes(uuid, user.sub, user.role);
    return { data: { notes } };
  }

  @Post(':uuid/notes')
  @Roles('STAFF')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async addNote(
    @Param('uuid') uuid: string,
    @Body('text') text: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!text?.trim()) {
      throw new BadRequestException('text is required');
    }
    let photoUrl: string | null = null;
    if (photo?.buffer?.length) {
      const dir = join(process.cwd(), 'uploads', 'task-notes', uuid);
      await fs.mkdir(dir, { recursive: true });
      const name = `${randomUUID()}.jpg`;
      const full = join(dir, name);
      await fs.writeFile(full, photo.buffer);
      const apiBase =
        this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
        `http://localhost:${this.configService.get<number>('PORT', 3010)}`;
      photoUrl = `${apiBase}/uploads/task-notes/${uuid}/${name}`;
    }

    const note = await this.tasksService.addNote(uuid, user.sub, user.role, text.trim(), photoUrl);
    return { data: { note } };
  }

  @Patch(':uuid/seen')
  @Roles('OWNER', 'MANAGER')
  async markSeen(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    const task = await this.tasksService.markManagerSeenRole(uuid, user.sub, user.role);
    return { data: task };
  }

  @Delete(':uuid')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    await this.tasksService.deleteForUser(uuid, user.sub, user.role);
    return { data: { ok: true } };
  }

  @Patch(':uuid')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async patch(
    @Param('uuid') uuid: string,
    @Body()
    body: Partial<{
      status: string;
      assigneeId: string | null;
      notes: string;
      issueDescription: string | null;
      title: string;
      priority: string;
      propertyId: string;
      /** checkout_cleaning | mid_stay_cleaning | checkin_prep | maintenance | other */
      type: string;
      dueDate: string;
      dueTime: string | null;
    }>,
    @Query('forceComplete') forceComplete: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const task = await this.tasksService.update(
      uuid,
      user.sub,
      user.role,
      body,
      forceComplete === 'true',
    );
    return { data: task };
  }

  @Post(':uuid/photos')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadPhotos(
    @Param('uuid') uuid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: JwtPayload,
  ) {
    if (!files?.length) {
      return { data: { photoUrls: [] as string[] } };
    }

    const dir = join(process.cwd(), 'uploads', 'tasks', uuid);
    await fs.mkdir(dir, { recursive: true });

    const apiBase =
      this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.configService.get<number>('PORT', 3010)}`;

    const urls: string[] = [];
    for (const file of files) {
      const name = `${randomUUID()}.jpg`;
      const full = join(dir, name);
      await fs.writeFile(full, file.buffer);
      urls.push(`${apiBase}/uploads/tasks/${uuid}/${name}`);
    }

    const task = await this.tasksService.appendPhotoUrls(uuid, user.sub, user.role, urls);
    return { data: { photoUrls: task.photoUrls } };
  }
}

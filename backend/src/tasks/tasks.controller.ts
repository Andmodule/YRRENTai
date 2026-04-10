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
import { TasksService } from './tasks.service';
import { ChecklistService } from './checklist.service';
import { IncidentsService } from '../incidents/incidents.service';
import type { IncidentType } from '../incidents/entities/incident.entity';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly checklistService: ChecklistService,
    private readonly configService: ConfigService,
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

  /** Staff: same handlers as POST /incidents (some dev setups never register IncidentsController). */
  @Post('incidents/upload-photos')
  @Roles('STAFF')
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

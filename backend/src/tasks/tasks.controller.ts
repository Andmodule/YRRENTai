import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  BadRequestException,
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

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly configService: ConfigService,
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
      await this.tasksService.seedDemoIfEmpty(user.sub);
    }

    const tasks = await this.tasksService.findForUser(user.sub, from, to, assigneeId);
    return { data: { tasks } };
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
    }>,
    @CurrentUser() user: JwtPayload,
  ) {
    const task = await this.tasksService.update(uuid, user.sub, user.role, body);
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

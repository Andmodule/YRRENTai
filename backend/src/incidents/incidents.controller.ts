import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { join } from 'path';
import {
  publicUploadFileExtension,
  STAFF_VERIFICATION_MAX_FILE_BYTES,
} from '../common/multer-upload-filename.util';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { IncidentsService } from './incidents.service';
import type { IncidentStatus, IncidentType } from './entities/incident.entity';
import { UserService } from '../user/user.service';

@ApiTags('Incidents')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  private async ownerScope(user: JwtPayload): Promise<string> {
    return this.userService.resolveTenantOwnerId(user.sub, user.role);
  }

  @Post('upload-photos')
  @Roles('STAFF', 'OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadPhotos(
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

  @Post()
  @Roles('STAFF')
  async create(
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
      suggestedTaskDraft?: unknown;
    },
  ) {
    const incident = await this.incidentsService.createForStaff(user.sub, body);
    return { data: { incident } };
  }

  @Post('manager')
  @Roles('OWNER', 'MANAGER')
  async createFromManager(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      type: IncidentType;
      propertyId: string;
      description: string;
      estimatedCost?: string | null;
      photoUrls?: string[];
    },
  ) {
    const incident = await this.incidentsService.createForManager(user.sub, user.role, body);
    return { data: { incident } };
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('type') type?: IncidentType,
    @Query('status') status?: IncidentStatus,
  ) {
    const ownerId = await this.ownerScope(user);
    const incidents = await this.incidentsService.listForOwner(ownerId, {
      propertyId,
      type,
      status,
    });
    return { data: { incidents } };
  }

  @Get('open-count')
  @Roles('OWNER', 'MANAGER')
  async openCount(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.ownerScope(user);
    const count = await this.incidentsService.countOpenForOwner(ownerId);
    return { data: { count } };
  }

  /** Staff: incidents reported by this user (history; add more photos via POST staff/:uuid/photos). */
  @Get('staff/history')
  @Roles('STAFF')
  async staffHistory(@CurrentUser() user: JwtPayload) {
    const incidents = await this.incidentsService.listForStaffReported(user.sub);
    return { data: { incidents } };
  }

  @Post('staff/:uuid/photos')
  @Roles('STAFF')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: STAFF_VERIFICATION_MAX_FILE_BYTES },
    }),
  )
  async staffAppendPhotos(
    @Param('uuid') uuid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: JwtPayload,
  ) {
    if (!files?.length) {
      throw new BadRequestException('No files: multipart part "files" is missing or empty');
    }

    const dir = join(process.cwd(), 'uploads', 'incidents', uuid);
    await fs.mkdir(dir, { recursive: true });

    const apiBase =
      this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.configService.get<number>('PORT', 3010)}`;

    const urls: string[] = [];
    for (const file of files) {
      const ext = publicUploadFileExtension(file);
      const name = `${randomUUID()}.${ext}`;
      const full = join(dir, name);
      await fs.writeFile(full, file.buffer);
      urls.push(`${apiBase}/uploads/incidents/${uuid}/${name}`);
    }

    const incident = await this.incidentsService.appendPhotoUrlsForStaff(uuid, user.sub, urls);
    return { data: { photoUrls: incident.photoUrls } };
  }

  @Post(':uuid/dispatch')
  @Roles('OWNER', 'MANAGER')
  async dispatch(
    @Param('uuid') uuid: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { assigneeId: string },
  ) {
    const incident = await this.incidentsService.dispatchMaintenanceTask(
      uuid,
      user.sub,
      user.role,
      body.assigneeId,
    );
    return { data: { incident } };
  }

  @Get(':uuid')
  @Roles('OWNER', 'MANAGER')
  async one(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    const ownerId = await this.ownerScope(user);
    const incident = await this.incidentsService.findOneForOwner(uuid, ownerId);
    return { data: { incident } };
  }

  @Patch(':uuid')
  @Roles('OWNER', 'MANAGER')
  async patch(
    @Param('uuid') uuid: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: Partial<{
      status: IncidentStatus;
      managerNote: string | null;
      estimatedCost: string | null;
      appendPhotoUrls: string[];
    }>,
  ) {
    const ownerId = await this.ownerScope(user);
    const incident = await this.incidentsService.patchForOwner(uuid, ownerId, user.sub, body);
    return { data: { incident } };
  }
}

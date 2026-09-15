import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import { PropertyService } from '../../property/property.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { UserService } from '../../user/user.service';
import { mapRoomRatesToPropertyPreview } from './zodomus-property-preview.util';
import { formatZodomusHttpException } from './zodomus-status.util';

@ApiTags('Zodomus')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('integrations/zodomus')
export class ZodomusController {
  constructor(
    private readonly zodomus: ZodomusService,
    private readonly zodomusSync: ZodomusSyncService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly propertyService: PropertyService,
    private readonly userService: UserService,
  ) {}

  /**
   * Превью листинга по внешнему property id Zodomus (до создания объекта в RentAI).
   * GET /room-rates → название/адрес (если есть) + комнаты, тарифы по комнатам, выбор zodomusRoomId.
   */
  @Get('property-preview')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async propertyPreview(
    @Query('channelId') channelIdParam: string,
    @Query('externalPropertyId') externalPropertyId: string,
  ) {
    if (!this.zodomus.isEnabled) {
      return { data: { status: 'disabled' as const } };
    }
    const channelId = Number(channelIdParam);
    const ext = externalPropertyId?.trim();
    if (!ext || !Number.isFinite(channelId)) {
      throw new BadRequestException('channelId and externalPropertyId are required');
    }
    try {
      const raw = await this.zodomus.getRoomRatesRaw(channelId, ext);
      const preview = mapRoomRatesToPropertyPreview(raw, ext);
      return { data: preview };
    } catch (e: unknown) {
      if (e instanceof HttpException) {
        const hint = formatZodomusHttpException(e).toLowerCase();
        if (hint.includes('invalid property')) {
          throw new BadRequestException(
            'ZODOMUS_INVALID_PROPERTY_ID: Use the external property id for this channel (not the room id). Check Zodomus backoffice or your OTA extranet.',
          );
        }
      }
      throw e;
    }
  }

  @Get('status')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async status() {
    if (!this.zodomus.isEnabled) {
      return { data: { status: 'disabled' as const } };
    }
    const account = await this.zodomus.getAccount();
    return { data: { status: 'ok' as const, account } };
  }

  @Post('sync')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async sync(
    @CurrentUser() user: JwtPayload,
    @Body() body: { channelId: number; propertyId: string; force?: boolean },
  ) {
    const channelId = Number(body.channelId);
    const propertyId = body.propertyId?.trim();
    if (!propertyId || !Number.isFinite(channelId)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const force = Boolean(body.force);
    const result =
      user.role === 'SUPERADMIN'
        ? await this.zodomusSync.syncQueueForPropertyAdmin(propertyId, channelId, force)
        : await this.zodomusSync.syncQueueForProperty(
            await this.userService.resolveTenantOwnerId(user.sub, user.role),
            propertyId,
            channelId,
            force,
          );
    return { data: result };
  }

  /** Синхронизация очереди для всех объектов владельца с привязкой Zodomus. */
  @Post('sync-all')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async syncAll(@CurrentUser() user: JwtPayload, @Body() body: { channelId?: number; force?: boolean }) {
    const channelId = Number(body?.channelId ?? 1);
    if (!Number.isFinite(channelId)) {
      throw new BadRequestException('channelId must be a number');
    }
    const force = Boolean(body.force);
    const result =
      user.role === 'SUPERADMIN'
        ? await this.zodomusSync.syncAllProperties(channelId, force)
        : await this.zodomusSync.syncAllForUser(
            await this.userService.resolveTenantOwnerId(user.sub, user.role),
            channelId,
            force,
          );
    return { data: result };
  }

  /**
   * Refresh persisted Zodomus listing status for one property or all owner-linked properties.
   * Probes POST /property-check (not the reservation queue) and stores zodomusStatus.
   */
  @Post('refresh-status')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async refreshStatus(
    @CurrentUser() user: JwtPayload,
    @Body() body: { channelId?: number; propertyId?: string },
  ) {
    if (!this.zodomus.isEnabled) {
      return { data: { status: 'disabled' as const, checked: 0, results: [] } };
    }
    const channelId = Number(body?.channelId ?? 1);
    if (!Number.isFinite(channelId)) {
      throw new BadRequestException('channelId must be a number');
    }
    const propertyId = body?.propertyId?.trim();
    let properties;
    if (propertyId) {
      const one =
        user.role === 'SUPERADMIN'
          ? await this.propertyService.findByIdForAdmin(propertyId)
          : await this.propertyService.findOneForUser(propertyId, user.sub, user.role);
      properties = [one];
    } else if (user.role === 'SUPERADMIN') {
      properties = await this.propertyService.findAllWithZodomus();
    } else {
      const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
      properties = (await this.propertyService.findAllByOwner(ownerId)).filter(
        (p) =>
          Boolean(p.zodomusPropertyId?.trim()) ||
          Boolean(p.channelListings?.some((c) => c.externalListingId?.trim())),
      );
    }
    const result = await this.zodomusSync.refreshPropertyStatuses({ channelId, properties });
    return { data: result };
  }

  /**
   * GET /reservations-summary — импорт всех активных броней при онбординге объекта.
   * Не зависит от очереди; полезен при первом подключении объекта к Zodomus.
   */
  /**
   * Recomputes availability from RentAI bookings and POSTs to Zodomus (manual retry / debugging).
   */
  @Post('push-availability')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async pushAvailability(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId: string },
  ) {
    const propertyId = body.propertyId?.trim();
    if (!propertyId) {
      throw new BadRequestException('propertyId is required');
    }
    if (user.role === 'SUPERADMIN') {
      await this.propertyService.findByIdForAdmin(propertyId);
    } else {
      await this.propertyService.findOneForUser(propertyId, user.sub, user.role);
    }
    try {
      const summary = await this.availabilityPush.pushAvailabilityNow(propertyId, {
        ignoreAutoPushDisable: true,
      });
      return { data: { ok: true as const, ...summary } };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(
        `Zodomus availability push failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  @Post('import-summary')
  @Roles('OWNER', 'MANAGER', 'SUPERADMIN')
  async importSummary(
    @CurrentUser() user: JwtPayload,
    @Body() body: { channelId: number; propertyId: string },
  ) {
    const channelId = Number(body.channelId);
    const propertyId = body.propertyId?.trim();
    if (!propertyId || !Number.isFinite(channelId)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const result =
      user.role === 'SUPERADMIN'
        ? await this.zodomusSync.importSummaryForPropertyAdmin(propertyId, channelId)
        : await this.zodomusSync.importSummaryForProperty(
            await this.userService.resolveTenantOwnerId(user.sub, user.role),
            propertyId,
            channelId,
          );
    return { data: result };
  }
}

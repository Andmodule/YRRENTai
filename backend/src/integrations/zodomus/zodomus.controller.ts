import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Zodomus')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('integrations/zodomus')
export class ZodomusController {
  constructor(
    private readonly zodomus: ZodomusService,
    private readonly zodomusSync: ZodomusSyncService,
  ) {}

  @Get('status')
  @Roles('OWNER', 'MANAGER')
  async status() {
    if (!this.zodomus.isEnabled) {
      return { data: { status: 'disabled' as const } };
    }
    const account = await this.zodomus.getAccount();
    return { data: { status: 'ok' as const, account } };
  }

  @Post('sync')
  @Roles('OWNER', 'MANAGER')
  async sync(
    @CurrentUser() user: JwtPayload,
    @Body() body: { channelId: number; propertyId: string; force?: boolean },
  ) {
    const channelId = Number(body.channelId);
    const propertyId = body.propertyId?.trim();
    if (!propertyId || !Number.isFinite(channelId)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const result = await this.zodomusSync.syncQueueForProperty(user.sub, propertyId, channelId, Boolean(body.force));
    return { data: result };
  }

  /** Синхронизация очереди для всех объектов владельца с привязкой Zodomus. */
  @Post('sync-all')
  @Roles('OWNER', 'MANAGER')
  async syncAll(@CurrentUser() user: JwtPayload, @Body() body: { channelId?: number; force?: boolean }) {
    const channelId = Number(body?.channelId ?? 1);
    if (!Number.isFinite(channelId)) {
      throw new BadRequestException('channelId must be a number');
    }
    const result = await this.zodomusSync.syncAllForUser(user.sub, channelId, Boolean(body.force));
    return { data: result };
  }

  /**
   * GET /reservations-summary — импорт всех активных броней при онбординге объекта.
   * Не зависит от очереди; полезен при первом подключении объекта к Zodomus.
   */
  @Post('import-summary')
  @Roles('OWNER', 'MANAGER')
  async importSummary(
    @CurrentUser() user: JwtPayload,
    @Body() body: { channelId: number; propertyId: string },
  ) {
    const channelId = Number(body.channelId);
    const propertyId = body.propertyId?.trim();
    if (!propertyId || !Number.isFinite(channelId)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const result = await this.zodomusSync.importSummaryForProperty(user.sub, propertyId, channelId);
    return { data: result };
  }
}

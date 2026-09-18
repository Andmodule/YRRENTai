import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ZodomusService } from './zodomus.service';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';
import { PropertyService } from '../../property/property.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { InvokeZodomusApiRefDto } from './dto/invoke-zodomus-api-ref.dto';
import {
  findZodomusApiRefEntry,
  injectZodomusApiRefRoomId,
  ZODOMUS_API_REF_CATALOG,
} from './zodomus-api-ref.constants';
import type { PropertyEntity } from '../../property/entities/property.entity';

/**
 * CRM (OWNER/MANAGER) explorer for Zodomus public API Reference + RentAI helpers.
 * Upstream calls go through allowlisted paths only; property-scoped ops are tenant-checked.
 */
@ApiTags('Zodomus API Reference')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('integrations/zodomus')
@Roles('OWNER', 'MANAGER', 'SUPERADMIN')
export class ZodomusApiRefController {
  constructor(
    private readonly zodomus: ZodomusService,
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    private readonly propertyService: PropertyService,
  ) {}

  /** Catalog of allowlisted upstream operations (for CRM UI). */
  @Get('api-ref/catalog')
  catalog() {
    return {
      data: {
        excluded: ['/reservations-cc'],
        excludedReason: 'PCI / credit-card payload — not exposed via CRM',
        entries: ZODOMUS_API_REF_CATALOG,
      },
    };
  }

  /**
   * Which roomId RentAI uses for POST /availability — tenant-scoped.
   */
  @Get('availability-push-targets')
  async availabilityPushTargets(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
  ) {
    const prop = await this.loadPropertyForUser(user, propertyId);
    const data = await this.availabilityPush.describeAvailabilityPushTargets(prop.id);
    return { data };
  }

  /** Invoke one allowlisted Zodomus upstream operation. */
  @Post('api-ref/invoke')
  async invoke(@CurrentUser() user: JwtPayload, @Body() dto: InvokeZodomusApiRefDto) {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }

    const entry = findZodomusApiRefEntry(dto.method, dto.path);
    if (!entry) {
      throw new BadRequestException(
        `Upstream ${dto.method} ${dto.path} is not in the API Reference allowlist`,
      );
    }

    let prop: PropertyEntity | null = null;
    let externalListingId: string | null = null;
    const channelId = dto.channelId;

    if (entry.requiresRentaiProperty || entry.scope === 'property') {
      if (!dto.propertyId?.trim()) {
        throw new BadRequestException('propertyId is required for this operation');
      }
      if (!Number.isFinite(channelId)) {
        throw new BadRequestException('channelId is required for this operation');
      }
      prop = await this.loadPropertyForUser(user, dto.propertyId);
      externalListingId = this.propertyService.getExternalListingIdForZodomusChannel(
        prop,
        channelId as number,
      );
      if (!externalListingId) {
        throw new BadRequestException(
          'Property has no external listing id for this channel — save Zodomus / OTA id first',
        );
      }
    }

    if (dto.method === 'GET') {
      const query: Record<string, string> = { ...(dto.query ?? {}) };
      if (entry.scope === 'property' && channelId != null && externalListingId) {
        query.channelId = String(channelId);
        query.propertyId = externalListingId;
      }
      if (entry.requiresRoomId && prop && channelId != null) {
        const roomId =
          dto.roomId?.trim() ||
          this.propertyService.getZodomusRoomIdForChannel(prop, channelId) ||
          '';
        if (roomId) injectZodomusApiRefRoomId(entry, roomId, { query });
      }
      const data = await this.zodomus.upstreamGet(dto.path, query);
      return {
        data: {
          upstream: { method: 'GET', path: dto.path, query },
          response: data,
        },
      };
    }

    const body =
      dto.body && typeof dto.body === 'object' && !Array.isArray(dto.body)
        ? { ...(dto.body as Record<string, unknown>) }
        : {};
    if (entry.scope === 'property' && channelId != null && externalListingId) {
      if (body.channelId === undefined) body.channelId = channelId;
      if (body.propertyId === undefined) body.propertyId = externalListingId;
    }
    if (entry.requiresRoomId && prop && channelId != null) {
      const roomId =
        dto.roomId?.trim() ||
        this.propertyService.getZodomusRoomIdForChannel(prop, channelId) ||
        '';
      if (roomId) injectZodomusApiRefRoomId(entry, roomId, { body });
    }
    const data = await this.zodomus.upstreamPost(dto.path, body);
    return {
      data: {
        upstream: { method: 'POST', path: dto.path, body },
        response: data,
      },
    };
  }
  private async loadPropertyForUser(user: JwtPayload, propertyId: string): Promise<PropertyEntity> {
    const pid = propertyId?.trim();
    if (!pid) {
      throw new BadRequestException('propertyId is required');
    }
    if (user.role === 'SUPERADMIN') {
      return this.propertyService.findByIdForAdmin(pid);
    }
    return this.propertyService.findOneForUser(pid, user.sub, user.role);
  }
}

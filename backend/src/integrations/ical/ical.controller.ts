import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ICalSyncService } from './ical-sync.service';

@ApiTags('iCal')
@Controller('ical')
export class ICalController {
  constructor(private readonly icalSync: ICalSyncService) {}

  // ── Public feed (no JWT) ───────────────────────────────────────────────────

  /**
   * Public iCal export — subscribe from Airbnb, VRBO, etc.
   * GET /ical/export/:propertyId.ics
   */
  @Get('export/:propertyId.ics')
  async exportFeed(
    @Param('propertyId') propertyId: string,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.icalSync.exportPropertyFeed(propertyId);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${propertyId}.ics"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(ics);
  }

  // ── Authenticated endpoints ────────────────────────────────────────────────

  /**
   * Set the list of external iCal URLs to import for a property.
   * PUT /ical/urls
   * Body: { propertyId, urls: string[] }
   */
  @Put('urls')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async setUrls(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId: string; urls: string[] },
  ) {
    if (!body.propertyId || !Array.isArray(body.urls)) {
      throw new BadRequestException('propertyId and urls[] are required');
    }
    const saved = await this.icalSync.setImportUrls(user.sub, user.role, body.propertyId, body.urls);
    return { data: { urls: saved } };
  }

  /**
   * Import a single iCal URL once (ad-hoc).
   * POST /ical/import
   * Body: { propertyId, url }
   */
  @Post('import')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async importOne(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId: string; url: string },
  ) {
    if (!body.propertyId || !body.url?.trim()) {
      throw new BadRequestException('propertyId and url are required');
    }
    const result = await this.icalSync.importUrl(user.sub, user.role, body.propertyId, body.url.trim());
    return { data: result };
  }

  /**
   * Sync all saved iCal URLs for a property.
   * POST /ical/sync-property
   * Body: { propertyId }
   */
  @Post('sync-property')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async syncProperty(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId: string },
  ) {
    if (!body.propertyId) {
      throw new BadRequestException('propertyId is required');
    }
    const results = await this.icalSync.syncProperty(user.sub, user.role, body.propertyId);
    return { data: { results } };
  }
}

import {
  Controller, Get, Post, Patch, Param, Body,
  Query, UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { Request } from 'express';
import { ParseUUIDPipe } from '@nestjs/common';
import { VoiceAlertsService } from '../voice-alerts.service';
import type { AlertMetricKey } from '../constants/voice-alert-thresholds';
import type { AlertStatus, AlertSeverity } from '../entities/voice-alert.entity';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const alertRuleSchema = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid().optional(),
  provider: z.string().max(32).optional(),
  metricKey: z.enum([
    'fallbackRate', 'escalationRate', 'lowConfidenceRate', 'p95LatencyMs',
    'webhookFailures24h', 'failedTransfers24h', 'emergencyTriggers24h',
  ]),
  warningThreshold:  z.number().optional(),
  criticalThreshold: z.number().optional(),
  comparator:        z.enum(['gt', 'gte']).optional(),
  windowMinutes:     z.number().int().min(5).max(1440).optional(),
  enabled:           z.boolean().optional(),
});
class AlertRuleDto extends createZodDto(alertRuleSchema) {}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Voice — Alerts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/alerts')
export class VoiceAlertsController {
  constructor(private readonly alertsService: VoiceAlertsService) {}

  private actor(req: Request): { actorId: string; actorRole: string } {
    const user = (req as Request & { user?: { id?: string; userId?: string; role?: string } }).user;
    return {
      actorId:  user?.id ?? user?.userId ?? 'unknown',
      actorRole: user?.role ?? 'manager',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List alerts (filter by status / severity / propertyId)' })
  @ApiQuery({ name: 'status',     enum: ['active', 'acknowledged', 'resolved'], required: false })
  @ApiQuery({ name: 'severity',   enum: ['warning', 'critical'], required: false })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'provider',   required: false })
  async listAlerts(
    @Query('status')     status?: string,
    @Query('severity')   severity?: string,
    @Query('propertyId') propertyId?: string,
    @Query('provider')   provider?: string,
  ) {
    return {
      data: await this.alertsService.listActiveAlerts({
        status:     status     as AlertStatus   | undefined,
        severity:   severity   as AlertSeverity | undefined,
        propertyId,
        provider,
      }),
    };
  }

  @Get('rules')
  @ApiOperation({ summary: 'List alert rules (optionally scoped to property)' })
  async listRules(@Query('propertyId') propertyId?: string) {
    return { data: await this.alertsService.listAlertRules({ propertyId }) };
  }

  @Post('rules')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update an alert rule' })
  async upsertRule(@Body() dto: AlertRuleDto) {
    return {
      data: await this.alertsService.upsertAlertRule({
        ownerId:           dto.ownerId,
        propertyId:        dto.propertyId,
        provider:          dto.provider,
        metricKey:         dto.metricKey as AlertMetricKey,
        warningThreshold:  dto.warningThreshold,
        criticalThreshold: dto.criticalThreshold,
        comparator:        dto.comparator,
        windowMinutes:     dto.windowMinutes,
        enabled:           dto.enabled,
      }),
    };
  }

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger alert evaluation (also runs on 1-min cron)' })
  async evaluate(@Query('propertyId') propertyId?: string) {
    return { data: await this.alertsService.evaluateAlerts({ propertyId }) };
  }

  @Patch(':id/ack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge an active alert' })
  async ack(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const { actorId, actorRole } = this.actor(req);
    return { data: await this.alertsService.acknowledgeAlert(id, actorId, actorRole) };
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually resolve an alert' })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const { actorId, actorRole } = this.actor(req);
    return { data: await this.alertsService.resolveAlert(id, actorId, actorRole) };
  }
}

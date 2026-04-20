import {
  Controller, Get, Patch, Param, Body,
  UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ParseUUIDPipe } from '@nestjs/common';
import type { Request } from 'express';
import { VoiceRolloutService } from '../voice-rollout.service';
import type { RolloutCohort } from '../entities/property-voice-rollout.entity';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const rolloutUpdateSchema = z.object({
  cohort:                      z.enum(['disabled', 'pilot', 'beta', 'stable']).optional(),
  enabled:                     z.boolean().optional(),
  provider:                    z.string().max(32).optional(),
  confidenceThresholdOverride: z.number().min(0).max(1).nullable().optional(),
  afterHoursMode:              z.string().max(32).nullable().optional(),
  exportAllowed:               z.boolean().optional(),
  notes:                       z.string().max(500).nullable().optional(),
  /** Required when cohort=stable — explicit production confirmation gate */
  confirmStableRollout:        z.boolean().optional(),
});
class RolloutUpdateDto extends createZodDto(rolloutUpdateSchema) {}

const bulkCohortSchema = z.object({
  propertyIds:          z.array(z.string().uuid()).min(1).max(500),
  cohort:               z.enum(['disabled', 'pilot', 'beta', 'stable']),
  confirmStableRollout: z.boolean().optional(),
});
class BulkCohortDto extends createZodDto(bulkCohortSchema) {}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Voice — Rollout')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/rollout')
export class VoiceRolloutController {
  constructor(private readonly rolloutService: VoiceRolloutService) {}

  private actor(req: Request): { actorId: string; actorRole: string } {
    const user = (req as Request & { user?: { id?: string; userId?: string; role?: string } }).user;
    return {
      actorId:   user?.id ?? user?.userId ?? 'unknown',
      actorRole: user?.role ?? 'manager',
    };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Rollout dashboard: cohort + provider summary + per-property rows' })
  async dashboard() {
    return { data: await this.rolloutService.getRolloutDashboard() };
  }

  @Patch('bulk-cohort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move multiple properties to a target cohort in one request' })
  async bulkMoveCohort(@Body() dto: BulkCohortDto, @Req() req: Request) {
    const { actorId, actorRole } = this.actor(req);
    const moved = await this.rolloutService.bulkMoveCohort(
      dto.propertyIds,
      dto.cohort as RolloutCohort,
      { actorId, actorRole, confirmStableRollout: dto.confirmStableRollout },
    );
    return { data: { moved, cohort: dto.cohort } };
  }

  @Patch(':propertyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update rollout settings for a single property' })
  async updateRollout(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RolloutUpdateDto,
    @Req() req: Request,
  ) {
    const { actorId, actorRole } = this.actor(req);
    return {
      data: await this.rolloutService.updatePropertyRollout(propertyId, {
        ...dto,
        cohort: dto.cohort as RolloutCohort | undefined,
        actorId,
        actorRole,
      }),
    };
  }
}

import {
  Controller, Get, Post, Body, UseGuards,
  HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { Request } from 'express';
import { VoiceReadinessService } from '../voice-readiness.service';
import { VoiceSmokeTestService } from '../voice-smoke-test.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const bootstrapSchema = z.object({
  ownerId: z.string().uuid(),
});
class BootstrapDto extends createZodDto(bootstrapSchema) {}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Voice — Readiness')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/readiness')
export class VoiceReadinessController {
  constructor(
    private readonly readinessService: VoiceReadinessService,
    private readonly smokeTestService: VoiceSmokeTestService,
  ) {}

  /**
   * Returns full readiness report: env, provider, webhook, handoff,
   * rollout, alerts, QA. No external calls — reads env + DB only.
   */
  @Get()
  @ApiOperation({ summary: 'Go-live readiness report (env + DB checks, no external calls)' })
  async getReadiness() {
    return { data: await this.readinessService.getGoLiveReadiness() };
  }

  /**
   * Runs 6 application-level smoke tests. Does NOT make real provider calls.
   * Tests: alert evaluation, audit write/read, stats shape, QA workload,
   * rollout guard invariant, history access.
   */
  @Post('smoke-test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run internal smoke tests (no real calls)' })
  async runSmokeTests() {
    return { data: await this.smokeTestService.runSmokeTests() };
  }

  /**
   * Bootstrap safe defaults: creates default alert rules if none exist.
   * Idempotent — safe to call multiple times.
   */
  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bootstrap default alert rules (idempotent)' })
  async bootstrap(@Body() dto: BootstrapDto) {
    return { data: await this.readinessService.bootstrapDefaults(dto.ownerId) };
  }
}

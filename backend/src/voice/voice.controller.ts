/**
 * VoiceController — core sessions, stats, takeover, privacy, eval.
 *
 * Domain-specific routes live in dedicated controllers:
 *   - VoiceAlertsController   → /voice/alerts
 *   - VoiceRolloutController  → /voice/rollout
 *   - VoiceQaController       → /voice/qa
 *   - VoiceAuditController    → /voice/audit-log
 */
import {
  Controller, Post, Get, Put, Patch, Param, Body,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
  Query, Res, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { Response, Request } from 'express';

import { VoiceService }         from './voice.service';
import { VoiceSessionService }  from './voice-session.service';
import { VoiceHandoffService }  from './voice-handoff.service';
import { VoicePostCallService } from './voice-post-call.service';
import { VoicePrivacyService }  from './voice-privacy.service';
import { VoiceMetricsService }  from './voice-metrics.service';
import { VoiceEvalService }     from './eval/voice-eval.service';
import { VoiceStatsService }    from './voice-stats.service';
import { VoiceAuditService }    from './voice-audit.service';
import { OperatorTakeoverDto }  from './dto/voice-webhook.dto';
import type { SessionHistoryItem } from './voice-stats.service';

// ── DTOs (scoped to this controller) ─────────────────────────────────────────

const reviewUpdateSchema = z.object({
  reviewerNote:   z.string().optional(),
  qualityRating:  z.number().int().min(1).max(5).optional(),
  status:         z.enum(['open', 'in_review', 'resolved', 'escalated', 'pending', 'reviewed', 'closed']).optional(),
  resolutionNote: z.string().optional(),
  priority:       z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueAt:          z.string().datetime().optional(),
});
class ReviewUpdateDto extends createZodDto(reviewUpdateSchema) {}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Voice')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService:    VoiceService,
    private readonly sessionService:  VoiceSessionService,
    private readonly handoffService:  VoiceHandoffService,
    private readonly postCallService: VoicePostCallService,
    private readonly privacyService:  VoicePrivacyService,
    private readonly metricsService:  VoiceMetricsService,
    private readonly evalService:     VoiceEvalService,
    private readonly statsService:    VoiceStatsService,
    private readonly auditService:    VoiceAuditService,
  ) {}

  private actor(req: Request): { actorId: string; actorRole: string } {
    const user = (req as Request & { user?: { id?: string; userId?: string; role?: string } }).user;
    return {
      actorId:   user?.id ?? user?.userId ?? 'unknown',
      actorRole: user?.role ?? 'manager',
    };
  }

  @Post('transcribe')
  async transcribe() {
    return this.voiceService.transcribe();
  }

  // ── Active sessions ───────────────────────────────────────────────────────

  @Get('sessions/active')
  @ApiOperation({ summary: 'List active call sessions' })
  async listActiveSessions() {
    return { data: await this.sessionService.findActive() };
  }

  // ── Session history ───────────────────────────────────────────────────────

  @Get('sessions/history')
  @ApiOperation({ summary: 'Paginated completed sessions with rich filters' })
  async sessionHistory(
    @Query('status')        status?: string,
    @Query('handoffStatus') handoffStatus?: string,
    @Query('hasQaFlag')     hasQaFlag?: string,
    @Query('propertyId')    propertyId?: string,
    @Query('provider')      provider?: string,
    @Query('dateFrom')      dateFrom?: string,
    @Query('dateTo')        dateTo?: string,
    @Query('search')        search?: string,
    @Query('limit')         limit = '50',
    @Query('offset')        offset = '0',
  ) {
    return {
      data: await this.statsService.getSessionHistory({
        status, handoffStatus, hasQaFlag, propertyId, provider,
        dateFrom, dateTo, search,
        limit:  Math.min(Number(limit), 100),
        offset: Number(offset),
      }),
    };
  }

  @Get('sessions/history/export')
  @ApiOperation({ summary: 'Export session history as CSV (policy-gated)' })
  async exportSessionHistory(
    @Req() req: Request,
    @Res() res: Response,
    @Query('propertyId') propertyId?: string,
    @Query('status')     status?: string,
    @Query('provider')   provider?: string,
    @Query('dateFrom')   dateFrom?: string,
    @Query('dateTo')     dateTo?: string,
  ) {
    const result = await this.statsService.exportSessionHistory({
      propertyId, status, provider, dateFrom, dateTo, limit: 5000, offset: 0,
    });
    const { actorId, actorRole } = this.actor(req);
    await this.auditService.log({
      actorId, actorRole,
      actionType: 'export_session_history',
      metadata: { propertyId, status, provider, count: result.sessions.length },
    });
    const csv = this.sessionsToCsv(result.sessions);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="call-history.csv"');
    res.send(csv);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get call session with full transcript + events' })
  async getSession(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.sessionService.getSessionWithEvents(id) };
  }

  @Post('sessions/takeover')
  @HttpCode(HttpStatus.OK)
  async takeover(@Body() dto: OperatorTakeoverDto) {
    await this.handoffService.operatorTakeover(dto.sessionId, 'operator-rest');
    return { data: { success: true } };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats/overview')
  @ApiOperation({ summary: 'Overview KPI stats for manager dashboard' })
  async getOverviewStats(@Query('propertyId') propertyId?: string) {
    return { data: await this.statsService.getOverviewStats(propertyId) };
  }

  @Get('stats/overview-trends')
  @ApiOperation({ summary: 'Time-series trends: today | 7d | 30d' })
  @ApiQuery({ name: 'range', enum: ['today', '7d', '30d'], required: false })
  async getOverviewTrends(
    @Query('range')      range: 'today' | '7d' | '30d' = 'today',
    @Query('propertyId') propertyId?: string,
  ) {
    return { data: await this.statsService.getOverviewTrends(range, propertyId) };
  }

  @Get('stats/system-health')
  @ApiOperation({ summary: 'System health: 24h | 7d' })
  @ApiQuery({ name: 'range', enum: ['24h', '7d'], required: false })
  async getSystemHealth(@Query('range') range: '24h' | '7d' = '24h') {
    return { data: await this.statsService.getSystemHealth(range) };
  }

  @Get('stats/rollout')
  @ApiOperation({ summary: 'Per-property rollout status (legacy — use /voice/rollout/dashboard)' })
  async getPropertyRollout() {
    return { data: await this.statsService.getPropertyRollout() };
  }

  // ── Post-call review ──────────────────────────────────────────────────────

  @Get('sessions/:id/review')
  async getReview(@Param('id', ParseUUIDPipe) id: string) {
    let review = await this.postCallService.getReview(id);
    if (!review) review = await this.postCallService.processSession(id);
    return { data: review };
  }

  @Put('sessions/:id/review')
  async updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewUpdateDto,
  ) {
    return { data: await this.postCallService.updateReview(id, dto, 'operator') };
  }

  @Post('sessions/:id/review/reprocess')
  @HttpCode(HttpStatus.OK)
  async reprocessReview(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.postCallService.processSession(id) };
  }

  // ── Briefing / Privacy ────────────────────────────────────────────────────

  @Get('sessions/:id/briefing')
  async getBriefing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('escalationReason') escalationReason?: string,
  ) {
    return { data: await this.handoffService.buildBriefing(id, escalationReason ?? 'operator_request') };
  }

  @Post('sessions/:id/redact')
  @HttpCode(HttpStatus.OK)
  async redactSession(@Param('id', ParseUUIDPipe) id: string) {
    return { data: { redactedSegments: await this.privacyService.redactSession(id) } };
  }

  // ── Metrics / Eval ────────────────────────────────────────────────────────

  @Get('metrics/summary')
  async getMetricsSummary() {
    return { data: { raw: await this.metricsService.getMetricsText() } };
  }

  @Get('eval/run')
  async runEval() {
    return { data: await this.evalService.runEval() };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private sessionsToCsv(sessions: SessionHistoryItem[]): string {
    const headers = [
      'id', 'status', 'provider', 'guestPhone', 'propertyId',
      'handoffStatus', 'turnCount', 'avgTurnLatencyMs',
      'language', 'startedAt', 'endedAt', 'createdAt',
    ] as const;
    const rows = sessions.map((s) =>
      headers.map((h) => JSON.stringify((s[h as keyof typeof s]) ?? '')).join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
}

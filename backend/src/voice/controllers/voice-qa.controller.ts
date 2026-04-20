import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus, Req, Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ParseUUIDPipe, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VoiceStatsService } from '../voice-stats.service';
import { VoiceAuditService } from '../voice-audit.service';
import type { QaQueueItem } from '../voice-stats.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const bulkQaSchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1),
  status: z.enum(['open', 'in_review', 'resolved', 'escalated', 'closed']),
});
class BulkQaDto extends createZodDto(bulkQaSchema) {}

const qaAssignSchema = z.object({
  assigneeId: z.string().uuid(),
  dueAt:      z.string().datetime().optional(),
  priority:   z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
class QaAssignDto extends createZodDto(qaAssignSchema) {}

const bulkAssignSchema = z.object({
  reviewIds:  z.array(z.string().uuid()).min(1),
  assigneeId: z.string().uuid(),
  dueAt:      z.string().datetime().optional(),
  priority:   z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
class BulkAssignDto extends createZodDto(bulkAssignSchema) {}

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

@ApiTags('Voice — QA')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/qa')
export class VoiceQaController {
  constructor(
    private readonly statsService: VoiceStatsService,
    private readonly auditService: VoiceAuditService,
  ) {}

  private actor(req: Request): { actorId: string; actorRole: string } {
    const user = (req as Request & { user?: { id?: string; userId?: string; role?: string } }).user;
    return {
      actorId:   user?.id ?? user?.userId ?? 'unknown',
      actorRole: user?.role ?? 'manager',
    };
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  @Get('queue')
  @ApiOperation({ summary: 'QA review queue' })
  async getQueue(
    @Query('reviewStatus') reviewStatus?: string,
    @Query('status')       status?: string,
    @Query('propertyId')   propertyId?: string,
    @Query('hasQaFlag')    hasQaFlag?: string,
    @Query('limit')        limit = '40',
    @Query('offset')       offset = '0',
  ) {
    return {
      data: await this.statsService.getQaQueue({
        reviewStatus: reviewStatus ?? status,
        propertyId,
        hasQaFlag,
        limit:  Math.min(Number(limit), 100),
        offset: Number(offset),
      }),
    };
  }

  @Get('workload')
  @ApiOperation({ summary: 'QA workload aggregated per reviewer' })
  async getWorkload() {
    return { data: await this.statsService.getQaWorkload() };
  }

  @Get('export')
  @ApiOperation({ summary: 'Export QA queue as CSV (policy-gated)' })
  async exportQueue(
    @Req() req: Request,
    @Res() res: Response,
    @Query('propertyId')   propertyId?: string,
    @Query('reviewStatus') reviewStatus?: string,
  ) {
    const result = await this.statsService.exportQaQueue({ propertyId, reviewStatus, limit: 5000, offset: 0 });
    const { actorId, actorRole } = this.actor(req);
    await this.auditService.log({
      actorId, actorRole,
      actionType: 'export_qa_queue',
      metadata: { propertyId, reviewStatus, count: result.items.length },
    });
    const csv = this.qaToCsv(result.items);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="qa-queue.csv"');
    res.send(csv);
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────

  @Patch('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk update QA status with transition validation' })
  async bulkUpdateStatus(@Body() dto: BulkQaDto, @Req() req: Request) {
    const { actorId, actorRole } = this.actor(req);
    const result = await this.statsService.bulkUpdateQaStatus(dto.sessionIds, dto.status, actorId);
    await this.auditService.log({
      actorId, actorRole,
      actionType: 'review_status_changed',
      metadata: { sessionIds: dto.sessionIds, status: dto.status, updated: result.updated },
    });
    return { data: result };
  }

  @Patch('bulk-assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk assign QA reviews to a reviewer' })
  async bulkAssign(@Body() dto: BulkAssignDto, @Req() req: Request) {
    const { actorId, actorRole } = this.actor(req);
    const updated = await this.statsService.bulkAssignQaReviews(
      dto.reviewIds, dto.assigneeId, actorId,
      { dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined, priority: dto.priority },
    );
    await this.auditService.log({
      actorId, actorRole,
      actionType: 'review_bulk_assigned',
      metadata: { reviewIds: dto.reviewIds, assigneeId: dto.assigneeId, count: updated },
    });
    return { data: { updated } };
  }

  // ── Single review ─────────────────────────────────────────────────────────

  @Patch(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a single QA review to a reviewer' })
  async assignReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QaAssignDto,
    @Req() req: Request,
  ) {
    const { actorId, actorRole } = this.actor(req);
    const review = await this.statsService.assignQaReview(id, dto.assigneeId, actorId, {
      dueAt:    dto.dueAt ? new Date(dto.dueAt) : undefined,
      priority: dto.priority,
    });
    await this.auditService.log({
      actorId, actorRole,
      actionType: 'review_assigned',
      entityType: 'call_review', entityId: id,
      metadata: { assigneeId: dto.assigneeId, priority: dto.priority, dueAt: dto.dueAt },
    });
    return { data: review };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a single QA review (status, note, rating, priority, dueAt)' })
  async updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewUpdateDto,
    @Req() req: Request,
  ) {
    const { actorId, actorRole } = this.actor(req);
    const review = await this.statsService.updateQaReview(id, dto);
    if (dto.status) {
      await this.auditService.log({
        actorId, actorRole,
        actionType: 'review_status_changed',
        entityType: 'call_review', entityId: id,
        metadata: { status: dto.status },
      });
    }
    return { data: review };
  }

  // ── CSV helper ────────────────────────────────────────────────────────────

  private qaToCsv(items: QaQueueItem[]): string {
    const headers = [
      'reviewId', 'sessionId', 'status', 'guestPhone', 'propertyId',
      'qaFlags', 'followUpRequired', 'escalationReason',
      'totalTurns', 'durationSeconds', 'createdAt',
    ] as const;
    const rows = items.map((item) =>
      headers.map((h) => {
        const v = item[h as keyof typeof item];
        return JSON.stringify(Array.isArray(v) ? (v as string[]).join(';') : (v ?? ''));
      }).join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
}

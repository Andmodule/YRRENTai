import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual, Between } from 'typeorm';
import { CallSessionEntity } from './entities/call-session.entity';
import { CallTranscriptSegmentEntity } from './entities/call-transcript-segment.entity';
import { CallEventEntity } from './entities/call-event.entity';
import { CallReviewEntity } from './entities/call-review.entity';
import { PropertyVoicePolicyEntity } from './entities/property-voice-policy.entity';
import { PropertyEntity } from '../property/entities/property.entity';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface OverviewStats {
  activeSessions: number;
  callsToday: number;
  escalatedPct: number;
  handoffPct: number;
  fallbackPct: number;
  lowConfidencePct: number;
  p50TurnLatencyMs: number | null;
  p95TurnLatencyMs: number | null;
  pendingReviewsCount: number;
  recentEscalations: RecentAlert[];
  recentFailedTransfers: RecentAlert[];
}

export interface RecentAlert {
  sessionId: string;
  guestPhone: string | null;
  propertyId: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface TrendPoint {
  ts: string; // ISO string bucket label
  callsCompleted: number;
  escalationRate: number;
  handoffRate: number;
  fallbackRate: number;
  lowConfidenceRate: number;
  p50TurnLatencyMs: number | null;
  p95TurnLatencyMs: number | null;
}

export interface OverviewTrends {
  range: 'today' | '7d' | '30d';
  bucketSize: 'hour' | 'day';
  points: TrendPoint[];
}

export interface SystemHealth {
  range: '24h' | '7d';
  webhookFailureCount: number;
  structuredOutputFailureCount: number;
  duplicateEventCount: number;
  kbMissRate: number;
  emergencyGuardTriggers: number;
  failedTransfersLast24h: number;
  activeSessionsByProvider: Record<string, number>;
}

export interface PropertyRolloutItem {
  propertyId: string;
  propertyName: string | null;
  enabled: boolean;
  provider: string;
  callsLast7d: number;
  fallbackRate: number | null;
  lastIssue: Date | null;
}

export interface QaQueueItem {
  sessionId: string;
  reviewId: string;
  status: string;
  guestPhone: string | null;
  propertyId: string | null;
  qaFlags: string[] | null;
  followUpRequired: boolean;
  escalationReason: string | null;
  totalTurns: number | null;
  durationSeconds: number | null;
  createdAt: Date;
}

export interface SessionHistoryItem {
  id: string;
  status: string;
  direction: string;
  provider: string;
  guestPhone: string | null;
  propertyId: string | null;
  handoffStatus: string;
  turnCount: number;
  avgTurnLatencyMs: number | null;
  language: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface HistoryFilters {
  limit: number;
  offset: number;
  status?: string;
  handoffStatus?: string;
  hasQaFlag?: string;
  propertyId?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface QaQueueFilters {
  limit: number;
  offset: number;
  status?: string;
  reviewStatus?: string;
  propertyId?: string;
  hasQaFlag?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = ['completed', 'failed', 'no_answer', 'handed_off'];
const ACTIVE_STATUSES = ['ringing', 'in_progress', 'ai_handling', 'handoff_pending'];

const VALID_QA_TRANSITIONS: Record<string, string[]> = {
  open:      ['in_review', 'resolved', 'escalated'],
  in_review: ['resolved', 'escalated', 'open'],
  resolved:  ['open', 'escalated'],
  escalated: ['in_review', 'resolved'],
  pending:   ['open', 'in_review', 'resolved', 'escalated'],
  reviewed:  ['open', 'resolved', 'escalated'],
  closed:    ['open'],
};

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class VoiceStatsService {
  constructor(
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    @InjectRepository(CallTranscriptSegmentEntity)
    private readonly segmentRepo: Repository<CallTranscriptSegmentEntity>,
    @InjectRepository(CallEventEntity)
    private readonly eventRepo: Repository<CallEventEntity>,
    @InjectRepository(CallReviewEntity)
    private readonly reviewRepo: Repository<CallReviewEntity>,
    @InjectRepository(PropertyVoicePolicyEntity)
    private readonly policyRepo: Repository<PropertyVoicePolicyEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  // ── Overview stats ────────────────────────────────────────────────────────

  async getOverviewStats(propertyId?: string): Promise<OverviewStats> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const baseWhere = propertyId ? { propertyId } : {};

    const activeSessions = await this.sessionRepo.count({
      where: { status: In(ACTIVE_STATUSES), ...baseWhere },
    });

    const todaysSessions = await this.sessionRepo.find({
      where: { createdAt: MoreThanOrEqual(todayStart), ...baseWhere },
      select: ['id', 'status', 'handoffStatus', 'avgTurnLatencyMs', 'guestPhone', 'propertyId', 'createdAt'],
    });

    const callsToday = todaysSessions.length;
    const ended = todaysSessions.filter((s) => TERMINAL_STATUSES.includes(s.status));

    const escalatedPct = callsToday > 0
      ? Math.round((ended.filter((s) => s.handoffStatus !== 'none').length / callsToday) * 100) : 0;
    const handoffPct = callsToday > 0
      ? Math.round((ended.filter((s) => s.status === 'handed_off').length / callsToday) * 100) : 0;

    const { p50, p95 } = await this.computeLatencyPercentiles(todaysSessions.map((s) => s.id));
    const { fallbackPct, lowConfidencePct } = await this.computeQualityRates(todaysSessions.map((s) => s.id));

    const pendingReviewsCount = await this.reviewRepo.count({
      where: { status: In(['pending', 'open', 'in_review']) },
    });

    const since24h = new Date(Date.now() - 86_400_000);
    const recentEscalated = await this.sessionRepo.find({
      where: { status: 'handed_off', createdAt: MoreThanOrEqual(since24h), ...baseWhere },
      order: { createdAt: 'DESC' },
      take: 5,
      select: ['id', 'guestPhone', 'propertyId', 'createdAt'],
    });
    const recentFailed = await this.reviewRepo.find({
      where: { transferOutcome: 'failed' },
      order: { createdAt: 'DESC' },
      take: 5,
      select: ['sessionId', 'escalationReason', 'createdAt'],
    });

    return {
      activeSessions, callsToday, escalatedPct, handoffPct, fallbackPct, lowConfidencePct,
      p50TurnLatencyMs: p50, p95TurnLatencyMs: p95, pendingReviewsCount,
      recentEscalations: recentEscalated.map((s) => ({
        sessionId: s.id, guestPhone: s.guestPhone, propertyId: s.propertyId, reason: null, occurredAt: s.createdAt,
      })),
      recentFailedTransfers: recentFailed.map((r) => ({
        sessionId: r.sessionId, guestPhone: null, propertyId: null, reason: r.escalationReason, occurredAt: r.createdAt,
      })),
    };
  }

  // ── Trends ─────────────────────────────────────────────────────────────────

  async getOverviewTrends(
    range: 'today' | '7d' | '30d',
    propertyId?: string,
  ): Promise<OverviewTrends> {
    const now = new Date();
    let since: Date;
    let bucketSize: 'hour' | 'day';
    let truncUnit: string;

    switch (range) {
      case 'today':
        since = new Date(now); since.setHours(0, 0, 0, 0);
        bucketSize = 'hour'; truncUnit = 'hour';
        break;
      case '7d':
        since = new Date(now.getTime() - 7 * 86_400_000);
        bucketSize = 'day'; truncUnit = 'day';
        break;
      case '30d':
        since = new Date(now.getTime() - 30 * 86_400_000);
        bucketSize = 'day'; truncUnit = 'day';
        break;
    }

    const propFilter = propertyId ? `AND s."propertyId" = '${propertyId}'` : '';

    // Single SQL query aggregating all per-bucket metrics
    const rows = await this.sessionRepo.manager.query<Array<Record<string, string>>>(
      `
      SELECT
        date_trunc($1, s."createdAt") AS ts,
        COUNT(*) FILTER (WHERE s.status = ANY($3)) AS calls_completed,
        COUNT(*) FILTER (WHERE s."handoffStatus" != 'none') AS escalated,
        COUNT(*) FILTER (WHERE s.status = 'handed_off') AS handed_off,
        COUNT(*) AS total
      FROM call_sessions s
      WHERE s."createdAt" >= $2
        ${propFilter}
      GROUP BY ts
      ORDER BY ts ASC
      `,
      [truncUnit, since, TERMINAL_STATUSES],
    );

    // Per-bucket latency percentiles via separate query
    const latencyRows = await this.segmentRepo.manager.query<Array<Record<string, string>>>(
      `
      SELECT
        date_trunc($1, seg."spokenAt") AS ts,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seg."turnTotalMs") AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY seg."turnTotalMs") AS p95,
        COUNT(*) FILTER (WHERE seg."confidence" < 0.45) AS low_conf,
        COUNT(*) AS seg_total
      FROM call_transcript_segments seg
      WHERE seg."spokenAt" >= $2
        AND seg."turnTotalMs" IS NOT NULL
        AND seg.role = 'ai'
      GROUP BY ts
      ORDER BY ts ASC
      `,
      [truncUnit, since],
    );

    const latencyMap = new Map(latencyRows.map((r) => [r['ts'] as string, r]));

    const points: TrendPoint[] = rows.map((r) => {
      const total = Number(r['total'] ?? 0);
      const lRow = latencyMap.get(r['ts'] as string);
      const segTotal = Number(lRow?.['seg_total'] ?? 0);

      return {
        ts: r['ts'] as string,
        callsCompleted: Number(r['calls_completed'] ?? 0),
        escalationRate: total > 0 ? Math.round((Number(r['escalated'] ?? 0) / total) * 100) : 0,
        handoffRate: total > 0 ? Math.round((Number(r['handed_off'] ?? 0) / total) * 100) : 0,
        fallbackRate: 0, // computed below from segments if needed
        lowConfidenceRate: segTotal > 0 ? Math.round((Number(lRow?.['low_conf'] ?? 0) / segTotal) * 100) : 0,
        p50TurnLatencyMs: lRow?.['p50'] ? Math.round(Number(lRow['p50'])) : null,
        p95TurnLatencyMs: lRow?.['p95'] ? Math.round(Number(lRow['p95'])) : null,
      };
    });

    return { range, bucketSize, points };
  }

  // ── System health ─────────────────────────────────────────────────────────

  async getSystemHealth(range: '24h' | '7d'): Promise<SystemHealth> {
    const since = new Date(Date.now() - (range === '24h' ? 86_400_000 : 7 * 86_400_000));

    const [
      webhookFailures,
      structuredOutputFailures,
      duplicateEvents,
      emergencyTriggers,
      activeByProvider,
      failedTransfers,
      kbMissReviews,
      totalReviews,
    ] = await Promise.all([
      this.eventRepo.count({
        where: { type: 'error', createdAt: MoreThanOrEqual(since) },
      }),
      this.eventRepo.count({
        where: { type: 'fallback_triggered', createdAt: MoreThanOrEqual(since) },
      }),
      this.sessionRepo.manager.query<Array<{ count: string }>>(
        `SELECT COUNT(*) FROM call_events WHERE "idempotencyKey" IS NOT NULL AND "createdAt" >= $1
         GROUP BY "idempotencyKey" HAVING COUNT(*) > 1`,
        [since],
      ).then((rows) => rows.length),
      this.eventRepo.count({
        where: { type: 'emergency_guard', createdAt: MoreThanOrEqual(since) },
      }),
      this.sessionRepo.manager.query<Array<{ provider: string; count: string }>>(
        `SELECT provider, COUNT(*) as count FROM call_sessions
         WHERE status = ANY($1) GROUP BY provider`,
        [ACTIVE_STATUSES],
      ),
      this.reviewRepo.count({
        where: {
          transferOutcome: 'failed',
          createdAt: MoreThanOrEqual(new Date(Date.now() - 86_400_000)),
        },
      }),
      this.reviewRepo.count({
        where: { createdAt: MoreThanOrEqual(since) },
      }),
      this.reviewRepo.manager.query<Array<{ count: string }>>(
        `SELECT COUNT(*) FROM call_reviews
         WHERE "createdAt" >= $1 AND "qaFlags" @> '["kb_miss"]'`,
        [since],
      ).then((rows) => Number(rows[0]?.['count'] ?? 0)),
    ]);

    const activeSessionsByProvider: Record<string, number> = {};
    for (const row of activeByProvider) {
      activeSessionsByProvider[row.provider] = Number(row.count);
    }

    const kbMissRate = totalReviews > 0
      ? Math.round((kbMissReviews / totalReviews) * 100)
      : 0;

    return {
      range,
      webhookFailureCount: webhookFailures,
      structuredOutputFailureCount: structuredOutputFailures,
      duplicateEventCount: duplicateEvents,
      kbMissRate,
      emergencyGuardTriggers: emergencyTriggers,
      failedTransfersLast24h: failedTransfers,
      activeSessionsByProvider,
    };
  }

  // ── Property rollout ──────────────────────────────────────────────────────

  async getPropertyRollout(): Promise<PropertyRolloutItem[]> {
    const [policies, properties] = await Promise.all([
      this.policyRepo.find({ select: ['propertyId', 'voiceAssistantEnabled'] }),
      this.propertyRepo.find({ select: ['id', 'name'] }),
    ]);

    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const items: PropertyRolloutItem[] = [];

    for (const pol of policies) {
      const prop = properties.find((p) => p.id === pol.propertyId);
      const sessions7d = await this.sessionRepo.find({
        where: { propertyId: pol.propertyId, createdAt: MoreThanOrEqual(since7d) },
        select: ['id', 'createdAt'],
      });

      const reviews = sessions7d.length > 0
        ? await this.reviewRepo.find({
            where: { sessionId: In(sessions7d.map((s) => s.id)) },
            select: ['fallbackCount', 'createdAt'],
          })
        : [];

      const totalFallbacks = reviews.reduce((acc, r) => acc + (r.fallbackCount ?? 0), 0);
      const fallbackRate = sessions7d.length > 0
        ? Math.round((totalFallbacks / sessions7d.length) * 100) : null;
      const lastIssueReview = reviews
        .filter((r) => r.fallbackCount && r.fallbackCount > 0)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      items.push({
        propertyId: pol.propertyId,
        propertyName: prop?.name ?? null,
        enabled: pol.voiceAssistantEnabled,
        provider: process.env['INBOUND_VOICE_PROVIDER'] ?? 'retell',
        callsLast7d: sessions7d.length,
        fallbackRate,
        lastIssue: lastIssueReview?.createdAt ?? null,
      });
    }

    return items.sort((a, b) => b.callsLast7d - a.callsLast7d);
  }

  // ── QA queue ──────────────────────────────────────────────────────────────

  async getQaQueue(opts: QaQueueFilters): Promise<{ items: QaQueueItem[]; total: number }> {
    const effectiveStatus = opts.reviewStatus ?? opts.status ?? 'open';

    const qb = this.reviewRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: effectiveStatus })
      .orderBy('r.createdAt', 'DESC')
      .take(opts.limit)
      .skip(opts.offset);

    if (opts.hasQaFlag) {
      qb.andWhere('r."qaFlags" @> :flag::jsonb', {
        flag: JSON.stringify([opts.hasQaFlag]),
      });
    }

    const [reviews, total] = await qb.getManyAndCount();

    const sessionIds = reviews.map((r) => r.sessionId);
    const sessions = sessionIds.length > 0
      ? await this.sessionRepo.findBy({ id: In(sessionIds) })
      : [];
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    // Apply propertyId filter after join (simple in-memory since list is small)
    const filtered = opts.propertyId
      ? reviews.filter((r) => sessionMap.get(r.sessionId)?.propertyId === opts.propertyId)
      : reviews;

    return {
      total: opts.propertyId ? filtered.length : total,
      items: filtered.map((r) => {
        const s = sessionMap.get(r.sessionId);
        return {
          sessionId: r.sessionId,
          reviewId: r.id,
          status: r.status,
          guestPhone: s?.guestPhone ?? null,
          propertyId: s?.propertyId ?? null,
          qaFlags: r.qaFlags,
          followUpRequired: r.followUpRequired,
          escalationReason: r.escalationReason,
          totalTurns: r.totalTurns,
          durationSeconds: r.durationSeconds,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  async bulkUpdateQaStatus(
    sessionIds: string[],
    targetStatus: string,
    reviewerUserId: string,
  ): Promise<{ updated: number; errors: string[] }> {
    const VALID_STATUSES = ['open', 'in_review', 'resolved', 'escalated', 'closed'];
    if (!VALID_STATUSES.includes(targetStatus)) {
      return { updated: 0, errors: [`Invalid status: ${targetStatus}`] };
    }

    // Validate transitions for each review
    const reviews = await this.reviewRepo.findBy({ sessionId: In(sessionIds) });
    const invalidTransitions: string[] = [];
    const validIds: string[] = [];

    for (const review of reviews) {
      const allowed = VALID_QA_TRANSITIONS[review.status] ?? [];
      if (allowed.includes(targetStatus)) {
        validIds.push(review.sessionId);
      } else {
        invalidTransitions.push(
          `${review.sessionId.slice(0, 8)}: ${review.status} → ${targetStatus} not allowed`,
        );
      }
    }

    let updated = 0;
    if (validIds.length > 0) {
      const result = await this.reviewRepo
        .createQueryBuilder()
        .update()
        .set({
          status: targetStatus as CallReviewEntity['status'],
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
        })
        .where('"sessionId" IN (:...ids)', { ids: validIds })
        .execute();
      updated = result.affected ?? 0;
    }

    return { updated, errors: invalidTransitions };
  }

  // ── Session history ───────────────────────────────────────────────────────

  async getSessionHistory(opts: HistoryFilters): Promise<{ sessions: SessionHistoryItem[]; total: number }> {
    const qb = this.sessionRepo
      .createQueryBuilder('s')
      .select([
        's.id', 's.status', 's.direction', 's.provider', 's.guestPhone',
        's.propertyId', 's.handoffStatus', 's.turnCount', 's.avgTurnLatencyMs',
        's.language', 's.startedAt', 's.endedAt', 's.createdAt',
      ])
      .where('s.status IN (:...statuses)', { statuses: TERMINAL_STATUSES })
      .orderBy('s.createdAt', 'DESC')
      .take(opts.limit)
      .skip(opts.offset);

    if (opts.status) qb.andWhere('s.status = :status', { status: opts.status });
    if (opts.handoffStatus) qb.andWhere('s.handoffStatus = :hs', { hs: opts.handoffStatus });
    if (opts.propertyId) qb.andWhere('s.propertyId = :pid', { pid: opts.propertyId });
    if (opts.provider) qb.andWhere('s.provider = :prov', { prov: opts.provider });
    if (opts.dateFrom) qb.andWhere('s."createdAt" >= :df', { df: new Date(opts.dateFrom) });
    if (opts.dateTo) qb.andWhere('s."createdAt" <= :dt', { dt: new Date(opts.dateTo) });
    if (opts.search) {
      qb.andWhere('s."guestPhone" ILIKE :q', { q: `%${opts.search}%` });
    }
    if (opts.hasQaFlag) {
      qb.innerJoin(
        'call_reviews', 'cr',
        'cr."sessionId" = s.id AND cr."qaFlags" @> :flag::jsonb',
        { flag: JSON.stringify([opts.hasQaFlag]) },
      );
    }

    const [sessions, total] = await qb.getManyAndCount();
    return { sessions: sessions as unknown as SessionHistoryItem[], total };
  }

  // ── QA Ownership ─────────────────────────────────────────────────────────

  async updateQaReview(
    reviewId: string,
    dto: {
      reviewerNote?: string;
      qualityRating?: number;
      status?: CallReviewEntity['status'];
      resolutionNote?: string;
      priority?: CallReviewEntity['priority'];
      dueAt?: string;
    },
  ): Promise<CallReviewEntity> {
    const review = await this.reviewRepo.findOneBy({ id: reviewId });
    if (!review) throw new Error(`Review ${reviewId} not found`);

    if (dto.reviewerNote !== undefined)  review.reviewerNote  = dto.reviewerNote;
    if (dto.qualityRating !== undefined) review.qualityRating = dto.qualityRating;
    if (dto.status !== undefined)        review.status        = dto.status;
    if (dto.resolutionNote !== undefined) review.resolutionNote = dto.resolutionNote;
    if (dto.priority !== undefined)      review.priority      = dto.priority;
    if (dto.dueAt !== undefined)         review.dueAt         = new Date(dto.dueAt);

    return this.reviewRepo.save(review);
  }

  async assignQaReview(
    reviewId: string,
    assigneeId: string,
    actorId: string,
    opts: { dueAt?: Date; priority?: CallReviewEntity['priority'] } = {},
  ): Promise<CallReviewEntity> {
    const review = await this.reviewRepo.findOneBy({ id: reviewId });
    if (!review) throw new Error(`Review ${reviewId} not found`);

    review.assigneeId = assigneeId;
    review.assignedBy = actorId;
    review.assignedAt = new Date();
    if (opts.dueAt !== undefined) review.dueAt = opts.dueAt;
    if (opts.priority !== undefined) review.priority = opts.priority;

    return this.reviewRepo.save(review);
  }

  async bulkAssignQaReviews(
    reviewIds: string[],
    assigneeId: string,
    actorId: string,
    opts: { dueAt?: Date; priority?: CallReviewEntity['priority'] } = {},
  ): Promise<number> {
    if (reviewIds.length === 0) return 0;

    const result = await this.reviewRepo
      .createQueryBuilder()
      .update()
      .set({
        assigneeId,
        assignedBy: actorId,
        assignedAt: new Date(),
        ...(opts.dueAt !== undefined ? { dueAt: opts.dueAt } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
      })
      .whereInIds(reviewIds)
      .execute();

    return result.affected ?? 0;
  }

  async getQaWorkload(): Promise<Array<{
    assigneeId: string;
    openCount: number;
    inReviewCount: number;
    escalatedCount: number;
    overdueCount: number;
  }>> {
    const now = new Date();
    const rows = await this.reviewRepo.manager.query<Array<{
      assigneeId: string;
      open_count: string;
      in_review_count: string;
      escalated_count: string;
      overdue_count: string;
    }>>(
      `SELECT
        "assigneeId",
        COUNT(*) FILTER (WHERE status IN ('open','pending')) AS open_count,
        COUNT(*) FILTER (WHERE status = 'in_review') AS in_review_count,
        COUNT(*) FILTER (WHERE status = 'escalated') AS escalated_count,
        COUNT(*) FILTER (WHERE "dueAt" < $1 AND status NOT IN ('resolved','closed')) AS overdue_count
      FROM call_reviews
      WHERE "assigneeId" IS NOT NULL
      GROUP BY "assigneeId"`,
      [now],
    );

    return rows.map((r) => ({
      assigneeId: r.assigneeId,
      openCount: Number(r.open_count),
      inReviewCount: Number(r.in_review_count),
      escalatedCount: Number(r.escalated_count),
      overdueCount: Number(r.overdue_count),
    }));
  }

  // ── Export (policy-gated) ─────────────────────────────────────────────────

  async exportQaQueue(
    opts: QaQueueFilters & { propertyId?: string },
  ): Promise<{ items: QaQueueItem[]; total: number }> {
    await this.assertExportAllowed(opts.propertyId);
    return this.getQaQueue({ ...opts, limit: 5000, offset: 0 });
  }

  async exportSessionHistory(
    opts: HistoryFilters,
  ): Promise<{ sessions: SessionHistoryItem[]; total: number }> {
    await this.assertExportAllowed(opts.propertyId);
    return this.getSessionHistory({ ...opts, limit: 5000, offset: 0 });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertExportAllowed(propertyId?: string): Promise<void> {
    if (propertyId) {
      const policy = await this.policyRepo.findOne({ where: { propertyId } });
      if (policy && !policy.exportAllowed) {
        throw new ForbiddenException(
          `Export is disabled for property ${propertyId} by its voice policy.`,
        );
      }
    } else {
      // Global export: check that no policy explicitly blocks it
      const blocked = await this.policyRepo.count({ where: { exportAllowed: false } });
      if (blocked > 0) {
        throw new ForbiddenException(
          `Export is disabled for ${blocked} propert${blocked === 1 ? 'y' : 'ies'}. ` +
          'Specify a propertyId or update the policy to allow export.',
        );
      }
    }
  }

  private async computeLatencyPercentiles(
    sessionIds: string[],
  ): Promise<{ p50: number | null; p95: number | null }> {
    if (sessionIds.length === 0) return { p50: null, p95: null };
    const result = await this.segmentRepo
      .createQueryBuilder('seg')
      .select([
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seg."turnTotalMs") as p50',
        'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY seg."turnTotalMs") as p95',
      ])
      .where('seg."sessionId" IN (:...ids)', { ids: sessionIds })
      .andWhere('seg."turnTotalMs" IS NOT NULL')
      .getRawOne<{ p50: string; p95: string }>();

    return {
      p50: result?.p50 ? Math.round(Number(result.p50)) : null,
      p95: result?.p95 ? Math.round(Number(result.p95)) : null,
    };
  }

  private async computeQualityRates(sessionIds: string[]): Promise<{
    fallbackPct: number;
    lowConfidencePct: number;
  }> {
    if (sessionIds.length === 0) return { fallbackPct: 0, lowConfidencePct: 0 };
    const result = await this.segmentRepo
      .createQueryBuilder('seg')
      .select([
        'COUNT(*) as total',
        `COUNT(*) FILTER (WHERE seg."content" LIKE '%секунду%' OR seg."content" LIKE '%уточняю%') as fallback_est`,
        `COUNT(*) FILTER (WHERE seg."confidence" < 0.45) as low_conf`,
      ])
      .where('seg."sessionId" IN (:...ids)', { ids: sessionIds })
      .andWhere("seg.role = 'ai'")
      .getRawOne<{ total: string; fallback_est: string; low_conf: string }>();

    const total = Number(result?.total ?? 0);
    if (total === 0) return { fallbackPct: 0, lowConfidencePct: 0 };
    return {
      fallbackPct: Math.round((Number(result?.fallback_est ?? 0) / total) * 100),
      lowConfidencePct: Math.round((Number(result?.low_conf ?? 0) / total) * 100),
    };
  }
}


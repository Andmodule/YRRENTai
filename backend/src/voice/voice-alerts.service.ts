import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, type FindOptionsWhere } from 'typeorm';
import {
  VoiceAlertRuleEntity,
  AlertComparator,
} from './entities/voice-alert-rule.entity';
import { VoiceAlertEntity, AlertSeverity, AlertStatus } from './entities/voice-alert.entity';
import {
  AlertMetricKey,
  DEFAULT_ALERT_THRESHOLDS,
  ALERT_METRIC_KEYS,
  ALERT_AUTO_RESOLVE_STREAK,
} from './constants/voice-alert-thresholds';
import { VoiceStatsService } from './voice-stats.service';
import { VoiceAuditService } from './voice-audit.service';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AlertFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  propertyId?: string;
  provider?: string;
}

export interface AlertRuleFilters {
  ownerId?: string;
  propertyId?: string;
  enabled?: boolean;
}

export interface UpsertAlertRuleDto {
  ownerId: string;
  propertyId?: string;
  provider?: string;
  metricKey: AlertMetricKey;
  warningThreshold?: number;
  criticalThreshold?: number;
  comparator?: AlertComparator;
  windowMinutes?: number;
  enabled?: boolean;
}

export interface EvaluateAlertsResult {
  created: number;
  refreshed: number;
  recovering: number;
  autoResolved: number;
}

// ── Internal metric snapshot ──────────────────────────────────────────────────

interface MetricSnapshot {
  fallbackRate: number;
  escalationRate: number;
  lowConfidenceRate: number;
  p95LatencyMs: number | null;
  webhookFailures24h: number;
  failedTransfers24h: number;
  emergencyTriggers24h: number;
}

@Injectable()
export class VoiceAlertsService {
  private readonly logger = new Logger(VoiceAlertsService.name);

  constructor(
    @InjectRepository(VoiceAlertRuleEntity)
    private readonly ruleRepo: Repository<VoiceAlertRuleEntity>,
    @InjectRepository(VoiceAlertEntity)
    private readonly alertRepo: Repository<VoiceAlertEntity>,
    private readonly statsService: VoiceStatsService,
    private readonly auditService: VoiceAuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listActiveAlerts(filters: AlertFilters = {}): Promise<VoiceAlertEntity[]> {
    const qb = this.alertRepo.createQueryBuilder('a')
      .leftJoinAndSelect('a.rule', 'rule')
      .orderBy('a.severity', 'DESC')
      .addOrderBy('a.lastTriggeredAt', 'DESC');

    qb.andWhere('a.status = :status', { status: filters.status ?? 'active' });
    if (filters.severity) qb.andWhere('a.severity = :sev', { sev: filters.severity });
    if (filters.propertyId) qb.andWhere('a.propertyId = :pid', { pid: filters.propertyId });
    if (filters.provider) qb.andWhere('a.provider = :prov', { prov: filters.provider });

    return qb.getMany();
  }

  async listAlertRules(filters: AlertRuleFilters = {}): Promise<VoiceAlertRuleEntity[]> {
    const where: FindOptionsWhere<VoiceAlertRuleEntity> = {};
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.propertyId !== undefined) {
      where.propertyId = filters.propertyId ? filters.propertyId : IsNull();
    }
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    return this.ruleRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async upsertAlertRule(dto: UpsertAlertRuleDto): Promise<VoiceAlertRuleEntity> {
    const defaults = DEFAULT_ALERT_THRESHOLDS[dto.metricKey];

    const existing = await this.ruleRepo.findOne({
      where: {
        ownerId: dto.ownerId,
        metricKey: dto.metricKey,
        propertyId: dto.propertyId != null ? dto.propertyId : IsNull(),
        provider: dto.provider != null ? dto.provider : IsNull(),
      },
    });

    const rule = existing ?? this.ruleRepo.create({
      ownerId: dto.ownerId,
      metricKey: dto.metricKey,
      propertyId: dto.propertyId ?? null,
      provider: dto.provider ?? null,
    });

    rule.warningThreshold  = dto.warningThreshold  ?? rule.warningThreshold  ?? defaults.warning;
    rule.criticalThreshold = dto.criticalThreshold ?? rule.criticalThreshold ?? defaults.critical;
    rule.comparator        = dto.comparator        ?? rule.comparator        ?? 'gt';
    rule.windowMinutes     = dto.windowMinutes     ?? rule.windowMinutes     ?? 60;
    rule.enabled           = dto.enabled           ?? rule.enabled           ?? true;

    return this.ruleRepo.save(rule);
  }

  async acknowledgeAlert(alertId: string, actorId: string, actorRole = 'manager'): Promise<VoiceAlertEntity> {
    const alert = await this.alertRepo.findOneBy({ id: alertId });
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`);

    alert.status = 'acknowledged';
    alert.acknowledgedBy = actorId;
    alert.acknowledgedAt = new Date();
    await this.alertRepo.save(alert);

    await this.auditService.log({
      actorId, actorRole,
      actionType: 'alert_acknowledged',
      entityType: 'voice_alert', entityId: alertId,
      propertyId: alert.propertyId ?? undefined,
      metadata: { metricKey: alert.metricKey, severity: alert.severity, value: alert.currentValue },
    });

    return alert;
  }

  async resolveAlert(alertId: string, actorId: string, actorRole = 'manager'): Promise<VoiceAlertEntity> {
    const alert = await this.alertRepo.findOneBy({ id: alertId });
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`);

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    await this.alertRepo.save(alert);

    await this.auditService.log({
      actorId, actorRole,
      actionType: 'alert_resolved',
      entityType: 'voice_alert', entityId: alertId,
      propertyId: alert.propertyId ?? undefined,
      metadata: { metricKey: alert.metricKey, severity: alert.severity, value: alert.currentValue },
    });

    return alert;
  }

  // ── Evaluation with anti-flapping ─────────────────────────────────────────

  /**
   * Core evaluation loop:
   * 1. Build metric snapshot via VoiceStatsService.
   * 2. For each enabled rule:
   *    a. If metric breaches threshold → create or refresh existing active/acked alert,
   *       reset recoveryStreak to 0.
   *    b. If metric is healthy → increment recoveryStreak.
   *       Auto-resolve only when recoveryStreak >= ALERT_AUTO_RESOLVE_STREAK (anti-flapping).
   */
  async evaluateAlerts(filters: { propertyId?: string; provider?: string } = {}): Promise<EvaluateAlertsResult> {
    const rules = await this.ruleRepo.find({ where: { enabled: true } });
    if (rules.length === 0) return { created: 0, refreshed: 0, recovering: 0, autoResolved: 0 };

    const snapshot = await this.buildMetricSnapshot(filters.propertyId);
    const result: EvaluateAlertsResult = { created: 0, refreshed: 0, recovering: 0, autoResolved: 0 };

    for (const rule of rules) {
      // Skip rules scoped to a different property/provider
      if (rule.propertyId && filters.propertyId && rule.propertyId !== filters.propertyId) continue;
      if (rule.provider  && filters.provider  && rule.provider  !== filters.provider)  continue;

      const value = snapshot[rule.metricKey];
      if (value === null || value === undefined) continue;

      const defaults = DEFAULT_ALERT_THRESHOLDS[rule.metricKey];
      const warnT = rule.warningThreshold  ?? defaults.warning;
      const critT = rule.criticalThreshold ?? defaults.critical;

      const exceeds = (v: number, t: number): boolean =>
        rule.comparator === 'gte' ? v >= t : v > t;

      let severity: AlertSeverity | null = null;
      let threshold = 0;

      if (exceeds(value, critT)) {
        severity = 'critical'; threshold = critT;
      } else if (exceeds(value, warnT)) {
        severity = 'warning'; threshold = warnT;
      }

      // Find existing non-resolved alert for this rule scope
      const existing = await this.alertRepo.findOne({
        where: {
          ruleId: rule.id,
          status: In(['active', 'acknowledged'] as AlertStatus[]),
        },
      });

      if (severity !== null) {
        // Metric is breaching — create or refresh
        if (existing) {
          existing.currentValue   = value;
          existing.severity       = severity;
          existing.thresholdValue = threshold;
          existing.lastTriggeredAt = new Date();
          existing.recoveryStreak  = 0;        // reset anti-flap counter
          await this.alertRepo.save(existing);
          result.refreshed++;
        } else {
          await this.alertRepo.insert({
            ruleId:          rule.id,
            severity,
            metricKey:       rule.metricKey,
            currentValue:    value,
            thresholdValue:  threshold,
            propertyId:      rule.propertyId ?? filters.propertyId ?? null,
            provider:        rule.provider   ?? filters.provider   ?? null,
            status:          'active',
            recoveryStreak:  0,
            lastTriggeredAt: new Date(),
          });
          result.created++;
          this.logger.warn(`New ${severity} alert: ${rule.metricKey} = ${value} (threshold ${threshold})`);
        }
      } else if (existing) {
        // Metric is healthy — increment recovery streak
        existing.recoveryStreak = (existing.recoveryStreak ?? 0) + 1;

        if (existing.recoveryStreak >= ALERT_AUTO_RESOLVE_STREAK) {
          // Cooldown complete — safe to auto-resolve
          existing.status = 'resolved';
          existing.resolvedAt = new Date();
          await this.alertRepo.save(existing);
          result.autoResolved++;
          this.logger.log(`Auto-resolved alert ${existing.id} after ${existing.recoveryStreak} recovery cycles`);
        } else {
          await this.alertRepo.save(existing);
          result.recovering++;
        }
      }
    }

    return result;
  }

  /** Bootstrap global (non-property-specific) default rules for an owner if missing. */
  async applyDefaultRulesIfMissing(ownerId: string): Promise<void> {
    for (const metricKey of ALERT_METRIC_KEYS) {
      const exists = await this.ruleRepo.findOne({
        where: { ownerId, metricKey, propertyId: IsNull() },
      });
      if (!exists) {
        await this.upsertAlertRule({ ownerId, metricKey });
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async buildMetricSnapshot(propertyId?: string): Promise<MetricSnapshot> {
    const [stats, health] = await Promise.all([
      this.statsService.getOverviewStats(propertyId),
      this.statsService.getSystemHealth('24h'),
    ]);

    return {
      fallbackRate:         (stats.fallbackPct ?? 0) / 100,
      escalationRate:       (stats.escalatedPct ?? 0) / 100,
      lowConfidenceRate:    (stats.lowConfidencePct ?? 0) / 100,
      p95LatencyMs:         stats.p95TurnLatencyMs,
      webhookFailures24h:   health.webhookFailureCount,
      failedTransfers24h:   health.failedTransfersLast24h,
      emergencyTriggers24h: health.emergencyGuardTriggers,
    };
  }
}

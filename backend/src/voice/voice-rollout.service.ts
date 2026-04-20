import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual } from 'typeorm';
import { PropertyVoiceRolloutEntity, RolloutCohort } from './entities/property-voice-rollout.entity';
import { VoiceAlertEntity } from './entities/voice-alert.entity';
import { CallSessionEntity } from './entities/call-session.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { VoiceAuditService } from './voice-audit.service';

export interface UpdateRolloutDto {
  cohort?: RolloutCohort;
  enabled?: boolean;
  provider?: string;
  confidenceThresholdOverride?: number | null;
  afterHoursMode?: string | null;
  exportAllowed?: boolean;
  notes?: string | null;
  actorId: string;
  actorRole?: string;
  /** Required when moving to 'stable' cohort — explicit confirmation gate */
  confirmStableRollout?: boolean;
}

export interface RolloutDashboardProperty {
  propertyId: string;
  propertyName: string | null;
  cohort: RolloutCohort;
  enabled: boolean;
  provider: string;
  callsLast7d: number;
  fallbackRate: number | null;
  activeAlertsCount: number;
  lastCallAt: Date | null;
  warningState: string[];
}

export interface RolloutDashboard {
  summary: {
    byCohort: Record<RolloutCohort, number>;
    byProvider: Record<string, number>;
    totalEnabled: number;
    totalDisabled: number;
  };
  properties: RolloutDashboardProperty[];
}

const ACTIVE_STATUSES = ['ringing', 'in_progress', 'ai_handling', 'handoff_pending'];

@Injectable()
export class VoiceRolloutService {
  constructor(
    @InjectRepository(PropertyVoiceRolloutEntity)
    private readonly rolloutRepo: Repository<PropertyVoiceRolloutEntity>,
    @InjectRepository(VoiceAlertEntity)
    private readonly alertRepo: Repository<VoiceAlertEntity>,
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    private readonly auditService: VoiceAuditService,
  ) {}

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getRolloutDashboard(): Promise<RolloutDashboard> {
    const [rollouts, properties] = await Promise.all([
      this.rolloutRepo.find(),
      this.propertyRepo.find({ select: ['id', 'name'] }),
    ]);

    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const propMap = new Map(properties.map((p) => [p.id, p]));

    const rows: RolloutDashboardProperty[] = [];
    const cohortCount: Record<RolloutCohort, number> = { disabled: 0, pilot: 0, beta: 0, stable: 0 };
    const providerCount: Record<string, number> = {};
    let totalEnabled = 0;
    let totalDisabled = 0;

    for (const r of rollouts) {
      const [sessions, activeAlerts] = await Promise.all([
        this.sessionRepo.find({
          where: { propertyId: r.propertyId, createdAt: MoreThanOrEqual(since7d) },
          select: ['id', 'avgTurnLatencyMs', 'turnCount', 'status', 'createdAt'],
          order: { createdAt: 'DESC' },
        }),
        this.alertRepo.count({ where: { propertyId: r.propertyId, status: 'active' } }),
      ]);

      const lastCallAt = sessions[0]?.createdAt ?? null;
      const callsLast7d = sessions.length;

      // Rough fallback rate from session avgTurnLatencyMs heuristic
      const fallbackRate: number | null = null; // computed from reviews if needed; skip for perf

      // Warning state
      const warningState: string[] = [];
      if (activeAlerts > 0) warningState.push('active_alerts');
      if (r.enabled && callsLast7d === 0) warningState.push('no_recent_calls');

      cohortCount[r.cohort] = (cohortCount[r.cohort] ?? 0) + 1;
      providerCount[r.provider] = (providerCount[r.provider] ?? 0) + 1;
      if (r.enabled) totalEnabled++; else totalDisabled++;

      rows.push({
        propertyId: r.propertyId,
        propertyName: propMap.get(r.propertyId)?.name ?? null,
        cohort: r.cohort,
        enabled: r.enabled,
        provider: r.provider,
        callsLast7d,
        fallbackRate,
        activeAlertsCount: activeAlerts,
        lastCallAt,
        warningState,
      });
    }

    return {
      summary: {
        byCohort: cohortCount,
        byProvider: providerCount,
        totalEnabled,
        totalDisabled,
      },
      properties: rows.sort((a, b) => b.callsLast7d - a.callsLast7d),
    };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updatePropertyRollout(propertyId: string, dto: UpdateRolloutDto): Promise<PropertyVoiceRolloutEntity> {
    let rollout = await this.rolloutRepo.findOne({ where: { propertyId } });
    if (!rollout) {
      rollout = this.rolloutRepo.create({ propertyId, cohort: 'disabled', enabled: false, provider: 'retell' });
    }

    const prev = { cohort: rollout.cohort, enabled: rollout.enabled, provider: rollout.provider };

    if (dto.cohort !== undefined) {
      // Guard: stable requires explicit confirmation to prevent accidental mass rollout
      if (dto.cohort === 'stable' && !dto.confirmStableRollout) {
        throw new BadRequestException('Moving to "stable" cohort requires confirmStableRollout=true. This enables voice for all guests — confirm intentionally.');
      }
      // Guard: disabled cohort forces enabled=false
      if (dto.cohort === 'disabled' && (dto.enabled ?? rollout.enabled)) {
        dto.enabled = false;
      }
      rollout.cohort = dto.cohort;
    }
    if (dto.enabled !== undefined) {
      if (dto.enabled && rollout.cohort === 'disabled') {
        throw new BadRequestException('Cannot enable voice for a property in cohort "disabled". Move to pilot/beta/stable first.');
      }
      // Guard: cannot enable without a provider configured
      const effectiveProvider = dto.provider ?? rollout.provider;
      if (dto.enabled && (!effectiveProvider || effectiveProvider.trim() === '')) {
        throw new BadRequestException('Cannot enable voice: provider is not set. Set provider (retell | vapi) first.');
      }
      rollout.enabled = dto.enabled;
    }
    if (dto.provider !== undefined) rollout.provider = dto.provider;
    if (dto.confidenceThresholdOverride !== undefined) rollout.confidenceThresholdOverride = dto.confidenceThresholdOverride;
    if (dto.afterHoursMode !== undefined) rollout.afterHoursMode = dto.afterHoursMode;
    if (dto.exportAllowed !== undefined) rollout.exportAllowed = dto.exportAllowed;
    if (dto.notes !== undefined) rollout.notes = dto.notes;
    rollout.updatedBy = dto.actorId;

    await this.rolloutRepo.save(rollout);

    // Audit
    const changes: Record<string, unknown> = {};
    if (prev.cohort !== rollout.cohort) changes['cohort'] = { from: prev.cohort, to: rollout.cohort };
    if (prev.enabled !== rollout.enabled) changes['enabled'] = { from: prev.enabled, to: rollout.enabled };
    if (prev.provider !== rollout.provider) changes['provider'] = { from: prev.provider, to: rollout.provider };

    if (Object.keys(changes).length > 0) {
      await this.auditService.log({
        actorId: dto.actorId,
        actorRole: dto.actorRole ?? 'manager',
        actionType: dto.cohort !== undefined ? 'cohort_changed' : 'rollout_changed',
        entityType: 'property_voice_rollout',
        entityId: rollout.id,
        propertyId,
        metadata: { changes },
      });
    }

    return rollout;
  }

  async bulkMoveCohort(
    propertyIds: string[],
    cohort: RolloutCohort,
    dto: { actorId: string; actorRole?: string; confirmStableRollout?: boolean },
  ): Promise<number> {
    if (propertyIds.length === 0) return 0;

    // Guard: stable bulk move requires explicit confirmation
    if (cohort === 'stable' && !dto.confirmStableRollout) {
      throw new BadRequestException(
        'Bulk move to "stable" requires confirmStableRollout=true. ' +
        'This enables production voice for all selected properties.',
      );
    }

    for (const propertyId of propertyIds) {
      await this.updatePropertyRollout(propertyId, {
        cohort,
        enabled:              cohort === 'disabled' ? false : undefined,
        confirmStableRollout: dto.confirmStableRollout,
        actorId:              dto.actorId,
        actorRole:            dto.actorRole,
      });
    }

    await this.auditService.log({
      actorId: dto.actorId,
      actorRole: dto.actorRole ?? 'manager',
      actionType: 'bulk_cohort_changed',
      metadata: { propertyIds, cohort, count: propertyIds.length },
    });

    return propertyIds.length;
  }

  async getOrCreate(propertyId: string): Promise<PropertyVoiceRolloutEntity> {
    const existing = await this.rolloutRepo.findOne({ where: { propertyId } });
    if (existing) return existing;
    return this.rolloutRepo.save(this.rolloutRepo.create({
      propertyId, cohort: 'disabled', enabled: false, provider: 'retell',
    }));
  }
}

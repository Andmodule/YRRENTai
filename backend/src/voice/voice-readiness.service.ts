import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { PropertyVoiceRolloutEntity } from './entities/property-voice-rollout.entity';
import { VoiceAlertRuleEntity } from './entities/voice-alert-rule.entity';
import { CallReviewEntity } from './entities/call-review.entity';
import { VoiceStatsService } from './voice-stats.service';
import type { EnvConfig } from '../config/env.schema';

// ── Public types ──────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type ReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
  details?: string;
}

export interface GoLiveReadiness {
  overallStatus: ReadinessStatus;
  checkedAt: string;
  checks: ReadinessCheck[];
  env: {
    provider: string;
    requiredKeysPresent: boolean;
    missingKeys: string[];
    voiceFeatureFlagEnabled: boolean;
  };
  provider: {
    configured: boolean;
    mode: string;
    inboundEnabled: boolean;
  };
  webhook: {
    urlConfigured: boolean;
    signingSecretPresent: boolean;
  };
  handoff: {
    transferNumberPresent: boolean;
    didMapPresent: boolean;
  };
  rollout: {
    enabledPropertiesCount: number;
    pilotCount: number;
    betaCount: number;
    stableCount: number;
    disabledCount: number;
  };
  alerts: {
    activeRuleCount: number;
    hasDefaultCriticalCoverage: boolean;
  };
  qa: {
    pendingReviewsCount: number;
    assignedOpenReviewsCount: number;
    unassignedOpenReviewsCount: number;
  };
}

// ── Critical metrics that MUST have a rule for go-live ───────────────────────
const CRITICAL_ALERT_METRICS = [
  'fallbackRate',
  'escalationRate',
  'webhookFailures24h',
  'emergencyTriggers24h',
] as const;

@Injectable()
export class VoiceReadinessService {
  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    @InjectRepository(PropertyVoiceRolloutEntity)
    private readonly rolloutRepo: Repository<PropertyVoiceRolloutEntity>,
    @InjectRepository(VoiceAlertRuleEntity)
    private readonly alertRuleRepo: Repository<VoiceAlertRuleEntity>,
    @InjectRepository(CallReviewEntity)
    private readonly reviewRepo: Repository<CallReviewEntity>,
    private readonly statsService: VoiceStatsService,
  ) {}

  // ── Main entry ────────────────────────────────────────────────────────────

  async getGoLiveReadiness(): Promise<GoLiveReadiness> {
    const [
      envResult,
      providerResult,
      webhookResult,
      handoffResult,
      rolloutResult,
      alertResult,
      qaResult,
    ] = await Promise.all([
      this.validateEnvConfiguration(),
      this.validateProviderConfiguration(),
      this.validateWebhookConfiguration(),
      this.validateHandoffConfiguration(),
      this.validateRolloutConfiguration(),
      this.validateAlertCoverage(),
      this.validateQaCoverage(),
    ]);

    const checks: ReadinessCheck[] = [
      ...envResult.checks,
      ...providerResult.checks,
      ...webhookResult.checks,
      ...handoffResult.checks,
      ...rolloutResult.checks,
      ...alertResult.checks,
      ...qaResult.checks,
    ];

    const hasBlocking = checks.some((c) => c.status === 'fail');
    const hasWarnings = checks.some((c) => c.status === 'warn');
    const overallStatus: ReadinessStatus = hasBlocking
      ? 'blocked'
      : hasWarnings
        ? 'warning'
        : 'ready';

    return {
      overallStatus,
      checkedAt: new Date().toISOString(),
      checks,
      env: envResult.data,
      provider: providerResult.data,
      webhook: webhookResult.data,
      handoff: handoffResult.data,
      rollout: rolloutResult.data,
      alerts: alertResult.data,
      qa: qaResult.data,
    };
  }

  // ── Individual validators ─────────────────────────────────────────────────

  async validateEnvConfiguration(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['env'];
  }> {
    const provider = this.config.get('INBOUND_VOICE_PROVIDER', { infer: true }) ?? 'retell';
    const ffVoice = this.config.get('FF_VOICE_ENABLED', { infer: true });
    const checks: ReadinessCheck[] = [];
    const missingKeys: string[] = [];

    // Provider API key
    const providerApiKey = provider === 'vapi'
      ? this.config.get('VAPI_API_KEY', { infer: true })
      : this.config.get('RETELL_API_KEY', { infer: true });
    const apiKeyName = provider === 'vapi' ? 'VAPI_API_KEY' : 'RETELL_API_KEY';

    if (!providerApiKey) {
      missingKeys.push(apiKeyName);
      checks.push({
        key: 'env_provider_api_key',
        label: `${provider.toUpperCase()} API key`,
        status: 'fail',
        message: `${apiKeyName} is not set`,
        details: `Required for voice provider authentication`,
      });
    } else {
      checks.push({ key: 'env_provider_api_key', label: `${provider.toUpperCase()} API key`, status: 'pass', message: `${apiKeyName} present` });
    }

    // Webhook secret
    const webhookSecret = provider === 'vapi'
      ? this.config.get('VAPI_WEBHOOK_SECRET', { infer: true })
      : (this.config.get('RETELL_WEBHOOK_SECRET', { infer: true }) ?? this.config.get('RETELL_API_KEY', { infer: true }));
    const secretName = provider === 'vapi' ? 'VAPI_WEBHOOK_SECRET' : 'RETELL_WEBHOOK_SECRET';

    if (!webhookSecret) {
      missingKeys.push(secretName);
      checks.push({ key: 'env_webhook_secret', label: 'Webhook signing secret', status: 'warn', message: `${secretName} not set — webhook signature validation disabled` });
    } else {
      checks.push({ key: 'env_webhook_secret', label: 'Webhook signing secret', status: 'pass', message: `${secretName} present` });
    }

    // Feature flag
    if (!ffVoice) {
      checks.push({ key: 'env_ff_voice', label: 'FF_VOICE_ENABLED', status: 'warn', message: 'Feature flag is false — voice AI disabled globally', details: 'Set FF_VOICE_ENABLED=true to enable' });
    } else {
      checks.push({ key: 'env_ff_voice', label: 'FF_VOICE_ENABLED', status: 'pass', message: 'Voice feature flag enabled' });
    }

    // DID mapping
    const didMap = this.config.get('INBOUND_DID_PROPERTY_MAP', { infer: true });
    if (!didMap) {
      missingKeys.push('INBOUND_DID_PROPERTY_MAP');
      checks.push({ key: 'env_did_map', label: 'DID→Property mapping', status: 'warn', message: 'INBOUND_DID_PROPERTY_MAP not set — inbound calls cannot resolve property', details: 'Format: +7999…:uuid1,+7999…:uuid2' });
    } else {
      checks.push({ key: 'env_did_map', label: 'DID→Property mapping', status: 'pass', message: `Mapping configured (${didMap.split(',').length} DID(s))` });
    }

    // Retell-specific checks
    if (String(provider) === 'retell') {
      const agentId       = this.config.get('RETELL_AGENT_ID', { infer: true });
      const inboundNumber = this.config.get('RETELL_INBOUND_NUMBER', { infer: true });
      const publicUrl     = this.config.get('PUBLIC_BACKEND_URL', { infer: true });

      if (!agentId) {
        missingKeys.push('RETELL_AGENT_ID');
        checks.push({ key: 'env_retell_agent_id', label: 'Retell Agent ID', status: 'warn', message: 'RETELL_AGENT_ID not set — inbound webhook cannot override agent', details: 'Copy agent_id from Retell dashboard → Agents' });
      } else {
        checks.push({ key: 'env_retell_agent_id', label: 'Retell Agent ID', status: 'pass', message: 'RETELL_AGENT_ID configured' });
      }

      if (!inboundNumber) {
        checks.push({ key: 'env_retell_inbound_number', label: 'Retell Inbound Number', status: 'warn', message: 'RETELL_INBOUND_NUMBER not set — displayed as unknown in manager UI', details: 'Set to your Retell phone number in E.164 format' });
      } else {
        checks.push({ key: 'env_retell_inbound_number', label: 'Retell Inbound Number', status: 'pass', message: `Inbound number: ${String(inboundNumber)}` });
      }

      if (!publicUrl) {
        checks.push({ key: 'env_public_backend_url', label: 'PUBLIC_BACKEND_URL', status: 'warn', message: 'PUBLIC_BACKEND_URL not set — webhook URL cannot be displayed in settings', details: 'Set to your backend HTTPS URL, e.g. https://api.example.com' });
      } else {
        checks.push({ key: 'env_public_backend_url', label: 'Backend URL', status: 'pass', message: `Public URL: ${String(publicUrl)}` });
      }
    }

    return {
      checks,
      data: {
        provider: String(provider),
        requiredKeysPresent: missingKeys.length === 0,
        missingKeys,
        voiceFeatureFlagEnabled: !!ffVoice,
      },
    };
  }

  async validateProviderConfiguration(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['provider'];
  }> {
    const provider = this.config.get('INBOUND_VOICE_PROVIDER', { infer: true }) ?? 'retell';
    const apiKey = provider === 'vapi'
      ? this.config.get('VAPI_API_KEY', { infer: true })
      : this.config.get('RETELL_API_KEY', { infer: true });

    const configured = !!apiKey;
    const checks: ReadinessCheck[] = [{
      key: 'provider_configured',
      label: `${provider} provider`,
      status: configured ? 'pass' : 'fail',
      message: configured ? `${provider} API key present and provider active` : `${provider} API key missing`,
    }];

    return {
      checks,
      data: {
        configured,
        mode: String(provider),
        inboundEnabled: configured && !!this.config.get('FF_VOICE_ENABLED', { infer: true }),
      },
    };
  }

  async validateWebhookConfiguration(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['webhook'];
  }> {
    const provider = this.config.get('INBOUND_VOICE_PROVIDER', { infer: true }) ?? 'retell';
    const secret = provider === 'vapi'
      ? this.config.get('VAPI_WEBHOOK_SECRET', { infer: true })
      : (this.config.get('RETELL_WEBHOOK_SECRET', { infer: true }) ?? this.config.get('RETELL_API_KEY', { infer: true }));

    const checks: ReadinessCheck[] = [{
      key: 'webhook_secret',
      label: 'Webhook signing secret',
      status: secret ? 'pass' : 'warn',
      message: secret
        ? 'Webhook signature validation active'
        : 'No webhook secret — validation disabled (security risk in production)',
    }];

    return {
      checks,
      data: {
        urlConfigured: true, // Always true — NestJS handles the route
        signingSecretPresent: !!secret,
      },
    };
  }

  async validateHandoffConfiguration(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['handoff'];
  }> {
    const transferNumber = this.config.get('HANDOFF_TRANSFER_NUMBER', { infer: true });
    const didMap = this.config.get('INBOUND_DID_PROPERTY_MAP', { infer: true });

    const checks: ReadinessCheck[] = [
      {
        key: 'handoff_transfer_number',
        label: 'Handoff transfer number',
        status: transferNumber ? 'pass' : 'warn',
        message: transferNumber
          ? `HANDOFF_TRANSFER_NUMBER set (${String(transferNumber).slice(0, 4)}…)`
          : 'HANDOFF_TRANSFER_NUMBER not set — hard transfer to operator will fail',
        details: transferNumber ? undefined : 'Set E.164 format: +7XXXXXXXXXX',
      },
      {
        key: 'handoff_did_map',
        label: 'Inbound DID mapping',
        status: didMap ? 'pass' : 'warn',
        message: didMap ? 'DID map configured' : 'DID map missing — property resolution will fail',
      },
    ];

    return {
      checks,
      data: {
        transferNumberPresent: !!transferNumber,
        didMapPresent: !!didMap,
      },
    };
  }

  async validateRolloutConfiguration(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['rollout'];
  }> {
    const rollouts = await this.rolloutRepo.find();
    const counts = { disabled: 0, pilot: 0, beta: 0, stable: 0, enabled: 0 };
    for (const r of rollouts) {
      counts[r.cohort] = (counts[r.cohort] ?? 0) + 1;
      if (r.enabled) counts.enabled++;
    }

    const checks: ReadinessCheck[] = [];

    const activeCohortCount = counts.pilot + counts.beta + counts.stable;
    if (activeCohortCount === 0) {
      checks.push({ key: 'rollout_cohorts', label: 'Rollout cohorts', status: 'warn', message: 'No properties in pilot/beta/stable cohort', details: 'Move at least one property to pilot cohort to start testing' });
    } else {
      checks.push({ key: 'rollout_cohorts', label: 'Rollout cohorts', status: 'pass', message: `${activeCohortCount} propert${activeCohortCount === 1 ? 'y' : 'ies'} in active cohort(s)` });
    }

    if (counts.enabled === 0) {
      checks.push({ key: 'rollout_enabled', label: 'Enabled properties', status: 'warn', message: 'No properties with voice enabled', details: 'Enable at least one pilot property to receive calls' });
    } else {
      checks.push({ key: 'rollout_enabled', label: 'Enabled properties', status: 'pass', message: `${counts.enabled} propert${counts.enabled === 1 ? 'y' : 'ies'} enabled` });
    }

    return {
      checks,
      data: {
        enabledPropertiesCount: counts.enabled,
        pilotCount: counts.pilot,
        betaCount: counts.beta,
        stableCount: counts.stable,
        disabledCount: counts.disabled,
      },
    };
  }

  async validateAlertCoverage(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['alerts'];
  }> {
    const rules = await this.alertRuleRepo.find({ where: { enabled: true } });
    const coveredMetrics = new Set(rules.map((r) => r.metricKey));
    const missingCritical = CRITICAL_ALERT_METRICS.filter((m) => !coveredMetrics.has(m));
    const hasDefaultCriticalCoverage = missingCritical.length === 0;

    const checks: ReadinessCheck[] = [{
      key: 'alerts_coverage',
      label: 'Alert rule coverage',
      status: hasDefaultCriticalCoverage ? 'pass' : rules.length === 0 ? 'fail' : 'warn',
      message: hasDefaultCriticalCoverage
        ? `${rules.length} alert rules active — critical metrics covered`
        : rules.length === 0
          ? 'No alert rules defined — run bootstrap or create rules manually'
          : `${missingCritical.length} critical metric(s) without rules: ${missingCritical.join(', ')}`,
      details: rules.length === 0 ? 'POST /voice/readiness/bootstrap to apply defaults' : undefined,
    }];

    return {
      checks,
      data: { activeRuleCount: rules.length, hasDefaultCriticalCoverage },
    };
  }

  async validateQaCoverage(): Promise<{
    checks: ReadinessCheck[];
    data: GoLiveReadiness['qa'];
  }> {
    const [pending, assignedOpen, unassignedOpen] = await Promise.all([
      this.reviewRepo.count({ where: { status: 'open' } }),
      this.reviewRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...s)', { s: ['open', 'in_review'] })
        .andWhere('r.assigneeId IS NOT NULL')
        .getCount(),
      this.reviewRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...s)', { s: ['open', 'in_review'] })
        .andWhere('r.assigneeId IS NULL')
        .getCount(),
    ]);

    const checks: ReadinessCheck[] = [];

    if (unassignedOpen > 5) {
      checks.push({ key: 'qa_backlog', label: 'QA backlog', status: 'warn', message: `${unassignedOpen} unassigned open reviews — assign before pilot`, details: 'Go to QA page to assign reviewers' });
    } else {
      checks.push({ key: 'qa_backlog', label: 'QA backlog', status: 'pass', message: unassignedOpen === 0 ? 'No unassigned QA reviews' : `${unassignedOpen} unassigned review(s)` });
    }

    return {
      checks,
      data: { pendingReviewsCount: pending, assignedOpenReviewsCount: assignedOpen, unassignedOpenReviewsCount: unassignedOpen },
    };
  }

  // ── Bootstrap helper ──────────────────────────────────────────────────────

  /**
   * Safe idempotent bootstrap:
   * - Applies default alert rules if none exist for ownerId.
   * Call from POST /voice/readiness/bootstrap or on first manager login.
   */
  async bootstrapDefaults(ownerId: string): Promise<{
    alertRulesCreated: number;
    message: string;
  }> {
    const existing = await this.alertRuleRepo.count({ where: { ownerId } });
    if (existing > 0) {
      return { alertRulesCreated: 0, message: `${existing} alert rules already exist — skipped` };
    }

    const { DEFAULT_ALERT_THRESHOLDS, ALERT_METRIC_KEYS } = await import('./constants/voice-alert-thresholds');
    let created = 0;
    for (const metricKey of ALERT_METRIC_KEYS) {
      const defaults = DEFAULT_ALERT_THRESHOLDS[metricKey];
      await this.alertRuleRepo.save(
        this.alertRuleRepo.create({
          ownerId,
          metricKey,
          propertyId: null,
          provider: null,
          warningThreshold: defaults.warning,
          criticalThreshold: defaults.critical,
          comparator: 'gt',
          windowMinutes: 60,
          enabled: true,
        }),
      );
      created++;
    }
    return { alertRulesCreated: created, message: `Created ${created} default alert rules` };
  }
}

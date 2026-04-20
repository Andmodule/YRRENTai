import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
} from 'prom-client';

/**
 * Prometheus metrics for the voice AI module.
 * Follows the same pattern as TelegramMetricsService.
 * Exposed at GET /api/v1/metrics (METRICS_ENABLED=true).
 *
 * Key SLIs:
 *   - p50/p95/p99 per-turn latency (total, LLM, retrieval)
 *   - fallback rate, handoff rate, policy-bypass rate, emergency rate
 *   - duplicate event rate, webhook failure rate
 */
@Injectable()
export class VoiceMetricsService implements OnModuleInit {
  private readonly logger = new Logger(VoiceMetricsService.name);
  readonly registry = new Registry();

  // ── Latency histograms ─────────────────────────────────────────────────────
  readonly turnTotalMs: Histogram<'property_id' | 'provider'>;
  readonly llmLatencyMs: Histogram<'provider'>;
  readonly retrievalLatencyMs: Histogram<'property_id'>;

  // ── Call lifecycle counters ────────────────────────────────────────────────
  readonly callsTotal: Counter<'provider' | 'direction'>;
  readonly callsEnded: Counter<'provider' | 'ended_by'>;

  // ── Quality / reliability counters ────────────────────────────────────────
  readonly fallbackTotal: Counter<'reason'>;
  readonly handoffTotal: Counter<'mode' | 'escalation_reason'>;
  readonly emergencyGuardTotal: Counter<'decision'>;
  readonly policyBypassTotal: Counter<'decision'>;
  readonly duplicateEventTotal: Counter<'type'>;
  readonly webhookFailureTotal: Counter<'provider' | 'reason'>;
  readonly lowConfidenceTotal: Counter<'property_id'>;
  readonly kbMissTotal: Counter<'property_id'>;
  readonly structuredOutputFailureTotal: Counter<'attempt'>;

  // ── Active sessions gauge ─────────────────────────────────────────────────
  readonly activeSessions: Gauge<'provider' | 'status'>;

  constructor(private readonly config: ConfigService) {
    // Shared quantile buckets for voice latency
    const latencyBuckets = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

    this.turnTotalMs = new Histogram({
      name: 'rentai_voice_turn_total_ms',
      help: 'End-to-end AI turn latency (guest utterance → first TTS audio), ms',
      labelNames: ['property_id', 'provider'],
      buckets: latencyBuckets,
      registers: [this.registry],
    });

    this.llmLatencyMs = new Histogram({
      name: 'rentai_voice_llm_latency_ms',
      help: 'LLM inference latency per turn, ms',
      labelNames: ['provider'],
      buckets: latencyBuckets,
      registers: [this.registry],
    });

    this.retrievalLatencyMs = new Histogram({
      name: 'rentai_voice_retrieval_latency_ms',
      help: 'KB retrieval latency per turn, ms',
      labelNames: ['property_id'],
      buckets: [10, 25, 50, 100, 200, 400, 800, 1500],
      registers: [this.registry],
    });

    this.callsTotal = new Counter({
      name: 'rentai_voice_calls_total',
      help: 'Total inbound/outbound calls received',
      labelNames: ['provider', 'direction'],
      registers: [this.registry],
    });

    this.callsEnded = new Counter({
      name: 'rentai_voice_calls_ended_total',
      help: 'Calls that reached terminal state',
      labelNames: ['provider', 'ended_by'],
      registers: [this.registry],
    });

    this.fallbackTotal = new Counter({
      name: 'rentai_voice_fallback_total',
      help: 'Times circuit breaker fired a safe fallback response',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.handoffTotal = new Counter({
      name: 'rentai_voice_handoff_total',
      help: 'Handoff requests initiated',
      labelNames: ['mode', 'escalation_reason'],
      registers: [this.registry],
    });

    this.emergencyGuardTotal = new Counter({
      name: 'rentai_voice_emergency_guard_total',
      help: 'Pre-LLM emergency guard triggers',
      labelNames: ['decision'],
      registers: [this.registry],
    });

    this.policyBypassTotal = new Counter({
      name: 'rentai_voice_policy_bypass_total',
      help: 'Turns where pre-LLM guard bypassed the LLM',
      labelNames: ['decision'],
      registers: [this.registry],
    });

    this.duplicateEventTotal = new Counter({
      name: 'rentai_voice_duplicate_event_total',
      help: 'Idempotent duplicate events safely ignored',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.webhookFailureTotal = new Counter({
      name: 'rentai_voice_webhook_failure_total',
      help: 'Webhook signature validation failures or unprocessable events',
      labelNames: ['provider', 'reason'],
      registers: [this.registry],
    });

    this.lowConfidenceTotal = new Counter({
      name: 'rentai_voice_low_confidence_total',
      help: 'Turns where AI confidence fell below escalation threshold',
      labelNames: ['property_id'],
      registers: [this.registry],
    });

    this.kbMissTotal = new Counter({
      name: 'rentai_voice_kb_miss_total',
      help: 'KB searches that returned no relevant chunks',
      labelNames: ['property_id'],
      registers: [this.registry],
    });

    this.structuredOutputFailureTotal = new Counter({
      name: 'rentai_voice_structured_output_failure_total',
      help: 'LLM structured JSON parse failures requiring retry or fallback',
      labelNames: ['attempt'],
      registers: [this.registry],
    });

    this.activeSessions = new Gauge({
      name: 'rentai_voice_active_sessions',
      help: 'Currently active (non-terminal) call sessions',
      labelNames: ['provider', 'status'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    if (this.config.get<boolean>('METRICS_ENABLED') === true) {
      this.logger.log('Voice Prometheus metrics registered');
    }
  }

  /** Convenience: record a completed AI turn's full latency breakdown */
  recordTurn(opts: {
    propertyId: string;
    provider: string;
    turnTotalMs: number;
    llmMs: number;
    retrievalMs: number;
    confidence: number;
    wasFallback: boolean;
    policyBypassed: boolean;
    policyDecision?: string;
  }): void {
    this.turnTotalMs.observe({ property_id: opts.propertyId, provider: opts.provider }, opts.turnTotalMs);
    this.llmLatencyMs.observe({ provider: opts.provider }, opts.llmMs);
    this.retrievalLatencyMs.observe({ property_id: opts.propertyId }, opts.retrievalMs);

    if (opts.wasFallback) {
      this.fallbackTotal.inc({ reason: 'llm_failure' });
    }
    if (opts.policyBypassed && opts.policyDecision) {
      this.policyBypassTotal.inc({ decision: opts.policyDecision });
    }
    if (opts.confidence < 0.35) {
      this.lowConfidenceTotal.inc({ property_id: opts.propertyId });
    }
  }

  /** Expose the Prometheus text format (merge with existing registry if needed) */
  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

/**
 * Server-side defaults for alert thresholds.
 * Never hardcode these in UI — always fetch from /voice/alerts/rules.
 */

export type AlertMetricKey =
  | 'fallbackRate'
  | 'escalationRate'
  | 'lowConfidenceRate'
  | 'p95LatencyMs'
  | 'webhookFailures24h'
  | 'failedTransfers24h'
  | 'emergencyTriggers24h';

export const ALERT_METRIC_KEYS: AlertMetricKey[] = [
  'fallbackRate',
  'escalationRate',
  'lowConfidenceRate',
  'p95LatencyMs',
  'webhookFailures24h',
  'failedTransfers24h',
  'emergencyTriggers24h',
];

export interface AlertThreshold {
  warning: number;
  critical: number;
}

export const DEFAULT_ALERT_THRESHOLDS: Record<AlertMetricKey, AlertThreshold> = {
  fallbackRate:         { warning: 0.15,  critical: 0.25  },
  escalationRate:       { warning: 0.20,  critical: 0.35  },
  lowConfidenceRate:    { warning: 0.12,  critical: 0.20  },
  p95LatencyMs:         { warning: 1200,  critical: 1800  },
  webhookFailures24h:   { warning: 0,     critical: 3     },
  failedTransfers24h:   { warning: 1,     critical: 3     },
  emergencyTriggers24h: { warning: 0,     critical: 2     },
};

/**
 * Number of consecutive clean evaluation cycles before an active alert
 * is automatically resolved. Prevents flapping on borderline metrics.
 */
export const ALERT_AUTO_RESOLVE_STREAK = 3;

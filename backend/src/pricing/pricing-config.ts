import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PricingFlags = {
  /** ZODOMUS_ENABLED && ZODOMUS_PROMOTIONS_ENABLED. */
  enabled: boolean;
  /** No writes to Booking (create / activate / deactivate); reads are allowed. */
  dryRun: boolean;
  /** Pilot list of RentAI property ids; empty = all. */
  allowlist: ReadonlySet<string>;
  channelId: number;
  syncMinutes: number;
  queueIntervalSeconds: number;
  gapMs: number;
  verify: boolean;
  /** «Автоправила» (last-minute steps): needs `enabled` plus ZODOMUS_PROMOTIONS_AUTORULES_ENABLED. */
  autoRules: boolean;
};

/** Env values arrive transformed by envSchema (booleans/numbers); strings are tolerated for safety. */
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
  }
  return fallback;
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseAllowlist(raw: unknown): ReadonlySet<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class PricingConfig {
  private readonly logger = new Logger(PricingConfig.name);
  readonly flags: PricingFlags;

  constructor(config: ConfigService) {
    const zodomusEnabled = toBool(config.get('ZODOMUS_ENABLED'), false);
    const enabled = zodomusEnabled && toBool(config.get('ZODOMUS_PROMOTIONS_ENABLED'), false);
    this.flags = {
      enabled,
      autoRules: enabled && toBool(config.get('ZODOMUS_PROMOTIONS_AUTORULES_ENABLED'), false),
      // Default to dry run when the value is missing or unreadable.
      dryRun: toBool(config.get('ZODOMUS_PROMOTIONS_DRY_RUN'), true),
      allowlist: parseAllowlist(config.get('ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST')),
      channelId: toInt(config.get('ZODOMUS_PROMOTIONS_CHANNEL_ID'), 1),
      syncMinutes: toInt(config.get('ZODOMUS_PROMOTIONS_SYNC_MINUTES'), 30),
      queueIntervalSeconds: toInt(config.get('ZODOMUS_PROMOTIONS_QUEUE_INTERVAL_SECONDS'), 60),
      gapMs: Math.max(0, Number(config.get('ZODOMUS_PROMOTIONS_GAP_MS') ?? 2000) || 0),
      verify: toBool(config.get('ZODOMUS_PROMOTIONS_VERIFY'), true),
    };
    if (this.flags.enabled) {
      this.logger.log(
        `Booking promotions ENABLED — dryRun=${this.flags.dryRun}, allowlist=${this.flags.allowlist.size || 'all'}, channel=${this.flags.channelId}, autoRules=${this.flags.autoRules}`,
      );
    }
  }

  /** Create / reactivate on Booking is allowed for this property right now. */
  canWrite(propertyId: string): boolean {
    return !this.flags.dryRun && this.isInAllowlist(propertyId);
  }

  isInAllowlist(propertyId: string): boolean {
    return this.flags.allowlist.size === 0 || this.flags.allowlist.has(propertyId.toLowerCase());
  }
}

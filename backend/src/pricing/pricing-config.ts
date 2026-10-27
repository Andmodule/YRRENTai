import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PricingFlags = {
  /** ZODOMUS_ENABLED && ZODOMUS_PROMOTIONS_ENABLED. */
  enabled: boolean;
  /** No writes to Booking (create / activate / deactivate); reads are allowed. */
  dryRun: boolean;
  /** Pilot list: RentAI property ids and/or Booking hotel ids; empty = all. */
  allowlist: ReadonlySet<string>;
  channelId: number;
  syncMinutes: number;
  queueIntervalSeconds: number;
  gapMs: number;
  verify: boolean;
  /** «Автоправила» (last-minute steps): needs `enabled` plus ZODOMUS_PROMOTIONS_AUTORULES_ENABLED. */
  autoRules: boolean;
  /** «Заполненность» (discount suggestions): needs `enabled` plus ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED. */
  occupancy: boolean;
  /** «Цена для гостя» (read-only): needs `enabled` plus ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED. */
  guestPrice: boolean;
  /** «Базовая цена»: needs `guestPrice` plus ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED; sending also `canWrite`. */
  basePrice: boolean;
  /** «Автоцены»: needs `basePrice` plus ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED. */
  autoPrice: boolean;
  /** «Только показывать» of «Автоцены» (ZODOMUS_PROMOTIONS_AUTOPRICE_DRY_RUN, default true). */
  autoPriceDryRun: boolean;
  /** Local hour of the daily «Автоцены» run, in `autoPriceTimeZone`. */
  autoPriceHour: number;
  /** IANA zone of that hour (Europe/Warsaw by default). */
  autoPriceTimeZone: string;
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

function toHour(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/** A zone Intl knows; anything else (a typo on Render) falls back rather than breaking the timer. */
function toTimeZone(v: unknown, fallback: string): string {
  const tz = typeof v === 'string' ? v.trim() : '';
  if (!tz) return fallback;
  try {
    // The canonical spelling («europe/warsaw» → «Europe/Warsaw»): the tab compares it.
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return fallback;
  }
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
      occupancy: enabled && toBool(config.get('ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED'), false),
      guestPrice: enabled && toBool(config.get('ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED'), false),
      // Builds on «Цена для гостя» (profiles, prices typed per night): on only together with it.
      basePrice:
        enabled &&
        toBool(config.get('ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED'), false) &&
        toBool(config.get('ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED'), false),
      autoPrice:
        enabled &&
        toBool(config.get('ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED'), false) &&
        toBool(config.get('ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED'), false) &&
        toBool(config.get('ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED'), false),
      autoPriceDryRun: toBool(config.get('ZODOMUS_PROMOTIONS_AUTOPRICE_DRY_RUN'), true),
      autoPriceHour: toHour(config.get('ZODOMUS_PROMOTIONS_AUTOPRICE_HOUR'), 6),
      autoPriceTimeZone: toTimeZone(config.get('ZODOMUS_PROMOTIONS_AUTOPRICE_TZ'), 'Europe/Warsaw'),
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
        `Booking promotions ENABLED — dryRun=${this.flags.dryRun}, allowlist=${this.flags.allowlist.size || 'all'}, channel=${this.flags.channelId}, autoRules=${this.flags.autoRules}, occupancy=${this.flags.occupancy}, guestPrice=${this.flags.guestPrice}, basePrice=${this.flags.basePrice}, autoPrice=${this.flags.autoPrice} (dryRun=${this.flags.autoPriceDryRun})`,
      );
    }
  }

  /** Create / reactivate on Booking is allowed for this property right now. */
  canWrite(propertyId: string, externalPropertyId?: string | null): boolean {
    return !this.flags.dryRun && this.isInAllowlist(propertyId, externalPropertyId);
  }

  /**
   * The pilot list may name a property either way: by its RentAI id or by its Booking hotel id
   * (the number people see in the extranet — the one that ends up in the env by hand).
   */
  isInAllowlist(propertyId: string, externalPropertyId?: string | null): boolean {
    const list = this.flags.allowlist;
    if (list.size === 0 || list.has(propertyId.toLowerCase())) return true;
    const ext = externalPropertyId?.trim().toLowerCase();
    return !!ext && list.has(ext);
  }
}

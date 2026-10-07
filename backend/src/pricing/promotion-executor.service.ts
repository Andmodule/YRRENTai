import { Injectable, Logger } from '@nestjs/common';
import { ZodomusService } from '../integrations/zodomus/zodomus.service';
import { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import {
  buildBasicPromotionPayload,
  buildLastMinutePromotionPayload,
  classifyPromotionError,
  extractPromotionId,
  parsePromotionsResponse,
  type ParsedPromotion,
} from '../integrations/zodomus/zodomus-promotions.util';
import {
  extractRoomsFromRoomRatesBody,
  pickPrimaryRateId,
} from '../integrations/zodomus/zodomus-room-rates.util';
import {
  collectOtaNightlyPrices,
  extractZodomusInventoryDays,
} from '../integrations/zodomus/zodomus-inventory.util';
import { PricingConfig } from './pricing-config';
import { parseRuleStepMeta, type RuleStepMeta } from './pricing-rules.util';
import {
  addDaysYmd,
  guestPriceAfter,
  nightsInRange,
  promotionHash,
  promotionMarker,
  todayInTz,
  toMajor,
} from './pricing-math.util';
import type { PricePromotionEntity } from './entities/price-promotion.entity';
import type {
  PreviousPromotionId,
  PricePromotionTargetEntity,
  PromotionTargetPatch,
} from './entities/price-promotion-target.entity';
import type { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';

export type ExecutorContext = {
  target: PricePromotionTargetEntity;
  promotion: PricePromotionEntity;
  property: PropertyEntity;
  settings: PropertyPricingSettingsEntity | null;
};

export type ExecutorEvent = { action: string; message: string; details?: Record<string, unknown> };

export type ExecutorOutcome = {
  /** Fields to persist on the target. */
  patch: PromotionTargetPatch;
  /** Set for transient failures — the queue schedules a retry with backoff. */
  retry: { kind: string; message: string } | null;
  events: ExecutorEvent[];
};

/** Failure inside one step, already classified. */
class StepError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Longest stay window checked against the minimum price (one GET /availability). */
const FLOOR_CHECK_MAX_NIGHTS = 120;

/**
 * Applies the desired state of ONE target (one property inside a discount) to Booking via Zodomus.
 * Writes happen only when PricingConfig.canWrite() — dry run / pilot allowlist are enforced here.
 */
@Injectable()
export class PromotionExecutorService {
  private readonly logger = new Logger(PromotionExecutorService.name);

  constructor(
    private readonly zodomus: ZodomusService,
    private readonly propertyService: PropertyService,
    private readonly cfg: PricingConfig,
  ) {}

  async process(ctx: ExecutorContext): Promise<ExecutorOutcome> {
    try {
      const wantOn = ctx.promotion.status === 'active' && ctx.target.desiredState === 'on';
      return wantOn ? await this.turnOn(ctx) : await this.turnOff(ctx);
    } catch (e) {
      const err = e instanceof StepError ? e : this.toStepError(e);
      return this.failure(err);
    }
  }

  // ─── ON ────────────────────────────────────────────────────────────────────

  private async turnOn(ctx: ExecutorContext): Promise<ExecutorOutcome> {
    const { target, promotion, property, settings } = ctx;
    if (promotion.source !== 'rentai') {
      return this.done({ needsPush: false }, []);
    }
    // «Автоправила»: a step of a last-minute ladder. Everything below is shared with ordinary discounts.
    const rule = promotion.promotionType === 'last_minute' ? parseRuleStepMeta(promotion.externalMeta) : null;
    if (promotion.promotionType === 'last_minute') {
      if (!this.cfg.flags.autoRules) {
        return this.skip(
          'AUTORULES_DISABLED',
          'Автоправила выключены (ZODOMUS_PROMOTIONS_AUTORULES_ENABLED=false) — на Booking ничего не отправлено',
        );
      }
      if (!rule) {
        return this.skip('RULE_INVALID', 'У шага правила нет корректных параметров «за N дней/часов»');
      }
    }
    if (!this.cfg.isInAllowlist(property.id)) {
      return this.skip(
        'NOT_IN_ALLOWLIST',
        'Пилотный режим: объекта нет в ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST',
      );
    }
    if (!promotion.stayFrom || !promotion.stayTo) {
      return this.skip('NO_DATES', 'У скидки не заданы даты проживания');
    }

    const today = todayInTz(property.timezone);
    if (promotion.stayTo < today) {
      return this.skip('STAY_DATES_PASSED', 'Даты проживания уже прошли');
    }
    // Booking rejects past stay dates (STAY_DATE_NOT_IN_FUTURE) — send from today when the start has passed.
    const sendFrom = promotion.stayFrom < today ? today : promotion.stayFrom;

    const { roomIds, rateIds } = await this.resolveRoomRate(
      property,
      target.channelId,
      target.externalPropertyId,
    );

    if (promotion.protectMinPrice) {
      const minPrice = toMajor(settings?.minPriceMinor);
      if (minPrice && minPrice > 0) {
        const lowest = await this.lowestNightlyPrice(
          target.channelId,
          target.externalPropertyId,
          roomIds[0]!,
          rateIds[0]!,
          sendFrom,
          promotion.stayTo,
          promotion.activeWeekdays,
        );
        if (!lowest) {
          return this.skip(
            'PRICE_UNKNOWN',
            'Не удалось получить цену из Booking — без неё нельзя проверить минимальную цену',
            {
              roomIds,
              rateIds,
            },
          );
        }
        const guest = guestPriceAfter(lowest.price, settings?.geniusPct, promotion.discountPct);
        if (guest < minPrice) {
          return this.skip(
            'BELOW_MIN_PRICE',
            `Для гостей Genius цена опустилась бы до ${guest.toFixed(2)} при минимуме ${minPrice.toFixed(2)} (${lowest.date})`,
            {
              roomIds,
              rateIds,
              lowestPrice: lowest.price,
              lowestDate: lowest.date,
              guestPrice: Math.round(guest * 100) / 100,
              minPrice,
            },
          );
        }
      }
    }

    // Ordinary discounts keep exactly the old fingerprint (a change would recreate live promotions).
    const hash = promotionHash({
      discountPct: promotion.discountPct,
      stayFrom: promotion.stayFrom,
      stayTo: promotion.stayTo,
      weekdays: promotion.activeWeekdays ?? null,
      roomIds,
      rateIds,
      ...(rule ? { type: 'last_minute', lastMinute: rule.lastMinute, bookTime: rule.bookTime } : {}),
    });
    const existingId = target.externalPromotionId;
    const recreate = !!existingId && target.pushedHash !== null && target.pushedHash !== hash;
    const reactivate = !!existingId && !recreate;
    const version = recreate ? target.version + 1 : target.version;
    const marker = promotionMarker(target.id, version);
    const payloadInput = {
      channelId: target.channelId,
      externalPropertyId: target.externalPropertyId,
      marker,
      discountPct: promotion.discountPct,
      stayFrom: sendFrom,
      stayTo: promotion.stayTo,
      weekdays: promotion.activeWeekdays,
      roomIds,
      rateIds,
    };
    const payload = rule
      ? buildLastMinutePromotionPayload({
          ...payloadInput,
          lastMinute: rule.lastMinute,
          bookTime: rule.bookTime,
        })
      : buildBasicPromotionPayload(payloadInput);

    if (!this.cfg.canWrite(property.id)) {
      const what = reactivate
        ? `включили бы снова акцию ${existingId}`
        : recreate
          ? `создали бы новую акцию вместо ${existingId} и выключили бы старую`
          : 'создали бы акцию';
      return this.done(
        {
          state: 'dry_run',
          needsPush: false,
          roomIds,
          rateIds,
          lastErrorCode: null,
          lastError: null,
        },
        [
          {
            action: 'dry_run',
            message: `Пробный режим: ${what} −${promotion.discountPct}% (на Booking ничего не отправлено)`,
            details: { payload },
          },
        ],
      );
    }

    const events: ExecutorEvent[] = [];
    const patch: PromotionTargetPatch = { roomIds, rateIds };
    let promotionId: string;

    if (reactivate && existingId) {
      if (target.state !== 'on') {
        await this.zodomus.activatePromotion(
          target.channelId,
          target.externalPropertyId,
          existingId,
        );
        events.push({
          action: 'activated',
          message: `Акция ${existingId} снова включена на Booking`,
        });
      }
      promotionId = existingId;
      patch.pushedHash = target.pushedHash ?? hash;
    } else {
      const adopted = await this.findByMarker(target.channelId, target.externalPropertyId, marker);
      if (adopted) {
        promotionId = adopted.id;
        events.push({
          action: 'adopted',
          message: `Найдена ранее созданная акция ${adopted.id} — повторно не создаём`,
        });
      } else {
        const res = await this.zodomus.createPromotion(payload);
        const id = extractPromotionId(res);
        if (!id) {
          throw new StepError(
            'NO_PROMOTION_ID',
            'Booking принял запрос, но не вернул id акции — повторите, RentAI найдёт её по метке',
            false,
          );
        }
        promotionId = id;
        events.push({
          action: recreate ? 'recreated' : 'created',
          message: recreate
            ? `Создана новая акция ${id} с изменёнными параметрами`
            : `Акция ${id} создана на Booking`,
          details: { payload },
        });
      }
      patch.externalPromotionId = promotionId;
      patch.version = version;
      patch.pushedHash = hash;

      if (recreate && existingId) {
        const previous: PreviousPromotionId[] = [...(target.previousExternalIds ?? [])];
        try {
          await this.zodomus.deactivatePromotion(
            target.channelId,
            target.externalPropertyId,
            existingId,
          );
          previous.push({ id: existingId, deactivated: true });
          events.push({ action: 'deactivated', message: `Старая акция ${existingId} выключена` });
        } catch (e) {
          const c = classifyPromotionError(e);
          previous.push({ id: existingId, deactivated: c.kind === 'ID_NOT_FOUND' });
          events.push({
            action: 'warning',
            message: `Старую акцию ${existingId} выключить не удалось: ${c.kind}`,
            details: { error: c.message },
          });
        }
        patch.previousExternalIds = previous;
      }
    }

    // Retry stopping old promotions that failed to deactivate earlier.
    const leftovers = await this.deactivateLeftovers(
      ctx,
      patch.previousExternalIds ?? target.previousExternalIds ?? [],
      events,
    );
    patch.previousExternalIds = leftovers;

    if (this.cfg.flags.verify) {
      Object.assign(
        patch,
        await this.verify(target, promotionId, promotion.discountPct, roomIds, rule),
      );
    }

    return this.done(
      {
        ...patch,
        state: 'on',
        needsPush: false,
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastError: null,
      },
      events,
    );
  }

  // ─── OFF ───────────────────────────────────────────────────────────────────

  private async turnOff(ctx: ExecutorContext): Promise<ExecutorOutcome> {
    const { target, promotion } = ctx;
    const previous = target.previousExternalIds ?? [];
    const ids = [
      ...(target.externalPromotionId && target.state !== 'off' ? [target.externalPromotionId] : []),
      ...previous.filter((p) => !p.deactivated).map((p) => p.id),
    ];
    if (promotion.source !== 'rentai' || ids.length === 0) {
      return this.done(
        {
          state: 'off',
          needsPush: false,
          attempts: 0,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastError: null,
        },
        [],
      );
    }
    // Deactivation is never blocked by the pilot allowlist — only by dry run.
    if (this.cfg.flags.dryRun) {
      return this.done(
        { state: 'dry_run', needsPush: false, lastErrorCode: null, lastError: null },
        [
          {
            action: 'dry_run',
            message: `Пробный режим: выключили бы на Booking акцию ${ids.join(', ')}`,
          },
        ],
      );
    }

    const events: ExecutorEvent[] = [];
    const nextPrevious = previous.map((p) => ({ ...p }));
    for (const id of ids) {
      try {
        await this.zodomus.deactivatePromotion(target.channelId, target.externalPropertyId, id);
      } catch (e) {
        const c = classifyPromotionError(e);
        if (c.kind !== 'ID_NOT_FOUND') {
          throw new StepError(c.kind, c.message, c.retryable);
        }
      }
      const prev = nextPrevious.find((p) => p.id === id);
      if (prev) prev.deactivated = true;
      events.push({ action: 'deactivated', message: `Акция ${id} выключена на Booking` });
    }
    return this.done(
      {
        state: 'off',
        needsPush: false,
        previousExternalIds: nextPrevious,
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastError: null,
      },
      events,
    );
  }

  // ─── Reads shared with PricingService ──────────────────────────────────────

  /** Room + Standard rate for the promotion (same rules as the calendar price push). */
  async resolveRoomRate(
    property: PropertyEntity,
    channelId: number,
    externalPropertyId: string,
  ): Promise<{ roomIds: string[]; rateIds: string[] }> {
    let raw: unknown;
    try {
      raw = await this.zodomus.getRoomRatesRaw(channelId, externalPropertyId);
    } catch (e) {
      throw this.toStepError(e);
    }
    const stored = this.propertyService.getZodomusRoomIdForChannel(property, channelId);
    let roomId = stored && stored !== externalPropertyId ? stored : null;
    if (!roomId) {
      roomId = extractRoomsFromRoomRatesBody(raw)[0]?.roomId ?? null;
    }
    const rateId = roomId ? pickPrimaryRateId(raw, roomId) : null;
    if (!roomId || !rateId) {
      throw new StepError(
        'ROOM_RATE_UNRESOLVED',
        'Не удалось определить номер и тариф Standard (GET /room-rates)',
        false,
      );
    }
    return { roomIds: [roomId], rateIds: [rateId] };
  }

  /** Lowest Booking nightly price within the stay window (rack price of the Standard rate). */
  async lowestNightlyPrice(
    channelId: number,
    externalPropertyId: string,
    roomId: string,
    rateId: string,
    from: string,
    to: string,
    weekdays: PricePromotionEntity['activeWeekdays'],
  ): Promise<{ price: number; date: string } | null> {
    const cappedTo = [to, addDaysYmd(from, FLOOR_CHECK_MAX_NIGHTS - 1)].sort()[0]!;
    let raw: unknown;
    try {
      raw = await this.zodomus.getAvailability(
        channelId,
        externalPropertyId,
        from,
        addDaysYmd(cappedTo, 1),
      );
    } catch (e) {
      throw this.toStepError(e);
    }
    const prices = collectOtaNightlyPrices(
      extractZodomusInventoryDays(raw, { preferRoomId: roomId, preferRateId: rateId }),
    );
    let lowest: { price: number; date: string } | null = null;
    for (const night of nightsInRange(from, cappedTo, weekdays)) {
      const p = prices[night];
      if (p !== undefined && p > 0 && (!lowest || p < lowest.price))
        lowest = { price: p, date: night };
    }
    return lowest;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async findByMarker(
    channelId: number,
    externalPropertyId: string,
    marker: string,
  ): Promise<ParsedPromotion | null> {
    let list: ParsedPromotion[];
    try {
      list = parsePromotionsResponse(
        await this.zodomus.getPromotions(channelId, externalPropertyId, 1),
      );
    } catch (e) {
      throw this.toStepError(e);
    }
    return list.find((p) => p.name.trim() === marker) ?? null;
  }

  private async deactivateLeftovers(
    ctx: ExecutorContext,
    previous: PreviousPromotionId[],
    events: ExecutorEvent[],
  ): Promise<PreviousPromotionId[]> {
    const out = previous.map((p) => ({ ...p }));
    for (const p of out) {
      if (p.deactivated) continue;
      try {
        await this.zodomus.deactivatePromotion(
          ctx.target.channelId,
          ctx.target.externalPropertyId,
          p.id,
        );
        p.deactivated = true;
        events.push({ action: 'deactivated', message: `Старая акция ${p.id} выключена` });
      } catch (e) {
        if (classifyPromotionError(e).kind === 'ID_NOT_FOUND') p.deactivated = true;
      }
    }
    return out;
  }

  private async verify(
    target: PricePromotionTargetEntity,
    promotionId: string,
    discountPct: number,
    roomIds: string[],
    rule: RuleStepMeta | null = null,
  ): Promise<Pick<PricePromotionTargetEntity, 'verifiedAt' | 'verifyNote'>> {
    try {
      const list = parsePromotionsResponse(
        await this.zodomus.getPromotions(target.channelId, target.externalPropertyId, 1),
      );
      const hit = list.find((p) => p.id === promotionId);
      if (!hit) {
        return {
          verifiedAt: null,
          verifyNote: 'NOT_FOUND: акции нет в списке активных на Booking',
        };
      }
      const problems: string[] = [];
      if (hit.discountPct !== null && hit.discountPct !== discountPct) {
        problems.push(`скидка на Booking ${hit.discountPct}% вместо ${discountPct}%`);
      }
      if (rule) {
        const lm = hit.lastMinute;
        if (lm && (lm.unit !== rule.lastMinute.unit || lm.value !== rule.lastMinute.value)) {
          problems.push(
            `на Booking «${lm.value} ${lm.unit}» вместо «${rule.lastMinute.value} ${rule.lastMinute.unit}»`,
          );
        }
        const bt = hit.bookTime;
        if (rule.bookTime && bt && (bt.start !== rule.bookTime.start || bt.end !== rule.bookTime.end)) {
          problems.push(
            `время бронирования на Booking ${bt.start}–${bt.end} вместо ${rule.bookTime.start}–${rule.bookTime.end}`,
          );
        }
      }
      const missingRooms = roomIds.filter((r) => !hit.roomIds.includes(r));
      if (hit.roomIds.length > 0 && missingRooms.length > 0) {
        problems.push(`Booking не применил акцию к номеру ${missingRooms.join(', ')}`);
      }
      return problems.length
        ? { verifiedAt: null, verifyNote: `MISMATCH: ${problems.join('; ')}` }
        : { verifiedAt: new Date(), verifyNote: null };
    } catch (e) {
      const c = classifyPromotionError(e);
      return { verifiedAt: null, verifyNote: `VERIFY_FAILED: ${c.kind}` };
    }
  }

  private toStepError(e: unknown): StepError {
    if (e instanceof StepError) return e;
    const c = classifyPromotionError(e);
    return new StepError(c.kind, c.message, c.retryable);
  }

  private done(patch: PromotionTargetPatch, events: ExecutorEvent[]): ExecutorOutcome {
    return { patch, retry: null, events };
  }

  private skip(code: string, message: string, details?: Record<string, unknown>): ExecutorOutcome {
    return this.done(
      {
        state: 'skipped',
        needsPush: false,
        lastErrorCode: code,
        lastError: message,
        attempts: 0,
        nextAttemptAt: null,
        ...(details?.roomIds ? { roomIds: details.roomIds as string[] } : {}),
        ...(details?.rateIds ? { rateIds: details.rateIds as string[] } : {}),
      },
      [{ action: 'skipped', message, details: { code, ...details } }],
    );
  }

  private failure(err: StepError): ExecutorOutcome {
    if (err.retryable) {
      this.logger.warn(`promotion step failed (will retry): ${err.code} — ${err.message}`);
      return { patch: {}, retry: { kind: err.code, message: err.message }, events: [] };
    }
    return this.done(
      {
        state: 'error',
        needsPush: false,
        lastErrorCode: err.code,
        lastError: err.message,
        nextAttemptAt: null,
      },
      [
        {
          action: 'error',
          message: `Ошибка Booking: ${err.code}`,
          details: { error: err.message },
        },
      ],
    );
  }
}

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { addDays, format, parseISO } from 'date-fns';
import { BookingEntity } from '../booking/entities/booking.entity';
import { formatCalendarDayInTimezone } from '../booking/booking-availability.util';
import { PropertyService } from '../property/property.service';
import { ZodomusSyncService } from '../integrations/zodomus/zodomus-sync.service';
import { resolveOtaChannelCurrency } from '../integrations/zodomus/zodomus-reservation-price.util';
import type { BookingStatus as SharedBookingStatus } from '@rentai/shared';
import type {
  OtaCalendarRestrictionHint,
  OtaNightlyPriceMeta,
} from '../integrations/zodomus/zodomus-inventory.util';
import { sumNightlyPriceMap } from '../integrations/zodomus/zodomus-inventory.util';
import type { PropertyEntity } from '../property/entities/property.entity';

export interface CalendarPropertyDto {
  uuid: string;
  title: string;
  avatarUrl?: string;
  /** CRM property currency (ISO 4217). */
  currency: string;
  /** Есть внешний id Zodomus — доступна синхронизация OTA. */
  zodomusLinked: boolean;
  /** Для UI-бейджа; дублирует флаг выше. */
  zodomusPropertyId?: string | null;
  /** Persisted Zodomus channel status (null = unknown / not checked). */
  zodomusStatus?: string | null;
  zodomusStatusDetail?: string | null;
  /**
   * Nights closed on the channel (GET /availability: avail=0, booked>0, or closed)
   * that are not already covered by a local booking bar.
   */
  otaBlockedDays?: string[];
  /** Rate restriction hints (min stay, closed) for tooltip / UI. */
  otaRestrictions?: OtaCalendarRestrictionHint[];
  /**
   * Nightly Standard (or preferred) rack from Zodomus GET /availability (major units).
   * Not Booking.com Genius / public B2C price.
   */
  otaNightlyPrices?: Record<string, number>;
  /**
   * Cheapest open non-child rate excluding Weekly/Monthly/LOS (major units).
   * Approximate Booking "from" rack without Genius.
   */
  otaNightlyPricesFrom?: Record<string, number>;
  /** Which rate won for `otaNightlyPrices` per night. */
  otaNightlyPriceMeta?: Record<string, OtaNightlyPriceMeta>;
  /** Channel currency for rack display / push-rates (ARI when present, else resolved). */
  otaCurrency?: string | null;
  /** Live ARI fetch failed for all linked channels. */
  ariUnavailable?: boolean;
}

export type CalendarBookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked' | 'cancelled';
export type CalendarBookingChannel = 'booking' | 'airbnb' | 'direct' | 'other';

export interface CalendarReservationDto {
  uuid: string;
  /** Внутренний id брони или внешний id Zodomus для отображения. */
  externalId: string;
  /** Подтянута из channel manager (Zodomus). */
  fromOta: boolean;
  propertyId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  guestsCount: number | null;
  guestsAdults: number | null;
  guestsChildren: number | null;
  notes: string | null;
  internalNotes: string | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  /** Payment / payout hint from OTA (Zodomus) when channel sends it. */
  otaPaymentHint: string | null;
  /** Manual direct booking only; null for OTA. */
  directSource: string | null;
  channel: CalendarBookingChannel;
  status: CalendarBookingStatus;
  totalPrice: number;
  currency: string;
  checkIn: string;
  checkOut: string;
  chatThreadId: string | null;
  /** Inbound OTA booking overlaps another blocking booking on the property. */
  overbookingConflict: boolean;
  overbookingConflictWithBookingId: string | null;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookingRepository: Repository<BookingEntity>,
    private readonly propertyService: PropertyService,
    @Inject(forwardRef(() => ZodomusSyncService))
    private readonly zodomusSync: ZodomusSyncService,
  ) {}

  async getCalendarData(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ properties: CalendarPropertyDto[]; reservations: CalendarReservationDto[] }> {
    const properties = await this.propertyService.findAllByOwner(userId);
    if (properties.length === 0) {
      return { properties: [], reservations: [] };
    }

    const fromYmd = from.trim();
    const toYmd = to.trim();
    /** Zodomus GET /availability treats dateTo as exclusive — include the last visible day. */
    const availabilityDateToExclusive = format(
      addDays(parseISO(`${toYmd}T12:00:00.000Z`), 1),
      'yyyy-MM-dd',
    );

    const linked = properties.filter((p) => this.zodomusSync.isPropertyZodomusLinked(p));

    /**
     * Do NOT pull reservations-summary or queue on the calendar request path.
     * Summary is onboarding-only; live updates come from webhooks + cron queue poll.
     * Calendar only needs GET /availability overlay (rate-limited + cached in sync service).
     */

    const propertyIds = properties.map((p) => p.id);
    const tzByPropertyId = new Map(properties.map((p) => [p.id, p.timezone || 'UTC']));
    /**
     * Parse from/to as UTC calendar midnights and widen by ±14h so bookings stored as
     * noon-in-property-TZ still overlap the requested window regardless of process TZ.
     */
    const rangeStart = new Date(parseISO(`${fromYmd}T00:00:00.000Z`).getTime() - 14 * 60 * 60 * 1000);
    const rangeEndExclusive = new Date(
      addDays(parseISO(`${toYmd}T00:00:00.000Z`), 1).getTime() + 14 * 60 * 60 * 1000,
    );

    const bookings = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.propertyId IN (:...propertyIds)', { propertyIds })
      .andWhere('b.checkIn < :rangeEndExclusive', { rangeEndExclusive })
      .andWhere('b.checkOut > :rangeStart', { rangeStart })
      .orderBy('b.checkIn', 'ASC')
      .getMany();

    const reservations: CalendarReservationDto[] = bookings.map((b) => {
      const prop = properties.find((p) => p.id === b.propertyId);
      return mapBookingToCalendarDto(
        b,
        tzByPropertyId.get(b.propertyId) ?? 'UTC',
        prop,
      );
    });

    const occupiedByProperty = new Map<string, Set<string>>();
    for (const r of reservations) {
      if (r.status === 'cancelled') continue;
      let set = occupiedByProperty.get(r.propertyId);
      if (!set) {
        set = new Set();
        occupiedByProperty.set(r.propertyId, set);
      }
      let cur = r.checkIn;
      while (cur < r.checkOut) {
        set.add(cur);
        const parts = cur.split('-').map(Number);
        const y = parts[0];
        const m = parts[1];
        const d = parts[2];
        if (y == null || m == null || d == null) break;
        cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      }
    }

    /** Sequential inventory overlay — only the visible 14-day window; sync paces Zodomus ≥10s/property. */
    const overlayByPropertyId = new Map<
      string,
      {
        blockedDays: string[];
        restrictions: OtaCalendarRestrictionHint[];
        nightlyPrices: Record<string, number>;
        nightlyPricesFrom: Record<string, number>;
        nightlyPriceMeta: Record<string, OtaNightlyPriceMeta>;
        otaCurrency: string | null;
        ariUnavailable: boolean;
      }
    >();
    if (linked.length > 0) {
      for (const p of linked) {
        try {
          const overlay = await this.zodomusSync.getInventoryOverlayForProperty(
            p,
            fromYmd,
            availabilityDateToExclusive,
          );
          overlayByPropertyId.set(p.id, overlay);
        } catch (e) {
          this.logger.warn(`calendar inventory overlay failed property=${p.id}: ${String(e)}`);
        }
      }
    }

    const propertyDtos: CalendarPropertyDto[] = properties.map((p) => {
      const zid = p.zodomusPropertyId?.trim() ?? null;
      const isLinked = this.zodomusSync.isPropertyZodomusLinked(p);
      const dto: CalendarPropertyDto = {
        uuid: p.id,
        title: p.name,
        currency: (p.currency?.trim().toUpperCase() || 'USD').slice(0, 3),
        zodomusLinked: isLinked || Boolean(zid) || (p.channelListings?.length ?? 0) > 0,
        zodomusPropertyId: zid,
        zodomusStatus: p.zodomusStatus ?? null,
        zodomusStatusDetail: p.zodomusStatusDetail ?? null,
      };

      if (isLinked) {
        const overlay = overlayByPropertyId.get(p.id) ?? {
          blockedDays: [],
          restrictions: [],
          nightlyPrices: {},
          nightlyPricesFrom: {},
          nightlyPriceMeta: {},
          otaCurrency: null,
          ariUnavailable: true,
        };
        const localOcc = occupiedByProperty.get(p.id) ?? new Set();
        dto.otaBlockedDays = overlay.blockedDays.filter((d) => !localOcc.has(d));
        dto.otaRestrictions = overlay.restrictions;
        dto.otaNightlyPrices = overlay.nightlyPrices;
        dto.otaNightlyPricesFrom = overlay.nightlyPricesFrom;
        dto.otaNightlyPriceMeta = overlay.nightlyPriceMeta;
        dto.otaCurrency = overlay.otaCurrency;
        dto.ariUnavailable = overlay.ariUnavailable;
      }

      return dto;
    });

    /**
     * OTA rows often store totalPriceMinor=0 (Zodomus reservation.totalPrice="0").
     * Prefer cheapest eligible rack (NR-like "from") over Standard — closer to guest-paid
     * when ingest could not resolve rooms[].totalPrice. Never overwrite a positive CRM total.
     * Also fix weak USD currency on Warsaw listings and persist price/currency when we can.
     */
    const persistPatches: Array<{ id: string; totalPriceMinor?: number; currency?: string }> = [];
    for (const r of reservations) {
      if (!r.fromOta) continue;
      const prop = properties.find((p) => p.id === r.propertyId);
      const overlay = overlayByPropertyId.get(r.propertyId);
      const channelCur =
        overlay?.otaCurrency ??
        (prop
          ? resolveOtaChannelCurrency({
              propertyCurrency: prop.currency,
              timezone: prop.timezone,
            })
          : null);

      const bookingCur = (r.currency || '').trim().toUpperCase();
      const tz = prop?.timezone?.trim() || '';
      const warsaw = tz === 'Europe/Warsaw' || tz.startsWith('Europe/Warsaw');
      if (channelCur && (bookingCur === '' || (warsaw && bookingCur === 'USD'))) {
        if (r.currency !== channelCur) {
          r.currency = channelCur;
          persistPatches.push({ id: r.uuid, currency: channelCur });
        }
      }

      if (r.totalPrice > 0) continue;
      const fromSum = sumNightlyPriceMap(overlay?.nightlyPricesFrom, r.checkIn, r.checkOut);
      const stdSum = sumNightlyPriceMap(overlay?.nightlyPrices, r.checkIn, r.checkOut);
      const sum = fromSum ?? stdSum;
      if (sum != null && sum > 0) {
        r.totalPrice = sum;
        const minor = Math.round(sum * 100);
        const existing = persistPatches.find((p) => p.id === r.uuid);
        if (existing) {
          existing.totalPriceMinor = minor;
        } else {
          persistPatches.push({ id: r.uuid, totalPriceMinor: minor });
        }
      }
    }

    if (persistPatches.length > 0) {
      void Promise.allSettled(
        persistPatches.map(async (patch) => {
          const update: Partial<BookingEntity> = {};
          if (patch.totalPriceMinor != null) update.totalPriceMinor = patch.totalPriceMinor;
          if (patch.currency) update.currency = patch.currency;
          await this.bookingRepository.update(patch.id, update);
        }),
      ).then((results) => {
        const failed = results.filter((x) => x.status === 'rejected').length;
        if (failed > 0) {
          this.logger.warn(`calendar OTA price/currency persist: ${failed}/${persistPatches.length} failed`);
        }
      });
    }

    return { properties: propertyDtos, reservations };
  }

  /**
   * Full-tenant search for calendar filter / guest picker (not limited to the visible date window).
   * Mirrors frontend `reservationMatchesQuery` fields at SQL level.
   */
  async searchReservationsAcrossCalendar(
    userId: string,
    rawQuery: string,
  ): Promise<CalendarReservationDto[]> {
    const properties = await this.propertyService.findAllByOwner(userId);
    if (properties.length === 0) {
      return [];
    }
    const trimmed = rawQuery.trim().slice(0, 200);
    if (trimmed.length < 2) {
      return [];
    }
    /** Avoid user-supplied `%` / `_` widening LIKE patterns */
    const sanitized = trimmed.replace(/[%_\\]/g, '').slice(0, 120);
    if (sanitized.length < 2) {
      return [];
    }
    const propertyIds = properties.map((p) => p.id);
    const like = `%${sanitized.toLowerCase()}%`;
    const qCompact = sanitized.replace(/-/g, '').toLowerCase();

    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .where('b.propertyId IN (:...propertyIds)', { propertyIds })
      .andWhere(
        new Brackets((wb) => {
          wb.where('LOWER(b.guestName) LIKE :like', { like })
            .orWhere("LOWER(COALESCE(b.guestEmail, '')) LIKE :like", { like })
            .orWhere("LOWER(COALESCE(b.guestPhone, '')) LIKE :like", { like })
            .orWhere("LOWER(COALESCE(b.notes, '')) LIKE :like", { like })
            .orWhere("LOWER(COALESCE(b.internalNotes, '')) LIKE :like", { like })
            .orWhere("LOWER(COALESCE(b.zodomusReservationId, '')) LIKE :like", { like });
          if (qCompact.length >= 4) {
            wb.orWhere("REPLACE(CAST(b.id AS text), '-', '') LIKE :idLike", {
              idLike: `%${qCompact}%`,
            });
          }
        }),
      )
      .orderBy('b.checkIn', 'DESC')
      .take(100);

    const bookings = await qb.getMany();
    const tzByPropertyId = new Map(properties.map((p) => [p.id, p.timezone || 'UTC']));
    const propById = new Map(properties.map((p) => [p.id, p]));
    return bookings.map((b) =>
      mapBookingToCalendarDto(
        b,
        tzByPropertyId.get(b.propertyId) ?? 'UTC',
        propById.get(b.propertyId),
      ),
    );
  }
}

export function mapBookingToCalendarDto(
  b: BookingEntity,
  propertyTimezone: string,
  property?: PropertyEntity | null,
): CalendarReservationDto {
  let currency = (b.currency || '').trim().toUpperCase();
  if (b.zodomusReservationId?.trim() && property) {
    const channelCur = resolveOtaChannelCurrency({
      propertyCurrency: property.currency,
      timezone: property.timezone,
    });
    const tz = property.timezone?.trim() || '';
    const warsaw = tz === 'Europe/Warsaw' || tz.startsWith('Europe/Warsaw');
    if (!/^[A-Z]{3}$/.test(currency) || (warsaw && currency === 'USD')) {
      currency = channelCur;
    }
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    currency = 'USD';
  }

  return {
    uuid: b.id,
    externalId: b.zodomusReservationId?.trim() || b.id,
    fromOta: Boolean(b.zodomusReservationId?.trim()),
    propertyId: b.propertyId,
    guestName: b.guestName,
    guestEmail: b.guestEmail?.trim() ? b.guestEmail.trim() : null,
    guestPhone: b.guestPhone?.trim() ? b.guestPhone.trim() : null,
    guestsCount:
      b.guestsCount != null && Number.isFinite(Number(b.guestsCount)) && Number(b.guestsCount) > 0
        ? Math.round(Number(b.guestsCount))
        : null,
    guestsAdults:
      b.guestsAdults != null && Number.isFinite(Number(b.guestsAdults)) && Number(b.guestsAdults) >= 0
        ? Math.round(Number(b.guestsAdults))
        : null,
    guestsChildren:
      b.guestsChildren != null && Number.isFinite(Number(b.guestsChildren)) && Number(b.guestsChildren) >= 0
        ? Math.round(Number(b.guestsChildren))
        : null,
    notes: b.notes?.trim() ? b.notes.trim() : null,
    internalNotes: b.internalNotes?.trim() ? b.internalNotes.trim() : null,
    paymentStatus:
      b.paymentStatus === 'partial' || b.paymentStatus === 'paid' ? b.paymentStatus : 'unpaid',
    otaPaymentHint: b.otaPaymentHint?.trim() ? b.otaPaymentHint.trim().slice(0, 512) : null,
    directSource: b.directSource?.trim() ? b.directSource.trim() : null,
    channel: calendarChannelFromBooking(b),
    status: mapBookingStatus(b.status as SharedBookingStatus),
    totalPrice: b.totalPriceMinor / 100,
    currency,
    checkIn: formatCalendarDayInTimezone(b.checkIn, propertyTimezone),
    checkOut: formatCalendarDayInTimezone(b.checkOut, propertyTimezone),
    chatThreadId: null,
    overbookingConflict: Boolean(b.overbookingConflict),
    overbookingConflictWithBookingId: b.overbookingConflictWithBookingId ?? null,
  };
}

function calendarChannelFromBooking(b: BookingEntity): CalendarBookingChannel {
  const zid = b.zodomusChannelId;
  if (zid == null) return 'direct';
  if (zid === 1) return 'booking';
  if (zid === 3) return 'airbnb';
  return 'other';
}

function mapBookingStatus(s: SharedBookingStatus): CalendarBookingStatus {
  switch (s) {
    case 'PENDING':
      return 'pending';
    case 'CONFIRMED':
    case 'CHECKED_IN':
      return 'confirmed';
    case 'CHECKED_OUT':
      return 'cleaning';
    case 'CANCELLED':
    case 'DECLINED':
    case 'NO_SHOW':
      return 'cancelled';
    default:
      return 'pending';
  }
}

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { addDays, parseISO } from 'date-fns';
import { BookingEntity } from '../booking/entities/booking.entity';
import { formatCalendarDayInTimezone } from '../booking/booking-availability.util';
import { PropertyService } from '../property/property.service';
import { ZodomusSyncService } from '../integrations/zodomus/zodomus-sync.service';
import type { BookingStatus as SharedBookingStatus } from '@rentai/shared';
import type { OtaCalendarRestrictionHint } from '../integrations/zodomus/zodomus-inventory.util';

export interface CalendarPropertyDto {
  uuid: string;
  title: string;
  avatarUrl?: string;
  /** Есть внешний id Zodomus — доступна синхронизация OTA. */
  zodomusLinked: boolean;
  /** Для UI-бейджа; дублирует флаг выше. */
  zodomusPropertyId?: string | null;
  /**
   * Nights closed on the channel (GET /availability: avail=0 or booked>0)
   * that are not already covered by a local booking bar.
   */
  otaBlockedDays?: string[];
  /** Rate restriction hints (min stay, closed) for tooltip / UI. */
  otaRestrictions?: OtaCalendarRestrictionHint[];
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

    // Soft live pull for linked properties so calendar reflects recent OTA bookings.
    for (const p of properties) {
      if (!this.zodomusSync.isPropertyZodomusLinked(p)) continue;
      try {
        await this.zodomusSync.pullLiveOtaBookingsSoft(p);
      } catch (e) {
        this.logger.warn(`calendar soft OTA pull failed property=${p.id}: ${String(e)}`);
      }
    }

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

    const reservations: CalendarReservationDto[] = bookings.map((b) =>
      mapBookingToCalendarDto(b, tzByPropertyId.get(b.propertyId) ?? 'UTC'),
    );

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
        const [y, m, d] = cur.split('-').map(Number);
        cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      }
    }

    const propertyDtos: CalendarPropertyDto[] = [];
    for (const p of properties) {
      const zid = p.zodomusPropertyId?.trim() ?? null;
      const linked = this.zodomusSync.isPropertyZodomusLinked(p);
      const dto: CalendarPropertyDto = {
        uuid: p.id,
        title: p.name,
        zodomusLinked: linked || Boolean(zid) || (p.channelListings?.length ?? 0) > 0,
        zodomusPropertyId: zid,
      };

      if (linked) {
        try {
          const overlay = await this.zodomusSync.getInventoryOverlayForProperty(p, fromYmd, toYmd);
          const localOcc = occupiedByProperty.get(p.id) ?? new Set();
          dto.otaBlockedDays = overlay.blockedDays.filter((d) => !localOcc.has(d));
          dto.otaRestrictions = overlay.restrictions;
        } catch (e) {
          this.logger.warn(`calendar inventory overlay failed property=${p.id}: ${String(e)}`);
          dto.otaBlockedDays = [];
          dto.otaRestrictions = [];
        }
      }

      propertyDtos.push(dto);
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
    return bookings.map((b) =>
      mapBookingToCalendarDto(b, tzByPropertyId.get(b.propertyId) ?? 'UTC'),
    );
  }
}

export function mapBookingToCalendarDto(
  b: BookingEntity,
  propertyTimezone: string,
): CalendarReservationDto {
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
    currency: b.currency,
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

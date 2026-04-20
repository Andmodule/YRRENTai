import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyService } from '../property/property.service';
import type { BookingStatus as SharedBookingStatus } from '@rentai/shared';

export interface CalendarPropertyDto {
  uuid: string;
  title: string;
  avatarUrl?: string;
  /** Есть внешний id Zodomus — доступна синхронизация OTA. */
  zodomusLinked: boolean;
  /** Для UI-бейджа; дублирует флаг выше. */
  zodomusPropertyId?: string | null;
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
}

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookingRepository: Repository<BookingEntity>,
    private readonly propertyService: PropertyService,
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

    const propertyIds = properties.map((p) => p.id);
    const rangeStart = startOfDay(parseISO(from));
    const rangeEndExclusive = addDays(startOfDay(parseISO(to)), 1);

    const bookings = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.propertyId IN (:...propertyIds)', { propertyIds })
      .andWhere('b.checkIn < :rangeEndExclusive', { rangeEndExclusive })
      .andWhere('b.checkOut > :rangeStart', { rangeStart })
      .orderBy('b.checkIn', 'ASC')
      .getMany();

    const reservations: CalendarReservationDto[] = bookings.map((b) => mapBookingToCalendarDto(b));

    const propertyDtos: CalendarPropertyDto[] = properties.map((p) => {
      const zid = p.zodomusPropertyId?.trim() ?? null;
      const hasChannels = (p.channelListings?.length ?? 0) > 0;
      return {
        uuid: p.id,
        title: p.name,
        zodomusLinked: Boolean(zid) || hasChannels,
        zodomusPropertyId: zid,
      };
    });

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
    return bookings.map((b) => mapBookingToCalendarDto(b));
  }
}

function mapBookingToCalendarDto(b: BookingEntity): CalendarReservationDto {
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
    checkIn: format(b.checkIn, 'yyyy-MM-dd'),
    checkOut: format(b.checkOut, 'yyyy-MM-dd'),
    chatThreadId: null,
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

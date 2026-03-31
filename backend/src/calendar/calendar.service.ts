import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyService } from '../property/property.service';
import type { BookingStatus as SharedBookingStatus } from '@rentai/shared';

export interface CalendarPropertyDto {
  uuid: string;
  title: string;
  avatarUrl?: string;
}

export type CalendarBookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked';
export type CalendarBookingChannel = 'booking' | 'airbnb' | 'direct' | 'other';

export interface CalendarReservationDto {
  uuid: string;
  externalId: string;
  propertyId: string;
  guestName: string;
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

    const reservations: CalendarReservationDto[] = bookings.map((b) => ({
      uuid: b.id,
      externalId: b.id,
      propertyId: b.propertyId,
      guestName: b.guestName,
      channel: 'direct' as const,
      status: mapBookingStatus(b.status as SharedBookingStatus),
      totalPrice: b.totalPriceMinor / 100,
      currency: b.currency,
      checkIn: format(b.checkIn, 'yyyy-MM-dd'),
      checkOut: format(b.checkOut, 'yyyy-MM-dd'),
      chatThreadId: null,
    }));

    const propertyDtos: CalendarPropertyDto[] = properties.map((p) => ({
      uuid: p.id,
      title: p.name,
    }));

    return { properties: propertyDtos, reservations };
  }
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
      return 'blocked';
    default:
      return 'pending';
  }
}

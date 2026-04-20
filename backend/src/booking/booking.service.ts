import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingEntity } from './entities/booking.entity';
import { BookingStatusChangedEvent } from '../common/events/booking.events';
import {
  isValidTransition,
  patchBookingSchema,
  BOOKING_STATUSES_BLOCKING_AVAILABILITY,
  BOOKING_STATUS,
  normalizeGuestEmail,
  type BookingStatus,
  type CreateBookingDto,
} from '@rentai/shared';
import type { z } from 'zod';
import { PropertyService } from '../property/property.service';
import { ZodomusAvailabilityPushService } from '../integrations/zodomus/zodomus-availability-push.service';
import { CalendarGateway } from '../calendar/calendar.gateway';
import { GuestService } from '../guest/guest.service';
import { nightsBetweenInPropertyTimezone } from './booking-availability.util';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookingRepository: Repository<BookingEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly propertyService: PropertyService,
    private readonly zodomusAvailabilityPush: ZodomusAvailabilityPushService,
    private readonly calendarGateway: CalendarGateway,
    private readonly guestService: GuestService,
  ) {}

  async create(dto: CreateBookingDto, userId: string, role: string): Promise<BookingEntity> {
    const property = await this.propertyService.findOneForUser(dto.propertyId, userId, role);
    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);

    const nights = nightsBetweenInPropertyTimezone(checkIn, checkOut, property.timezone);
    if (nights < 1) {
      throw new BadRequestException('MINIMUM_ONE_NIGHT');
    }

    const overlap = await this.findBlockingOverlap(property.id, checkIn, checkOut);
    if (overlap) {
      throw new ConflictException({
        error: 'BOOKING_CONFLICT',
        conflictWith: {
          guestName: overlap.guestName,
          checkIn: overlap.checkIn.toISOString(),
          checkOut: overlap.checkOut.toISOString(),
        },
      });
    }

    const emailNorm = normalizeGuestEmail(dto.guestEmail);
    const phoneTrim = dto.guestPhone?.trim();

    let guestId: string | null = null;
    if (phoneTrim || emailNorm) {
      const guest = await this.guestService.resolveOrCreate(
        property.ownerId,
        dto.guestName.trim(),
        dto.guestPhone,
        dto.guestEmail,
      );
      guestId = guest.id;
    }

    const booking = this.bookingRepository.create({
      propertyId: dto.propertyId,
      guestId,
      guestName: dto.guestName.trim(),
      guestEmail: emailNorm ?? undefined,
      guestPhone: phoneTrim || undefined,
      checkIn,
      checkOut,
      totalPriceMinor: dto.totalPriceMinor,
      currency: dto.currency,
      guestsCount: dto.guestsCount,
      notes: dto.notes,
      directSource: dto.directSource ?? null,
      status: 'PENDING',
      createdBy: userId,
    });
    const saved = await this.bookingRepository.save(booking);
    this.zodomusAvailabilityPush.scheduleAvailabilityPush(saved.propertyId, {
      dateFromISO: saved.checkIn.toISOString(),
      dateToISO: saved.checkOut.toISOString(),
    });
    this.calendarGateway.emitCalendarChanged({ propertyId: saved.propertyId, source: 'booking:create' });
    return saved;
  }

  /**
   * For UI: same overlap + min-night rules as create, without persisting.
   */
  async previewConflict(
    propertyId: string,
    checkInIso: string,
    checkOutIso: string,
    userId: string,
    role: string,
  ): Promise<{
    available: boolean;
    reason?: 'MINIMUM_ONE_NIGHT';
    conflictWith?: { guestName: string; checkIn: string; checkOut: string };
  }> {
    const property = await this.propertyService.findOneForUser(propertyId, userId, role);
    const checkIn = new Date(checkInIso);
    const checkOut = new Date(checkOutIso);
    const nights = nightsBetweenInPropertyTimezone(checkIn, checkOut, property.timezone);
    if (nights < 1) {
      return { available: false, reason: 'MINIMUM_ONE_NIGHT' };
    }
    const overlap = await this.findBlockingOverlap(property.id, checkIn, checkOut);
    if (overlap) {
      return {
        available: false,
        conflictWith: {
          guestName: overlap.guestName,
          checkIn: overlap.checkIn.toISOString(),
          checkOut: overlap.checkOut.toISOString(),
        },
      };
    }
    return { available: true };
  }

  private async findBlockingOverlap(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
    excludeBookingId?: string,
  ): Promise<BookingEntity | null> {
    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .where('b.propertyId = :propertyId', { propertyId })
      .andWhere('b.status IN (:...blocking)', {
        blocking: [...BOOKING_STATUSES_BLOCKING_AVAILABILITY],
      })
      .andWhere('b.checkIn < :checkOut', { checkOut })
      .andWhere('b.checkOut > :checkIn', { checkIn });
    if (excludeBookingId) {
      qb.andWhere('b.id != :excludeId', { excludeId: excludeBookingId });
    }
    return qb.getOne();
  }

  async findAllByProperty(propertyId: string, userId: string, role: string): Promise<BookingEntity[]> {
    const pid = propertyId?.trim();
    if (!pid) {
      throw new BadRequestException('Query parameter propertyId is required');
    }
    await this.propertyService.findOneForUser(pid, userId, role);
    return this.bookingRepository.find({
      where: { propertyId: pid },
      order: { checkIn: 'DESC' },
    });
  }

  async findOne(id: string, userId: string, role: string): Promise<BookingEntity> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    await this.propertyService.findOneForUser(booking.propertyId, userId, role);
    return booking;
  }

  async patch(
    id: string,
    dto: z.infer<typeof patchBookingSchema>,
    userId: string,
    role: string,
  ): Promise<BookingEntity> {
    const booking = await this.findOne(id, userId, role);
    const property = await this.propertyService.findOneForUser(booking.propertyId, userId, role);

    if (dto.checkIn !== undefined || dto.checkOut !== undefined) {
      const nextCheckIn = dto.checkIn !== undefined ? new Date(dto.checkIn) : booking.checkIn;
      const nextCheckOut = dto.checkOut !== undefined ? new Date(dto.checkOut) : booking.checkOut;
      const nights = nightsBetweenInPropertyTimezone(nextCheckIn, nextCheckOut, property.timezone);
      if (nights < 1) {
        throw new BadRequestException('MINIMUM_ONE_NIGHT');
      }
      const overlap = await this.findBlockingOverlap(
        property.id,
        nextCheckIn,
        nextCheckOut,
        booking.id,
      );
      if (overlap) {
        throw new ConflictException({
          error: 'BOOKING_CONFLICT',
          conflictWith: {
            guestName: overlap.guestName,
            checkIn: overlap.checkIn.toISOString(),
            checkOut: overlap.checkOut.toISOString(),
          },
        });
      }
    }

    let availabilityDirty = false;
    let minDate = booking.checkIn;
    let maxDate = booking.checkOut;

    if (dto.guestName !== undefined) booking.guestName = dto.guestName;
    if (dto.guestEmail !== undefined) {
      booking.guestEmail = dto.guestEmail === null || dto.guestEmail === '' ? undefined : dto.guestEmail;
    }
    if (dto.guestPhone !== undefined) {
      booking.guestPhone = dto.guestPhone === null || dto.guestPhone === '' ? undefined : dto.guestPhone;
    }
    if (dto.checkIn !== undefined) {
      booking.checkIn = new Date(dto.checkIn);
      if (booking.checkIn < minDate) minDate = booking.checkIn;
      availabilityDirty = true;
    }
    if (dto.checkOut !== undefined) {
      booking.checkOut = new Date(dto.checkOut);
      if (booking.checkOut > maxDate) maxDate = booking.checkOut;
      availabilityDirty = true;
    }
    if (dto.totalPriceMinor !== undefined) {
      booking.totalPriceMinor = dto.totalPriceMinor;
      availabilityDirty = true;
    }
    if (dto.currency !== undefined) {
      booking.currency = dto.currency;
      availabilityDirty = true;
    }
    if (dto.guestsCount !== undefined) {
      if (dto.guestsCount === null || dto.guestsCount === undefined) {
        booking.guestsCount = undefined;
      } else {
        booking.guestsCount = dto.guestsCount;
      }
      (booking as { guestsAdults?: number | null; guestsChildren?: number | null }).guestsAdults = null;
      (booking as { guestsAdults?: number | null; guestsChildren?: number | null }).guestsChildren = null;
    }
    if (dto.notes !== undefined) {
      booking.notes = dto.notes === null || dto.notes === '' ? undefined : dto.notes;
    }
    if (dto.internalNotes !== undefined) {
      booking.internalNotes =
        dto.internalNotes === null || dto.internalNotes === '' ? null : dto.internalNotes.trim();
    }
    if (dto.paymentStatus !== undefined) {
      booking.paymentStatus = dto.paymentStatus;
    }

    const saved = await this.bookingRepository.save(booking);
    if (availabilityDirty) {
      this.zodomusAvailabilityPush.scheduleAvailabilityPush(saved.propertyId, {
        dateFromISO: minDate.toISOString(),
        dateToISO: maxDate.toISOString(),
      });
    }
    this.calendarGateway.emitCalendarChanged({ propertyId: saved.propertyId, source: 'booking:patch' });
    return saved;
  }

  /**
   * Booking.com guest proxy address (`guest_email_alias`) → booking for inbound email routing (doc/EMAILdeliveryTZ.md).
   * Prefers CONFIRMED / CHECKED_IN, then latest check-in.
   */
  async findByGuestEmailAliasForOwner(
    ownerId: string,
    normalizedEmail: string,
  ): Promise<BookingEntity | null> {
    const q = normalizedEmail.trim().toLowerCase();
    if (!q) return null;
    const rows = await this.bookingRepository
      .createQueryBuilder('b')
      .innerJoin('b.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('LOWER(TRIM(b.guestEmailAlias)) = :q', { q })
      .getMany();
    const priority = (s: string) =>
      s === BOOKING_STATUS.CONFIRMED || s === BOOKING_STATUS.CHECKED_IN ? 0 : 1;
    rows.sort((a, b) => {
      const pa = priority(a.status);
      const pb = priority(b.status);
      if (pa !== pb) return pa - pb;
      return b.checkIn.getTime() - a.checkIn.getTime();
    });
    return rows[0] ?? null;
  }

  /**
   * Inbound mail (e.g. Booking.com) often carries the channel reservation id; we store it as `zodomusReservationId`.
   * Resolves which property this booking belongs to for the given owner.
   */
  async findPropertyIdByZodomusReservationForOwner(
    ownerId: string,
    zodomusReservationId: string,
  ): Promise<string | null> {
    const zid = zodomusReservationId.trim();
    if (!zid) return null;
    const row = await this.bookingRepository
      .createQueryBuilder('b')
      .innerJoin('b.property', 'p')
      .select('b.propertyId', 'propertyId')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('b.zodomusReservationId = :zid', { zid })
      .orderBy('b.checkOut', 'DESC')
      .getRawOne<{ propertyId: string }>();
    return row?.propertyId ?? null;
  }

  async transition(
    id: string,
    newStatus: string,
    userId: string,
    cancelledBy: string | undefined,
    role: string,
  ): Promise<BookingEntity> {
    const booking = await this.findOne(id, userId, role);
    const previous = booking.status as BookingStatus;
    const next = newStatus as BookingStatus;

    if (!isValidTransition(previous, next)) {
      throw new BadRequestException(
        `Invalid transition from ${previous} to ${next}`,
      );
    }

    booking.status = next;
    if (cancelledBy) {
      booking.cancelledBy = cancelledBy;
    }

    const saved = await this.bookingRepository.save(booking);

    this.eventEmitter.emit(
      'booking.status.changed',
      new BookingStatusChangedEvent(
        id,
        booking.propertyId,
        previous,
        next,
        userId,
        cancelledBy as 'guest' | 'manager' | 'system' | undefined,
      ),
    );

    this.zodomusAvailabilityPush.scheduleAvailabilityPush(saved.propertyId, {
      dateFromISO: saved.checkIn.toISOString(),
      dateToISO: saved.checkOut.toISOString(),
    });

    this.calendarGateway.emitCalendarChanged({ propertyId: saved.propertyId, source: 'booking:transition' });

    return saved;
  }
}

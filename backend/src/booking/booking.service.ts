import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  BadGatewayException,
  HttpException,
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
import { ZodomusSyncService } from '../integrations/zodomus/zodomus-sync.service';
import { CalendarGateway } from '../calendar/calendar.gateway';
import { GuestService } from '../guest/guest.service';
import {
  calendarDayToInstantInTimezone,
  formatCalendarDayInTimezone,
  nightsBetweenInPropertyTimezone,
} from './booking-availability.util';
import { ZODOMUS_BOOKING_FLOW } from '../integrations/zodomus/zodomus-booking-flow.constants';
import type { OtaInventoryBlockReason } from '../integrations/zodomus/zodomus-inventory.util';

export type BookingConflictPreviewResult = {
  available: boolean;
  reason?: 'MINIMUM_ONE_NIGHT' | OtaInventoryBlockReason;
  conflictWith?: { guestName: string; checkIn: string; checkOut: string };
  otaRefreshed?: boolean;
  otaRestriction?: {
    reason: OtaInventoryBlockReason;
    date?: string;
    minStayRequired?: number;
    nights?: number;
  };
};

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookingRepository: Repository<BookingEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly propertyService: PropertyService,
    private readonly zodomusAvailabilityPush: ZodomusAvailabilityPushService,
    private readonly zodomusSync: ZodomusSyncService,
    private readonly calendarGateway: CalendarGateway,
    private readonly guestService: GuestService,
  ) {}

  /**
   * Normalize client datetime to noon-in-property-TZ of the intended calendar day.
   * Clients should send `${yyyy-MM-dd}T12:00:00.000Z` for the selected day; we still
   * re-anchor via UTC calendar day so process/browser TZ cannot shift the stay.
   */
  private normalizeBookingDay(iso: string, propertyTimezone: string): Date {
    const raw = new Date(iso);
    const day = formatCalendarDayInTimezone(raw, 'UTC');
    return calendarDayToInstantInTimezone(day, propertyTimezone);
  }

  private throwOtaInventoryBlock(
    result: Extract<Awaited<ReturnType<ZodomusSyncService['assertStayAllowedByOtaInventory']>>, { ok: false }>,
  ): never {
    throw new BadRequestException({
      error: result.reason,
      message: result.reason,
      date: result.date,
      minStayRequired: result.minStayRequired,
      nights: result.nights,
    });
  }

  async create(dto: CreateBookingDto, userId: string, role: string): Promise<BookingEntity> {
    const property = await this.propertyService.findOneForUser(dto.propertyId, userId, role);
    const checkIn = this.normalizeBookingDay(dto.checkIn, property.timezone);
    const checkOut = this.normalizeBookingDay(dto.checkOut, property.timezone);

    const nights = nightsBetweenInPropertyTimezone(checkIn, checkOut, property.timezone);
    if (nights < 1) {
      throw new BadRequestException('MINIMUM_ONE_NIGHT');
    }

    // Pull live OTA reservations (Booking via Zodomus) into local DB before conflict check.
    // Hard-fails when linked channels error (returnCode >= 400 / network).
    await this.zodomusSync.pullLiveOtaBookingsForDirectBooking(property);

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

    const inventory = await this.zodomusSync.assertStayAllowedByOtaInventory(
      property,
      checkIn,
      checkOut,
      nights,
    );
    if (!inventory.ok) {
      this.throwOtaInventoryBlock(inventory);
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
    // Direct booking only — no Zodomus reservation-create (unsupported in public API).
    // Occupancy is sent to OTAs via availability push (see doc/zodomus/BOOKING-FLOW.md).
    const saved = await this.bookingRepository.save(booking);

    const linked = this.zodomusSync.isPropertyZodomusLinked(property);
    if (linked) {
      try {
        await this.zodomusAvailabilityPush.pushAvailabilityNow(saved.propertyId, {
          dateFromISO: saved.checkIn.toISOString(),
          dateToISO: saved.checkOut.toISOString(),
          ignoreAutoPushDisable: true,
          awaitUpstream: true,
        });
      } catch (e) {
        await this.bookingRepository.remove(saved);
        if (e instanceof HttpException) {
          const body = e.getResponse();
          throw new BadGatewayException({
            error: 'ZODOMUS_AVAILABILITY_PUSH_FAILED',
            message: 'Zodomus availability push failed — local booking was not kept',
            upstream: 'zodomus',
            detail: typeof body === 'object' && body !== null ? body : String(e.message),
          });
        }
        throw new BadGatewayException({
          error: 'ZODOMUS_AVAILABILITY_PUSH_FAILED',
          message: 'Zodomus availability push failed — local booking was not kept',
          upstream: 'zodomus',
          detail: String(e),
        });
      }
    }

    this.calendarGateway.emitCalendarChanged({ propertyId: saved.propertyId, source: 'booking:create' });
    return saved;
  }

  /**
   * For UI: same overlap + min-night + OTA inventory rules as create, without persisting.
   * Also refreshes live OTA bookings when the property is linked to Zodomus.
   */
  async previewConflict(
    propertyId: string,
    checkInIso: string,
    checkOutIso: string,
    userId: string,
    role: string,
  ): Promise<BookingConflictPreviewResult> {
    const property = await this.propertyService.findOneForUser(propertyId, userId, role);
    const checkIn = this.normalizeBookingDay(checkInIso, property.timezone);
    const checkOut = this.normalizeBookingDay(checkOutIso, property.timezone);
    const nights = nightsBetweenInPropertyTimezone(checkIn, checkOut, property.timezone);
    if (nights < 1) {
      return { available: false, reason: 'MINIMUM_ONE_NIGHT' };
    }

    const live = await this.zodomusSync.pullLiveOtaBookingsForDirectBooking(property);

    const overlap = await this.findBlockingOverlap(property.id, checkIn, checkOut);
    if (overlap) {
      return {
        available: false,
        conflictWith: {
          guestName: overlap.guestName,
          checkIn: overlap.checkIn.toISOString(),
          checkOut: overlap.checkOut.toISOString(),
        },
        otaRefreshed: live.attempted,
      };
    }

    const inventory = await this.zodomusSync.assertStayAllowedByOtaInventory(
      property,
      checkIn,
      checkOut,
      nights,
    );
    if (!inventory.ok) {
      return {
        available: false,
        reason: inventory.reason,
        otaRefreshed: live.attempted,
        otaRestriction: {
          reason: inventory.reason,
          date: inventory.date,
          minStayRequired: inventory.minStayRequired,
          nights: inventory.nights,
        },
      };
    }

    return { available: true, otaRefreshed: live.attempted };
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
      const nextCheckIn =
        dto.checkIn !== undefined
          ? this.normalizeBookingDay(dto.checkIn, property.timezone)
          : booking.checkIn;
      const nextCheckOut =
        dto.checkOut !== undefined
          ? this.normalizeBookingDay(dto.checkOut, property.timezone)
          : booking.checkOut;
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
      booking.checkIn = this.normalizeBookingDay(dto.checkIn, property.timezone);
      if (booking.checkIn < minDate) minDate = booking.checkIn;
      availabilityDirty = true;
    }
    if (dto.checkOut !== undefined) {
      booking.checkOut = this.normalizeBookingDay(dto.checkOut, property.timezone);
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

    /**
     * OTA lifecycle is inbound only (Zodomus → CRM). Public Zodomus APIs have no
     * production reservation-cancel; CRM must not fake it. See ZODOMUS_BOOKING_FLOW.
     */
    if (next === BOOKING_STATUS.CANCELLED && booking.zodomusReservationId?.trim()) {
      throw new BadRequestException(ZODOMUS_BOOKING_FLOW.OTA_CANCEL_VIA_CHANNEL);
    }

    booking.status = next;
    if (cancelledBy) {
      booking.cancelledBy = cancelledBy;
    }
    if (next === BOOKING_STATUS.CANCELLED) {
      booking.overbookingConflict = false;
      booking.overbookingConflictWithBookingId = null;
      booking.overbookingDetectedAt = null;
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

    // Inventory only — never treat availability push as OTA reservation cancel authority.
    // Direct cancel: await upstream so OTA nights reopen before response.
    const property = await this.propertyService.findOneForUser(saved.propertyId, userId, role);
    if (next === BOOKING_STATUS.CANCELLED && this.zodomusSync.isPropertyZodomusLinked(property)) {
      try {
        await this.zodomusAvailabilityPush.pushAvailabilityNow(saved.propertyId, {
          dateFromISO: saved.checkIn.toISOString(),
          dateToISO: saved.checkOut.toISOString(),
          ignoreAutoPushDisable: true,
          awaitUpstream: true,
        });
      } catch (e) {
        // Local cancel already applied; push service marks dirty for retry.
        if (e instanceof HttpException) throw e;
        throw new BadGatewayException({
          error: 'ZODOMUS_AVAILABILITY_PUSH_FAILED',
          message: 'Booking cancelled locally but Zodomus availability reopen failed',
          upstream: 'zodomus',
          detail: String(e),
        });
      }
    } else {
      this.zodomusAvailabilityPush.scheduleAvailabilityPush(saved.propertyId, {
        dateFromISO: saved.checkIn.toISOString(),
        dateToISO: saved.checkOut.toISOString(),
      });
    }

    this.calendarGateway.emitCalendarChanged({ propertyId: saved.propertyId, source: 'booking:transition' });

    return saved;
  }
}

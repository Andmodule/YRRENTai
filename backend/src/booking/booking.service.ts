import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingEntity } from './entities/booking.entity';
import { BookingStatusChangedEvent } from '../common/events/booking.events';
import { isValidTransition, type BookingStatus, type CreateBookingDto } from '@rentai/shared';
import { PropertyService } from '../property/property.service';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(BookingEntity)
    private readonly bookingRepository: Repository<BookingEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly propertyService: PropertyService,
  ) {}

  async create(dto: CreateBookingDto, userId: string): Promise<BookingEntity> {
    const booking = this.bookingRepository.create({
      ...dto,
      status: 'PENDING',
      createdBy: userId,
    });
    return this.bookingRepository.save(booking);
  }

  async findAllByProperty(propertyId: string, userId: string): Promise<BookingEntity[]> {
    const pid = propertyId?.trim();
    if (!pid) {
      throw new BadRequestException('Query parameter propertyId is required');
    }
    await this.propertyService.findOne(pid, userId);
    return this.bookingRepository.find({
      where: { propertyId: pid },
      order: { checkIn: 'DESC' },
    });
  }

  async findOne(id: string, _userId: string): Promise<BookingEntity> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  async transition(
    id: string,
    newStatus: string,
    userId: string,
    cancelledBy?: string,
  ): Promise<BookingEntity> {
    const booking = await this.findOne(id, userId);
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

    return saved;
  }
}

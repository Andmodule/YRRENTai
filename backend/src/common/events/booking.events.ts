import { BookingStatus } from '@rentai/shared';

export class BookingStatusChangedEvent {
  constructor(
    public readonly bookingId: string,
    public readonly propertyId: string,
    public readonly previousStatus: BookingStatus,
    public readonly newStatus: BookingStatus,
    public readonly changedBy: string,
    public readonly cancelledBy?: 'guest' | 'manager' | 'system',
  ) {}
}

export class BookingConfirmedEvent extends BookingStatusChangedEvent {}
export class BookingCancelledEvent extends BookingStatusChangedEvent {}
export class BookingCheckedInEvent extends BookingStatusChangedEvent {}
export class BookingCheckedOutEvent extends BookingStatusChangedEvent {}

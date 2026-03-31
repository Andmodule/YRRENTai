export type BookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked';
export type BookingChannel = 'booking' | 'airbnb' | 'direct' | 'other';

export interface Property {
  uuid: string;
  title: string;
  avatarUrl?: string;
}

export interface Reservation {
  uuid: string;
  externalId: string;
  propertyId: string;
  guestName: string;
  channel: BookingChannel;
  status: BookingStatus;
  totalPrice: number;
  currency: string;
  checkIn: string;
  checkOut: string;
  chatThreadId: string | null;
}

export interface CalendarDateRange {
  start: Date;
  end: Date;
}

export interface CalendarFilters {
  propertyQuery: string;
  channelFilter: BookingChannel | 'all';
  statusFilter: BookingStatus | 'all';
}

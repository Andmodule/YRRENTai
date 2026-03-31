export type BookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked';
export type BookingChannel = 'booking' | 'airbnb' | 'direct' | 'other';

export interface Property {
  uuid: string;
  title: string;
  avatarUrl?: string;
  /** Объект привязан к Zodomus (можно синхронизировать OTA). */
  zodomusLinked?: boolean;
  /** Внешний id Zodomus (если задан). */
  zodomusPropertyId?: string | null;
}

export interface Reservation {
  uuid: string;
  externalId: string;
  /** Бронь пришла из Zodomus OTA sync. */
  fromOta?: boolean;
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

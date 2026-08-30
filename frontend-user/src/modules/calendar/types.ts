export type BookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked' | 'cancelled';
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
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestsCount?: number | null;
  guestsAdults?: number | null;
  guestsChildren?: number | null;
  notes?: string | null;
  /** Team-only; not overwritten by OTA sync. */
  internalNotes?: string | null;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  /** From OTA (Zodomus) when channel sends payment / payout type. */
  otaPaymentHint?: string | null;
  /** Manual direct booking source; only when channel is direct. */
  directSource?: string | null;
  channel: BookingChannel;
  status: BookingStatus;
  totalPrice: number;
  currency: string;
  checkIn: string;
  checkOut: string;
  chatThreadId: string | null;
  /** Inbound OTA booking overlaps another blocking booking. */
  overbookingConflict?: boolean;
  overbookingConflictWithBookingId?: string | null;
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

export type BookingStatus = 'confirmed' | 'pending' | 'cleaning' | 'blocked' | 'cancelled';
export type BookingChannel = 'booking' | 'airbnb' | 'direct' | 'other';

export type OtaCalendarRestrictionHint = {
  date: string;
  kind: 'closed' | 'minStay' | 'closedOnArrival' | 'closedOnDeparture';
  minStay?: number;
};

export interface Property {
  uuid: string;
  title: string;
  avatarUrl?: string;
  /** Объект привязан к Zodomus (можно синхронизировать OTA). */
  zodomusLinked?: boolean;
  /** Внешний id Zodomus (если задан). */
  zodomusPropertyId?: string | null;
  /** Nights closed on channel inventory (not covered by a local booking). */
  otaBlockedDays?: string[];
  /** Rate restriction hints from Zodomus GET /availability. */
  otaRestrictions?: OtaCalendarRestrictionHint[];
  /** Nightly rack prices from channel (major units). */
  otaNightlyPrices?: Record<string, number>;
}

export interface Reservation {
  uuid: string;
  externalId: string;
  /** Бронь пришла из Zodomus OTA sync. */
  fromOta?: boolean;
  /** Synthetic bar from channel availability=0 (not a CRM booking). */
  otaInventoryBlock?: boolean;
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

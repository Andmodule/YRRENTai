/**
 * Draft shapes — align with real JSON from GET /account, /channels, etc. after first successful curl.
 */

export interface ZodomusAccount {
  userId?: string;
  companyName?: string;
  email?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ZodomusChannel {
  channelId?: number;
  channelName?: string;
  name?: string;
  active?: boolean;
  [key: string]: unknown;
}

/** GET /reservations-queue — live API uses `id` per item; `reservationId` kept for compatibility. */
export interface ZodomusReservationQueueItem {
  id?: string;
  reservationId?: string;
  status?: number;
  date?: string;
  channelId?: number;
  propertyId?: string;
  action?: string;
  [key: string]: unknown;
}

/** Один номер в теле POST /rooms-activation (официальный формат Zodomus). */
export interface ZodomusRoomActivationRoom {
  roomId: string;
  roomName: string;
  quantity: number;
  status: number;
  rates: string[];
}

/** Full reservation from GET /reservations — refine fields against live API. */
export interface ZodomusReservation {
  /** Some responses use `id` instead of `reservationId`. */
  id?: string | number;
  reservationId?: string;
  channelId?: number;
  propertyId?: string;
  roomId?: string;
  checkIn?: string;
  checkOut?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestName?: string;
  guestEmail?: string;
  /** Merged from `customer.phone` (+ country code when present). */
  guestPhone?: string;
  /** From first room: adults+children preferred, else `numberOfGuests`. */
  guestsCount?: number;
  /** Set when breakdown comes from room adults+children (not only numberOfGuests). */
  guestBreakdownFromRoom?: boolean;
  guestAdults?: number;
  guestChildren?: number;
  /** Remarks / meal plan lines from OTA payload. */
  notes?: string;
  totalPrice?: number;
  currency?: string;
  status?: string;
  /** Filled by flattenZodomusReservationsBlock from OTA payment fields when present. */
  otaPaymentHint?: string;
  [key: string]: unknown;
}

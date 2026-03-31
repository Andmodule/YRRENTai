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

export interface ZodomusReservationQueueItem {
  reservationId: string;
  channelId?: number;
  propertyId?: string;
  action?: string;
  [key: string]: unknown;
}

/** Full reservation from GET /reservations — refine fields against live API. */
export interface ZodomusReservation {
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
  totalPrice?: number;
  currency?: string;
  status?: string;
  [key: string]: unknown;
}

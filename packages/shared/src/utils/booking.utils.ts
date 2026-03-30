import { type BookingStatus, BOOKING_TRANSITIONS, TERMINAL_BOOKING_STATUSES } from '../constants/booking-states';

export function isValidTransition(from: BookingStatus, to: BookingStatus): boolean {
  const allowed = BOOKING_TRANSITIONS[from];
  return allowed.includes(to);
}

export function isTerminalStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

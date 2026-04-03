/** How a direct (non-OTA) booking was acquired — only for manual / non-channel bookings. */
export const DIRECT_BOOKING_SOURCES = [
  'call',
  'whatsapp',
  'email',
  'website',
  'in_person',
] as const;

export type DirectBookingSource = (typeof DIRECT_BOOKING_SOURCES)[number];

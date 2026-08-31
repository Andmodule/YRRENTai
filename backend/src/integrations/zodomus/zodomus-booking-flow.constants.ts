/**
 * Supported CRM ↔ Zodomus ↔ Booking semantics.
 * Full product description: doc/zodomus/BOOKING-FLOW.md
 *
 * Public Zodomus Reservation APIs do NOT include production create/cancel
 * of guest reservations — only inbound queue/get/summary and sandbox createtest.
 * Outbound from RentAI is availability (inventory) only.
 */
export const ZODOMUS_BOOKING_FLOW = {
  /** Direct CRM booking lives only in RentAI; Zodomus receives occupancy via availability push. */
  CRM_DIRECT_CREATE: 'crm-direct-create',
  /** Direct CRM cancel updates local status then pushes availability:1 for freed nights. */
  CRM_DIRECT_CANCEL: 'crm-direct-cancel',
  /**
   * OTA cancel from CRM is rejected with this API error code.
   * Managers cancel on the channel; Zodomus delivers reservationStatus=3 inbound.
   */
  OTA_CANCEL_VIA_CHANNEL: 'OTA_CANCEL_VIA_CHANNEL',
  /** Inbound new/modified reservation → upsert BookingEntity. */
  INBOUND_UPSERT: 'zodomus-inbound-upsert',
  /** Inbound cancel (queue/webhook status 3) → local CANCELLED + availability push. */
  INBOUND_CANCEL: 'zodomus-inbound-cancel',
} as const;

export type ZodomusBookingFlowOp =
  (typeof ZODOMUS_BOOKING_FLOW)[keyof typeof ZODOMUS_BOOKING_FLOW];

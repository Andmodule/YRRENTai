import { z } from 'zod';
import { BOOKING_STATUS } from '../constants/booking-states';
import { DIRECT_BOOKING_SOURCES } from '../constants/direct-booking-source';
import { normalizeGuestEmail, normalizeGuestPhone } from '../utils/guest';

const bookingStatusEnum = z.enum([
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.CHECKED_IN,
  BOOKING_STATUS.CHECKED_OUT,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.DECLINED,
  BOOKING_STATUS.NO_SHOW,
]);

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().email().optional(),
);

const optionalPhone = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().max(50).optional(),
);

const createBookingFieldsSchema = z.object({
  propertyId: z.string().uuid(),
  guestName: z.string().min(1).max(255),
  guestEmail: optionalEmail,
  guestPhone: optionalPhone,
  checkIn: z.string().datetime(),
  checkOut: z.string().datetime(),
  totalPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
  guestsCount: z.number().int().positive().max(100).optional(),
  notes: z.string().max(2000).optional(),
  /** Only for direct (manual) bookings; ignored when channel is OTA. */
  directSource: z.enum(DIRECT_BOOKING_SOURCES).optional().nullable(),
});

/** Phone/email optional — guest CRM link is created only when at least one is provided. */
export const createBookingSchema = createBookingFieldsSchema;

export const updateBookingSchema = createBookingFieldsSchema.omit({ propertyId: true }).partial();

export const BOOKING_PAYMENT_STATUS = ['unpaid', 'partial', 'paid'] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUS)[number];

export const patchBookingSchema = updateBookingSchema.extend({
  internalNotes: z.string().max(5000).optional().nullable(),
  paymentStatus: z.enum(BOOKING_PAYMENT_STATUS).optional(),
});

export const transitionBookingSchema = z.object({
  status: bookingStatusEnum,
  cancelledBy: z.enum(['guest', 'manager', 'system']).optional(),
});

import { z } from 'zod';
import { BOOKING_STATUS } from '../constants/booking-states';

const bookingStatusEnum = z.enum([
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.CHECKED_IN,
  BOOKING_STATUS.CHECKED_OUT,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.DECLINED,
  BOOKING_STATUS.NO_SHOW,
]);

export const createBookingSchema = z.object({
  propertyId: z.string().uuid(),
  guestName: z.string().min(1).max(255),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().max(50).optional(),
  checkIn: z.string().datetime(),
  checkOut: z.string().datetime(),
  totalPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
  guestsCount: z.number().int().positive().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateBookingSchema = createBookingSchema
  .omit({ propertyId: true })
  .partial();

export const transitionBookingSchema = z.object({
  status: bookingStatusEnum,
  cancelledBy: z.enum(['guest', 'manager', 'system']).optional(),
});

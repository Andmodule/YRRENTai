import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');

/**
 * Push nightly OTA prices via Zodomus POST /rates.
 * `dateTo` is exclusive (last night + 1 day), same as availability.
 */
export const pushZodomusRatesSchema = z
  .object({
    propertyId: z.string().uuid(),
    dateFrom: ymd,
    /** Exclusive end (checkout-style). Must be after dateFrom. */
    dateTo: ymd,
    /** Nightly rack price in major units (e.g. 600.00 PLN). */
    price: z.coerce.number().positive().max(1_000_000),
    /** Optional single-occupancy price (Booking Maximum/Single model). */
    priceSingle: z.coerce.number().positive().max(1_000_000).optional(),
    currencyCode: z
      .string()
      .trim()
      .length(3)
      .transform((s) => s.toUpperCase())
      .optional(),
    /** Optional override; otherwise first Standard rate from GET /room-rates. */
    rateId: z.string().trim().min(1).max(64).optional(),
    /** Optional Zodomus channel filter (default: all linked channels). */
    channelId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine((d) => d.dateFrom < d.dateTo, {
    message: 'dateTo must be after dateFrom (exclusive end)',
    path: ['dateTo'],
  });

export class PushZodomusRatesDto extends createZodDto(pushZodomusRatesSchema) {}

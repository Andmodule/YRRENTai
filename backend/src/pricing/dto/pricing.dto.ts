import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BOOKING_WEEKDAYS } from '../../integrations/zodomus/zodomus-promotions.util';
import { nightsCount } from '../pricing-math.util';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');
const weekdays = z.array(z.enum(BOOKING_WEEKDAYS)).min(1).max(7);
const propertyIds = z.array(z.string().uuid()).min(1).max(500);
/** Longest discount window accepted (Booking promotions are per stay date). */
const MAX_NIGHTS = 366;

export const createPromotionSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    /** Booking Basic deal accepts 1–99 %. */
    discountPct: z.coerce.number().int().min(1).max(99),
    /** Inclusive. */
    stayFrom: ymd,
    /** Inclusive. */
    stayTo: ymd,
    /** Omitted / null / all seven = every day. */
    weekdays: weekdays.nullable().optional(),
    /** Omitted = every property of the tenant connected to Booking. */
    propertyIds: propertyIds.optional(),
    /** Skip properties where the Genius guest price would go below their minimum. Default true. */
    protectMinPrice: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.stayFrom <= d.stayTo, {
    message: 'stayTo must not be before stayFrom',
    path: ['stayTo'],
  })
  .refine((d) => nightsCount(d.stayFrom, d.stayTo) <= MAX_NIGHTS, {
    message: `At most ${MAX_NIGHTS} nights`,
    path: ['stayTo'],
  });

export class CreatePromotionDto extends createZodDto(createPromotionSchema) {}

export const updatePromotionSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    discountPct: z.coerce.number().int().min(1).max(99).optional(),
    stayFrom: ymd.optional(),
    stayTo: ymd.optional(),
    weekdays: weekdays.nullable().optional(),
    propertyIds: propertyIds.optional(),
    protectMinPrice: z.boolean().optional(),
  })
  .strict()
  .refine((d) => !d.stayFrom || !d.stayTo || d.stayFrom <= d.stayTo, {
    message: 'stayTo must not be before stayFrom',
    path: ['stayTo'],
  });

export class UpdatePromotionDto extends createZodDto(updatePromotionSchema) {}

export const pricingSettingsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            propertyId: z.string().uuid(),
            /** Major units of the Booking price currency; null clears the minimum. */
            minPrice: z.number().min(0).max(1_000_000).nullable().optional(),
            /** Genius discount as set in the Booking extranet; null = unknown. */
            geniusPct: z.number().int().min(0).max(50).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export class PricingSettingsDto extends createZodDto(pricingSettingsSchema) {}

export const accessCheckSchema = z
  .object({
    /** Omitted = every Booking-connected property of the tenant. */
    propertyIds: propertyIds.optional(),
  })
  .strict();

export class AccessCheckDto extends createZodDto(accessCheckSchema) {}

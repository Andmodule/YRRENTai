import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BOOKING_WEEKDAYS } from '../../integrations/zodomus/zodomus-promotions.util';

const weekdays = z.array(z.enum(BOOKING_WEEKDAYS)).min(1).max(7);
const propertyIds = z.array(z.string().uuid()).min(1).max(500);

/** Booking accepts 1–1000; keep the UI sane: up to 30 days or 720 hours before arrival. */
const MAX_DAYS = 30;
const MAX_HOURS = 720;
const MAX_STEPS = 8;

export const ruleStepSchema = z
  .object({
    /** Booking last-minute deal accepts 1–99 %. */
    discountPct: z.coerce.number().int().min(1).max(99),
    unit: z.enum(['day', 'hour']),
    /** Bookable only this many days / hours before check-in. */
    value: z.coerce.number().int().min(1).max(MAX_HOURS),
    /** Hours of the day (property time zone, 0–24) when guests can book it; null = any time. */
    bookTime: z
      .object({
        start: z.coerce.number().int().min(0).max(23),
        end: z.coerce.number().int().min(1).max(24),
      })
      .strict()
      .refine((t) => t.start < t.end, { message: 'start must be before end' })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((s) => s.unit !== 'day' || s.value <= MAX_DAYS, {
    message: `At most ${MAX_DAYS} days`,
    path: ['value'],
  });

export const createRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    steps: z.array(ruleStepSchema).min(1).max(MAX_STEPS),
    /** Stay weekdays the rule applies to; omitted / null / all seven = every day. */
    weekdays: weekdays.nullable().optional(),
    /** How far ahead the rule is created (months of stay dates). */
    horizonMonths: z.coerce.number().int().min(1).max(12).default(6),
    /** Omitted = every property of the tenant connected to Booking. */
    propertyIds: propertyIds
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate property ids' })
      .optional(),
    /** Skip properties where the Genius guest price would go below their minimum. Default true. */
    protectMinPrice: z.boolean().optional(),
    /** Editing = create the new rule, then switch this one off. */
    replaceGroupId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (r) => {
      const keys = r.steps.map((s) => `${s.unit}:${s.value}:${s.bookTime?.start ?? ''}-${s.bookTime?.end ?? ''}`);
      return new Set(keys).size === keys.length;
    },
    { message: 'Steps must differ', path: ['steps'] },
  );

export class CreateRuleDto extends createZodDto(createRuleSchema) {}

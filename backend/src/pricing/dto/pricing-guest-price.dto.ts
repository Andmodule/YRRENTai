import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isYmd } from '../pricing-math.util';

const ymd = z.string().refine(isYmd, 'Дата в формате yyyy-MM-dd');
const money = z.coerce.number().min(0).max(1_000_000);
const optMoney = money.nullable().optional();
/** Discount names come from Booking (extranet deals) and from RentAI (up to 120 characters). */
const lineLabel = z.string().max(120);
const optPct = (max: number) => z.coerce.number().int().min(0).max(max).nullable().optional();

/** Every field is optional: what is not sent stays as it was; null clears it. */
export const channelProfileSchema = z
  .object({
    cleaningFee: optMoney,
    vatIncludedPct: optPct(50),
    cityTaxPerGuestNight: optMoney,
    extraDiscounts: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(40),
            pct: z.coerce.number().gt(0).max(99),
          })
          .strict(),
      )
      .max(5)
      .nullable()
      .optional(),
    weeklyPct: optPct(99),
    monthlyPct: optPct(99),
    nightly: money.positive().nullable().optional(),
    weekendNightly: money.positive().nullable().optional(),
  })
  .strict();

export class ChannelProfileDto extends createZodDto(channelProfileSchema) {}

/** Hand-typed nightly prices of a channel for [from, to] (inclusive); price null removes them. */
export const nightPricesSchema = z
  .object({
    channel: z.enum(['booking', 'airbnb']),
    from: ymd,
    to: ymd,
    price: money.positive().nullable(),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: '«С» позже «по»', path: ['to'] });

export class NightPricesDto extends createZodDto(nightPricesSchema) {}

const guestDiscountSchema = z
  .object({
    kind: z.enum(['rate_plan', 'genius', 'extra', 'deal', 'targeting', 'length_of_stay']),
    label: lineLabel,
    pct: z.coerce.number().min(0).max(100),
  })
  .strict();

export const guestPriceInputSchema = z
  .object({
    nights: z
      .array(
        z
          .object({ date: ymd, rack: money, discounts: z.array(guestDiscountSchema).max(10) })
          .strict(),
      )
      .min(1)
      .max(60),
    fees: z
      .array(
        z
          .object({ kind: z.enum(['cleaning', 'pets', 'other']), label: lineLabel, amount: money })
          .strict(),
      )
      .max(5)
      .optional(),
    taxesOnTop: z.array(z.object({ label: lineLabel, amount: money }).strict()).max(5).optional(),
    vatIncludedPct: z.coerce.number().min(0).max(50).nullable().optional(),
  })
  .strict();

/**
 * Calibration: the total a guest saw on the channel, plus what the panel calculated it from.
 * The server recalculates `input` itself; `clientTotal` only tells when the two calculations drift apart.
 */
export const observationSchema = z
  .object({
    channel: z.enum(['booking', 'airbnb']),
    scenario: z.enum(['min', 'regular']),
    guests: z.coerce.number().int().min(1).max(20),
    observedTotal: money.positive(),
    clientTotal: money,
    input: guestPriceInputSchema,
  })
  .strict();

export class ObservationDto extends createZodDto(observationSchema) {}

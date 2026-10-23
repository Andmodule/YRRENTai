import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isYmd } from '../pricing-math.util';
import { MARKUP_MAX, MARKUP_MIN } from '../base-price.util';

const ymd = z.string().refine(isYmd, 'Дата в формате yyyy-MM-dd');
const price = z.coerce.number().positive().max(1_000_000);

/** Base price for every night of [from, to] (inclusive); price null removes it. */
export const basePriceRangeSchema = z
  .object({ from: ymd, to: ymd, price: price.nullable() })
  .strict()
  .refine((v) => v.from <= v.to, { message: '«С» позже «по»', path: ['to'] });

export class BasePriceRangeDto extends createZodDto(basePriceRangeSchema) {}

/** Base prices night by night (e.g. taken from Booking for a month): yyyy-MM-dd → price. */
export const basePriceNightsSchema = z
  .object({
    prices: z
      .record(z.string(), price)
      .refine((m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 62, 'От 1 до 62 ночей за раз')
      .refine((m) => Object.keys(m).every(isYmd), 'Даты в формате yyyy-MM-dd'),
  })
  .strict();

export class BasePriceNightsDto extends createZodDto(basePriceNightsSchema) {}

/** Every field optional: what is not sent stays; null clears the guest percents. */
export const channelPricingSchema = z
  .object({
    markupPct: z.coerce.number().int().min(MARKUP_MIN).max(MARKUP_MAX).optional(),
    singleGuestPct: z.coerce.number().int().min(0).max(90).nullable().optional(),
    extraGuestPct: z.coerce.number().int().min(0).max(200).nullable().optional(),
  })
  .strict();

export class ChannelPricingDto extends createZodDto(channelPricingSchema) {}

/** Nights [from, to] (inclusive) to price on Booking from the base price. */
export const bookingSendSchema = z
  .object({ from: ymd, to: ymd })
  .strict()
  .refine((v) => v.from <= v.to, { message: '«С» позже «по»', path: ['to'] });

export class BookingSendDto extends createZodDto(bookingSendSchema) {}

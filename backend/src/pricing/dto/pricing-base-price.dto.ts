import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
// The strict check: «2026-02-30» is refused here, not by the database.
import { isYmd } from '../../calendar-dates/calendar-dates.util';
import { MARKUP_MAX, MARKUP_MIN } from '../base-price.util';

const ymd = z.string().refine(isYmd, 'Дата в формате yyyy-MM-dd');
const price = z.coerce.number().positive().max(1_000_000);

/** Base price for every night of [from, to] (inclusive); price null removes it. */
export const basePriceRangeSchema = z
  .object({ from: ymd, to: ymd, price: price.nullable() })
  .strict()
  .refine((v) => v.from <= v.to, { message: '«С» позже «по»', path: ['to'] });

export class BasePriceRangeDto extends createZodDto(basePriceRangeSchema) {}


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

/** «Отправить» after «Проверить»: the preview's fingerprint — the prices must still be the same. */
export const bookingSendConfirmSchema = z
  .object({ from: ymd, to: ymd, fingerprint: z.string().regex(/^[0-9a-f]{40}$/, 'Отпечаток проверки') })
  .strict()
  .refine((v) => v.from <= v.to, { message: '«С» позже «по»', path: ['to'] });

export class BookingSendConfirmDto extends createZodDto(bookingSendConfirmSchema) {}

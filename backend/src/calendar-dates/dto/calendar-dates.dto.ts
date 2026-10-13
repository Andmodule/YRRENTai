import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isYmd } from '../calendar-dates.util';

/** A real calendar date (2000–2100), not just the pattern: «9999-99-99» must never reach a date loop. */
const ymd = z.string().refine(isYmd, 'Expected a real date yyyy-MM-dd');
/** Nightly price in major units of the Booking currency (e.g. 1180 PLN). */
const price = z.coerce.number().positive().max(1_000_000);

/** «Открыть / закрыть даты»: one property, one range. */
export const calendarDatesSchema = z
  .object({
    propertyId: z.string().uuid(),
    action: z.enum(['open', 'close']),
    dateFrom: ymd,
    /** Exclusive end (the day after the last night), like push-rates. */
    dateTo: ymd,
    /** 0 = Sunday … 6 = Saturday; missing = every day. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    /** Missing = each night keeps the price Booking has. Not allowed on «close». */
    price: price.optional(),
    /** Friday and Saturday nights; needs `price`. */
    weekendPrice: price.optional(),
    /** «open» only: leave nights that are already open (and their price) alone. */
    onlyClosed: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.dateFrom < d.dateTo, { message: 'dateTo must be after dateFrom (exclusive end)', path: ['dateTo'] })
  .refine((d) => d.weekendPrice == null || d.price != null, { message: 'weekendPrice needs price', path: ['weekendPrice'] })
  .refine((d) => d.action === 'open' || (d.price == null && d.weekendPrice == null), {
    message: 'Closing keeps the prices Booking has — send no price',
    path: ['price'],
  });

export class CalendarDatesDto extends createZodDto(calendarDatesSchema) {}

/** «Автопродление»: keep the next N days open, opening each new far night at this price. */
export const calendarAutoOpenSchema = z
  .object({
    propertyId: z.string().uuid(),
    enabled: z.boolean(),
    horizonDays: z.coerce.number().int().min(7).max(366),
    price,
    weekendPrice: price.nullable().optional(),
  })
  .strict();

export class CalendarAutoOpenDto extends createZodDto(calendarAutoOpenSchema) {}

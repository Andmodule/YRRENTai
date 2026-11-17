/**
 * The price to put in a price field before anyone types: the one value every picked night has now. Nights
 * with different prices (or some without one) leave the field empty — a guess there would be sent as typed.
 */
export function samePrice(values: readonly (number | null | undefined)[]): number | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (first == null || !(first > 0)) return null;
  return values.every((v) => v === first) ? first : null;
}

/**
 * «Базовая цена на выбранные ночи»: the base price the nights share. Without any base price the field stays empty
 * and Booking's price is only a hint (`bookingHint`): saving it as the base would change what Booking (+ its %)
 * and Airbnb get at once.
 */
export function basePrefill(
  nights: readonly { ymd: string }[],
  base: Readonly<Record<string, number>>,
): number | null {
  return samePrice(nights.map((n) => base[n.ymd]));
}

/** Booking's price now on all the picked nights, when none of them has a base price yet. */
export function bookingHint(
  nights: readonly { ymd: string; rack: number | null }[],
  base: Readonly<Record<string, number>>,
): number | null {
  if (nights.some((n) => base[n.ymd] != null)) return null;
  return samePrice(nights.map((n) => n.rack));
}

/** The field's text: whole numbers as they are, others with two decimals at most. */
export function prefillText(price: number | null): string {
  if (price == null) return '';
  return Number.isInteger(price) ? String(price) : String(Math.round(price * 100) / 100);
}

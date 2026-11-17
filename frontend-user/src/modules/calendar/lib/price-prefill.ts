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
 * «Базовая цена на выбранные ночи»: the base price the nights share; without any base price yet — what Booking
 * has now (its main rate), so the field starts from the real price, as «Цена на канале» does.
 */
export function basePrefill(
  nights: readonly { ymd: string; rack: number | null }[],
  base: Readonly<Record<string, number>>,
): number | null {
  const own = nights.map((n) => base[n.ymd]);
  if (own.some((v) => v != null)) return samePrice(own);
  return samePrice(nights.map((n) => n.rack));
}

/** The field's text: whole numbers as they are, others with two decimals at most. */
export function prefillText(price: number | null): string {
  if (price == null) return '';
  return Number.isInteger(price) ? String(price) : String(Math.round(price * 100) / 100);
}

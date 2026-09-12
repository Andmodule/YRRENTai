import { BadRequestException } from '@nestjs/common';

/** Тариф из GET /room-rates (вложен в room). */
export interface ZodomusRoomRateDto {
  id: string;
  name?: string;
  active?: string;
  maxPersons?: string;
  policy?: string;
  policyId?: string;
}

export interface ZodomusRoomPreviewDto {
  id: string;
  name?: string;
  rates?: ZodomusRoomRateDto[];
}

export interface ZodomusPropertyPreviewDto {
  externalPropertyId: string;
  /** Подпись для поля name (может быть запасной). */
  displayName: string;
  address: string | null;
  city: string | null;
  country: string | null;
  rooms: ZodomusRoomPreviewDto[];
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v != null && typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function mapRoomRates(rr: Record<string, unknown>): ZodomusRoomRateDto[] | undefined {
  const raw = rr.rates;
  if (!Array.isArray(raw)) return undefined;
  const out: ZodomusRoomRateDto[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = o.id != null ? String(o.id).trim() : '';
    if (!id) continue;
    out.push({
      id,
      name: o.name != null ? String(o.name) : undefined,
      active: o.active != null ? String(o.active) : undefined,
      maxPersons: o.maxPersons != null ? String(o.maxPersons) : undefined,
      policy: o.policy != null ? String(o.policy) : undefined,
      policyId: o.policyId != null ? String(o.policyId) : undefined,
    });
  }
  return out.length ? out : undefined;
}

/** Вложенные объекты, где Zodomus/канал иногда кладёт адрес (не задокументировано единообразно). */
function collectRecordCandidates(root: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [root];
  const push = (v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
  };
  push(root.body);
  push(root.data);
  push(root.property);
  push(root.hotel);
  push(root.listing);
  push(root.propertyDetails);
  push(root.channelProperty);
  return out;
}

/**
 * Разбор тела GET /room-rates для превью в форме объекта.
 *
 * По официальной схеме Zodomus ответ почти всегда содержит только `status` и `rooms[]`
 * (тарифы/комнаты), без названия отеля и адреса — их нет в контракте endpoint.
 * Поэтому адрес/страна часто остаются пустыми; название подставляем из комнат, если возможно.
 */
export function mapRoomRatesToPropertyPreview(
  raw: unknown,
  externalPropertyId: string,
): ZodomusPropertyPreviewDto {
  const ext = externalPropertyId.trim();
  let displayName: string | null = null;
  let address: string | null = null;
  let city: string | null = null;
  let country: string | null = null;

  let roomList: unknown[] = [];

  if (Array.isArray(raw)) {
    roomList = raw;
  } else if (raw && typeof raw === 'object') {
    const root = raw as Record<string, unknown>;
    const inner =
      root.body && typeof root.body === 'object' && !Array.isArray(root.body)
        ? (root.body as Record<string, unknown>)
        : root;

    const candidates = collectRecordCandidates(inner);
    const nameKeys = [
      'propertyName',
      'name',
      'hotelName',
      'title',
      'propertyTitle',
      'listingName',
      'accommodationName',
    ];
    const addressKeys = [
      'address',
      'addressLine',
      'street',
      'fullAddress',
      'propertyAddress',
      'streetAddress',
      'addressLine1',
      'address1',
    ];
    const cityKeys = ['city', 'town', 'cityName', 'locality'];
    const countryKeys = ['country', 'countryName', 'countryCode'];

    for (const c of candidates) {
      if (!displayName) displayName = pickString(c, nameKeys);
      if (!address) address = pickString(c, addressKeys);
      if (!city) city = pickString(c, cityKeys);
      if (!country) country = pickString(c, countryKeys);
    }

    if (Array.isArray(inner.rooms)) {
      roomList = inner.rooms as unknown[];
    }
  }

  const rooms: ZodomusRoomPreviewDto[] = [];
  for (const r of roomList) {
    if (!r || typeof r !== 'object') continue;
    const rr = r as Record<string, unknown>;
    const rid = rr.id ?? rr.roomId;
    const id = rid != null ? String(rid).trim() : '';
    if (!id) continue;
    const rn = rr.name ?? rr.roomName;
    const name = rn != null ? String(rn).trim() : undefined;
    const rates = mapRoomRates(rr);
    const row: ZodomusRoomPreviewDto = name ? { id, name } : { id };
    if (rates?.length) row.rates = rates;
    rooms.push(row);
  }

  if (!displayName?.trim()) {
    // GET /room-rates has no hotel name — do not invent one from room type labels
    // (e.g. "Single room, Double room, Suite"), which overwrote CRM property titles.
    displayName = null;
  }

  const fallbackTitle = `Listing ${ext}`;
  const title = displayName?.trim() || fallbackTitle;

  if (rooms.length === 0) {
    throw new BadRequestException(
      'Zodomus returned no rooms for this property id — check channel, id, and that the listing is linked in Zodomus.',
    );
  }

  return {
    externalPropertyId: ext,
    displayName: title,
    address,
    city,
    country,
    rooms,
  };
}

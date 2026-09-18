/**
 * Live probe: Standard vs NR vs cheapest open rates from Zodomus ARI.
 * Compare rack to Booking strikethrough (pre-Genius); Genius B2C will still differ.
 *
 * Usage (from repo root):
 *   node doc/zodomus/_tmp-price-compare-probe.mjs [propertyId] [dateFrom] [dateTo]
 * Defaults: 10322630, 2026-09-17, 2026-09-24
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const auth = Buffer.from(`${env.ZODOMUS_API_USER}:${env.ZODOMUS_API_PASSWORD}`, 'utf8').toString(
  'base64',
);
const base = (env.ZODOMUS_BASE_URL || 'https://api.zodomus.com').replace(/\/$/, '');

async function req(method, path, { query, body } = {}) {
  const url = new URL(base + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { http: res.status, body: parsed };
}

function isLongStay(name) {
  const n = String(name || '').toLowerCase();
  return /\bweekly\b|\bmonthly\b|\bmonth\b|length of stay|\blos\b|per day length/.test(n);
}

function findRooms(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.rooms)) return body.rooms;
  if (body.data && Array.isArray(body.data.rooms)) return body.data.rooms;
  return [];
}

const propertyId = process.argv[2] || '10322630';
const channelId = 1;
const dateFrom = process.argv[3] || '2026-09-17';
const dateTo = process.argv[4] || '2026-09-24';

const check = await req('POST', '/property-check', { body: { channelId, propertyId } });
const roomRates = await req('GET', '/room-rates', { query: { channelId, propertyId } });
const availability = await req('GET', '/availability', {
  query: { channelId, propertyId, dateFrom, dateTo },
});

const rooms = findRooms(roomRates.body);
const rateMap = {};
for (const room of rooms) {
  for (const r of room.rates || []) {
    rateMap[String(r.id)] = {
      name: r.name,
      isChildRate: Boolean(r.isChildRate),
      roomId: room.id,
      roomName: room.name,
    };
  }
}

const standardIds = Object.entries(rateMap)
  .filter(([, v]) => !v.isChildRate && String(v.name).toLowerCase().includes('standard'))
  .map(([id]) => id);
const nrIds = Object.entries(rateMap)
  .filter(([, v]) => !v.isChildRate && /non-?refund/i.test(String(v.name)))
  .map(([id]) => id);

const byDate = {};
function walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, depth + 1);
    return;
  }
  const date = typeof node.date === 'string' ? node.date.slice(0, 10) : null;
  if (date && Array.isArray(node.rates)) {
    if (!byDate[date]) byDate[date] = [];
    for (const rate of node.rates) {
      const rateId = String(rate.rateId ?? rate.id ?? '');
      const price = Number(rate.price);
      const meta = rateMap[rateId] || {};
      byDate[date].push({
        rateId,
        name: meta.name || null,
        price: Number.isFinite(price) ? price : null,
        closed: String(rate.closed) === '1' || rate.closed === true,
        isChildRate: Boolean(meta.isChildRate),
        longStay: isLongStay(meta.name),
      });
    }
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walk(v, depth + 1);
  }
}
walk(availability.body);

const nights = Object.keys(byDate)
  .sort()
  .map((date) => {
    const rates = byDate[date].filter((r) => r.price != null && r.price > 0 && !r.closed);
    const std = rates.find((r) => standardIds.includes(r.rateId));
    const nr = rates.find((r) => nrIds.includes(r.rateId));
    const eligibleFrom = rates.filter((r) => !r.isChildRate && !r.longStay);
    const from = eligibleFrom.reduce(
      (best, r) => (best == null || r.price < best.price ? r : best),
      null,
    );
    const cheapestAny = rates.reduce(
      (best, r) => (best == null || r.price < best.price ? r : best),
      null,
    );
    return {
      date,
      standard: std ? { rateId: std.rateId, name: std.name, price: std.price } : null,
      nonRefundable: nr ? { rateId: nr.rateId, name: nr.name, price: nr.price } : null,
      fromEligible: from ? { rateId: from.rateId, name: from.name, price: from.price } : null,
      cheapestAny: cheapestAny
        ? { rateId: cheapestAny.rateId, name: cheapestAny.name, price: cheapestAny.price }
        : null,
      openRateCount: rates.length,
    };
  });

const out = {
  at: new Date().toISOString(),
  propertyId,
  channelId,
  dateFrom,
  dateTo,
  note:
    'RentAI calendar uses Standard rack (otaNightlyPrices). Booking public Genius/−10% is NOT in Zodomus ARI. Compare Standard/NR to Booking strikethrough (pre-discount), not the Genius final.',
  propertyCheck: check.body?.status ?? check.body,
  roomRatesHttp: roomRates.http,
  roomRatesReturnCode: roomRates.body?.status?.returnCode ?? roomRates.body?.returnCode,
  roomRatesMessage: roomRates.body?.status?.returnMessage ?? null,
  availabilityHttp: availability.http,
  availabilityReturnCode: availability.body?.status?.returnCode ?? availability.body?.returnCode,
  availabilityMessage: availability.body?.status?.returnMessage ?? null,
  availabilityTopKeys:
    availability.body && typeof availability.body === 'object'
      ? Object.keys(availability.body).slice(0, 20)
      : [],
  rooms: rooms.map((r) => ({ id: r.id, name: r.name, rateCount: (r.rates || []).length })),
  rateCatalog: rateMap,
  nights,
  rawRoomRatesSample: JSON.stringify(roomRates.body).slice(0, 1200),
  rawAvailabilitySample: JSON.stringify(availability.body).slice(0, 1200),
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), '_tmp-price-compare-probe.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      wrote: outPath,
      roomRatesReturnCode: out.roomRatesReturnCode,
      availabilityReturnCode: out.availabilityReturnCode,
      roomCount: rooms.length,
      nightCount: nights.length,
      sampleNight: nights[0] ?? null,
    },
    null,
    2,
  ),
);

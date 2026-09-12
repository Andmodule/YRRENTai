/**
 * Path C remapping for 10322630 (owner-approved OTA disconnect):
 * property-cancellation → property-activation → room-rates →
 * rooms-activation → property-check → availability reopen Nov dates.
 *
 * Usage: node doc/zodomus/remap-10322630.mjs [priceModelId]
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

function rc(body) {
  return body?.status?.returnCode ?? body?.returnCode ?? null;
}
function rm(body) {
  return body?.status?.returnMessage ?? body?.returnMessage ?? null;
}
function isSuccess(body) {
  const n = Number(rc(body));
  return Number.isFinite(n) ? n < 400 : true;
}

function summarize(label, res) {
  return {
    label,
    http: res.http,
    returnCode: rc(res.body),
    returnMessage: rm(res.body),
  };
}

function extractRooms(ratesBody, fallbackRooms) {
  const candidates = [
    ratesBody?.rooms,
    ratesBody?.data?.rooms,
    ratesBody?.roomRates,
    ratesBody?.mappedRooms,
  ];
  for (const roomsRaw of candidates) {
    if (!Array.isArray(roomsRaw) || roomsRaw.length === 0) continue;
    return roomsRaw.map((r) => {
      const rateList = Array.isArray(r.rates)
        ? r.rates
        : Array.isArray(r.rateIds)
          ? r.rateIds
          : [];
      const rates = rateList.map((x) =>
        String(typeof x === 'object' && x != null ? (x.rateId ?? x.id) : x),
      );
      return {
        roomId: String(r.roomId ?? r.id),
        roomName: String(r.roomName ?? r.name ?? 'Room'),
        quantity: Number(r.quantity ?? 1) || 1,
        status: Number(r.status ?? 1) || 1,
        rates,
      };
    });
  }
  return fallbackRooms;
}

function propertyLooksActive(checkBody) {
  const msg = rm(checkBody);
  if (msg && typeof msg === 'object') {
    const ps = String(msg['Property status'] ?? '').toLowerCase();
    const cs = String(msg['Channel status'] ?? '').toLowerCase();
    const product = String(msg['Product status'] ?? '').toLowerCase();
    const room = String(msg['Room status'] ?? '').toLowerCase();
    const propOk = ps === 'active' || ps === 'ok';
    const channelOk = cs === 'ok' || cs === 'active' || (cs && !cs.includes('error') && !cs.includes('waiting'));
    const mapsOk = (product === 'ok' || product === '') && (room === 'ok' || room === '');
    return propOk && channelOk && mapsOk;
  }
  if (typeof msg === 'string') {
    const t = msg.toLowerCase();
    if (t.includes('not active') || t.includes('evaluation') || t.includes('waiting')) return false;
    return isSuccess(checkBody) && (t === 'ok' || t.includes('active'));
  }
  return isSuccess(checkBody);
}

const env = loadEnv();
const auth = Buffer.from(`${env.ZODOMUS_API_USER}:${env.ZODOMUS_API_PASSWORD}`, 'utf8').toString(
  'base64',
);
const base = (env.ZODOMUS_BASE_URL || 'https://api.zodomus.com').replace(/\/$/, '');
const propertyId = '10322630';
const channelId = 1;
const priceModelId = Number(process.argv[2] || process.env.ZODOMUS_PRICE_MODEL_ID || 1);
const segments = [
  { label: '2-3 Nov', dateFrom: '2026-11-02', dateTo: '2026-11-03' },
  { label: '4-5 Nov', dateFrom: '2026-11-04', dateTo: '2026-11-05' },
];

const fallbackRooms = JSON.parse(
  readFileSync(join(root, 'doc/zodomus/rooms-activation.mapped-products.example.json'), 'utf8'),
).rooms;

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
  return { http: res.status, url: url.toString(), body: parsed };
}

const out = {
  at: new Date().toISOString(),
  propertyId,
  channelId,
  priceModelId,
  steps: {},
  summary: [],
};

function pushSummary(label, res) {
  const s = summarize(label, res);
  out.summary.push(s);
  console.log(JSON.stringify(s));
  return s;
}

out.steps.checkBefore = await req('POST', '/property-check', {
  body: { channelId, propertyId },
});
pushSummary('checkBefore', out.steps.checkBefore);

out.steps.priceModel = await req('GET', '/price-model');
pushSummary('priceModel', out.steps.priceModel);

out.steps.cancellation = await req('POST', '/property-cancellation', {
  body: { channelId, propertyId },
});
pushSummary('property-cancellation', out.steps.cancellation);

// Brief pause so upstream can drop mapping
await new Promise((r) => setTimeout(r, 2000));

out.steps.activation = await req('POST', '/property-activation', {
  body: { channelId, propertyId, priceModelId },
});
pushSummary('property-activation', out.steps.activation);

await new Promise((r) => setTimeout(r, 2000));

out.steps.roomRates = await req('GET', '/room-rates', {
  query: { channelId, propertyId },
});
pushSummary('room-rates', out.steps.roomRates);

const rooms = extractRooms(out.steps.roomRates.body, fallbackRooms);
out.roomsUsed = rooms;
out.roomsSource = isSuccess(out.steps.roomRates.body) ? 'room-rates' : 'fallback-example';

out.steps.roomsActivation = await req('POST', '/rooms-activation', {
  body: { channelId, propertyId, rooms },
});
pushSummary('rooms-activation', out.steps.roomsActivation);

out.steps.checkAfter = await req('POST', '/property-check', {
  body: { channelId, propertyId },
});
pushSummary('checkAfter', out.steps.checkAfter);

out.propertyActive = propertyLooksActive(out.steps.checkAfter.body);

const roomId = rooms[0]?.roomId || '1032263001';
out.roomIdForReopen = roomId;

if (out.propertyActive || isSuccess(out.steps.checkAfter.body)) {
  out.steps.availabilityMultiple = await req('POST', '/availability-multiple', {
    body: {
      channelId,
      propertyId,
      roomIds: segments.map((s) => ({
        roomId,
        dateFrom: s.dateFrom,
        dateTo: s.dateTo,
        availability: 1,
      })),
    },
  });
  pushSummary('availability-multiple', out.steps.availabilityMultiple);
  out.reopenOk = isSuccess(out.steps.availabilityMultiple.body);
} else {
  // Still try reopen — sometimes check returns structured Evaluation but UI says Active
  out.steps.availabilityMultiple = await req('POST', '/availability-multiple', {
    body: {
      channelId,
      propertyId,
      roomIds: segments.map((s) => ({
        roomId,
        dateFrom: s.dateFrom,
        dateTo: s.dateTo,
        availability: 1,
      })),
    },
  });
  pushSummary('availability-multiple-forced', out.steps.availabilityMultiple);
  out.reopenOk = isSuccess(out.steps.availabilityMultiple.body);
}

out.steps.checkFinal = await req('POST', '/property-check', {
  body: { channelId, propertyId },
});
pushSummary('checkFinal', out.steps.checkFinal);

writeFileSync(join(root, 'doc/zodomus/_tmp-remap-10322630.json'), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      propertyActive: out.propertyActive,
      roomsSource: out.roomsSource,
      reopenOk: out.reopenOk,
      roomIdForReopen: out.roomIdForReopen,
      summary: out.summary,
    },
    null,
    2,
  ),
);

process.exit(out.reopenOk ? 0 : 1);

/**
 * Zodomus API samples: account → channels → [optional activation] → [optional createtest] → reservations-queue.
 * Run from repo root: node doc/zodomus/fetch-samples.mjs
 * Requires ZODOMUS_API_USER and ZODOMUS_API_PASSWORD in .env (root).
 *
 * Optional (see RUNBOOK.md — Mapping API):
 *   ZODOMUS_RUN_ACTIVATION=true     — property-check → property-activation → optional rooms-activation
 *   ZODOMUS_SAMPLE_CHANNEL_ID=1     — override channel (default: first from /channels)
 *   ZODOMUS_PRICE_MODEL_ID=...      — optional; если не задан, берётся первый id из GET /price-model
 *   ZODOMUS_ROOMS_ACTIVATION_JSON — опционально; иначе rooms для POST строятся из GET /room-rates
 *   ZODOMUS_CREATE_TEST_RESERVATION=true — POST /reservations-createtest before queue
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = __dirname;

function loadEnv(envPath) {
  const env = {};
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function writeJson(name, data) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

/** Align with backend zodomus-status.util.ts — status.returnCode или top-level returnCode */
function zodomusReturnOk(body) {
  if (!body || typeof body !== 'object') return true;
  const st = body.status;
  if (st && typeof st === 'object') {
    const rc = st.returnCode;
    if (rc !== undefined && rc !== null) {
      const n = Number(rc);
      if (Number.isFinite(n)) return n < 400;
    }
  }
  if (body.returnCode !== undefined && body.returnCode !== null) {
    const n = Number(body.returnCode);
    if (Number.isFinite(n)) return n < 400;
  }
  return true;
}

async function fetchGet(url, authHeader) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text, _parseError: true };
  }
  return { ok: res.ok, status: res.status, body };
}

async function fetchPost(baseUrl, pathname, authHeader, jsonBody) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const res = await fetch(`${baseUrl}${p}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(jsonBody ?? {}),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text, _parseError: true };
  }
  return { ok: res.ok, status: res.status, body };
}

function truthy(v) {
  return v === 'true' || v === '1' || v === 'yes';
}

/** Первый priceModelId из тела GET /price-model (полный JSON до unwrap в клиенте) */
function pickFirstPriceModelId(body) {
  if (!body || typeof body !== 'object') return undefined;
  const d = body.data;
  if (Array.isArray(d) && d[0] != null && typeof d[0] === 'object' && d[0].id != null) {
    return d[0].id;
  }
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const arr = d.priceModels ?? d.models ?? d.items;
    if (Array.isArray(arr) && arr[0]?.id != null) return arr[0].id;
  }
  if (Array.isArray(body.priceModels) && body.priceModels[0]?.id != null) {
    return body.priceModels[0].id;
  }
  if (Array.isArray(body.models) && body.models[0]?.id != null) {
    return body.models[0].id;
  }
  return undefined;
}

/**
 * Полный body POST /rooms-activation: из файла, или JSON-строки, или массива комнат (добавятся channelId/propertyId).
 */
function loadRoomsActivationPayload(raw, channelId, propertyId) {
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return { channelId, propertyId, rooms: parsed };
    }
    return parsed;
  }
  const abs = path.isAbsolute(t) ? t : path.join(ROOT, t);
  const fileContent = fs.readFileSync(abs, 'utf8');
  return JSON.parse(fileContent);
}

/** Сырой JSON GET /room-rates — плоские пары { roomId, rateId } для /rooms-activation */
function pickRoomRatesRows(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.roomRates)) return body.roomRates;
  if (Array.isArray(body.data)) return body.data;
  const d = body.data;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.roomRates)) return d.roomRates;
    if (Array.isArray(d)) return d;
  }
  const rooms = body.rooms;
  if (Array.isArray(rooms)) {
    const flat = [];
    for (const room of rooms) {
      if (!room || typeof room !== 'object') continue;
      const roomId = room.id ?? room.roomId;
      const rates = room.rates;
      if (!roomId || !Array.isArray(rates)) continue;
      for (const rate of rates) {
        if (!rate || typeof rate !== 'object') continue;
        const rateId = rate.id ?? rate.rateId;
        if (rateId == null) continue;
        flat.push({ roomId, rateId });
      }
    }
    return flat;
  }
  return [];
}

function buildRoomsFromRoomRatesRows(rows, priceModelId) {
  const pm = normalizePriceModelId(priceModelId) ?? 1;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const roomId = r.roomId ?? r.room_id;
    const rateId = r.rateId ?? r.rate_id;
    if (roomId == null || rateId == null) continue;
    out.push({
      roomId: String(roomId),
      rateId: String(rateId),
      priceModelId: pm,
    });
  }
  return out;
}

function normalizePriceModelId(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function extractQueueParams(channelsBody, envPropertyId) {
  let channelId = null;
  const list = channelsBody?.channels;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0];
    if (first?.id != null) channelId = Number(first.id);
  }

  const propertyId = envPropertyId?.trim() || null;

  return { channelId, propertyId };
}

const env = loadEnv(path.join(ROOT, '.env'));
const user = env.ZODOMUS_API_USER;
const pass = env.ZODOMUS_API_PASSWORD;
if (!user || !pass) {
  console.error('Set ZODOMUS_API_USER and ZODOMUS_API_PASSWORD in .env');
  process.exit(1);
}

const base = (env.ZODOMUS_BASE_URL || 'https://api.zodomus.com').replace(/\/$/, '');
const authHeader = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

// 1. Account
const acc = await fetchGet(`${base}/account`, authHeader);
writeJson('response-account.json', {
  _meta: {
    step: 1,
    url: `${base}/account`,
    httpStatus: acc.status,
    ok: acc.ok,
    zodomusApiOk: zodomusReturnOk(acc.body),
  },
  body: acc.body,
});

if (!acc.ok) {
  console.error('Step 1 failed; fix credentials or URL before continuing.');
  process.exit(1);
}

// 2. Channels
const ch = await fetchGet(`${base}/channels`, authHeader);
writeJson('response-channels.json', {
  _meta: {
    step: 2,
    url: `${base}/channels`,
    httpStatus: ch.status,
    ok: ch.ok,
    zodomusApiOk: zodomusReturnOk(ch.body),
  },
  body: ch.body,
});

if (!ch.ok) {
  console.error('Step 2 failed; skipping rest.');
  writeJson('response-queue.json', {
    _meta: {
      step: 'queue',
      skipped: true,
      reason: 'channels request failed',
    },
    body: null,
  });
  process.exit(0);
}

let { channelId, propertyId } = extractQueueParams(ch.body, env.ZODOMUS_SAMPLE_PROPERTY_ID);
if (env.ZODOMUS_SAMPLE_CHANNEL_ID != null && env.ZODOMUS_SAMPLE_CHANNEL_ID !== '') {
  const c = Number(env.ZODOMUS_SAMPLE_CHANNEL_ID);
  if (Number.isFinite(c)) channelId = c;
}

if (channelId == null) {
  writeJson('response-queue.json', {
    _meta: { skipped: true, reason: 'No channels[].id in /channels' },
    body: null,
  });
  console.warn('Stopped: no channel id.');
  process.exit(0);
}

if (propertyId == null) {
  writeJson('response-queue.json', {
    _meta: {
      skipped: true,
      reason: 'Set ZODOMUS_SAMPLE_PROPERTY_ID (Zodomus backoffice / sandbox test property)',
      exampleQueueUrl: `${base}/reservations-queue?channelId=${channelId}&propertyId=YOUR_PROPERTY_ID`,
    },
    body: null,
  });
  console.warn('Stopped: ZODOMUS_SAMPLE_PROPERTY_ID missing.');
  process.exit(0);
}

const activationChannelId = channelId;

// Optional: Mapping API — property-check → property-activation → rooms-activation
if (truthy(env.ZODOMUS_RUN_ACTIVATION)) {
  const pc = await fetchPost(base, '/property-check', authHeader, {
    channelId: activationChannelId,
    propertyId,
  });
  writeJson('response-property-check.json', {
    _meta: {
      step: 'property-check',
      httpStatus: pc.status,
      ok: pc.ok,
      zodomusApiOk: zodomusReturnOk(pc.body),
    },
    body: pc.body,
  });

  if (!zodomusReturnOk(pc.body)) {
    const pmUrl = new URL(`${base}/price-model`);
    pmUrl.searchParams.set('channelId', String(activationChannelId));
    const pm = await fetchGet(pmUrl.toString(), authHeader);
    writeJson('response-price-model.json', {
      _meta: {
        step: 'price-model',
        url: pmUrl.toString(),
        httpStatus: pm.status,
        ok: pm.ok,
        zodomusApiOk: zodomusReturnOk(pm.body),
      },
      body: pm.body,
    });

    const fromEnv = normalizePriceModelId(env.ZODOMUS_PRICE_MODEL_ID?.trim());
    let priceModelId = fromEnv ?? normalizePriceModelId(pickFirstPriceModelId(pm.body));
    if (priceModelId == null && zodomusReturnOk(pm.body)) {
      console.warn('GET /price-model: could not infer priceModelId from body shape; set ZODOMUS_PRICE_MODEL_ID');
    }
    if (priceModelId == null) {
      console.error(
        'ZODOMUS_PRICE_MODEL_ID not set and could not infer priceModelId from GET /price-model — see doc/zodomus/response-price-model.json',
      );
      process.exit(1);
    }

    const activationBody = {
      channelId: activationChannelId,
      propertyId,
      priceModelId,
    };
    const pa = await fetchPost(base, '/property-activation', authHeader, activationBody);
    writeJson('response-property-activation.json', {
      _meta: {
        step: 'property-activation',
        httpStatus: pa.status,
        ok: pa.ok,
        zodomusApiOk: zodomusReturnOk(pa.body),
      },
      body: pa.body,
    });

    const rrUrl = new URL(`${base}/room-rates`);
    rrUrl.searchParams.set('channelId', String(activationChannelId));
    rrUrl.searchParams.set('propertyId', String(propertyId));
    const rr = await fetchGet(rrUrl.toString(), authHeader);
    writeJson('response-room-rates.json', {
      _meta: {
        step: 'room-rates',
        url: rrUrl.toString(),
        httpStatus: rr.status,
        ok: rr.ok,
        zodomusApiOk: zodomusReturnOk(rr.body),
      },
      body: rr.body,
    });

    const roomsPath = env.ZODOMUS_ROOMS_ACTIVATION_JSON?.trim();
    let roomsPayload;
    if (roomsPath) {
      roomsPayload = loadRoomsActivationPayload(roomsPath, activationChannelId, propertyId);
      const n = Array.isArray(roomsPayload.rooms) ? roomsPayload.rooms.length : 0;
      console.log(`POST /rooms-activation: using ZODOMUS_ROOMS_ACTIVATION_JSON (${n} room/rate pair(s))`);
    } else {
      const rows = pickRoomRatesRows(rr.body);
      const rooms = buildRoomsFromRoomRatesRows(rows, priceModelId);
      if (rooms.length === 0) {
        console.warn(
          'GET /room-rates: no room/rate rows — POST /rooms-activation may activate 0 rooms (use sandbox test property from Zodomus backoffice; set ZODOMUS_ROOMS_ACTIVATION_JSON to override)',
        );
      } else {
        console.log(`POST /rooms-activation: built ${rooms.length} room/rate pair(s) from GET /room-rates`);
      }
      roomsPayload = { channelId: activationChannelId, propertyId, rooms };
    }

    const ra = await fetchPost(base, '/rooms-activation', authHeader, roomsPayload);
    writeJson('response-rooms-activation.json', {
      _meta: {
        step: 'rooms-activation',
        httpStatus: ra.status,
        ok: ra.ok,
        zodomusApiOk: zodomusReturnOk(ra.body),
      },
      body: ra.body,
    });

    const pc2 = await fetchPost(base, '/property-check', authHeader, {
      channelId: activationChannelId,
      propertyId,
    });
    writeJson('response-property-check-after.json', {
      _meta: {
        step: 'property-check-after',
        httpStatus: pc2.status,
        ok: pc2.ok,
        zodomusApiOk: zodomusReturnOk(pc2.body),
      },
      body: pc2.body,
    });
  }
}

if (truthy(env.ZODOMUS_CREATE_TEST_RESERVATION)) {
  const cr = await fetchPost(base, '/reservations-createtest', authHeader, {
    channelId: activationChannelId,
    propertyId,
  });
  writeJson('response-createtest.json', {
    _meta: {
      step: 'reservations-createtest',
      httpStatus: cr.status,
      ok: cr.ok,
      zodomusApiOk: zodomusReturnOk(cr.body),
    },
    body: cr.body,
  });
}

// Queue
const qUrl = new URL(`${base}/reservations-queue`);
qUrl.searchParams.set('channelId', String(channelId));
qUrl.searchParams.set('propertyId', String(propertyId));

const q = await fetchGet(qUrl.toString(), authHeader);
const queueApiOk = zodomusReturnOk(q.body);
writeJson('response-queue.json', {
  _meta: {
    step: 'reservations-queue',
    url: qUrl.toString(),
    httpStatus: q.status,
    ok: q.ok,
    zodomusApiOk: queueApiOk,
    channelId,
    propertyId,
  },
  body: q.body,
});
if (!queueApiOk) {
  console.warn(
    'Queue: Zodomus body.status indicates error — see response-queue.json. Run with ZODOMUS_RUN_ACTIVATION=true or fix propertyId in backoffice.',
  );
}

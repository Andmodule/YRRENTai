/**
 * Zodomus API samples: account → channels → [optional activation] → [optional createtest] → reservations-queue.
 * Run from RentAI repo root: pnpm zodomus:fetch-samples   OR   node doc/zodomus/fetch-samples.mjs
 * Requires ZODOMUS_API_USER and ZODOMUS_API_PASSWORD in .env (root).
 *
 * Optional (see RUNBOOK.md — Mapping API):
 *   ZODOMUS_RUN_ACTIVATION=true     — property-check → property-activation → optional rooms-activation
 *   ZODOMUS_SAMPLE_CHANNEL_ID=1     — override channel (default: first from /channels)
 *   ZODOMUS_PRICE_MODEL_ID=...      — optional; если не задан, берётся первый id из GET /price-model
 *   ZODOMUS_ROOMS_ACTIVATION_JSON — опционально; иначе POST /rooms-activation собирается из GET /room-rates
 *   (формат Zodomus: roomId, roomName, quantity, status, rates[] — см. rooms-activation.example.json)
 *   ZODOMUS_CREATE_TEST_RESERVATION=true — POST /reservations-createtest before queue
 *   ZODOMUS_CREATE_TEST_STATUS=new      — status для POST /reservations-createtest: new | modified | cancelled | summary
 *   ZODOMUS_CREATE_TEST_RESERVATION_ID=   — optional; если задан — передаётся как reservationId в теле POST /reservations-createtest (Zodomus API)
 *   ZODOMUS_FETCH_RESERVATION_SAMPLE=true (default) — после очереди GET /reservations для первого id (см. response-reservation.json)
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

/** Первый id из тела GET /reservations-queue (body.reservations[].id). */
function firstQueueReservationId(body) {
  if (!body || typeof body !== 'object') return undefined;
  const list = body.reservations;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const first = list[0];
  if (first && typeof first === 'object') {
    const id = first.id ?? first.reservationId;
    if (id != null && id !== '') return String(id);
  }
  return undefined;
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
 * Полный body POST /rooms-activation: файл или JSON; массив только если элементы — комнаты с rates[] (официальный формат).
 */
function loadRoomsActivationPayload(raw, channelId, propertyId) {
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (first && typeof first === 'object' && Array.isArray(first.rates)) {
        return { channelId, propertyId, rooms: parsed };
      }
      throw new Error(
        'ZODOMUS_ROOMS_ACTIVATION_JSON: устаревший формат [ { roomId, rateId, priceModelId } ]. Используйте полный объект с rooms[].{ roomId, roomName, quantity, status, rates } — см. doc/zodomus/rooms-activation.example.json',
      );
    }
    return parsed;
  }
  const abs = path.isAbsolute(t) ? t : path.join(ROOT, t);
  const fileContent = fs.readFileSync(abs, 'utf8');
  return JSON.parse(fileContent);
}

/** Сборка rooms[] для POST /rooms-activation из тела GET /room-rates (Zodomus: roomName, quantity, status, rates[]). */
function inferRoomQuantity(room, roomName) {
  if (room.quantity != null && Number.isFinite(Number(room.quantity))) {
    return Math.max(1, Math.floor(Number(room.quantity)));
  }
  const n = String(roomName).toLowerCase();
  if (n.includes('double') || n.includes('suite') || n.includes('twin')) return 2;
  const mp = room.rates?.[0]?.maxPersons;
  if (mp != null) {
    const m = parseInt(String(mp), 10);
    if (Number.isFinite(m) && m > 0) return Math.min(8, m);
  }
  return 1;
}

function buildRoomsActivationFromRoomRatesBody(body) {
  const rooms = body?.rooms;
  if (!Array.isArray(rooms)) return [];
  const out = [];
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;
    const roomId = room.id ?? room.roomId;
    if (roomId == null) continue;
    const roomName = String(room.name ?? room.roomName ?? 'Room');
    const rates = [];
    if (Array.isArray(room.rates)) {
      for (const rate of room.rates) {
        if (rate && typeof rate === 'object') {
          const id = rate.id ?? rate.rateId;
          if (id != null) rates.push(String(id));
        }
      }
    }
    if (rates.length === 0) continue;
    const quantity = inferRoomQuantity(room, roomName);
    const status = Number(room.status ?? 1) || 1;
    out.push({
      roomId: String(roomId),
      roomName,
      quantity,
      status,
      rates,
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

/** POST /reservations-createtest: status — одно из new | modified | cancelled | summary (ответ API при ошибке). */
function parseCreateTestStatus(raw) {
  const allowed = new Set(['new', 'modified', 'cancelled', 'summary']);
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'new';
  const s = String(raw).trim().toLowerCase();
  if (allowed.has(s)) return s;
  if (s === '1' || s === '0') return 'new';
  return String(raw).trim();
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
      console.log(`POST /rooms-activation: using ZODOMUS_ROOMS_ACTIVATION_JSON (${n} room(s))`);
    } else {
      const rooms = buildRoomsActivationFromRoomRatesBody(rr.body);
      if (rooms.length === 0) {
        console.warn(
          'GET /room-rates: could not build rooms[] — POST /rooms-activation may activate 0 rooms (set ZODOMUS_ROOMS_ACTIVATION_JSON to doc/zodomus/rooms-activation.mapped-products.example.json)',
        );
      } else {
        console.log(`POST /rooms-activation: built ${rooms.length} room(s) from GET /room-rates (roomName, quantity, status, rates[])`);
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
  const createtestBody = {
    channelId: activationChannelId,
    propertyId,
    status: parseCreateTestStatus(env.ZODOMUS_CREATE_TEST_STATUS),
  };
  const testRid = env.ZODOMUS_CREATE_TEST_RESERVATION_ID?.trim();
  if (testRid) {
    createtestBody.reservationId = testRid;
  }
  const cr = await fetchPost(base, '/reservations-createtest', authHeader, createtestBody);
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

const fetchReservationSample =
  env.ZODOMUS_FETCH_RESERVATION_SAMPLE === undefined || env.ZODOMUS_FETCH_RESERVATION_SAMPLE === ''
    ? true
    : truthy(env.ZODOMUS_FETCH_RESERVATION_SAMPLE);
const firstRid = firstQueueReservationId(q.body);
if (fetchReservationSample && firstRid && q.ok && queueApiOk) {
  const resUrl = new URL(`${base}/reservations`);
  resUrl.searchParams.set('channelId', String(channelId));
  resUrl.searchParams.set('propertyId', String(propertyId));
  resUrl.searchParams.set('reservationId', firstRid);
  const res = await fetchGet(resUrl.toString(), authHeader);
  writeJson('response-reservation.json', {
    _meta: {
      step: 'reservations',
      url: resUrl.toString(),
      httpStatus: res.status,
      ok: res.ok,
      zodomusApiOk: zodomusReturnOk(res.body),
      channelId,
      propertyId,
      reservationId: firstRid,
    },
    body: res.body,
  });
  if (!zodomusReturnOk(res.body)) {
    console.warn(
      'GET /reservations: see response-reservation.json — check propertyId/channelId/reservationId or align upsertBooking with live fields.',
    );
  }
} else if (fetchReservationSample && !firstRid) {
  console.log('GET /reservations sample skipped: queue empty or no id in body.reservations');
}

// ─────────────────────────────────────────────────────────────────────────────
// ZODOMUS_TEST_AVAILABILITY_CYCLE=true
//
// Full property lifecycle test — the CORRECT way to test availability:
//   1. GET /room-rates          — get roomId (one GET, not per-night)
//   2. POST /availability       — set available=1 for test window (ONE call, not per-night)
//   3. GET  /availability       — verify (1 GET)
//   4. POST /reservations-createtest (status=new)
//   5. GET  /reservations-queue — verify reservation arrived
//   6. GET  /reservations       — ACK from queue (fetch full details)
//   7. POST /availability       — set occupied=0 for booking dates (ONE call)
//   8. GET  /availability       — verify occupied
//   9. POST /reservations-createtest (status=cancelled)
//  10. POST /availability       — restore available=1 (ONE call)
//  11. GET  /availability       — verify restored
//
// Total POST /availability calls = 3 (one per state change), NOT one per night.
//
// Optional env:
//   ZODOMUS_TEST_DATE_FROM  — start date YYYY-MM-DD (default: today+1)
//   ZODOMUS_TEST_DATE_TO    — end   date YYYY-MM-DD (default: today+8, exclusive)
//   ZODOMUS_TEST_ROOM_ID    — override roomId (default: first room from GET /room-rates)
// ─────────────────────────────────────────────────────────────────────────────
if (truthy(env.ZODOMUS_TEST_AVAILABILITY_CYCLE)) {
  console.log('\n── Availability lifecycle cycle ──────────────────────────────────');

  if (!propertyId || channelId == null) {
    console.warn('Availability cycle skipped: ZODOMUS_SAMPLE_PROPERTY_ID or channelId missing.');
  } else {
    /** ISO date string YYYY-MM-DD offset by N days from today (UTC). */
    function isoDate(offsetDays) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    }

    const testDateFrom = env.ZODOMUS_TEST_DATE_FROM?.trim() || isoDate(1);
    const testDateTo   = env.ZODOMUS_TEST_DATE_TO?.trim()   || isoDate(8); // exclusive

    // Step 1: GET /room-rates — find roomId
    const rrCycleUrl = new URL(`${base}/room-rates`);
    rrCycleUrl.searchParams.set('channelId', String(channelId));
    rrCycleUrl.searchParams.set('propertyId', String(propertyId));
    const rrCycle = await fetchGet(rrCycleUrl.toString(), authHeader);

    let testRoomId = env.ZODOMUS_TEST_ROOM_ID?.trim() || null;
    if (!testRoomId) {
      const rooms = rrCycle.body?.rooms;
      if (Array.isArray(rooms) && rooms[0]?.id) {
        testRoomId = String(rooms[0].id);
      }
    }

    if (!testRoomId) {
      console.warn('Availability cycle: could not determine roomId — set ZODOMUS_TEST_ROOM_ID or run activation first.');
    } else {
      console.log(`  roomId=${testRoomId}  window=${testDateFrom} → ${testDateTo} (exclusive)`);

      // Step 2: POST /availability — set available=1 for the whole test window (ONE call)
      const avSet1 = await fetchPost(base, '/availability', authHeader, {
        channelId,
        propertyId,
        roomId: testRoomId,
        dateFrom: testDateFrom,
        dateTo:   testDateTo,
        availability: 1,
      });
      writeJson('response-avail-set-available.json', {
        _meta: {
          step: 'availability-set-available',
          note: 'ONE call covers full date range — not one call per night',
          channelId, propertyId, roomId: testRoomId,
          dateFrom: testDateFrom, dateTo: testDateTo, availability: 1,
          httpStatus: avSet1.status, ok: avSet1.ok, zodomusApiOk: zodomusReturnOk(avSet1.body),
        },
        body: avSet1.body,
      });
      console.log(`  [2] POST /availability (available=1): ${avSet1.ok && zodomusReturnOk(avSet1.body) ? 'OK' : 'WARN — see response-avail-set-available.json'}`);

      // Step 3: GET /availability — verify available
      const avGet1Url = new URL(`${base}/availability`);
      avGet1Url.searchParams.set('channelId', String(channelId));
      avGet1Url.searchParams.set('propertyId', String(propertyId));
      avGet1Url.searchParams.set('dateFrom', testDateFrom);
      avGet1Url.searchParams.set('dateTo', testDateTo);
      const avGet1 = await fetchGet(avGet1Url.toString(), authHeader);
      writeJson('response-avail-get-1.json', {
        _meta: {
          step: 'availability-get-after-set-available',
          channelId, propertyId, dateFrom: testDateFrom, dateTo: testDateTo,
          httpStatus: avGet1.status, ok: avGet1.ok, zodomusApiOk: zodomusReturnOk(avGet1.body),
        },
        body: avGet1.body,
      });
      console.log(`  [3] GET  /availability (verify available=1): ${avGet1.ok ? 'OK' : 'WARN — see response-avail-get-1.json'}`);

      // Step 4: POST /reservations-createtest (status=new)
      const testResId = env.ZODOMUS_CREATE_TEST_RESERVATION_ID?.trim() || undefined;
      const createBody = { channelId, propertyId, status: 'new', ...(testResId ? { reservationId: testResId } : {}) };
      const ctNew = await fetchPost(base, '/reservations-createtest', authHeader, createBody);
      writeJson('response-avail-createtest-new.json', {
        _meta: {
          step: 'createtest-new',
          httpStatus: ctNew.status, ok: ctNew.ok, zodomusApiOk: zodomusReturnOk(ctNew.body),
        },
        body: ctNew.body,
      });
      console.log(`  [4] POST /reservations-createtest (status=new): ${ctNew.ok && zodomusReturnOk(ctNew.body) ? 'OK' : 'WARN'}`);

      // Brief pause — sandbox may need a moment for reservation to appear in queue
      await new Promise((r) => setTimeout(r, 1500));

      // Step 5: GET /reservations-queue
      const qCycleUrl = new URL(`${base}/reservations-queue`);
      qCycleUrl.searchParams.set('channelId', String(channelId));
      qCycleUrl.searchParams.set('propertyId', String(propertyId));
      const qCycle = await fetchGet(qCycleUrl.toString(), authHeader);
      writeJson('response-avail-queue.json', {
        _meta: {
          step: 'queue-after-createtest',
          httpStatus: qCycle.status, ok: qCycle.ok, zodomusApiOk: zodomusReturnOk(qCycle.body),
        },
        body: qCycle.body,
      });
      const cycleRid = firstQueueReservationId(qCycle.body);
      console.log(`  [5] GET  /reservations-queue: ${cycleRid ? `reservationId=${cycleRid}` : 'empty / no id'}`);

      // Step 6: GET /reservations — ACK from queue, get check-in/check-out
      let bookingCheckIn = testDateFrom;
      let bookingCheckOut = testDateTo;

      if (cycleRid) {
        const resUrl = new URL(`${base}/reservations`);
        resUrl.searchParams.set('channelId', String(channelId));
        resUrl.searchParams.set('propertyId', String(propertyId));
        resUrl.searchParams.set('reservationId', cycleRid);
        const resCycle = await fetchGet(resUrl.toString(), authHeader);
        writeJson('response-avail-reservation.json', {
          _meta: {
            step: 'get-reservation',
            reservationId: cycleRid,
            httpStatus: resCycle.status, ok: resCycle.ok, zodomusApiOk: zodomusReturnOk(resCycle.body),
          },
          body: resCycle.body,
        });

        // Extract actual check-in / check-out from response
        const resBody = resCycle.body;
        const r = resBody?.reservations?.reservation ?? resBody?.reservation ?? resBody ?? {};
        const rooms = resBody?.reservations?.rooms ?? resBody?.rooms ?? [];
        const firstRoom = Array.isArray(rooms) ? rooms[0] : null;
        const ci = firstRoom?.arrivalDate ?? r.checkIn ?? r.check_in;
        const co = firstRoom?.departureDate ?? r.checkOut ?? r.check_out;
        if (ci) bookingCheckIn = String(ci).slice(0, 10);
        if (co) bookingCheckOut = String(co).slice(0, 10);
        console.log(`  [6] GET  /reservations (ACK): checkIn=${bookingCheckIn} checkOut=${bookingCheckOut}`);
      } else {
        console.log('  [6] GET  /reservations: skipped (no reservationId in queue)');
      }

      // Step 7: POST /availability — set occupied=0 for booking dates (ONE call, not per-night!)
      const avSet0 = await fetchPost(base, '/availability', authHeader, {
        channelId,
        propertyId,
        roomId: testRoomId,
        dateFrom: bookingCheckIn,
        dateTo:   bookingCheckOut,
        availability: 0,
      });
      writeJson('response-avail-set-occupied.json', {
        _meta: {
          step: 'availability-set-occupied',
          note: 'ONE call for the booking range — not one call per night',
          channelId, propertyId, roomId: testRoomId,
          dateFrom: bookingCheckIn, dateTo: bookingCheckOut, availability: 0,
          httpStatus: avSet0.status, ok: avSet0.ok, zodomusApiOk: zodomusReturnOk(avSet0.body),
        },
        body: avSet0.body,
      });
      console.log(`  [7] POST /availability (occupied=0, ${bookingCheckIn}→${bookingCheckOut}): ${avSet0.ok && zodomusReturnOk(avSet0.body) ? 'OK' : 'WARN — see response-avail-set-occupied.json'}`);

      // Step 8: GET /availability — verify occupied
      const avGet2Url = new URL(`${base}/availability`);
      avGet2Url.searchParams.set('channelId', String(channelId));
      avGet2Url.searchParams.set('propertyId', String(propertyId));
      avGet2Url.searchParams.set('dateFrom', testDateFrom);
      avGet2Url.searchParams.set('dateTo', testDateTo);
      const avGet2 = await fetchGet(avGet2Url.toString(), authHeader);
      writeJson('response-avail-get-2.json', {
        _meta: {
          step: 'availability-get-after-occupied',
          channelId, propertyId, dateFrom: testDateFrom, dateTo: testDateTo,
          httpStatus: avGet2.status, ok: avGet2.ok, zodomusApiOk: zodomusReturnOk(avGet2.body),
        },
        body: avGet2.body,
      });
      console.log(`  [8] GET  /availability (verify occupied): ${avGet2.ok ? 'OK — see response-avail-get-2.json' : 'WARN'}`);

      // Step 9: POST /reservations-createtest (status=cancelled)
      const ctCancel = await fetchPost(base, '/reservations-createtest', authHeader, {
        channelId, propertyId, status: 'cancelled',
        ...(cycleRid ? { reservationId: cycleRid } : {}),
      });
      writeJson('response-avail-createtest-cancelled.json', {
        _meta: {
          step: 'createtest-cancelled',
          httpStatus: ctCancel.status, ok: ctCancel.ok, zodomusApiOk: zodomusReturnOk(ctCancel.body),
        },
        body: ctCancel.body,
      });
      console.log(`  [9] POST /reservations-createtest (status=cancelled): ${ctCancel.ok && zodomusReturnOk(ctCancel.body) ? 'OK' : 'WARN'}`);

      // Step 10: POST /availability — restore available=1 (ONE call)
      const avSet1b = await fetchPost(base, '/availability', authHeader, {
        channelId,
        propertyId,
        roomId: testRoomId,
        dateFrom: testDateFrom,
        dateTo:   testDateTo,
        availability: 1,
      });
      writeJson('response-avail-set-restored.json', {
        _meta: {
          step: 'availability-restore-available',
          note: 'ONE call to restore full test window — cancellation frees the dates',
          channelId, propertyId, roomId: testRoomId,
          dateFrom: testDateFrom, dateTo: testDateTo, availability: 1,
          httpStatus: avSet1b.status, ok: avSet1b.ok, zodomusApiOk: zodomusReturnOk(avSet1b.body),
        },
        body: avSet1b.body,
      });
      console.log(`  [10] POST /availability (restore available=1): ${avSet1b.ok && zodomusReturnOk(avSet1b.body) ? 'OK' : 'WARN — see response-avail-set-restored.json'}`);

      // Step 11: GET /availability — verify restored
      const avGet3Url = new URL(`${base}/availability`);
      avGet3Url.searchParams.set('channelId', String(channelId));
      avGet3Url.searchParams.set('propertyId', String(propertyId));
      avGet3Url.searchParams.set('dateFrom', testDateFrom);
      avGet3Url.searchParams.set('dateTo', testDateTo);
      const avGet3 = await fetchGet(avGet3Url.toString(), authHeader);
      writeJson('response-avail-get-3.json', {
        _meta: {
          step: 'availability-get-final',
          channelId, propertyId, dateFrom: testDateFrom, dateTo: testDateTo,
          httpStatus: avGet3.status, ok: avGet3.ok, zodomusApiOk: zodomusReturnOk(avGet3.body),
        },
        body: avGet3.body,
      });
      console.log(`  [11] GET  /availability (verify restored): ${avGet3.ok ? 'OK — see response-avail-get-3.json' : 'WARN'}`);

      console.log(`\n  Summary: 3 POST /availability calls total (set-available, set-occupied, restore)`);
      console.log('  Full lifecycle complete.\n');
    }
  }
}

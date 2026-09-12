/**
 * After Zodomus marks property Active: property-check → reopen Nov 2026 dates.
 *
 * Usage (from repo root):
 *   node doc/zodomus/post-active-reopen-10322630.mjs
 *   node doc/zodomus/post-active-reopen-10322630.mjs 10322630 1 1032263001
 *
 * Loads ZODOMUS_* from root .env. Exits 2 if property-check is not Active.
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
function isPropertyActive(checkBody) {
  const msg = rm(checkBody);
  if (msg && typeof msg === 'object') {
    const ps = String(msg['Property status'] ?? '').toLowerCase();
    const cs = String(msg['Channel status'] ?? '').toLowerCase();
    return (ps === 'active' || ps === 'ok') && !cs.includes('error') && !cs.includes('waiting');
  }
  if (typeof msg === 'string') {
    const t = msg.toLowerCase();
    if (t.includes('not active') || t.includes('evaluation')) return false;
    return isSuccess(checkBody) && (t === 'ok' || t.includes('active'));
  }
  return false;
}

const env = loadEnv();
const auth = Buffer.from(`${env.ZODOMUS_API_USER}:${env.ZODOMUS_API_PASSWORD}`, 'utf8').toString(
  'base64',
);
const base = (env.ZODOMUS_BASE_URL || 'https://api.zodomus.com').replace(/\/$/, '');
const propertyId = process.argv[2] || '10322630';
const channelId = Number(process.argv[3] || env.ZODOMUS_DEFAULT_CHANNEL_ID || 1);
const roomId = process.argv[4] || process.env.ZODOMUS_ROOM_ID || '1032263001';
const segments = [
  { label: '2-3 Nov', dateFrom: '2026-11-02', dateTo: '2026-11-03' },
  { label: '4-5 Nov', dateFrom: '2026-11-04', dateTo: '2026-11-05' },
];

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

const check = await req('POST', '/property-check', { body: { channelId, propertyId } });
const active = isPropertyActive(check.body);

const result = {
  at: new Date().toISOString(),
  propertyId,
  channelId,
  roomId,
  segments,
  propertyActive: active,
  check: { returnCode: rc(check.body), returnMessage: rm(check.body) },
};

if (!active) {
  writeFileSync(
    join(root, 'doc/zodomus/_tmp-post-active-reopen-10322630.json'),
    JSON.stringify(result, null, 2),
  );
  console.error(JSON.stringify({ ...result, error: 'Property not Active — abort reopen' }, null, 2));
  process.exit(2);
}

const reopen = await req('POST', '/availability-multiple', {
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
result.reopen = { returnCode: rc(reopen.body), returnMessage: rm(reopen.body) };
result.reopenOk = isSuccess(reopen.body);

const checkAfter = await req('POST', '/property-check', { body: { channelId, propertyId } });
result.checkAfter = { returnCode: rc(checkAfter.body), returnMessage: rm(checkAfter.body) };

writeFileSync(
  join(root, 'doc/zodomus/_tmp-post-active-reopen-10322630.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
process.exit(result.reopenOk ? 0 : 1);

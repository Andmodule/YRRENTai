/**
 * Read-only probe: what Zodomus returns for property info.
 * Usage: node doc/zodomus/probe-property-info-10322630.mjs [propertyId]
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

const env = loadEnv();
const auth = Buffer.from(`${env.ZODOMUS_API_USER}:${env.ZODOMUS_API_PASSWORD}`, 'utf8').toString(
  'base64',
);
const base = (env.ZODOMUS_BASE_URL || 'https://api.zodomus.com').replace(/\/$/, '');
const propertyId = process.argv[2] || '10322630';
const channelId = 1;

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

const calls = [
  ['GET', '/account', {}],
  ['POST', '/property-check', { body: { channelId, propertyId } }],
  ['GET', '/property', { query: { channelId, propertyId } }],
  ['GET', '/room-rates', { query: { channelId, propertyId } }],
  ['GET', '/reservations-summary', { query: { channelId, propertyId } }],
  ['GET', '/reservations-queue', { query: { channelId, propertyId } }],
  [
    'GET',
    '/availability',
    {
      query: {
        channelId,
        propertyId,
        roomId: '1032263001',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-06',
      },
    },
  ],
];

const out = { at: new Date().toISOString(), propertyId, channelId, results: {} };
const summary = {};

for (const [method, path, opts] of calls) {
  const key = `${method} ${path}`;
  const res = await req(method, path, opts);
  out.results[key] = res;
  summary[key] = {
    http: res.http,
    returnCode: rc(res.body),
    returnMessage: rm(res.body),
    bodyPreview: JSON.stringify(res.body).slice(0, 1200),
  };
  console.log('\n=== ' + key + ' ===');
  console.log(JSON.stringify(summary[key], null, 2));
}

writeFileSync(
  join(root, 'doc/zodomus/_tmp-probe-info-10322630.json'),
  JSON.stringify({ summary, out }, null, 2),
);

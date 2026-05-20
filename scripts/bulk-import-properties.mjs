#!/usr/bin/env node
/**
 * Bulk-create properties via POST /api/v1/properties (same as the user app form).
 *
 * Prerequisites: backend running, user logged in as OWNER or MANAGER with a company.
 *
 * Token: copy value of the `access_token` cookie from the browser (DevTools → Application → Cookies),
 * or use a Bearer JWT from login. Do not commit tokens.
 *
 * Usage:
 *   set RENTAI_TOKEN=eyJ...
 *   node scripts/bulk-import-properties.mjs
 *   node scripts/bulk-import-properties.mjs --dry-run
 *   node scripts/bulk-import-properties.mjs path/to/other.tsv
 *
 * Env:
 *   RENTAI_TOKEN or JWT_TOKEN — required unless --dry-run
 *   API_URL — default http://localhost:3010
 *   TIMEZONE — default Europe/Warsaw (API requires timezone; change if needed)
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = (process.env.API_URL || 'http://localhost:3010').replace(/\/$/, '');
const TOKEN = process.env.RENTAI_TOKEN || process.env.JWT_TOKEN || '';
const TIMEZONE = process.env.TIMEZONE || 'Europe/Warsaw';
const COUNTRY = 'Польша';
const CITY = 'Варшава';
const CURRENCY = 'PLN';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find((a) => !a.startsWith('--'));

function parseTsv(content) {
  const rows = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^-+$/.test(trimmed)) continue;
    const tab = trimmed.indexOf('\t');
    if (tab === -1) {
      console.warn('Skip line (no TAB between name and address):', trimmed.slice(0, 80));
      continue;
    }
    const name = trimmed.slice(0, tab).trim();
    const address = trimmed.slice(tab + 1).trim();
    if (!name || !address) continue;
    rows.push({ name, address });
  }
  return rows;
}

async function createProperty(row, index, total) {
  const body = {
    name: row.name,
    country: COUNTRY,
    city: CITY,
    address: row.address,
    timezone: TIMEZONE,
    currency: CURRENCY,
    channelListings: [],
  };

  const url = `${API_URL}/api/v1/properties`;
  if (dryRun) {
    console.log(`[${index + 1}/${total}] ${row.name}`);
    return;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[${index + 1}/${total}] FAIL ${row.name}:`, res.status, text);
    return;
  }
  let id;
  try {
    id = JSON.parse(text)?.data?.id;
  } catch {
    /* ignore */
  }
  console.log(`[${index + 1}/${total}] OK ${row.name}${id ? ` (${id})` : ''}`);
}

const tsvPath = fileArg ? resolve(fileArg) : join(__dirname, 'warsaw-properties.tsv');
const content = readFileSync(tsvPath, 'utf8');
const rows = parseTsv(content);

if (rows.length === 0) {
  console.error('No rows parsed from', tsvPath);
  process.exit(1);
}

if (!dryRun && !TOKEN) {
  console.error('Set RENTAI_TOKEN (or JWT_TOKEN) to your access_token JWT, or use --dry-run');
  process.exit(1);
}

console.log(`Importing ${rows.length} properties → ${API_URL} (timezone=${TIMEZONE}, dryRun=${dryRun})`);

for (let i = 0; i < rows.length; i++) {
  await createProperty(rows[i], i, rows.length);
}

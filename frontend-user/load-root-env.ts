/**
 * Must be imported first from `next.config.ts` so repo root `.env` can merge
 * into `process.env` before Next reads `NEXT_PUBLIC_*` for the client bundle.
 *
 * Intentionally does not depend on `@next/env` (not listed in package.json;
 * production `next build` typecheck would fail). Only merges keys that are
 * still `undefined` so Vercel / CI env vars win over missing file keys.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function mergeEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim().replace(/\r$/, '');
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

mergeEnvFile(path.join(repoRoot, '.env'));

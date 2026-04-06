/**
 * Must be imported first from `next.config.ts` so repo root `.env` is merged
 * before Next reads `NEXT_PUBLIC_*` for the client bundle.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvConfig } from '@next/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const isDev = process.env.NODE_ENV !== 'production';

loadEnvConfig(repoRoot, isDev);

/** If the key is still unset, read it from root `.env` (handles cases where @next/env misses the file). */
function mergeNavLimitedFromRootFile(): void {
  const cur = process.env.NEXT_PUBLIC_NAV_LIMITED_MODE;
  if (cur !== undefined && cur !== '') return;

  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^\s*NEXT_PUBLIC_NAV_LIMITED_MODE\s*=\s*(.+)$/m);
  if (!m) return;

  let v = m[1].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env.NEXT_PUBLIC_NAV_LIMITED_MODE = v.trim();
}

mergeNavLimitedFromRootFile();

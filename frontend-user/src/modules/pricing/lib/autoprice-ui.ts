import type { AutoPriceRow, AutoPriceSettingsInput } from '../api';

// ─── «Автоцены» (same limits and rules as backend autoprice.util.ts) ───

export const AUTO_NEXT_DAYS_MIN = 3;
export const AUTO_NEXT_DAYS_MAX = 30;
export const AUTO_MONTH_END_DAYS_MIN = 3;
export const AUTO_MONTH_END_DAYS_MAX = 14;
export const AUTO_TIER_PCT_MAX = 50;
export const AUTO_TIERS_MAX = 4;

/** The manager's example (2026-10-26): a week before the month ends, 70 % unsold → −10 %, 50 % → −5 %. */
export const AUTO_PRICE_DEFAULTS: Omit<AutoPriceSettingsInput, 'enabled'> = {
  window: { kind: 'month_end', daysBefore: 7 },
  down: [
    { unsoldPct: 70, pct: 10 },
    { unsoldPct: 50, pct: 5 },
  ],
  up: [{ soldPct: 85, pct: 5 }],
};

/** A threshold row while it is being typed: `share` is «не сдано от» for down tiers, «сдано от» for up ones. */
export type AutoTierDraft = { key: string; share: string; pct: string };

export type AutoPriceDraft = {
  enabled: boolean;
  windowKind: 'next' | 'month_end';
  days: string;
  down: AutoTierDraft[];
  up: AutoTierDraft[];
};

export type AutoPriceProblem = 'days' | 'none' | 'count' | 'share' | 'pct' | 'duplicate' | 'order' | 'overlap';

const wholeNumber = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
const within = (n: number, min: number, max: number) => n >= min && n <= max;

/** What is typed → settings ready to save (strongest tier first), or what is wrong. */
export function parseAutoPriceDraft(d: AutoPriceDraft): { value: AutoPriceSettingsInput | null; problem: AutoPriceProblem | null } {
  const fail = (problem: AutoPriceProblem) => ({ value: null, problem });
  const days = wholeNumber(d.days);
  const [min, max] = d.windowKind === 'next' ? [AUTO_NEXT_DAYS_MIN, AUTO_NEXT_DAYS_MAX] : [AUTO_MONTH_END_DAYS_MIN, AUTO_MONTH_END_DAYS_MAX];
  if (!within(days, min, max)) return fail('days');
  if (d.down.length + d.up.length === 0) return fail('none');
  if (d.down.length > AUTO_TIERS_MAX || d.up.length > AUTO_TIERS_MAX) return fail('count');
  const parse = (rows: AutoTierDraft[]) => rows.map((t) => ({ share: wholeNumber(t.share), pct: wholeNumber(t.pct) }));
  const down = parse(d.down);
  const up = parse(d.up);
  const all = [...down, ...up];
  if (all.some((t) => !within(t.share, 1, 100))) return fail('share');
  if (all.some((t) => !within(t.pct, 1, AUTO_TIER_PCT_MAX))) return fail('pct');
  const sorted = (rows: { share: number; pct: number }[]) => [...rows].sort((a, b) => b.share - a.share);
  for (const side of [sorted(down), sorted(up)]) {
    for (let i = 1; i < side.length; i++) {
      if (side[i]!.share === side[i - 1]!.share) return fail('duplicate');
      // more unsold (or more sold) must never move the price less
      if (side[i]!.pct > side[i - 1]!.pct) return fail('order');
    }
  }
  const sd = sorted(down);
  const su = sorted(up);
  // One share must never match both sides: «не сдано от X %» is «сдано до 100 − X %».
  if (sd.length && su.length && su[su.length - 1]!.share <= 100 - sd[sd.length - 1]!.share) return fail('overlap');
  return {
    value: {
      enabled: d.enabled,
      window: d.windowKind === 'next' ? { kind: 'next', days } : { kind: 'month_end', daysBefore: days },
      down: sd.map((t) => ({ unsoldPct: t.share, pct: t.pct })),
      up: su.map((t) => ({ soldPct: t.share, pct: t.pct })),
    },
    problem: null,
  };
}

/** A stable key of saved or parsed settings, to tell whether the editor differs from the server. */
export function autoPriceKey(s: AutoPriceSettingsInput): string {
  const w = s.window.kind === 'next' ? `n${s.window.days}` : `m${s.window.daysBefore}`;
  return [s.enabled ? 1 : 0, w, s.down.map((t) => `${t.unsoldPct}:${t.pct}`).join(','), s.up.map((t) => `${t.soldPct}:${t.pct}`).join(',')].join('|');
}

/** What the row says today. */
export type AutoPriceState =
  | { kind: 'blocked'; reason: NonNullable<AutoPriceRow['block']> }
  | { kind: 'silent' }
  | { kind: 'between' }
  | { kind: 'change'; pct: number; nights: number; minimum: number };

export function autoPriceState(row: AutoPriceRow): AutoPriceState {
  if (row.block) return { kind: 'blocked', reason: row.block };
  if (!row.window) return { kind: 'silent' };
  if (row.pct === 0) return { kind: 'between' };
  const nights = row.nights.filter((n) => n.status === 'adjusted' || n.status === 'minimum');
  return { kind: 'change', pct: row.pct, nights: nights.length, minimum: nights.filter((n) => n.status === 'minimum').length };
}

/** «−5 %» / «+5 %» with a real minus sign. */
export function signedPct(pct: number): string {
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%';
}

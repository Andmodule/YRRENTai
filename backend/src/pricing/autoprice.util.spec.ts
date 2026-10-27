import {
  DEFAULT_AUTO_PRICE_SETTINGS,
  adjustBase,
  autoChannelPrice,
  autoPriceWindow,
  diffAdjustments,
  monthEnd,
  pickAdjustment,
  planAutoNights,
  settingsProblem,
  type AutoPriceSettings,
} from './autoprice.util';

const S = DEFAULT_AUTO_PRICE_SETTINGS;

describe('monthEnd', () => {
  it.each([
    ['2026-10-05', '2026-10-31'],
    ['2026-10-31', '2026-10-31'],
    ['2026-11-01', '2026-11-30'],
    ['2026-02-10', '2026-02-28'],
    ['2028-02-10', '2028-02-29'],
    ['2026-12-31', '2026-12-31'],
  ])('%s → %s', (d, last) => expect(monthEnd(d)).toBe(last));
});

describe('autoPriceWindow', () => {
  it('«ближайшие N дней»: today and N − 1 more, across a month end', () => {
    expect(autoPriceWindow('2026-10-26', { kind: 'next', days: 14 })).toEqual({ from: '2026-10-26', to: '2026-11-08' });
  });

  it('«остаток месяца» is silent while more nights than N are left', () => {
    expect(autoPriceWindow('2026-10-24', { kind: 'month_end', daysBefore: 7 })).toBeNull();
  });

  it('«остаток месяца» starts when exactly N nights are left (today included)', () => {
    expect(autoPriceWindow('2026-10-25', { kind: 'month_end', daysBefore: 7 })).toEqual({ from: '2026-10-25', to: '2026-10-31' });
  });

  it('«остаток месяца» shrinks day by day and ends with the last night', () => {
    expect(autoPriceWindow('2026-10-31', { kind: 'month_end', daysBefore: 7 })).toEqual({ from: '2026-10-31', to: '2026-10-31' });
  });

  it('«остаток месяца» is silent again on the first of the next month', () => {
    expect(autoPriceWindow('2026-11-01', { kind: 'month_end', daysBefore: 7 })).toBeNull();
  });

  it('«остаток месяца» in a short month', () => {
    expect(autoPriceWindow('2026-02-22', { kind: 'month_end', daysBefore: 7 })).toEqual({ from: '2026-02-22', to: '2026-02-28' });
  });
});

describe('pickAdjustment (defaults: unsold ≥70 → −10, ≥50 → −5, sold ≥85 → +5)', () => {
  it.each([
    [0, 7, -10], // nothing sold
    [2, 7, -10], // 5 of 7 unsold = 71 %
    [3, 10, -10], // exactly 70 % unsold
    [4, 10, -5], // 60 % unsold
    [5, 10, -5], // exactly 50 % unsold
    [6, 10, 0], // 40 % unsold, 60 % sold — between the tiers
    [8, 10, 0], // 80 % sold — below the up tier
    [17, 20, 5], // exactly 85 % sold
    [7, 7, 5], // all sold
  ])('%i booked of %i → %i %', (booked, total, pct) => expect(pickAdjustment(booked, total, S)).toBe(pct));

  it('gives 0 for an empty or broken window', () => {
    expect(pickAdjustment(0, 0, S)).toBe(0);
    expect(pickAdjustment(-1, 7, S)).toBe(0);
    expect(pickAdjustment(8, 7, S)).toBe(0);
  });

  it('works with only down or only up tiers', () => {
    expect(pickAdjustment(10, 10, { down: S.down, up: [] })).toBe(0);
    expect(pickAdjustment(0, 10, { down: [], up: S.up })).toBe(0);
    expect(pickAdjustment(10, 10, { down: [], up: S.up })).toBe(5);
  });

  it('does not depend on the order the tiers are listed in', () => {
    expect(pickAdjustment(0, 10, { down: [...S.down].reverse(), up: S.up })).toBe(-10);
  });
});

describe('settingsProblem', () => {
  const ok = (s: Partial<AutoPriceSettings>) => settingsProblem({ ...S, ...s });

  it('accepts the defaults', () => expect(settingsProblem(S)).toBeNull());

  it.each([
    [{ window: { kind: 'next' as const, days: 2 } }],
    [{ window: { kind: 'next' as const, days: 31 } }],
    [{ window: { kind: 'month_end' as const, daysBefore: 2 } }],
    [{ window: { kind: 'month_end' as const, daysBefore: 15 } }],
    [{ window: { kind: 'next' as const, days: 7.5 } }],
  ])('refuses a window out of range %#', (s) => expect(ok(s)).not.toBeNull());

  it('accepts window edges', () => {
    expect(ok({ window: { kind: 'next', days: 3 } })).toBeNull();
    expect(ok({ window: { kind: 'next', days: 30 } })).toBeNull();
    expect(ok({ window: { kind: 'month_end', daysBefore: 14 } })).toBeNull();
  });

  it('needs at least one tier, at most four each way', () => {
    expect(ok({ down: [], up: [] })).not.toBeNull();
    const five = [90, 80, 70, 60, 55].map((u, i) => ({ unsoldPct: u, pct: 10 - i }));
    expect(ok({ down: five })).not.toBeNull();
  });

  it('refuses percents out of range or not whole', () => {
    expect(ok({ down: [{ unsoldPct: 70, pct: 0 }] })).not.toBeNull();
    expect(ok({ down: [{ unsoldPct: 70, pct: 51 }] })).not.toBeNull();
    expect(ok({ down: [{ unsoldPct: 0, pct: 5 }] })).not.toBeNull();
    expect(ok({ up: [{ soldPct: 101, pct: 5 }] })).not.toBeNull();
    expect(ok({ up: [{ soldPct: 90, pct: 2.5 }] })).not.toBeNull();
  });

  it('refuses a repeated threshold', () => {
    expect(ok({ down: [{ unsoldPct: 70, pct: 10 }, { unsoldPct: 70, pct: 5 }] })).not.toBeNull();
    expect(ok({ up: [{ soldPct: 90, pct: 5 }, { soldPct: 90, pct: 3 }] })).not.toBeNull();
  });

  it('refuses a smaller cut for an emptier property, a smaller raise for a fuller one', () => {
    expect(ok({ down: [{ unsoldPct: 70, pct: 5 }, { unsoldPct: 50, pct: 10 }] })).not.toBeNull();
    expect(ok({ up: [{ soldPct: 95, pct: 3 }, { soldPct: 85, pct: 5 }] })).not.toBeNull();
  });

  it('refuses tiers where one share would both lower and raise', () => {
    // unsold ≥ 40 % = sold ≤ 60 %; sold ≥ 60 % overlaps at exactly 60 %
    expect(ok({ down: [{ unsoldPct: 40, pct: 5 }], up: [{ soldPct: 60, pct: 5 }] })).not.toBeNull();
    expect(ok({ down: [{ unsoldPct: 40, pct: 5 }], up: [{ soldPct: 61, pct: 5 }] })).toBeNull();
  });
});

describe('adjustBase / autoChannelPrice', () => {
  it('moves the base by whole units', () => {
    expect(adjustBase(250, -10)).toBe(225);
    expect(adjustBase(245, 5)).toBe(257); // 257.25
    expect(adjustBase(89.9, 0)).toBe(89.9);
  });

  it('adds the channel markup after the adjustment', () => {
    expect(autoChannelPrice(250, -10, 10, null)).toBe(248); // 225 × 1.1 = 247.5 → 248
  });

  it('lifts a price under the minimum to the minimum', () => {
    expect(autoChannelPrice(170, -10, 0, 160)).toBe(160); // 153 → 160
    expect(autoChannelPrice(200, -10, 0, 160)).toBe(180);
  });
});

describe('planAutoNights', () => {
  const night = (date: string, extra: Partial<{ booked: boolean; base: number | null; typed: boolean }> = {}) => ({
    date,
    booked: false,
    base: 250,
    typed: false,
    ...extra,
  });

  it('adjusts a free night with a base price', () => {
    expect(planAutoNights([night('2026-10-27')], -10, 0, null)).toEqual([
      { date: '2026-10-27', status: 'adjusted', pct: -10, before: 250, after: 225 },
    ]);
  });

  it('leaves a booked night, a typed night and a night without a base', () => {
    const out = planAutoNights(
      [night('2026-10-27', { booked: true }), night('2026-10-28', { typed: true }), night('2026-10-29', { base: null })],
      -10,
      0,
      null,
    );
    expect(out.map((n) => [n.status, n.pct, n.after])).toEqual([
      ['booked', 0, 250],
      ['typed', 0, 250],
      ['no_base', 0, null],
    ]);
  });

  it('marks a night lifted to the minimum', () => {
    expect(planAutoNights([night('2026-10-27', { base: 170 })], -10, 0, 160)[0]).toEqual({
      date: '2026-10-27',
      status: 'minimum',
      pct: -10,
      before: 170,
      after: 160,
    });
  });

  it('leaves every night when the share is between the tiers (0 %)', () => {
    expect(planAutoNights([night('2026-10-27')], 0, 0, null)[0]!.status).toBe('none');
  });

  it('raises a free night', () => {
    expect(planAutoNights([night('2026-10-27')], 5, 0, null)[0]!.after).toBe(263); // 262.5 → 263
  });
});

describe('diffAdjustments', () => {
  const TODAY = '2026-10-26';

  it('sets new nights and nights with another percent, keeps equal ones', () => {
    const { set, clear } = diffAdjustments(
      new Map([['2026-10-27', -5], ['2026-10-28', -10]]),
      new Map([['2026-10-27', -10], ['2026-10-28', -10], ['2026-10-29', -10]]),
      TODAY,
    );
    expect([...set]).toEqual([['2026-10-27', -10], ['2026-10-29', -10]]);
    expect(clear).toEqual([]);
  });

  it('clears nights the rule no longer wants (sold, outside the window, switched off)', () => {
    const { set, clear } = diffAdjustments(new Map([['2026-10-27', -10], ['2026-10-30', -10]]), new Map(), TODAY);
    expect(set.size).toBe(0);
    expect(clear).toEqual(['2026-10-27', '2026-10-30']);
  });

  it('never touches past nights', () => {
    const { set, clear } = diffAdjustments(new Map([['2026-10-20', -10]]), new Map([['2026-10-21', -5]]), TODAY);
    expect(set.size).toBe(0);
    expect(clear).toEqual([]);
  });

  it('treats today as present', () => {
    const { set, clear } = diffAdjustments(new Map([[TODAY, -5]]), new Map([[TODAY, -10]]), TODAY);
    expect([...set]).toEqual([[TODAY, -10]]);
    expect(clear).toEqual([]);
  });
});

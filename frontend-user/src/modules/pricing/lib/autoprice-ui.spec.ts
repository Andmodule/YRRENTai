import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autoPriceKey, autoPriceState, parseAutoPriceDraft, signedPct, type AutoPriceDraft } from './autoprice-ui';
import type { AutoPriceRow } from '../api';

const tier = (share: string, pct: string, key = `${share}-${pct}`) => ({ key, share, pct });
const draft = (o: Partial<AutoPriceDraft> = {}): AutoPriceDraft => ({
  enabled: true,
  windowKind: 'month_end',
  days: '7',
  down: [tier('50', '5'), tier('70', '10')],
  up: [tier('85', '5')],
  ...o,
});

describe('parseAutoPriceDraft', () => {
  it('the manager’s example: strongest tier first, window kept', () => {
    assert.deepEqual(parseAutoPriceDraft(draft()), {
      value: {
        enabled: true,
        window: { kind: 'month_end', daysBefore: 7 },
        down: [
          { unsoldPct: 70, pct: 10 },
          { unsoldPct: 50, pct: 5 },
        ],
        up: [{ soldPct: 85, pct: 5 }],
      },
      problem: null,
    });
  });

  it('window bounds: «next» 3–30, «остаток месяца» 3–14', () => {
    assert.equal(parseAutoPriceDraft(draft({ windowKind: 'next', days: '30' })).problem, null);
    assert.equal(parseAutoPriceDraft(draft({ windowKind: 'next', days: '31' })).problem, 'days');
    assert.equal(parseAutoPriceDraft(draft({ windowKind: 'next', days: '2' })).problem, 'days');
    assert.equal(parseAutoPriceDraft(draft({ days: '14' })).problem, null);
    assert.equal(parseAutoPriceDraft(draft({ days: '15' })).problem, 'days');
    assert.equal(parseAutoPriceDraft(draft({ days: '' })).problem, 'days');
    assert.equal(parseAutoPriceDraft(draft({ days: '7.5' })).problem, 'days');
  });

  it('only one side is fine; none at all is not', () => {
    assert.equal(parseAutoPriceDraft(draft({ up: [] })).problem, null);
    assert.equal(parseAutoPriceDraft(draft({ down: [] })).problem, null);
    assert.equal(parseAutoPriceDraft(draft({ down: [], up: [] })).problem, 'none');
  });

  it('no more than four tiers a side', () => {
    const five = ['90', '80', '70', '60', '55'].map((s) => tier(s, '5'));
    assert.equal(parseAutoPriceDraft(draft({ down: five, up: [] })).problem, 'count');
  });

  it('share 1–100, percent 1–50, whole numbers only', () => {
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('0', '5')] })).problem, 'share');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('101', '5')], up: [] })).problem, 'share');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '51')] })).problem, 'pct');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '0')] })).problem, 'pct');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '')] })).problem, 'pct');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '50')], up: [] })).problem, null);
  });

  it('a threshold twice, or an emptier property moved less → refused', () => {
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '10', 'a'), tier('70', '5', 'b')] })).problem, 'duplicate');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('70', '5'), tier('50', '10')] })).problem, 'order');
    assert.equal(parseAutoPriceDraft(draft({ up: [tier('95', '5'), tier('85', '10')] })).problem, 'order');
  });

  it('sides must not meet: 50 % unsold and 50 % sold match the same property', () => {
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('50', '5')], up: [tier('50', '5')] })).problem, 'overlap');
    assert.equal(parseAutoPriceDraft(draft({ down: [tier('50', '5')], up: [tier('51', '5')] })).problem, null);
  });

  it('the switch goes through as typed', () => {
    assert.equal(parseAutoPriceDraft(draft({ enabled: false })).value?.enabled, false);
  });
});

describe('autoPriceKey', () => {
  it('same settings → same key; any change → another', () => {
    const v = parseAutoPriceDraft(draft()).value!;
    assert.equal(autoPriceKey(v), autoPriceKey({ ...v }));
    assert.notEqual(autoPriceKey(v), autoPriceKey({ ...v, enabled: false }));
    assert.notEqual(autoPriceKey(v), autoPriceKey({ ...v, window: { kind: 'next', days: 7 } }));
    assert.notEqual(autoPriceKey(v), autoPriceKey({ ...v, up: [] }));
  });
});

describe('autoPriceState', () => {
  const row = (o: Partial<AutoPriceRow>): AutoPriceRow => ({
    propertyId: 'p',
    name: 'Andersa',
    block: null,
    window: { from: '2026-11-25', to: '2026-11-30' },
    totalNights: 6,
    bookedNights: 2,
    soldPct: 33,
    pct: -5,
    nights: [],
    cleared: [],
    ...o,
  });
  it('blocked, silent, between the tiers, a change with nights lifted to the minimum', () => {
    assert.deepEqual(autoPriceState(row({ block: 'NOT_IN_PILOT' })), { kind: 'blocked', reason: 'NOT_IN_PILOT' });
    assert.deepEqual(autoPriceState(row({ window: null })), { kind: 'silent' });
    assert.deepEqual(autoPriceState(row({ pct: 0 })), { kind: 'between' });
    const nights = [
      { date: '2026-11-25', status: 'adjusted' as const, pct: -5, before: 500, after: 475 },
      { date: '2026-11-26', status: 'minimum' as const, pct: -5, before: 500, after: 490 },
      { date: '2026-11-27', status: 'booked' as const, pct: 0, before: 500, after: 500 },
    ];
    assert.deepEqual(autoPriceState(row({ nights })), { kind: 'change', pct: -5, nights: 2, minimum: 1 });
  });
});

describe('signedPct', () => {
  it('real minus, plus sign, zero', () => {
    assert.equal(signedPct(-5), '−5%');
    assert.equal(signedPct(5), '+5%');
    assert.equal(signedPct(0), '0%');
  });
});

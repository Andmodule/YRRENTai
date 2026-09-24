import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveDisplayTotalMajor,
  sumOtaNightlyPrices,
  formatDisplayTotal,
  resolveDisplayCurrency,
} from './resolve-display-total.js';

describe('resolve-display-total', () => {
  const prices = {
    '2026-09-17': 600,
    '2026-09-18': 700,
  };

  it('sums nightly prices for exclusive checkout', () => {
    assert.equal(sumOtaNightlyPrices(prices, '2026-09-17', '2026-09-19'), 1300);
  });

  it('returns null when any night is missing', () => {
    assert.equal(sumOtaNightlyPrices(prices, '2026-09-17', '2026-09-20'), null);
  });

  it('prefers CRM total when > 0', () => {
    assert.equal(resolveDisplayTotalMajor(520, '2026-09-17', '2026-09-19', prices), 520);
  });

  it('falls back to nightly sum when CRM total is 0', () => {
    assert.equal(resolveDisplayTotalMajor(0, '2026-09-17', '2026-09-19', prices), 1300);
  });

  it('formats unavailable when no total and no rack', () => {
    assert.equal(
      formatDisplayTotal(0, 'EUR', '2026-09-17', '2026-09-19', undefined, 'Price unavailable'),
      'Price unavailable',
    );
  });

  it('resolveDisplayCurrency falls back to property currency', () => {
    assert.equal(resolveDisplayCurrency('', 'PLN'), 'PLN');
    assert.equal(resolveDisplayCurrency('eur', 'PLN'), 'EUR');
  });

  it('resolveDisplayCurrency treats USD as weak when channel fallback is PLN', () => {
    assert.equal(resolveDisplayCurrency('USD', 'PLN'), 'PLN');
    assert.equal(resolveDisplayCurrency('USD', 'USD'), 'USD');
    assert.equal(resolveDisplayCurrency('EUR', 'PLN'), 'EUR');
  });

  it('formats with fallback currency when booking currency empty', () => {
    const out = formatDisplayTotal(
      100,
      '',
      '2026-09-17',
      '2026-09-18',
      undefined,
      'Price unavailable',
      undefined,
      'PLN',
    );
    assert.ok(out.includes('100') || out.includes('zł') || out.includes('PLN'));
  });

  it('formats USD booking with PLN fallback as PLN', () => {
    const out = formatDisplayTotal(
      260,
      'USD',
      '2026-09-17',
      '2026-09-18',
      undefined,
      'Price unavailable',
      undefined,
      'PLN',
    );
    assert.ok(out.includes('260') || out.includes('zł') || out.includes('PLN'));
    assert.equal(out.includes('$') || out.includes('USD'), false);
  });
});

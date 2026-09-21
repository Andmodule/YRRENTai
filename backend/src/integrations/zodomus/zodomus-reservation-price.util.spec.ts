import {
  resolveZodomusReservationTotalMajor,
  resolveZodomusCurrency,
  extractCurrencyFromZodomusPayload,
  normalizeCurrencyCode,
  resolveOtaChannelCurrency,
} from './zodomus-reservation-price.util';

describe('resolveZodomusReservationTotalMajor', () => {
  it('uses reservation total when > 0', () => {
    expect(
      resolveZodomusReservationTotalMajor('520', [{ totalPrice: '260' }, { totalPrice: '260' }]),
    ).toBe(520);
  });

  it('falls back to sum of rooms[].totalPrice when reservation is 0', () => {
    expect(
      resolveZodomusReservationTotalMajor('0', [{ totalPrice: '260' }, { totalPrice: '290' }]),
    ).toBe(550);
  });

  it('falls back to nightly prices when room totals missing', () => {
    expect(
      resolveZodomusReservationTotalMajor(0, [
        {
          prices: [{ price: '120', date: '2026-12-10' }, { price: '140', date: '2026-12-11' }],
        },
      ]),
    ).toBe(260);
  });

  it('returns 0 when everything is zero', () => {
    expect(resolveZodomusReservationTotalMajor('0', [{ totalPrice: '0' }])).toBe(0);
  });

  it('returns undefined when no price fields present', () => {
    expect(resolveZodomusReservationTotalMajor(undefined, [])).toBeUndefined();
  });
});

describe('resolveZodomusCurrency', () => {
  it('prefers currencyCode on reservation', () => {
    expect(resolveZodomusCurrency({ currencyCode: 'pln', currency: 'EUR' }, [], 'USD')).toBe(
      'PLN',
    );
  });

  it('falls back to room currency when top-level missing', () => {
    expect(resolveZodomusCurrency({}, [{ currencyCode: 'EUR' }], 'USD')).toBe('EUR');
  });

  it('falls back to property currency', () => {
    expect(resolveZodomusCurrency({}, [], 'pln')).toBe('PLN');
  });

  it('prefers existing booking when sources empty', () => {
    expect(resolveZodomusCurrency({}, [], null, 'USD')).toBe('USD');
  });

  it('returns null when nothing valid', () => {
    expect(resolveZodomusCurrency({}, [], 'xx', '1')).toBeNull();
  });
});

describe('extractCurrencyFromZodomusPayload', () => {
  it('finds nested rate currency', () => {
    expect(
      extractCurrencyFromZodomusPayload({
        rooms: [{ dates: [{ rates: [{ price: '100', currency: 'pln' }] }] }],
      }),
    ).toBe('PLN');
  });

  it('returns null when currency fields are null', () => {
    expect(
      extractCurrencyFromZodomusPayload({
        rooms: [{ dates: [{ rates: [{ price: '100', currency: null }] }] }],
      }),
    ).toBeNull();
  });
});

describe('resolveOtaChannelCurrency', () => {
  it('prefers ARI currency', () => {
    expect(
      resolveOtaChannelCurrency({
        fromAri: 'eur',
        explicit: 'USD',
        propertyCurrency: 'USD',
        timezone: 'Europe/Warsaw',
      }),
    ).toBe('EUR');
  });

  it('maps Warsaw+USD CRM default to PLN when ARI omits currency', () => {
    expect(
      resolveOtaChannelCurrency({
        fromAri: null,
        explicit: 'USD',
        propertyCurrency: 'USD',
        timezone: 'Europe/Warsaw',
      }),
    ).toBe('PLN');
  });

  it('keeps intentional EUR on Warsaw property', () => {
    expect(
      resolveOtaChannelCurrency({
        fromAri: null,
        explicit: 'USD',
        propertyCurrency: 'EUR',
        timezone: 'Europe/Warsaw',
      }),
    ).toBe('EUR');
  });
});

describe('normalizeCurrencyCode', () => {
  it('accepts ISO codes', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR');
  });

  it('rejects garbage', () => {
    expect(normalizeCurrencyCode('')).toBeNull();
    expect(normalizeCurrencyCode('EU')).toBeNull();
  });
});

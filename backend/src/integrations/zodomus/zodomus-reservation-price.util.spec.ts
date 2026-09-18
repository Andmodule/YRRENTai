import { resolveZodomusReservationTotalMajor } from './zodomus-reservation-price.util';

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

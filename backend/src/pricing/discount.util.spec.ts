import { applyDiscounts, discountedPrice, discountPctByNight } from './discount.util';
import { addDaysYmd } from './pricing-math.util';

describe('discount.util', () => {
  it('discountPctByNight: biggest per night, only the channel asked, clipped to the range', () => {
    const spans = [
      { dateFrom: '2027-01-30', dateTo: '2027-02-02', pct: 10, channels: ['booking', 'airbnb'] },
      { dateFrom: '2027-02-02', dateTo: '2027-02-03', pct: 15, channels: ['booking'] },
      { dateFrom: '2027-02-01', dateTo: '2027-02-05', pct: 30, channels: ['airbnb'] },
      { dateFrom: '2027-02-01', dateTo: '2027-02-05', pct: 0, channels: ['booking'] },
    ];
    expect([...discountPctByNight(spans, 'booking', '2027-02-01', '2027-02-04', addDaysYmd)]).toEqual([
      ['2027-02-01', 10],
      ['2027-02-02', 15],
      ['2027-02-03', 15],
    ]);
    expect(discountPctByNight(spans, 'airbnb', '2027-02-04', '2027-02-04', addDaysYmd).get('2027-02-04')).toBe(30);
    expect(discountPctByNight([], 'booking', '2027-02-01', '2027-02-04', addDaysYmd).size).toBe(0);
  });

  it('discountedPrice: whole units, 0 / missing percent leaves the price', () => {
    expect(discountedPrice(300, 10)).toBe(270);
    expect(discountedPrice(284, 10)).toBe(256); // 255.6
    expect(discountedPrice(89.9, 0)).toBe(89.9);
    expect(discountedPrice(1180, 90)).toBe(118);
  });

  it('applyDiscounts: in place, never below the minimum, a price already under it kept; nights without a target ignored', () => {
    const t = new Map([['a', 300], ['b', 250], ['c', 400]]);
    const atMin = applyDiscounts(t, new Map([['a', 10], ['b', 10], ['c', 10], ['z', 10]]), 280);
    expect([...t]).toEqual([['a', 280], ['b', 250], ['c', 360]]);
    expect(atMin).toEqual(['a', 'b']);
    const u = new Map([['a', 300]]);
    expect(applyDiscounts(u, new Map([['a', 10]]), null)).toEqual([]);
    expect(u.get('a')).toBe(270);
  });
});

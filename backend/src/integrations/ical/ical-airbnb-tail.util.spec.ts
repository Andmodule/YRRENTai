import { isAirbnbNotAvailable, isAirbnbWindowTail, isStoredAirbnbWindowTail } from './ical-airbnb-tail.util';

const NOW = new Date('2026-11-11T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const NA = 'Airbnb (Not available)';

describe('isAirbnbNotAvailable', () => {
  it("only Airbnb's own summary, any case and spacing", () => {
    for (const s of ['Airbnb (Not available)', 'airbnb (not available)', '  Airbnb ( Not available ) ']) {
      expect(isAirbnbNotAvailable(s)).toBe(true);
    }
    for (const s of ['Reserved', 'CLOSED - Not available', 'Not available', 'Airbnb (Not available) extra', '', null, undefined]) {
      expect(isAirbnbNotAvailable(s)).toBe(false);
    }
  });
});

describe('isAirbnbWindowTail (a feed read now)', () => {
  it('the real K22 feed of 2026-11-11 (09.02.2027 – 12.11.2027) is the tail', () => {
    expect(isAirbnbWindowTail(NA, new Date('2027-02-09T00:00:00Z'), new Date('2027-11-12T00:00:00Z'), NOW)).toBe(true);
  });

  it('every booking window: start at today + 90 / 180 / 270 / 365 days, ±2 days', () => {
    for (const w of [90, 180, 270]) {
      for (const d of [w - 2, w, w + 2]) expect(isAirbnbWindowTail(NA, day(d), day(366), NOW)).toBe(true);
      for (const d of [w - 2.1, w + 2.1]) expect(isAirbnbWindowTail(NA, day(d), day(366), NOW)).toBe(false);
    }
    // A 12-month window: the tail is the last day or two of the feed.
    expect(isAirbnbWindowTail(NA, day(365), day(366), NOW)).toBe(true);
  });

  it('the end must be where the feed ends, 362–370 days ahead', () => {
    expect(isAirbnbWindowTail(NA, day(90), day(362), NOW)).toBe(true);
    expect(isAirbnbWindowTail(NA, day(90), day(370), NOW)).toBe(true);
    expect(isAirbnbWindowTail(NA, day(90), day(361.9), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(90), day(370.1), NOW)).toBe(false);
  });

  it('a host closure whose start happens to fall on a window edge but ends elsewhere is a real block', () => {
    // 12-month window: host blocks are separate events; this one starts at today + 180 by chance.
    expect(isAirbnbWindowTail(NA, day(180), day(400), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(180), day(340), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(270), day(300), NOW)).toBe(false);
  });

  it('a host closure that is not at a window edge is a real block: renovation from day 35, block 60 → tail merged', () => {
    expect(isAirbnbWindowTail(NA, day(35), day(366), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(60), day(366), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(120), day(366), NOW)).toBe(false);
  });

  it('closed from today on (listing switched off, window «none») is a real block', () => {
    expect(isAirbnbWindowTail(NA, day(0), day(366), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(-3), day(366), NOW)).toBe(false);
  });

  it('a short night the host closed on Airbnb, even at the window edge, is a real block', () => {
    expect(isAirbnbWindowTail(NA, day(90), day(92), NOW)).toBe(false);
  });

  it('a reservation or another platform’s closure is never a tail', () => {
    expect(isAirbnbWindowTail('Reserved', day(90), day(366), NOW)).toBe(false);
    expect(isAirbnbWindowTail('CLOSED - Not available', day(90), day(366), NOW)).toBe(false);
  });

  it('missing or broken dates are not a tail', () => {
    expect(isAirbnbWindowTail(NA, null, day(366), NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, day(90), undefined, NOW)).toBe(false);
    expect(isAirbnbWindowTail(NA, new Date('x'), day(366), NOW)).toBe(false);
  });
});

describe('isStoredAirbnbWindowTail (a booking imported earlier)', () => {
  it('a tail imported up to 7 days ago (its start is now up to 7 days before today + window) is still a tail', () => {
    for (const d of [83, 86, 90, 92]) expect(isStoredAirbnbWindowTail(NA, day(d), day(360), NOW)).toBe(true);
    expect(isStoredAirbnbWindowTail(NA, day(82.9), day(360), NOW)).toBe(false);
  });

  it('a host closure from day 35 or 60 stays', () => {
    expect(isStoredAirbnbWindowTail(NA, day(35), day(366), NOW)).toBe(false);
    expect(isStoredAirbnbWindowTail(NA, day(60), day(366), NOW)).toBe(false);
  });

  it('only Airbnb «Not available» notes', () => {
    expect(isStoredAirbnbWindowTail('Reserved', day(90), day(366), NOW)).toBe(false);
    expect(isStoredAirbnbWindowTail(undefined, day(90), day(366), NOW)).toBe(false);
  });
});

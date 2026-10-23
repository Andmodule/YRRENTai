import { overlayAvailabilityWindows, overlayReadStart } from './zodomus-overlay-windows.util';

describe('overlayAvailabilityWindows', () => {
  it('keeps the 14-day calendar window as one request', () => {
    expect(overlayAvailabilityWindows('2026-10-13', '2026-10-27')).toEqual([
      { dateFrom: '2026-10-13', dateToExclusive: '2026-10-27' },
    ]);
  });

  it('keeps exactly 28 nights as one request', () => {
    expect(overlayAvailabilityWindows('2026-11-01', '2026-11-29')).toHaveLength(1);
  });

  it('splits a 31-night month into 28 + 3 nights', () => {
    expect(overlayAvailabilityWindows('2026-10-01', '2026-11-01')).toEqual([
      { dateFrom: '2026-10-01', dateToExclusive: '2026-10-29' },
      { dateFrom: '2026-10-29', dateToExclusive: '2026-11-01' },
    ]);
  });

  it('splits a 29-night February of a leap year', () => {
    expect(overlayAvailabilityWindows('2028-02-01', '2028-03-01')).toEqual([
      { dateFrom: '2028-02-01', dateToExclusive: '2028-02-29' },
      { dateFrom: '2028-02-29', dateToExclusive: '2028-03-01' },
    ]);
  });

  it('splits up to three windows (84 nights)', () => {
    expect(overlayAvailabilityWindows('2026-11-01', '2027-01-24')).toHaveLength(3);
  });

  it('does not fan out a longer range — one request as before', () => {
    expect(overlayAvailabilityWindows('2026-11-01', '2027-01-25')).toEqual([
      { dateFrom: '2026-11-01', dateToExclusive: '2027-01-25' },
    ]);
    expect(overlayAvailabilityWindows('2026-01-01', '2027-01-01')).toHaveLength(1);
  });

  it('passes bad or reversed dates through unchanged', () => {
    expect(overlayAvailabilityWindows('2026-02-30', '2026-04-01')).toEqual([
      { dateFrom: '2026-02-30', dateToExclusive: '2026-04-01' },
    ]);
    expect(overlayAvailabilityWindows('', '2026-04-01')).toHaveLength(1);
    expect(overlayAvailabilityWindows('2026-04-01', '2026-03-01')).toEqual([
      { dateFrom: '2026-04-01', dateToExclusive: '2026-03-01' },
    ]);
    expect(overlayAvailabilityWindows('2026-04-01', '2026-04-01')).toHaveLength(1);
  });
});

describe('overlayReadStart', () => {
  it('moves a start in the past to yesterday', () => {
    expect(overlayReadStart('2026-10-01', '2026-10-23')).toBe('2026-10-22');
  });

  it('keeps yesterday, today and later as they are', () => {
    expect(overlayReadStart('2026-10-22', '2026-10-23')).toBe('2026-10-22');
    expect(overlayReadStart('2026-10-23', '2026-10-23')).toBe('2026-10-23');
    expect(overlayReadStart('2026-11-01', '2026-10-23')).toBe('2026-11-01');
  });

  it('crosses month and year ends', () => {
    expect(overlayReadStart('2026-10-01', '2026-11-01')).toBe('2026-10-31');
    expect(overlayReadStart('2026-12-01', '2027-01-01')).toBe('2026-12-31');
  });

  it('a bad date is left alone (the old behaviour)', () => {
    expect(overlayReadStart('bad', '2026-10-23')).toBe('bad');
    expect(overlayReadStart('2026-10-01', 'bad')).toBe('2026-10-01');
  });
});

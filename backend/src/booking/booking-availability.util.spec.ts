import {
  calendarDayToInstantInTimezone,
  formatCalendarDayInTimezone,
  nightsBetweenInPropertyTimezone,
} from './booking-availability.util';

describe('booking-availability.util calendar days', () => {
  it('round-trips 29→30 in Europe/Moscow without shifting a day back', () => {
    const tz = 'Europe/Moscow';
    const checkIn = calendarDayToInstantInTimezone('2026-08-29', tz);
    const checkOut = calendarDayToInstantInTimezone('2026-08-30', tz);

    expect(formatCalendarDayInTimezone(checkIn, tz)).toBe('2026-08-29');
    expect(formatCalendarDayInTimezone(checkOut, tz)).toBe('2026-08-30');
    expect(nightsBetweenInPropertyTimezone(checkIn, checkOut, tz)).toBe(1);
  });

  it('formats UTC-stored evening instant as next calendar day in positive offset TZ', () => {
    // Local midnight Aug 29 in UTC+3 is Aug 28 21:00Z — classic off-by-one source.
    const instant = new Date('2026-08-28T21:00:00.000Z');
    expect(formatCalendarDayInTimezone(instant, 'Europe/Moscow')).toBe('2026-08-29');
    expect(formatCalendarDayInTimezone(instant, 'UTC')).toBe('2026-08-28');
  });

  it('keeps calendar day stable for America/New_York noon storage', () => {
    const tz = 'America/New_York';
    const checkIn = calendarDayToInstantInTimezone('2026-08-29', tz);
    const checkOut = calendarDayToInstantInTimezone('2026-08-30', tz);
    expect(formatCalendarDayInTimezone(checkIn, tz)).toBe('2026-08-29');
    expect(formatCalendarDayInTimezone(checkOut, tz)).toBe('2026-08-30');
  });
});

import { calendarChannelFromBooking } from './calendar.service';

describe('calendarChannelFromBooking', () => {
  it('Zodomus channel: 1 Booking, 3 Airbnb, other ids other', () => {
    expect(calendarChannelFromBooking({ zodomusChannelId: 1, icalUid: null })).toBe('booking');
    expect(calendarChannelFromBooking({ zodomusChannelId: 3, icalUid: null })).toBe('airbnb');
    expect(calendarChannelFromBooking({ zodomusChannelId: 7, icalUid: null })).toBe('other');
  });

  it('iCal import: the event UID names the platform', () => {
    expect(calendarChannelFromBooking({ zodomusChannelId: null, icalUid: '1418fb94e984-0fa0e0b2a8c2@airbnb.com' })).toBe('airbnb');
    expect(calendarChannelFromBooking({ zodomusChannelId: null, icalUid: ' 5926249254@Booking.com ' })).toBe('booking');
  });

  it('own bookings and unknown iCal sources stay direct', () => {
    expect(calendarChannelFromBooking({ zodomusChannelId: null, icalUid: null })).toBe('direct');
    expect(calendarChannelFromBooking({ zodomusChannelId: null, icalUid: 'abc@vrbo.com' })).toBe('direct');
    expect(calendarChannelFromBooking({ zodomusChannelId: null, icalUid: 'airbnb.com@evil.example' })).toBe('direct');
  });

  it('a Zodomus channel wins over an iCal UID', () => {
    expect(calendarChannelFromBooking({ zodomusChannelId: 1, icalUid: 'x@airbnb.com' })).toBe('booking');
  });
});

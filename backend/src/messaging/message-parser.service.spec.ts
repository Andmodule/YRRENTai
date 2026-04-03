import { MessageParserService } from './message-parser.service';

describe('MessageParserService', () => {
  let service: MessageParserService;

  beforeEach(() => {
    service = new MessageParserService();
  });

  it('parseChannel detects booking.com', () => {
    expect(service.parseChannel('no-reply@booking.com')).toBe('booking');
  });

  it('extractReservationId finds numeric id in subject', () => {
    expect(service.extractReservationId('New message - Reservation 4900703')).toBe('4900703');
  });

  it('extractGuestName parses display name before angle address', () => {
    expect(service.extractGuestName('John Doe <john@booking.com>')).toBe('John Doe');
  });

  it('cleanEmailBody strips quotes and signature', () => {
    expect(service.cleanEmailBody('Hi\n> quoted\n-- \nSig')).toBe('Hi');
  });

  it('stripHtmlToText removes tags', () => {
    expect(service.stripHtmlToText('<p>Hello</p>')).toBe('Hello');
  });

  it('extractInboundBody keeps forwarded plain text when every line was quoted', () => {
    const body = '> Please confirm check-in\n> Thanks';
    expect(service.extractInboundBody(body, undefined)).toBe('Please confirm check-in\nThanks');
  });

  it('extractInboundBody uses HTML when plain text is empty', () => {
    const html = '<p>Hello from <b>HTML</b></p>';
    expect(service.extractInboundBody('', html)).toBe('Hello from HTML');
  });

  it('extractInboundBody decodes common entities in HTML', () => {
    expect(service.extractInboundBody('', '<p>Hi&nbsp;there</p>')).toBe('Hi there');
  });

  it('parseBookingStyleInboxHints extracts reservation, property, guest (EN)', () => {
    const body = `Reservation: 4900703
Property: Апартаменты на Ленина 12
Guest: John Doe
Message: "Добрый день!"`;
    const h = service.parseBookingStyleInboxHints(body);
    expect(h.reservationId).toBe('4900703');
    expect(h.propertyName).toContain('Ленина');
    expect(h.guestName).toContain('John');
  });

  it('resolveInboundReservationId prefers body hints over subject', () => {
    const hints = {
      reservationId: '4900703',
      propertyName: null,
      guestName: null,
      zodomusPropertyId: null,
      bookingHotelId: null,
    };
    expect(service.resolveInboundReservationId('Other 9999999', 'x', hints)).toBe('4900703');
  });

  it('parseBookingStyleInboxHints extracts Zodomus property id from guest text', () => {
    const body = 'Zodomus property id 10322630 есть ли подушки';
    const h = service.parseBookingStyleInboxHints(body);
    expect(h.zodomusPropertyId).toBe('10322630');
  });

  it('parseBookingStyleInboxHints extracts hotel_id from Booking admin URL', () => {
    const src =
      'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/home.html?hotel_id=10322630';
    const h = service.parseBookingStyleInboxHints(src);
    expect(h.bookingHotelId).toBe('10322630');
  });

  it('extractGuestNameFromBookingSubject gets name after гостя (RU)', () => {
    expect(
      service.extractGuestNameFromBookingSubject(
        'Мы получили это сообщение от гостя Tsveiuk Ihor',
      ),
    ).toBe('Tsveiuk Ihor');
  });

  it('extractGuestNameFromBookingSubject gets name after from the guest (EN)', () => {
    expect(
      service.extractGuestNameFromBookingSubject(
        'We received a message from the guest Jane Doe - Booking.com',
      ),
    ).toBe('Jane Doe');
  });
});

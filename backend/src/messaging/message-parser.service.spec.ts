import { parseBookingComEmail } from '@rentai/shared';
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

  it('parseBookingStyleInboxHints extracts guest from Booking RU «Имя гостя» block', () => {
    const body = `Данные бронирования
Имя гостя: Mariusz Kamiński
Заезд: пятница, 3 апреля 2026 г.`;
    const h = service.parseBookingStyleInboxHints(body);
    expect(h.guestName).toBe('Mariusz Kamiński');
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

  it('extractBookingHotelIdFromUrls matches URL-encoded hotel_id', () => {
    const u =
      'https://admin.booking.com/...?utm_content=property_name%26hotel_id%3D19191919%26...';
    expect(service.extractBookingHotelIdFromUrls(u)).toBe('19191919');
  });

  it('extractBookingHotelIdFromUrls unwraps double-encoded Gmail-style redirect', () => {
    const wrapped =
      'https://www.google.com/url?q=https%3A%2F%2Fadmin.booking.com%2Fhotel%2Fhoteladmin%2Fextranet_ng%2Fmanage%2Fhome.html%253Fhotel_id%253D19191919';
    expect(service.extractBookingHotelIdFromUrls(wrapped)).toBe('19191919');
  });

  it('extractBookingHotelIdFromHtml reads hotel_id from href only (tags would drop URL)', () => {
    const html = `<table><tr><td><a href="https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/home.html?hotel_id=19191919&amp;lang=ru">Немига</a></td></tr></table>`;
    expect(service.extractBookingHotelIdFromHtml(html)).toBe('19191919');
    expect(service.stripHtmlToText(html)).not.toContain('19191919');
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

  it('stripInboundQuoteNoise cuts On … wrote thread tail', () => {
    const t = 'Thanks!\n\nOn Mon Jan 1, guest@x wrote:\n> old';
    expect(service.stripInboundQuoteNoise(t)).toBe('Thanks!');
  });

  it('stripInboundQuoteNoise removes Booking footer line', () => {
    const t = 'Hello\n\nThis message was sent by Booking.com';
    expect(service.stripInboundQuoteNoise(t)).toBe('Hello');
  });

  it('extractBookingGuestInquiryForAgent keeps only guest question (RU Booking template)', () => {
    const body = `Booking.com
Номер бронирования: 5758080834

У вас новое сообщение от гостя

Tsveiuk Ihor:

Я хочу запросить заезд в 14:00 - 15:00. Это возможно?

Принять (бесплатно)
Принять (за доплату)
При наличии возможности
Не принято

Данные бронирования
Имя гостя: Tsveiuk Ihor
Заезд: пятница, 3 апреля 2026 г.
© Copyright 2026 Booking.com`;
    const out = service.extractBookingGuestInquiryForAgent(body);
    expect(out).toContain('Я хочу запросить заезд в 14:00 - 15:00');
    expect(out).not.toContain('Данные бронирования');
    expect(out).not.toContain('Принять');
    expect(out).not.toContain('5758080834');
  });

  it('extractBookingGuestInquiryForAgent uses Message: block when present', () => {
    const body = `Header noise

Message: Can we check in at 14:00?

Reservation details
Reservation: 12345`;
    const out = service.extractBookingGuestInquiryForAgent(body);
    expect(out).toContain('check in at 14:00');
    expect(out).not.toContain('Reservation details');
  });

  it('extractBookingGuestInquiryForAgent falls back to full text when extraction empty', () => {
    const tiny = 'OK';
    expect(service.extractBookingGuestInquiryForAgent(tiny)).toBe('OK');
  });

  it('extractBookingGuestInquiryForAgent strips Booking guest-message template junk (PL guest)', () => {
    const body = `##- Введите ваш ответ над этой линией -##

Номер бронирования: 5778712803

У вас новое сообщение от гостя

Piotr Bańka:

Zleciłem przelew za miejsce parkingowe 60 zł ale PKO BP wykona go
dopiero 15,06,2026 , i nie mogę wydrukować potwierdzenia , zrobiłem
foto z ekranu i mam to w PDF. Jak to do Was przesłać , bo tu się nie
daje załączyć ?

Ответить

-->
https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/messaging/inbox.html?product_id=5778712803

Данные бронирования

Имя гостя:
Piotr Bańka

© Copyright 2026 Booking.com
[email_opened_tracking_pixel?lang=ru&token=abc]`;
    const out = service.extractBookingGuestInquiryForAgent(body);
    expect(out).toContain('Zleciłem przelew za miejsce parkingowe');
    expect(out).toContain('daje załączyć');
    expect(out).not.toContain('Данные бронирования');
    expect(out).not.toContain('admin.booking.com');
    expect(out).not.toContain('Ответить');
    expect(out).not.toContain('email_opened_tracking');
  });

  it('extractBookingGuestInquiryForAgent strips issue-report template with zero-width chars', () => {
    const zw = '\u200B'.repeat(40);
    const body = `${zw}
Booking.com

Здравствуйте!

Гость Pawel Slodnik сообщил о проблеме во время проживания в K22 Large
Family Apart Komputerowa. Данные бронирования: 5988322688 (воскресенье,
14 июня 2026 — понедельник, 15 июня 2026).

Пожалуйста, рассмотрите обращение гостей и ответьте на него в течение
48 hours (17 Jun 2026 - 11:33 Europe/Warsaw).

Review and respond

[email_icon_alert_info_callout_dark.png] Если кнопка выше не работает,
попробуйте скопировать и вставить эту ссылку в другой браузер:
https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/pega_hotel_response.html

Если у вас есть другие вопросы, мы будем рады на них ответить.

Служба поддержки Booking.com

Правила конфиденциальности
Перейти в Центр помощи`;
    const out = service.extractBookingGuestInquiryForAgent(body);
    expect(out).toContain('Pawel Slodnik сообщил о проблеме');
    expect(out).not.toContain('Review and respond');
    expect(out).not.toContain('admin.booking.com');
    expect(out).not.toContain('Правила конфиденциальности');
    expect(out).not.toMatch(/\u200B/);
  });

  it('extractBookingGuestInquiryForAgent keeps plain guest text unchanged', () => {
    const plain = 'Ми заїдемо близько 18 год, а виселення в 3.30 год ночі';
    expect(service.extractBookingGuestInquiryForAgent(plain)).toBe(plain);
  });

  it('extractBookingGuestInquiryForAgent strips full Booking guest-message template (PL invoice)', () => {
    const body = `##- Введите ваш ответ над этой линией -##

Номер бронирования: 5117654096

У вас новое сообщение от гостя

Krzysztof Sowa:

Proszę jeszcze o fakturę za parking na kwotę 60 zł

Ответить

Данные бронирования

Имя гостя:
Krzysztof Sowa

© Copyright 2026 Booking.com`;
    expect(service.extractBookingGuestInquiryForAgent(body)).toBe(
      'Proszę jeszcze o fakturę za parking na kwotę 60 zł',
    );
  });

  it('parseBookingComEmail does not treat guest check-in question as reservation check-in date', () => {
    const body = `##- Введите ваш ответ над этой линией -##
Номер бронирования: 5516227082
У вас новое сообщение от гостя
Denys Lyshchuk:
Hello!
Could you please send me the exact check-in instructions? Specifically, I need the lockbox code.

Ответить

Данные бронирования

Имя гостя:
Denys Lyshchuk

Заезд:
вт, 16 июня 2026

Отъезд:
ср, 17 июня 2026

© Copyright 2026 Booking.com`;
    const parsed = parseBookingComEmail(body);
    expect(parsed?.guestQuestion).toContain('check-in instructions');
    expect(parsed?.checkIn).toBe('вт, 16 июня 2026');
    expect(parsed?.checkIn).not.toContain('instructions');
  });

  it('extractBookingGuestInquiryForAgent strips full Booking guest-message template (EN check-in)', () => {
    const body = `##- Введите ваш ответ над этой линией -##

                       Номер бронирования: 5516227082

                       У вас новое сообщение от гостя

                               Denys Lyshchuk:

                                   Hello!
   I am arriving today, June 16th, and my flight lands at 19:05.
   Could you please send me the exact check-in instructions?

   Ответить

                                     -->
   https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/messaging/inbox.html

   Данные бронирования

   © Copyright 2026 Booking.com`;
    const out = service.extractBookingGuestInquiryForAgent(body);
    expect(out).toContain('Hello!');
    expect(out).toContain('check-in instructions');
    expect(out).not.toContain('Ответить');
    expect(out).not.toContain('admin.booking.com');
  });
});

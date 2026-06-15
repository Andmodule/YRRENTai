import { z } from 'zod';

/** Persisted on `chat_messages.metadata` when the body looks like a Booking.com notification email. */
export const bookingComMessageMetadataSchema = z.object({
  channel: z.literal('booking_com'),
  variant: z.enum(['full', 'followup']),
  bookingNumber: z.string(),
  guestName: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  propertyName: z.string().optional(),
  guestQuestion: z.string(),
  /** Booking extranet Property ID (`hotel_id` in admin links) — debug / routing checks. */
  hotelId: z.string().optional(),
});

export type BookingComMessageMetadata = z.infer<typeof bookingComMessageMetadataSchema>;

/**
 * Inbox list preview and Telegram escalation: prefer parsed guest question for Booking.com notifications.
 */
export function listPreviewForInbox(
  content: string,
  bookingMeta: BookingComMessageMetadata | null | undefined,
): string {
  const q = bookingMeta?.guestQuestion?.trim();
  if (q) return q;
  return content;
}

export interface BookingComParsed {
  bookingNumber: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  propertyName?: string;
  guestQuestion: string;
  hotelId?: string;
}

/** `hotel_id` in admin.booking.com links — same value as Property ID in OTA listing settings. */
export function extractBookingHotelIdFromText(source: string): string | null {
  let s = source.replace(/&amp;/gi, '&');
  for (let i = 0; i < 8; i++) {
    const plain = s.match(/[?&]hotel_id=(\d{4,12})\b/i);
    if (plain?.[1]) return plain[1];
    const enc = s.match(/hotel_id(?:=|%3[Dd])(\d{4,12})\b/i);
    if (enc?.[1]) return enc[1];
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return null;
}

function matchGroup(re: RegExp, text: string, group = 1): string | undefined {
  const m = text.match(re);
  const g = m?.[group];
  return typeof g === 'string' ? g.trim() : undefined;
}

function extractResIdFromUrls(text: string): string | null {
  const m = text.match(/res_id=(\d+)/i);
  return m?.[1] ?? null;
}

/** Zero-width / soft-hyphen noise common in Booking HTML emails. */
function stripInvisibleChars(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u034F\u180E]/g, '');
}

function isBookingOperationalOrActionLine(s: string): boolean {
  if (/^принять\s*(?:\(|\s|$)/i.test(s)) return true;
  if (/^accept\s*(?:\(|\s|$)/i.test(s)) return true;
  if (/^accept\s+with\s+/i.test(s)) return true;
  if (/^decline\s*$/i.test(s)) return true;
  if (/^отклонить\s*$/i.test(s)) return true;
  if (/^при\s+наличии\s+возможности\s*$/i.test(s)) return true;
  if (/^not\s+accepted\s*$/i.test(s)) return true;
  if (/^не\s+принято\s*$/i.test(s)) return true;
  if (/^reject\s*$/i.test(s)) return true;
  if (/^номер\s+бронирования\s*:/i.test(s)) return true;
  if (/^booking\s+number\s*:/i.test(s)) return true;
  if (/^reservation\s+(?:ID|number)\s*:/i.test(s)) return true;
  if (/^booking\.com\s*$/i.test(s)) return true;
  if (/^www\.booking\.com/i.test(s) && s.length < 80) return true;
  if (/^узнать\s+больше\s+о\s+том,/i.test(s)) return true;
  if (/^find\s+out\s+more\s+about\s+how\s+Booking\.com/i.test(s)) return true;
  if (/^get\s+the\s+Booking\.com\s+app/i.test(s)) return true;
  if (/^скачайте\s+приложение\s+Booking/i.test(s)) return true;
  if (/^ответить\s*$/i.test(s)) return true;
  if (/^reply\s*$/i.test(s)) return true;
  if (/^-->\s*$/i.test(s)) return true;
  if (/^review\s+and\s+respond\s*$/i.test(s)) return true;
  if (/^##-\s*введите\s+ваш\s+ответ/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/admin\.booking\.com/i.test(s)) return true;
  if (/^\[email_opened_tracking/i.test(s)) return true;
  if (/^\[image:/i.test(s)) return true;
  if (/^utm_(source|medium|campaign|term|content)=/i.test(s)) return true;
  if (/[?&](utm_|res_id=|hotel_id=|_e=|_s=)/i.test(s) && s.length > 40) return true;
  if (/^если\s+кнопка\s+выше\s+не\s+работает/i.test(s)) return true;
  if (/^if\s+the\s+button\s+above\s+doesn/i.test(s)) return true;
  if (/^если\s+у\s+вас\s+есть\s+другие\s+вопросы/i.test(s)) return true;
  if (/^служба\s+поддержки\s+booking\.com\s*$/i.test(s)) return true;
  if (/^правила\s+конфиденциальности\s*$/i.test(s)) return true;
  if (/^перейти\s+в\s+центр\s+помощи\s*$/i.test(s)) return true;
  if (/^скачать\s+приложение\s+pulse\s*$/i.test(s)) return true;
  if (/^oosterdokskade\s+\d+/i.test(s)) return true;
  if (/^\d{4}\s+[A-Z]{2}\s+/i.test(s) && s.length < 40) return true;
  return false;
}

function tryExtractBookingMessageBlock(t: string): string | null {
  const re =
    /(?:^|\n)\s*(?:Message|Сообщение|Сообщение\s+гостя|Текст\s+сообщения)\s*:\s*([\s\S]*?)(?=\n\s*(?:Данные бронирования|Reservation details|©\s*Copyright)|$)/i;
  const m = re.exec(t);
  if (!m?.[1]) return null;
  const inner = m[1].replace(/\r\n/g, '\n').trim();
  if (inner.length < 3) return null;
  return inner;
}

function stripLeadingBookingMarketingNoise(t: string): string {
  let s = t.trim();
  const dropLead = [
    /^У вас новое сообщение от гостя\.?\s*\n+/i,
    /^You have a new message from the guest\.?\s*\n+/i,
    /^New message from (?:the )?guest\.?\s*\n+/i,
    /^Booking\.com\s*\n+/i,
    /^Здравствуйте!\s*\n+/i,
    /^Hello!\s*\n+/i,
  ];
  for (const re of dropLead) {
    s = s.replace(re, '');
  }
  s = s.replace(/^[^\n]{1,120}:\s*\n+/m, (match) => {
    const namePart = match.replace(/\s*\n+$/, '');
    if (/^[A-Za-zÀ-ÿ\u0400-\u04FF\s.'-]+:\s*$/.test(namePart.trim())) {
      return '';
    }
    return match;
  });
  return s.trim();
}

/**
 * Booking.com host-notification emails (RU/EN/PL): extract only the guest inquiry for UI, Telegram, and LLM.
 * Falls back to trimmed input when extraction would be empty.
 */
export function extractBookingGuestQuestion(text: string): string {
  const raw = stripInvisibleChars(text.replace(/\r\n/g, '\n')).trim();
  if (!raw) return raw;

  let t = sanitizeBookingEmailPlainText(raw);
  if (!t) t = raw;

  const footerStart =
    /(?:^|\n)\s*(?:Данные бронирования|Детали бронирования|Информация о бронировании|Reservation details|Reservation information|Your reservation details|Booking details|Информация о бронировании в объекте)(?:\s|$)[\s\S]*$/i;
  const footerMatch = footerStart.exec(t);
  if (footerMatch && footerMatch.index > 0) {
    t = t.slice(0, footerMatch.index).trim();
  }

  const actionTail =
    /(?:^|\n)\s*(?:Review and respond|Если кнопка выше не работает|If the button above doesn|Если у вас есть другие вопросы|If you have any other questions|Правила конфиденциальности|Privacy Policy|Get the Booking\.com app|Скачайте приложение Booking)[\s\S]*$/i;
  const actionMatch = actionTail.exec(t);
  if (actionMatch && actionMatch.index > 0) {
    t = t.slice(0, actionMatch.index).trim();
  }

  t = t.split(/\n\s*©\s*Copyright\b/i)[0] ?? t;
  t = t.split(/\n\s*©\s*\d{4}\s+Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*This e-?mail was sent by Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*Это письмо отправлено компанией Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*Данное электронное сообщение было отправлено/i)[0] ?? t;
  t = t.split(/\n\s*Настроить уведомления\s*$/im)[0] ?? t;
  t = t.split(/\n\s*Вы подписаны на уведомления Booking\.com/i)[0] ?? t;

  const lines = t.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) {
      if (kept.length > 0) kept.push('');
      continue;
    }
    if (isBookingOperationalOrActionLine(s)) continue;
    if (isJunkBookingLine(s)) continue;
    kept.push(line);
  }

  let out = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const msgBlock = tryExtractBookingMessageBlock(out);
  if (msgBlock) out = msgBlock;

  out = stripLeadingBookingMarketingNoise(out);

  if (out.length < 3) return raw;
  return out;
}

function firstLineOnly(s: string): string {
  const line = s.split(/\r?\n/)[0]?.trim() ?? s.trim();
  return line.replace(/\s*<https?:\/\/[^>]+>\s*$/i, '').trim();
}

/**
 * Heuristic parse of Booking.com-style guest notification emails (RU/EN).
 * Returns null if the text does not look like a Booking.com reservation message.
 */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    });
}

function stripHtmlToPlain(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<\/(thead|tbody|tfoot)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeBasicEntities(s);
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function isJunkBookingLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return true;
  if (/^[\s\-_=·.]{2,}$/.test(t)) return true;
  if (/^\[image:/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^<https?:\/\//i.test(t)) return true;
  if (/admin\.booking\.com/i.test(t)) return true;
  if (/booking\.com\/hotel\//i.test(t)) return true;
  if (/utm_(source|medium|campaign|term|content)=/i.test(t)) return true;
  if (/[?&](utm_|res_id=|hotel_id=)/i.test(t) && t.length > 40) return true;
  if (/^принять\s*\(/i.test(t)) return true;
  if (/^не принято$/i.test(t)) return true;
  if (/^при наличии возможности$/i.test(t)) return true;
  if (/^другое$/i.test(t)) return true;
  if (/^данные бронирования$/i.test(t)) return true;
  if (/^accept\s*\(/i.test(t)) return true;
  if (/^reject$/i.test(t)) return true;
  if (/^вы подписаны на уведомления/i.test(t)) return true;
  if (/^их можно настроить/i.test(t)) return true;
  if (/^настроить уведомления$/i.test(t)) return true;
  if (/\*booking\.com будет получать/i.test(t)) return true;
  if (/положени[еи] о конфиденциальности/i.test(t)) return true;
  if (/cookie-файлах/i.test(t)) return true;
  if (/^это сообщение было написано не сотрудниками/i.test(t)) return true;
  if (/не несет ответственности за его содержание/i.test(t)) return true;
  if (/вы подписаны на уведомления booking\.com/i.test(t)) return true;
  if (/^you are subscribed to (notifications|emails)/i.test(t)) return true;
  if (/^manage (your )?notification/i.test(t)) return true;
  if (/^\*Имя гостя\*|^\*Guest name\*|^\*Заезд\*|^\*Отъезд\*|^\*Название объекта/i.test(t)) return true;
  if (/^\*Номер бронирования\*|^\*Booking number\*|^\*Confirmation/i.test(t)) return true;
  if (/^©\s*copyright/i.test(t)) return true;
  if (/^данное электронное сообщение/i.test(t)) return true;
  if (/^this (e-)?mail was sent/i.test(t)) return true;
  return false;
}

function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length > 0 && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out;
}

/**
 * Turns forwarded HTML/plain Booking notifications into readable multi-line text
 * (no tags, no tracking URLs, no action-button lines).
 */
export function sanitizeBookingEmailPlainText(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').trim();
  if (s.length === 0) return '';

  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = stripHtmlToPlain(s);
  }

  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !isJunkBookingLine(l));

  return dedupeConsecutive(lines).join('\n').trim();
}

export function parseBookingComEmail(text: string): BookingComParsed | null {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.length < 80) return null;

  const lower = normalized.toLowerCase();
  const hasBookingHost = lower.includes('booking.com');
  const hasResId = /res_id=\d+/i.test(normalized);
  const hasBookingLabels =
    /номер бронирования|booking number|confirmation (?:no|number)|reservation (?:details|number)/i.test(
      normalized,
    );

  if (!hasBookingHost && !hasResId && !hasBookingLabels) return null;

  const fromUrl = extractResIdFromUrls(normalized);
  const fromLabel = matchGroup(
    /(?:Номер бронирования|Booking number|Confirmation no\.?|Reservation number)\s*[:\*]?\s*(\d+)/i,
    normalized,
  );
  const bookingNumber = fromUrl ?? fromLabel;
  if (!bookingNumber) return null;

  const guestName = matchGroup(
    /(?:\*Имя гостя\*|Guest name)\s*[:\*]?\s*(.+)/i,
    normalized,
  );
  const checkInRaw = matchGroup(
    /(?:\*Заезд\*|Check-in(?: date)?)\s*[:\*]?\s*(.+)/i,
    normalized,
  );
  const checkOutRaw = matchGroup(
    /(?:\*Отъезд\*|Check-out(?: date)?)\s*[:\*]?\s*(.+)/i,
    normalized,
  );
  const propertyRaw = matchGroup(
    /(?:\*Название объекта размещения\*|Property name|Accommodation)\s*[:\*]?\s*(.+)/i,
    normalized,
  );

  const guestQuestion = extractBookingGuestQuestion(normalized);

  const hotelId = extractBookingHotelIdFromText(normalized) ?? undefined;

  return {
    bookingNumber,
    guestName: guestName ? firstLineOnly(guestName) : undefined,
    checkIn: checkInRaw ? firstLineOnly(checkInRaw) : undefined,
    checkOut: checkOutRaw ? firstLineOnly(checkOutRaw) : undefined,
    propertyName: propertyRaw ? firstLineOnly(propertyRaw) : undefined,
    guestQuestion,
    hotelId,
  };
}

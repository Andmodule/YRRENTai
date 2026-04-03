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
});

export type BookingComMessageMetadata = z.infer<typeof bookingComMessageMetadataSchema>;

/**
 * Inbox list preview and Telegram escalation: on Booking.com follow-up threads, show only the parsed guest question.
 * Same rule as email bridge and web chat.
 */
export function listPreviewForInbox(
  content: string,
  bookingMeta: BookingComMessageMetadata | null | undefined,
): string {
  if (bookingMeta?.variant === 'followup' && bookingMeta.guestQuestion) {
    return bookingMeta.guestQuestion;
  }
  return content;
}

export interface BookingComParsed {
  bookingNumber: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  propertyName?: string;
  guestQuestion: string;
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

function extractGuestQuestion(text: string): string | undefined {
  const guestBlock = /(?:новое сообщение от гостя|new message from the guest)/i;
  if (guestBlock.test(text)) {
    const fromGuest = text.slice(text.search(guestBlock));
    const m = fromGuest.match(/\n[^\n:]+:\s*\n+\s*([^\n]+)/);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  const m2 = text.match(
    /\n[A-Za-zÀ-ÿ\u0400-\u04FF][^\n:]{0,120}:\s*\n+\s*([^\n]+)/,
  );
  if (m2?.[1]?.trim()) {
    const line = m2[1].trim();
    if (line.length > 3 && !/^https?:\/\//i.test(line)) return line;
  }

  const m3 = text.match(
    /(?:^|\n)\s*(?:Guest|Гость)\s*message\s*[:\-]?\s*\n+\s*([^\n]+)/i,
  );
  if (m3?.[1]?.trim()) return m3[1].trim();

  return undefined;
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

  let guestQuestion = extractGuestQuestion(normalized);
  if (!guestQuestion) {
    guestQuestion = normalized.slice(0, 2000).trim();
  }

  return {
    bookingNumber,
    guestName: guestName ? firstLineOnly(guestName) : undefined,
    checkIn: checkInRaw ? firstLineOnly(checkInRaw) : undefined,
    checkOut: checkOutRaw ? firstLineOnly(checkOutRaw) : undefined,
    propertyName: propertyRaw ? firstLineOnly(propertyRaw) : undefined,
    guestQuestion,
  };
}

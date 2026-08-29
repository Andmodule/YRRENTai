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
  /** Guest contact email (real or @guest.booking.com proxy). */
  guestEmail: z.string().optional(),
  totalGuests: z.string().optional(),
  totalRooms: z.string().optional(),
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
  if (looksLikeBookingGuestNotification(content)) {
    const cleaned = extractBookingGuestQuestion(content);
    if (cleaned.length >= 3) return cleaned;
  }
  return content;
}

/** True when plain/HTML body looks like a Booking.com extranet guest-notification email. */
export function looksLikeBookingGuestNotification(text: string): boolean {
  const t = stripInvisibleChars(text).toLowerCase();
  if (t.length < 40) return false;
  return (
    t.includes('booking.com') ||
    /##-\s*введите\s+ваш\s+ответ/i.test(text) ||
    /данные бронирования/i.test(text) ||
    /новое сообщение от гостя/i.test(text) ||
    /new message from the guest/i.test(text) ||
    /admin\.booking\.com/i.test(text) ||
    /\[email_opened_tracking/i.test(text) ||
    /в целях безопасности убедитесь/i.test(text) ||
    /было отменено/i.test(text) ||
    /вы получили новое бронирование/i.test(text) ||
    /гость получил автоответ/i.test(text) ||
    /booking confirmation/i.test(text) ||
    /cancellation\s*[—-]/i.test(text)
  );
}

/**
 * Last-mile cleanup before persisting/sending Telegram alerts (covers any upstream path).
 */
export function sanitizeGuestQuestionForAlert(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (!looksLikeBookingGuestNotification(trimmed)) return trimmed;
  const cleaned = extractBookingGuestQuestion(trimmed);
  return cleaned.length >= 3 ? cleaned : trimmed.slice(0, 500);
}

/** Guest bubble + inbox: prefer cleaned speech; never show raw Booking template when extractable. */
export function resolveBookingGuestDisplayText(
  rawContent: string,
  metadata?: BookingComMessageMetadata | null,
): string {
  const raw = rawContent.trim();
  if (!raw) return raw;
  const extracted = extractBookingGuestQuestion(raw);
  const metaQ = metadata?.guestQuestion?.trim();
  if (extracted.length >= 3) return extracted;
  if (metaQ && metaQ.length >= 3 && !looksLikeBookingGuestNotification(metaQ)) return metaQ;
  return metaQ || raw;
}

/** Inbox list one-liner — strip Booking boilerplate from stored previews (incl. legacy rows). */
export function formatInboxMessagePreview(content: string | null | undefined): string {
  const c = content?.trim() ?? '';
  if (!c) return '';
  if (looksLikeBookingGuestNotification(c)) {
    const cleaned = extractBookingGuestQuestion(c);
    if (cleaned.length >= 3) {
      return cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned;
    }
  }
  return c.length > 200 ? `${c.slice(0, 197)}…` : c;
}

/** Reject reservation fields misparsed from guest message body (e.g. "check-in instructions?"). */
export function isPlausibleBookingDateLabel(value: string | undefined | null): boolean {
  const v = value?.trim() ?? '';
  if (v.length < 4 || v.length > 80) return false;
  if (/instructions?|specifically|could you|please|lockbox|password|apartment/i.test(v)) return false;
  if (/##-|введите ваш ответ|booking\.com|admin\.booking/i.test(v)) return false;
  return /(\d{1,2}[\s./-]\w+[\s./-]\d{2,4})|\d{4}|(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|понедельник|вторник|сред|четверг|пятниц|суббот|воскресен|poniedziałek|wtorek|środ|czwartek|piątek|sobot|niedziel)/i.test(
    v,
  );
}

export function isPlausibleBookingPropertyName(value: string | undefined | null): boolean {
  const v = value?.trim() ?? '';
  if (v.length < 3 || v.length > 120) return false;
  if (/instructions?|##-|введите ваш ответ|booking\.com/i.test(v)) return false;
  return true;
}

export interface BookingComParsed {
  bookingNumber: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  propertyName?: string;
  guestQuestion: string;
  guestEmail?: string;
  totalGuests?: string;
  totalRooms?: string;
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
  if (/^\/inbox\.html/i.test(s)) return true;
  if (/^\/[a-z_/]+\.(?:html|php)/i.test(s) && /(?:utm_|hotel_id|res_id|message_id)/i.test(s)) return true;
  if (/^(?:utm_|m_campaign|m_term|ee_text\]|type=to_hotel)/i.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s) && s.length >= 16) return true;
  if (/^&[a-z_]+=/i.test(s)) return true;
  if (/^письмо отправлено на:/i.test(s)) return true;
  if (/^сообщение было написано не сотрудниками/i.test(s)) return true;
  if (/^что их можно настроить/i.test(s)) return true;
  if (/^некоторые сообщения гостей\?/i.test(s)) return true;
  if (/^в целях безопасности/i.test(s)) return true;
  if (/booking\.com online hotel/i.test(s)) return true;
  if (/^cancellation\s*[—-]/i.test(s)) return true;
  if (/^booking confirmation\s*[—-]/i.test(s)) return true;
  if (/^iata\/tids:/i.test(s)) return true;
  if (/^гость получил автоответ/i.test(s)) return true;
  if (/^подтверждено\s+(?:бесплатно|за)/i.test(s)) return true;
  if (/^пожалуйста, не отвечайте/i.test(s)) return true;
  if (/^команда booking\.com/i.test(s)) return true;
  if (/^с уважением,?\s*$/i.test(s)) return true;
  if (/^благодарим вас за сотрудничество/i.test(s)) return true;
  if (/^получайте мгновенные push/i.test(s)) return true;
  if (/^узнать подробности/i.test(s)) return true;
  if (/^если ссылка выше не работает/i.test(s)) return true;
  if (/^если гость имеет право на возврат/i.test(s)) return true;
  if (/^мы вернем гостю средства/i.test(s)) return true;
  if (/^мы вычтем эту сумму/i.test(s)) return true;
  if (/^подробности об отмене/i.test(s)) return true;
  if (/^вы получили новое бронирование/i.test(s)) return true;
  if (/^copyright\s*©/i.test(s)) return true;
  if (/^все права защищены/i.test(s)) return true;
  if (/type=confirmation_hotel/i.test(s)) return true;
  return false;
}

function stillContainsBookingJunk(text: string): boolean {
  return /##-\s*введите|admin\.booking\.com|в целях безопасности|email_opened_tracking|письмо отправлено на:|настроить уведомления|booking\.com online hotel|iata\/tids|пожалуйста, не отвечайте|гость получил автоответ|подтверждено бесплатно|вы можете в любое время изменить настройки|copyright\s*©|вы подписаны на уведомления|положени[еи] о конфиденциальности|благодарим вас за сотрудничество|получайте мгновенные push/i.test(
    text,
  );
}

function stripBookingSecurityPreamble(text: string): string {
  if (!/в целях безопасности убедитесь/i.test(text)) return text;
  const m = text.match(
    /(?:^|\n)\s*(?:##-|Номер бронирования:|Booking confirmation|Cancellation|Гость получил автоответ|У вас новое сообщение от гостя|Бронирование\s+\d{6,12}\s+гостя)/im,
  );
  if (m?.index != null && m.index > 0) return text.slice(m.index).trim();
  return text;
}

function cleanupGuestSpeechBlock(speech: string): string {
  const lines = speech.split('\n');
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
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tryExtractBookingSystemSummary(text: string): string | null {
  const cancelRu = text.match(
    /Бронирование\s+(\d{6,12})\s+гостя\s+([^.\n]+?)\s+было\s+отменено[^.\n]*/i,
  );
  if (cancelRu?.[1]) {
    const name = cancelRu[2]?.trim();
    return name
      ? `Отмена бронирования ${cancelRu[1]} (гость ${name}).`
      : `Отмена бронирования ${cancelRu[1]}.`;
  }

  const cancelEn = text.match(
    /(?:reservation|booking)\s+(\d{6,12})\s+(?:for\s+)?(?:guest\s+)?([^.\n]+?)\s+(?:has been |was )?cancelled/i,
  );
  if (cancelEn?.[1]) {
    const name = cancelEn[2]?.trim();
    return name
      ? `Cancellation: booking ${cancelEn[1]} (guest ${name}).`
      : `Cancellation: booking ${cancelEn[1]}.`;
  }

  if (/вы получили новое бронирование/i.test(text)) {
    const num =
      text.match(/Booking confirmation\s*[—-]\s*(\d{6,12})/i)?.[1] ??
      text.match(/res_id=(\d{6,12})/i)?.[1] ??
      text.match(/(?:номер бронирования|booking number)\s*:\s*(\d{6,12})/i)?.[1];
    if (num) return `Новое бронирование ${num}.`;
  }

  if (/you(?:'ve| have) received a new booking/i.test(text)) {
    const num = text.match(/Booking confirmation\s*[—-]\s*(\d{6,12})/i)?.[1];
    if (num) return `New booking ${num}.`;
  }

  return null;
}

/** Cut reservation / legal blocks — run on raw text before sanitize drops anchor lines. */
function cutBookingEmailFooters(t: string): string {
  let s = t;
  const footerPatterns = [
    /(?:^|\n)\s*Данные бронирования[\s\S]*$/i,
    /(?:^|\n)\s*Детали бронирования[\s\S]*$/i,
    /(?:^|\n)\s*Reservation details[\s\S]*$/i,
    /(?:^|\n)\s*Your reservation details[\s\S]*$/i,
    /(?:^|\n)\s*©\s*Copyright\b[\s\S]*$/i,
    /(?:^|\n)\s*Данное электронное сообщение было отправлено[\s\S]*$/i,
    /(?:^|\n)\s*Вы подписаны на уведомления Booking\.com[\s\S]*$/i,
    /(?:^|\n)\s*\*Booking\.com будет получать[\s\S]*$/i,
    /(?:^|\n)\s*\[email_opened_tracking[\s\S]*$/i,
  ];
  for (const re of footerPatterns) {
    const m = re.exec(s);
    if (m && m.index > 0) s = s.slice(0, m.index).trim();
  }
  const actionTail =
    /(?:^|\n)\s*(?:Review and respond|Если кнопка выше не работает|If the button above doesn|Если у вас есть другие вопросы|If you have any other questions|Правила конфиденциальности|Privacy Policy|Get the Booking\.com app|Скачайте приложение Booking)[\s\S]*$/i;
  const actionMatch = actionTail.exec(s);
  if (actionMatch && actionMatch.index > 0) {
    s = s.slice(0, actionMatch.index).trim();
  }
  const replyTail = /(?:^|\n)\s*(?:Ответить|Reply)\s*\n[\s\S]*$/i;
  const replyMatch = replyTail.exec(s);
  if (replyMatch && replyMatch.index > 0) {
    s = s.slice(0, replyMatch.index).trim();
  }
  return s;
}

/**
 * Booking "new message from guest" template: text between guest name line and Reply / reservation block.
 */
function tryExtractGuestSpeechAfterGuestName(text: string): string | null {
  const marker = /(?:новое сообщение от гостя|new message from the guest|you have a new message from the guest)/i;
  if (!marker.test(text)) return null;
  const slice = text.slice(text.search(marker));
  const re =
    /(?:^|\n)\s*([^\n:]{1,120}):\s*\n+([\s\S]*?)(?=\n\s*(?:Ответить|Reply|-->|Принять|Accept\s*\(|Не принято|Not accepted|Decline|Данные бронирования|Reservation details|https?:\/\/|©\s*Copyright|\[email_opened|Review and respond)|$)/i;
  const m = re.exec(slice);
  const speech = m?.[2]?.replace(/\r\n/g, '\n').trim();
  if (speech && speech.length >= 3) return cleanupGuestSpeechBlock(speech);
  return null;
}

function tryExtractGuestSpeechAfterAutoReply(text: string): string | null {
  const marker =
    /(?:гость получил автоответ|guest received an auto[- ]?reply|the guest received an automatic reply)/i;
  if (!marker.test(text)) return null;
  const slice = text.slice(text.search(marker));
  const re =
    /(?:^|\n)\s*([^\n:]{1,120}):\s*\n+([\s\S]*?)(?=\n\s*(?:Подтверждено|Confirmed\s+(?:free|with)|Данные бронирования|Reservation details|©\s*Copyright|\[email_opened)|$)/i;
  const m = re.exec(slice);
  const speech = m?.[2]?.replace(/\r\n/g, '\n').trim();
  if (speech && speech.length >= 3) return cleanupGuestSpeechBlock(speech);
  return null;
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
    /^##-\s*Введите ваш ответ[^\n]*\n+/i,
    /^У вас новое сообщение от гостя\.?\s*\n+/i,
    /^You have a new message from the guest\.?\s*\n+/i,
    /^New message from (?:the )?guest\.?\s*\n+/i,
    /^Booking\.com\s*\n+/i,
    /^Здравствуйте!\s*\n+/i,
  ];
  for (const re of dropLead) {
    s = s.replace(re, '');
  }
  s = s.replace(/^[^\n]{1,120}:\s*\n+/m, (match) => {
    const namePart = match.replace(/\s*\n+$/, '');
    if (/^[A-Za-zÀ-ÿ\u0400-\u04FF\s.'\u2019-]+:\s*$/.test(namePart.trim())) {
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
  const rawInput = stripInvisibleChars(text.replace(/\r\n/g, '\n')).trim();
  if (!rawInput) return rawInput;

  const raw = stripBookingSecurityPreamble(rawInput);

  const systemSummary = tryExtractBookingSystemSummary(raw);
  if (systemSummary) return systemSummary;

  const speech = tryExtractGuestSpeechAfterGuestName(raw);
  if (speech) return speech;

  const autoReplySpeech = tryExtractGuestSpeechAfterAutoReply(raw);
  if (autoReplySpeech) return autoReplySpeech;

  const msgOnRaw = tryExtractBookingMessageBlock(raw);
  if (msgOnRaw) return cleanupGuestSpeechBlock(msgOnRaw);

  let t = cutBookingEmailFooters(raw);
  t = sanitizeBookingEmailPlainText(t) || t;

  const footerStart =
    /(?:^|\n)\s*(?:Данные бронирования|Детали бронирования|Информация о бронировании|Reservation details|Reservation information|Your reservation details|Booking details|Информация о бронировании в объекте)(?:\s|$)[\s\S]*$/i;
  const footerMatch = footerStart.exec(t);
  if (footerMatch && footerMatch.index > 0) {
    t = t.slice(0, footerMatch.index).trim();
  }

  t = t.split(/\n\s*©\s*Copyright\b/i)[0] ?? t;
  t = t.split(/\n\s*©\s*\d{4}\s+Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*This e-?mail was sent by Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*Это письмо отправлено компанией Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*Данное электронное сообщение было отправлено/i)[0] ?? t;
  t = t.split(/\n\s*Настроить уведомления\s*$/im)[0] ?? t;
  t = t.split(/\n\s*Вы подписаны на уведомления Booking\.com/i)[0] ?? t;
  t = t.split(/\n\s*Copyright\s*©/i)[0] ?? t;

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
    if (isBookingReservationLabelLine(s)) continue;
    kept.push(line);
  }

  let out = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const msgBlock = tryExtractBookingMessageBlock(out);
  if (msgBlock) out = cleanupGuestSpeechBlock(msgBlock);

  out = stripLeadingBookingMarketingNoise(out);

  if (out.length >= 3 && !stillContainsBookingJunk(out)) return out;

  const summaryFallback = tryExtractBookingSystemSummary(raw);
  if (summaryFallback) return summaryFallback;

  if (looksLikeBookingGuestNotification(rawInput)) {
    const aggressive = cleanupGuestSpeechBlock(
      stripLeadingBookingMarketingNoise(cutBookingEmailFooters(raw)),
    );
    if (aggressive.length >= 3 && !stillContainsBookingJunk(aggressive)) return aggressive;
    if (summaryFallback) return summaryFallback;
    const summaryAgain = tryExtractBookingSystemSummary(raw);
    if (summaryAgain) return summaryAgain;
    return out.length >= 3 ? out : aggressive.slice(0, 400);
  }
  return rawInput;
}

/** Reservation summary labels leaked when footer anchor was stripped early. */
function isBookingReservationLabelLine(s: string): boolean {
  if (/^(?:имя гостя|guest name)\s*:?\s*$/i.test(s)) return true;
  if (/^(?:заезд|отъезд|check-in|check-out)\s*:?\s*$/i.test(s)) return true;
  if (/^(?:название объекта(?:\s+размещения)?|property name|accommodation)\s*:?\s*$/i.test(s)) return true;
  if (/^(?:всего гостей|всего номеров|total guests|total rooms)\s*:?\s*$/i.test(s)) return true;
  if (/^\d{8,12}$/.test(s)) return true;
  return false;
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
  if (/^(?:имя гостя|guest name)\s*:?\s*$/i.test(t)) return true;
  if (/^(?:заезд|отъезд|check-in|check-out)\s*:?\s*$/i.test(t)) return true;
  if (/^(?:название объекта(?:\s+размещения)?|property name)\s*:?\s*$/i.test(t)) return true;
  if (/^(?:всего гостей|всего номеров)\s*:?\s*$/i.test(t)) return true;
  if (/^\/inbox\.html/i.test(t)) return true;
  if (/^(?:utm_|m_campaign|ee_text\])/i.test(t)) return true;
  if (/^[0-9a-f]{20,}$/i.test(t)) return true;
  if (/&amp;type=to_hotel/i.test(t)) return true;
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

/** «Данные бронирования» / Reservation details block — avoids parsing guest speech as check-in. */
function extractReservationBlock(text: string): string {
  const m =
    /(?:^|\n)\s*(?:Данные бронирования|Reservation details)\s*\n([\s\S]*?)(?=\n\s*©\s*Copyright|\n\s*Данное электронное|\n\s*Вы подписаны на уведомления|$)/i.exec(
      text,
    );
  return m?.[1]?.trim() ?? '';
}

function matchReservationMultilineField(labels: string[], block: string): string | undefined {
  if (!block) return undefined;
  for (const label of labels) {
    const re = new RegExp(`(?:${label})\\s*:\\s*\\n\\s*([^\\n]+)`, 'i');
    const m = block.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

function parseReservationCountField(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const m = v.match(/^(\d{1,3})$/);
  return m?.[1];
}

export function isPlausibleGuestContactEmail(email: string | undefined | null): boolean {
  const e = email?.trim().toLowerCase() ?? '';
  if (!e) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  if (e.includes('resend.app') || /no[-_]?reply@booking\.com/.test(e)) return false;
  if (e.endsWith('@booking.com') && !e.endsWith('@guest.booking.com')) return false;
  return true;
}

function extractGuestEmailFromBookingText(text: string): string | undefined {
  const resBlock = extractReservationBlock(text);
  const fromBlock = matchReservationMultilineField(
    ['E-mail', 'Email', 'Электронная почта', 'Guest email', 'Адрес электронной почты'],
    resBlock,
  );
  if (fromBlock && isPlausibleGuestContactEmail(fromBlock)) {
    return fromBlock.trim().toLowerCase();
  }
  const proxyMatch = text.match(/\b([a-z0-9._%+-]+@guest\.booking\.com)\b/i);
  if (proxyMatch?.[1] && isPlausibleGuestContactEmail(proxyMatch[1])) {
    return proxyMatch[1].toLowerCase();
  }
  return undefined;
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

  const resBlock = extractReservationBlock(normalized);

  const guestName =
    matchReservationMultilineField(['Имя гостя', 'Guest name'], resBlock) ??
    matchGroup(/(?:\*Имя гостя\*|Guest name)\s*[:\*]?\s*(.+)/i, resBlock || normalized);
  const checkInRaw =
    matchReservationMultilineField(['Заезд', 'Check-in(?: date)?'], resBlock) ??
    matchGroup(/(?:\*Заезд\*|Check-in(?: date)?)\s*[:\*]?\s*(.+)/i, resBlock);
  const checkOutRaw =
    matchReservationMultilineField(['Отъезд', 'Check-out(?: date)?'], resBlock) ??
    matchGroup(/(?:\*Отъезд\*|Check-out(?: date)?)\s*[:\*]?\s*(.+)/i, resBlock);
  const propertyRaw =
    matchReservationMultilineField(
      ['Название объекта размещения', 'Property name', 'Accommodation'],
      resBlock,
    ) ??
    matchGroup(
      /(?:\*Название объекта размещения\*|Property name|Accommodation)\s*[:\*]?\s*(.+)/i,
      resBlock,
    );
  const totalGuestsRaw = matchReservationMultilineField(
    ['Всего гостей', 'Total guests', 'Number of guests'],
    resBlock,
  );
  const totalRoomsRaw = matchReservationMultilineField(
    ['Всего номеров', 'Total rooms', 'Number of rooms'],
    resBlock,
  );
  const guestEmailFromBody = extractGuestEmailFromBookingText(normalized);

  const guestQuestion = extractBookingGuestQuestion(normalized);

  const hotelId = extractBookingHotelIdFromText(normalized) ?? undefined;

  const checkIn = checkInRaw ? firstLineOnly(checkInRaw) : undefined;
  const checkOut = checkOutRaw ? firstLineOnly(checkOutRaw) : undefined;
  const propertyName = propertyRaw ? firstLineOnly(propertyRaw) : undefined;

  return {
    bookingNumber,
    guestName: guestName ? firstLineOnly(guestName) : undefined,
    checkIn: isPlausibleBookingDateLabel(checkIn) ? checkIn : undefined,
    checkOut: isPlausibleBookingDateLabel(checkOut) ? checkOut : undefined,
    propertyName: isPlausibleBookingPropertyName(propertyName) ? propertyName : undefined,
    guestQuestion,
    ...(guestEmailFromBody ? { guestEmail: guestEmailFromBody } : {}),
    ...(parseReservationCountField(totalGuestsRaw)
      ? { totalGuests: parseReservationCountField(totalGuestsRaw) }
      : {}),
    ...(parseReservationCountField(totalRoomsRaw)
      ? { totalRooms: parseReservationCountField(totalRoomsRaw) }
      : {}),
    hotelId,
  };
}

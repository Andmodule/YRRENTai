import { Injectable } from '@nestjs/common';
import { convert } from 'html-to-text';
import type { MessagingChannel } from './entities/messaging-thread.entity';
import { mailHeaderFirst } from './inbound-mail-headers.util';

export interface BookingInboxHints {
  reservationId: string | null;
  propertyName: string | null;
  guestName: string | null;
  /** Explicit Zodomus listing id typed by guest (e.g. "Zodomus property id 10322630"). */
  zodomusPropertyId: string | null;
  /** Booking admin URL param `hotel_id` — store the same value in `property_channel_listings.externalListingId` for Booking. */
  bookingHotelId: string | null;
}

@Injectable()
export class MessageParserService {
  parseChannel(guestEmail: string): MessagingChannel {
    const lower = guestEmail.toLowerCase();
    if (lower.includes('booking.com')) return 'booking';
    if (lower.includes('airbnb.com')) return 'airbnb';
    return 'direct';
  }

  extractReservationId(subject: string): string | null {
    return subject.match(/\b(\d{6,12})\b/)?.[1] ?? null;
  }

  extractGuestName(fromHeader: string): string | null {
    const m = fromHeader.match(/^([^<]+)</);
    return m?.[1]?.trim() ?? null;
  }

  /**
   * Booking’s fixed-format subject lines: take the guest name after RU «гостя» / EN «from (the) guest».
   */
  extractGuestNameFromBookingSubject(subject: string): string | null {
    const oneLine = subject.replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!oneLine) return null;
    const noBracket = oneLine.replace(/^\[[^\]]{0,80}\]\s*/, '').trim();

    const ru = noBracket.match(/гостя\s+(.+)$/i);
    if (ru?.[1]) {
      return this.trimInboxLabelLine(this.stripBookingSubjectSuffix(ru[1]));
    }

    const en = noBracket.match(/(?:from\s+the\s+guest|from\s+guest)\s+(.+)$/i);
    if (en?.[1]) {
      return this.trimInboxLabelLine(this.stripBookingSubjectSuffix(en[1]));
    }

    return null;
  }

  /** `hotel_id` in admin.booking.com links — same id as Booking object in channel settings. */
  extractBookingHotelIdFromUrls(source: string): string | null {
    let s = source.replace(/&amp;/gi, '&');
    for (let i = 0; i < 8; i++) {
      const plain = s.match(/[?&]hotel_id=(\d{4,12})\b/i);
      if (plain?.[1]) return plain[1];
      // Encoded `=` (e.g. inside utm_* or redirect chains): ...hotel_id%3D19191919...
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

  /**
   * Booking emails often put `hotel_id` only in `<a href="...">` — `stripHtmlToText` drops the URL.
   * 1) Search the raw HTML (Gmail redirects, encoded params).
   * 2) Each quoted / unquoted `href` value.
   */
  extractBookingHotelIdFromHtml(html: string): string | null {
    if (!html?.trim()) return null;
    const fromDoc = this.extractBookingHotelIdFromUrls(html);
    if (fromDoc) return fromDoc;

    const hrefQuoted = /href\s*=\s*(["'])([^"']*)\1/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefQuoted.exec(html)) !== null) {
      const raw = m[2];
      if (!raw) continue;
      const id = this.extractBookingHotelIdFromUrls(raw);
      if (id) return id;
    }

    const hrefBare = /href\s*=\s*([^\s"'=<>`]+)/gi;
    while ((m = hrefBare.exec(html)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const id = this.extractBookingHotelIdFromUrls(raw);
      if (id) return id;
    }

    return null;
  }

  /** Parses bare email from a From header (RFC 5322 display name + angle-addr). */
  extractEmailFromFrom(fromHeader: string): string {
    const angle = fromHeader.match(/<([^>]+)>/);
    if (angle?.[1]) return angle[1].trim().toLowerCase();
    const bare = fromHeader.match(/\b([^\s<>]+@[^\s<>]+)\b/);
    return bare?.[1]?.trim().toLowerCase() ?? fromHeader.trim().toLowerCase();
  }

  /**
   * Mailbox addresses in `From` for L1:
   * - If any `<…@…>` exists, use **only** those (avoids matching `x@gmail.com` inside a display name
   *   before `Name <id@guest.booking.com>`).
   * - Otherwise all bare `a@b` tokens (e.g. comma-separated list without angle brackets).
   */
  extractAllMailboxEmailsFromFrom(fromHeader: string): string[] {
    const s = fromHeader?.trim() ?? '';
    if (!s) return [];
    const fromAngles: string[] = [];
    for (const m of s.matchAll(/<([^>]+)>/g)) {
      const inner = m[1]?.trim().toLowerCase() ?? '';
      if (inner.includes('@')) fromAngles.push(inner);
    }
    if (fromAngles.length > 0) {
      return [...new Set(fromAngles)];
    }
    const bare: string[] = [];
    for (const m of s.matchAll(/\b([^\s<>]+@[^\s<>]+)\b/g)) {
      const b = m[1]?.trim().toLowerCase() ?? '';
      if (b) bare.push(b);
    }
    return [...new Set(bare)];
  }

  /** Minimal HTML → plain text for inbound mail that only has `html`. */
  stripHtmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Prefer html-to-text for OTA HTML bodies; fallback to tag stripping (doc/EMAILdeliveryTZ Phase 4). */
  htmlToPlainForInbound(html: string): string {
    try {
      return convert(html, { wordwrap: false }).replace(/\u00a0/g, ' ');
    } catch {
      return this.stripHtmlToText(html);
    }
  }

  /** Decode a few entities so stripHtmlToText output is readable (Resend HTML often encodes spaces). */
  decodeHtmlEntities(text: string): string {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  cleanEmailBody(text: string): string {
    const noQuotes = text
      .split('\n')
      .filter((line) => !line.startsWith('>'))
      .join('\n');
    const noSig = noQuotes.split(/^--\s*$/m)[0] ?? noQuotes;
    return noSig.trim();
  }

  /**
   * When every line is quoted (`>`), `cleanEmailBody` returns empty — common for forwards.
   * Strip one or more `>` prefixes per line and drop signature delimiter.
   */
  dequotePlainBody(text: string): string {
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n').map((line) => {
      let l = line;
      while (/^>\s?/.test(l)) {
        l = l.replace(/^>\s?/, '');
      }
      return l;
    });
    const joined = lines.join('\n').trim();
    const noSig = joined.split(/^--\s*$/m)[0] ?? joined;
    return noSig.trim();
  }

  /**
   * Best-effort body for chat / agent: plain `text`, then HTML, then dequoted plain if quoted-only.
   */
  extractInboundBody(text: string | undefined, html: string | null | undefined): string {
    const rawPlain = (text ?? '').replace(/\r\n/g, '\n');

    let plain = this.cleanEmailBody(rawPlain);
    if (!plain.trim() && html?.trim()) {
      const fromHtml = this.decodeHtmlEntities(this.htmlToPlainForInbound(html));
      plain = this.cleanEmailBody(fromHtml);
      if (!plain.trim()) {
        plain = fromHtml.trim();
      }
    }

    if (!plain.trim() && rawPlain.trim()) {
      plain = this.dequotePlainBody(rawPlain);
    }

    if (!plain.trim() && html?.trim()) {
      plain = this.decodeHtmlEntities(this.htmlToPlainForInbound(html)).trim();
    }

    return plain.trim();
  }

  /**
   * After HTML/plain extraction: drop quoted thread tails and common Booking footers (no LLM).
   */
  stripInboundQuoteNoise(text: string): string {
    let t = text.replace(/\r\n/g, '\n').trim();
    if (!t) return t;
    const cutPatterns = [
      /\n-{3,}\s*Original Message\s*-{3,}\s*\n/i,
      /\nOn .+ wrote:\s*\n/i,
      /\nLe .+ a écrit\s*:\s*\n/i,
      /\nAm .+ schrieb.+\s*:\s*\n/i,
    ];
    for (const re of cutPatterns) {
      const idx = t.search(re);
      if (idx > 0) {
        t = t.slice(0, idx).trim();
      }
    }
    t = t.split(/\n\s*This message was sent by Booking\.com/i)[0] ?? t;
    t = t.split(/\n\s*Это сообщение (?:было )?отправлено через Booking\.com/i)[0] ?? t;
    t = t.split(/\n\s*Get the Booking\.com app/i)[0] ?? t;
    return t.trim();
  }

  /**
   * Booking.com (and similar OTAs) often use a fixed block in the plain body:
   * Reservation: 4900703 / Property: … / Guest: … / Message: …
   * Works for EN/RU templates.
   */
  parseBookingStyleInboxHints(source: string): BookingInboxHints {
    const t = source.replace(/\r\n/g, '\n');
    let reservationId: string | null = null;
    const resPatterns = [
      /(?:Reservation|Бронирование)[\s#:]*(\d{5,12})\b/i,
      /(?:Reservation\s+ID|ID\s+брони)[\s#:]*(\d{5,12})\b/i,
      /(?:reservation|booking)[\s#:]+(\d{5,12})/i,
    ];
    for (const p of resPatterns) {
      const m = t.match(p);
      if (m?.[1]) {
        reservationId = m[1];
        break;
      }
    }
    let propertyName: string | null = null;
    const propMatch = t.match(
      /(?:Property|Объект|Название\s+объекта)[\s:]+(.+?)(?:\n|$)/i,
    );
    if (propMatch?.[1]) {
      propertyName = this.trimInboxLabelLine(propMatch[1]);
    }
    let guestName: string | null = null;
    const guestMatch = t.match(/(?:Guest|Гость)[\s:]+(.+?)(?:\n|$)/i);
    if (guestMatch?.[1]) {
      guestName = this.trimInboxLabelLine(guestMatch[1]);
    }
    let zodomusPropertyId: string | null = null;
    const zPx = t.match(/zodomus\s+property\s+id[:\s#]*(\d{5,16})\b/i);
    if (zPx?.[1]) {
      zodomusPropertyId = zPx[1];
    }
    const bookingHotelId = this.extractBookingHotelIdFromUrls(t);
    return {
      reservationId,
      propertyName,
      guestName,
      zodomusPropertyId,
      bookingHotelId,
    };
  }

  /** Prefer body block, then digits in subject, then digits anywhere in body. */
  resolveInboundReservationId(
    subject: string,
    bodyText: string,
    hints: BookingInboxHints,
  ): string | null {
    return (
      hints.reservationId ??
      this.extractReservationId(subject) ??
      this.extractReservationId(bodyText)
    );
  }

  private stripBookingSubjectSuffix(s: string): string {
    return s
      .replace(/\s*[-—–|]\s*Booking\.com.*$/i, '')
      .replace(/\s*[-—–|]\s*Бронирование.*$/i, '')
      .trim();
  }

  private trimInboxLabelLine(s: string): string {
    return s
      .trim()
      .replace(/^["'`«»\u201c\u201d\u2018\u2019]+|["'`«»\u201c\u201d\u2018\u2019]+$/g, '')
      .trim();
  }

  extractMessageId(headers: Record<string, string | string[] | undefined> = {}): string | null {
    const raw =
      mailHeaderFirst(headers, 'message-id') ??
      mailHeaderFirst(headers, 'message_id');
    return raw?.trim() ? raw.trim() : null;
  }

  /** Subject from webhook `data.subject` or `Subject` header (use {@link normalizeMailHeaders} first). */
  pickInboundSubject(
    webhookSubject: string | undefined | null,
    normHeaders: Record<string, string | string[] | undefined>,
  ): string | undefined {
    const w = webhookSubject?.trim();
    if (w) return w;
    return mailHeaderFirst(normHeaders, 'subject');
  }

  /**
   * Optional webhook gate: only Booking-style “guest wrote” notification subjects.
   * `extraRegexes` from env (semicolon-separated) extend the default RU/EN patterns.
   */
  isBookingInboundGuestChatSubject(
    subject: string | undefined,
    opts: { extraRegexes: RegExp[] },
  ): boolean {
    const s = subject?.trim() ?? '';
    if (!s) return false;
    const defaults: RegExp[] = [
      /новое\s+сообщение\s+от\s+гостя/i,
      /сообщение\s+от\s+гостя/i,
      /new\s+message\s+from\s+the\s+guest/i,
      /message\s+from\s+the\s+guest/i,
      /from\s+the\s+guest\b/i,
      /\bот\s+гостя\b/i,
    ];
    for (const re of [...defaults, ...opts.extraRegexes]) {
      if (re.test(s)) return true;
    }
    return false;
  }
}

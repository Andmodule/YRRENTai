/**
 * Minimal RFC 5545 iCal generator — no external dependencies.
 * Produces a VCALENDAR feed with VEVENT entries for each booking.
 * Privacy-safe: guest name is replaced with "Reserved".
 */

export interface ICalGenerateInput {
  propertyName: string;
  prodId?: string;
  events: ICalGenerateEvent[];
}

export interface ICalGenerateEvent {
  uid: string;
  /** UTC date */
  dtStart: Date;
  /** UTC date (exclusive — checkout day) */
  dtEnd: Date;
  summary?: string;
  lastModified?: Date;
}

export function generateICal(input: ICalGenerateInput): string {
  const prodId = input.prodId ?? '-//RentAI//RentAI PMS//EN';
  const now = formatICalDateTime(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICalText(input.propertyName)}`,
    `X-WR-TIMEZONE:UTC`,
  ];

  for (const ev of input.events) {
    const dtStart = formatICalDate(ev.dtStart);
    const dtEnd = formatICalDate(ev.dtEnd);
    const dtstamp = ev.lastModified ? formatICalDateTime(ev.lastModified) : now;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeICalText(ev.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeICalText(ev.summary ?? 'Reserved')}`,
      `LAST-MODIFIED:${dtstamp}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  // Fold lines longer than 75 octets (RFC 5545 §3.1)
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Format date as YYYYMMDD (DATE-only, no time component). */
function formatICalDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Format datetime as YYYYMMDDTHHMMSSZ (UTC). */
function formatICalDateTime(d: Date): string {
  const date = formatICalDate(d);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const min = d.getUTCMinutes().toString().padStart(2, '0');
  const sec = d.getUTCSeconds().toString().padStart(2, '0');
  return `${date}T${h}${min}${sec}Z`;
}

function escapeICalText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines SHOULD be no longer than 75 octets.
 * Fold by inserting CRLF + single SPACE.
 */
function foldLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;

  const chunks: string[] = [];
  let pos = 0;
  chunks.push(line.slice(pos, pos + MAX));
  pos += MAX;

  while (pos < line.length) {
    chunks.push(' ' + line.slice(pos, pos + MAX - 1));
    pos += MAX - 1;
  }

  return chunks.join('\r\n');
}

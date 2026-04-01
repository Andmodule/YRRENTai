/**
 * Minimal RFC 5545 iCal parser — no external dependencies.
 * Handles the most common calendar feeds from Airbnb, VRBO, Booking.com, etc.
 */

export interface ICalEvent {
  uid: string;
  /** Inclusive check-in date (start of day UTC) */
  dtStart: Date;
  /** Exclusive check-out date (start of day UTC). Most platforms use DATE-only values. */
  dtEnd: Date;
  summary: string;
  description?: string;
  /** CONFIRMED | TENTATIVE | CANCELLED */
  status?: string;
}

/**
 * Parse raw iCal text into a list of VEVENT objects.
 * Skips VFREEBUSY, VTIMEZONE, etc.
 */
export function parseICal(text: string): ICalEvent[] {
  // 1. Unfold lines (RFC 5545 §3.1: continuation lines start with SPACE or TAB)
  const unfolded = text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '');

  const lines = unfolded.split(/\r?\n/);

  const events: ICalEvent[] = [];
  let current: Partial<ICalEvent> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current?.uid && current.dtStart && current.dtEnd) {
        events.push(current as ICalEvent);
      }
      current = null;
      continue;
    }

    if (!current) continue;

    // Split into name[:params] and value at the FIRST colon
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const nameWithParams = line.substring(0, colonIdx);
    const value = line.substring(colonIdx + 1);

    // Strip parameters (e.g. DTSTART;TZID=Europe/Moscow → DTSTART)
    const propName = (nameWithParams.split(';')[0] ?? '').toUpperCase();

    switch (propName) {
      case 'UID':
        current.uid = value.trim();
        break;

      case 'DTSTART':
        try {
          current.dtStart = parseICalDate(value.trim(), nameWithParams);
        } catch {
          // malformed date — skip event
        }
        break;

      case 'DTEND':
        try {
          current.dtEnd = parseICalDate(value.trim(), nameWithParams);
        } catch {
          // malformed date — skip event
        }
        break;

      case 'SUMMARY':
        current.summary = unescapeICalText(value);
        break;

      case 'DESCRIPTION':
        current.description = unescapeICalText(value);
        break;

      case 'STATUS':
        current.status = value.trim().toUpperCase();
        break;
    }
  }

  return events;
}

/**
 * Parse an iCal date value.
 * Handles: DATE (20260601), DATETIME UTC (20260601T120000Z), DATETIME local (20260601T120000).
 * Always returns a UTC Date whose time is 00:00:00 for DATE-only values.
 */
function parseICalDate(value: string, nameWithParams: string): Date {
  const clean = value.replace(/Z$/, '').trim();

  // DATE-only: 20260601
  if (/^\d{8}$/.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d));
  }

  // DATETIME: 20260601T120000 (with or without Z / timezone)
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(clean);
  if (dtMatch) {
    const hasZ = value.endsWith('Z');
    const hasTzParam = nameWithParams.includes('TZID=');

    const yr = dtMatch[1] ?? '0';
    const mo = dtMatch[2] ?? '1';
    const dy = dtMatch[3] ?? '1';
    const hr = dtMatch[4] ?? '0';
    const min = dtMatch[5] ?? '0';
    const sec = dtMatch[6] ?? '0';

    if (hasZ || !hasTzParam) {
      return new Date(
        Date.UTC(
          parseInt(yr, 10),
          parseInt(mo, 10) - 1,
          parseInt(dy, 10),
          parseInt(hr, 10),
          parseInt(min, 10),
          parseInt(sec, 10),
        ),
      );
    }

    // TZID present but we don't do full tz resolution — use date portion only
    return new Date(Date.UTC(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(dy, 10)));
  }

  throw new Error(`Cannot parse iCal date: ${value}`);
}

function unescapeICalText(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

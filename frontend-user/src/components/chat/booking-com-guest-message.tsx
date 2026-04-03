'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { sanitizeBookingEmailPlainText, type BookingComMessageMetadata } from '@rentai/shared';

interface BookingComGuestMessageProps {
  metadata: BookingComMessageMetadata;
  rawContent: string;
}

function extraPlainAfterStructuredMetadata(
  plain: string,
  meta: BookingComMessageMetadata,
): string {
  const lines = plain.split('\n').map((l) => l.trim());
  const out: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (/новое сообщение от гостя|new message from the guest/i.test(line)) continue;
    if (/^номер бронирования\s*:/i.test(line) || /^booking number\s*:/i.test(line)) continue;
    if (meta.guestName && (line === `${meta.guestName}:` || line === `${meta.guestName}：` || line === meta.guestName.trim())) continue;
    if (line === meta.guestQuestion.trim()) continue;
    if (line === meta.bookingNumber || line === `№ ${meta.bookingNumber}`) continue;
    if (meta.propertyName && line === meta.propertyName.trim()) continue;
    if (meta.checkIn && line === meta.checkIn.trim()) continue;
    if (meta.checkOut && line === meta.checkOut.trim()) continue;
    out.push(line);
  }
  return [...new Set(out)].join('\n').trim();
}

export function BookingComGuestMessage({ metadata, rawContent }: BookingComGuestMessageProps) {
  const t = useTranslations('inbox');
  const [moreOpen, setMoreOpen] = useState(false);

  const sanitizedExtra = useMemo(() => {
    const raw = sanitizeBookingEmailPlainText(rawContent);
    return extraPlainAfterStructuredMetadata(raw, metadata);
  }, [rawContent, metadata]);

  const hasMore = sanitizedExtra.length >= 24;

  if (metadata.variant === 'followup') {
    return (
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{metadata.guestQuestion}</p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 border-b border-primary-foreground/10 pb-2">
        <p className="min-w-0 text-[10px] leading-none text-primary-foreground/35">
          <span className="font-normal">№</span>
          <span className="ml-1 tabular-nums font-normal text-primary-foreground/32">{metadata.bookingNumber}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] font-normal tracking-wide text-primary-foreground/38">booking</span>
          {hasMore ? (
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-label={t('bookingComMoreToggleAria')}
              onClick={() => setMoreOpen((o) => !o)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-primary-foreground/45 transition hover:bg-primary-foreground/10 hover:text-primary-foreground/70"
            >
              <span
                className={`inline-block text-sm leading-none transition-transform ${moreOpen ? 'rotate-90' : ''}`}
              >
                ›
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {(metadata.checkIn || metadata.checkOut || metadata.propertyName) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[12px] leading-snug text-primary-foreground/85 [&_dt]:text-primary-foreground/50 [&_dd]:min-w-0 [&_dd]:break-words">
          {metadata.checkIn ? (
            <>
              <dt>{t('bookingComCheckIn')}</dt>
              <dd>{metadata.checkIn}</dd>
            </>
          ) : null}
          {metadata.checkOut ? (
            <>
              <dt>{t('bookingComCheckOut')}</dt>
              <dd>{metadata.checkOut}</dd>
            </>
          ) : null}
          {metadata.propertyName ? (
            <>
              <dt>{t('bookingComProperty')}</dt>
              <dd>{metadata.propertyName}</dd>
            </>
          ) : null}
        </dl>
      )}

      <div>
        {metadata.guestName ? (
          <p className="text-[11px] text-primary-foreground/50">{t('bookingComMessageTitle', { name: metadata.guestName })}</p>
        ) : null}
        <p
          className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed text-primary-foreground/95 [overflow-wrap:anywhere] ${metadata.guestName ? 'mt-1' : ''}`}
        >
          {metadata.guestQuestion}
        </p>
      </div>

      {hasMore && moreOpen ? (
        <div className="border-t border-primary-foreground/10 pt-2">
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-primary-foreground/60 [overflow-wrap:anywhere]">
            {sanitizedExtra}
          </div>
        </div>
      ) : null}
    </div>
  );
}

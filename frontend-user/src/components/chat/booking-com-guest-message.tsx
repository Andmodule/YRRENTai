'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  isPlausibleBookingDateLabel,
  isPlausibleBookingPropertyName,
  resolveBookingGuestDisplayText,
  type BookingComMessageMetadata,
} from '@rentai/shared';

interface BookingComGuestMessageProps {
  metadata: BookingComMessageMetadata;
  rawContent: string;
}

function BookingHotelIdDebugRow({ hotelId, label }: { hotelId: string; label: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-snug text-primary-foreground/70 [&_dt]:text-primary-foreground/45">
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums text-primary-foreground/85">{hotelId}</dd>
    </dl>
  );
}

export function BookingComGuestMessage({ metadata, rawContent }: BookingComGuestMessageProps) {
  const t = useTranslations('inbox');
  const [moreOpen, setMoreOpen] = useState(false);

  const guestText = useMemo(
    () => resolveBookingGuestDisplayText(rawContent, metadata),
    [rawContent, metadata],
  );

  const checkIn = isPlausibleBookingDateLabel(metadata.checkIn) ? metadata.checkIn : undefined;
  const checkOut = isPlausibleBookingDateLabel(metadata.checkOut) ? metadata.checkOut : undefined;
  const propertyName = isPlausibleBookingPropertyName(metadata.propertyName)
    ? metadata.propertyName
    : undefined;

  const hasReservationMeta = !!(checkIn || checkOut || propertyName);
  const hotelId = metadata.hotelId?.trim();
  const showExpand = hasReservationMeta || !!hotelId;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 border-b border-primary-foreground/10 pb-2">
        <p className="min-w-0 text-[10px] leading-none text-primary-foreground/35">
          <span className="font-normal">№</span>
          <span className="ml-1 tabular-nums font-normal text-primary-foreground/32">
            {metadata.bookingNumber}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] font-normal tracking-wide text-primary-foreground/38">
            booking
          </span>
          {showExpand ? (
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

      <div>
        {metadata.guestName ? (
          <p className="text-[11px] text-primary-foreground/50">
            {t('bookingComMessageTitle', { name: metadata.guestName })}
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed text-primary-foreground/95 [overflow-wrap:anywhere] ${metadata.guestName ? 'mt-1' : ''}`}
        >
          {guestText}
        </p>
      </div>

      {showExpand && moreOpen ? (
        <div className="space-y-2 border-t border-primary-foreground/10 pt-2">
          {hasReservationMeta ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[12px] leading-snug text-primary-foreground/85 [&_dt]:text-primary-foreground/50 [&_dd]:min-w-0 [&_dd]:break-words">
              {checkIn ? (
                <>
                  <dt>{t('bookingComCheckIn')}</dt>
                  <dd>{checkIn}</dd>
                </>
              ) : null}
              {checkOut ? (
                <>
                  <dt>{t('bookingComCheckOut')}</dt>
                  <dd>{checkOut}</dd>
                </>
              ) : null}
              {propertyName ? (
                <>
                  <dt>{t('bookingComProperty')}</dt>
                  <dd>{propertyName}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {hotelId ? (
            <BookingHotelIdDebugRow hotelId={hotelId} label={t('bookingComHotelId')} />
          ) : (
            <p className="text-[11px] text-primary-foreground/45">{t('bookingComHotelIdMissing')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

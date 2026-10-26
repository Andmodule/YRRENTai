'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pricingKeys } from '@/modules/pricing/hooks';
import { useCalendarDatesJob, type CalendarDatesJob, type DatesRange } from '../calendar-dates-api';
import { sentNightPrices } from '../lib/booking-send';
import { patchOtaNightlyPricesInCalendarCache } from '../lib/calendar-cache';

/** A send started from the base price panel: its run, and the prices it carried. */
export type SentRun = {
  jobId: string;
  ranges: DatesRange[];
  currency: string;
  /** The check listed only a part of the ranges (the send went on with the whole plan). */
  more: boolean;
};

export type BookingSendWatch = {
  /** The property's latest «Отправить в Booking» / dates run, whoever started it. */
  job: CalendarDatesJob | null;
  /** The run started from this page, while it is the one on screen. */
  sent: SentRun | null;
  running: boolean;
  setSent: (run: SentRun | null) => void;
};

/**
 * Watches the property's Booking run for the whole page, not for the panel: the panel remounts with every
 * picked range and lives inside the phone sheet that unmounts when closed — a watcher there missed the end
 * of the run, and the cells kept the old price. When the run ends, the cells take the sent prices at once,
 * then the calendar re-reads Booking.
 */
export function useBookingSend(propertyId: string, enabled: boolean): BookingSendWatch {
  const qc = useQueryClient();
  const jobQuery = useCalendarDatesJob(propertyId, enabled);
  const job = jobQuery.data ?? null;
  const [sent, setSentState] = useState<SentRun | null>(null);
  const sentRef = useRef<SentRun | null>(null);
  const setSent = useCallback((run: SentRun | null) => {
    sentRef.current = run;
    setSentState(run);
  }, []);
  useEffect(() => setSent(null), [propertyId, setSent]);

  const lastState = useRef<string | null>(null);
  useEffect(() => {
    const s = job?.state ?? null;
    if (lastState.current === 'running' && s && s !== 'running') {
      const mine = sentRef.current;
      if (job && mine && job.id === mine.jobId) {
        patchOtaNightlyPricesInCalendarCache(qc, propertyId, sentNightPrices(job, mine.ranges));
      }
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: pricingKeys.basePrice(propertyId) });
    }
    lastState.current = s;
  }, [job, qc, propertyId]);

  return { job, sent, running: job?.state === 'running', setSent };
}

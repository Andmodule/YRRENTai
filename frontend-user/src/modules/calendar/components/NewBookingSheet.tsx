'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { z } from 'zod';
import { DIRECT_BOOKING_SOURCES } from '@rentai/shared';
import { apiClient } from '@/lib/api/client';
import { useProperties } from '@/hooks/use-properties';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Property as CalendarProperty } from '../types';
import {
  mapApiBookingToReservation,
  upsertReservationInCalendarCache,
  type ApiBooking,
} from '../lib/calendar-cache';

type InitialStatus = 'PENDING' | 'CONFIRMED';

type ConflictPreview = {
  available: boolean;
  reason?:
    | 'MINIMUM_ONE_NIGHT'
    | 'OTA_UNAVAILABLE'
    | 'OTA_CLOSED'
    | 'OTA_CLOSED_ON_ARRIVAL'
    | 'OTA_CLOSED_ON_DEPARTURE'
    | 'OTA_MIN_STAY';
  conflictWith?: { guestName: string; checkIn: string; checkOut: string };
  otaRefreshed?: boolean;
  otaRestriction?: {
    reason: string;
    date?: string;
    minStayRequired?: number;
    nights?: number;
  };
};

interface NewBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Objects from calendar payload (uuid = property id) */
  properties: CalendarProperty[];
  /** When opening from a calendar row, preselect that property (otherwise first object). */
  initialPropertyId?: string | null;
  /** When opening from a grid cell, use these dates (otherwise today / tomorrow from toolbar). */
  initialGridDates?: { checkIn: string; checkOut: string } | null;
}

const fieldClass = 'h-9 text-sm';
const labelClass = 'text-xs font-medium text-muted-foreground';

export function NewBookingSheet({
  open,
  onOpenChange,
  properties,
  initialPropertyId = null,
  initialGridDates = null,
}: NewBookingSheetProps) {
  const t = useTranslations('calendar.newBookingForm');
  const queryClient = useQueryClient();
  const { properties: fullProperties } = useProperties();

  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [directSource, setDirectSource] = useState<string>('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [totalMajor, setTotalMajor] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [guestsCount, setGuestsCount] = useState('');
  const [initialStatus, setInitialStatus] = useState<InitialStatus>('PENDING');

  const defaultPropertyId = properties[0]?.uuid ?? '';

  useEffect(() => {
    if (open) {
      const preferred =
        initialPropertyId && properties.some((p) => p.uuid === initialPropertyId)
          ? initialPropertyId
          : defaultPropertyId;
      setPropertyId(preferred);
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setNotes('');
      setDirectSource('');
      if (initialGridDates?.checkIn && initialGridDates?.checkOut) {
        setCheckIn(initialGridDates.checkIn);
        setCheckOut(initialGridDates.checkOut);
      } else {
        const today = format(new Date(), 'yyyy-MM-dd');
        const out = format(addDays(parseISO(`${today}T12:00:00.000Z`), 1), 'yyyy-MM-dd');
        setCheckIn(today);
        setCheckOut(out);
      }
      setTotalMajor('');
      setGuestsCount('');
      setInitialStatus('PENDING');
    }
  }, [open, defaultPropertyId, initialPropertyId, properties, initialGridDates]);

  const currencyForProperty = useMemo(() => {
    const fp = fullProperties.find((p) => p.id === propertyId);
    return fp?.currency ?? 'EUR';
  }, [fullProperties, propertyId]);

  useEffect(() => {
    if (propertyId) {
      setCurrency(currencyForProperty);
    }
  }, [propertyId, currencyForProperty]);

  const checkInIso = useMemo(() => {
    if (!checkIn) return '';
    return `${checkIn}T12:00:00.000Z`;
  }, [checkIn]);

  const checkOutIso = useMemo(() => {
    if (!checkOut) return '';
    return `${checkOut}T12:00:00.000Z`;
  }, [checkOut]);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const ci = parseISO(`${checkIn}T12:00:00.000Z`);
    const co = parseISO(`${checkOut}T12:00:00.000Z`);
    return differenceInCalendarDays(co, ci);
  }, [checkIn, checkOut]);

  const conflictEnabled =
    open &&
    Boolean(propertyId) &&
    Boolean(checkInIso) &&
    Boolean(checkOutIso) &&
    nights >= 1;

  const { data: conflictPreview, isFetching: conflictLoading, isError: conflictQueryError } = useQuery({
    queryKey: ['bookingConflictPreview', propertyId, checkInIso, checkOutIso],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ConflictPreview }>('/bookings/conflict-preview', {
        params: {
          propertyId,
          checkIn: checkInIso,
          checkOut: checkOutIso,
        },
      });
      return res.data.data;
    },
    enabled: conflictEnabled,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (conflictPreview?.otaRefreshed) {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  }, [conflictPreview?.otaRefreshed, queryClient]);

  const emailInvalid = useMemo(() => {
    const e = guestEmail.trim();
    if (!e) return false;
    return !z.string().email().safeParse(e).success;
  }, [guestEmail]);

  const priceValid = useMemo(() => {
    const major = parseFloat(totalMajor.replace(',', '.'));
    return !Number.isNaN(major) && major >= 0;
  }, [totalMajor]);

  const availabilityOk =
    !conflictLoading && !conflictQueryError && conflictPreview?.available === true;

  const canSubmit =
    Boolean(propertyId.trim()) &&
    Boolean(guestName.trim()) &&
    !emailInvalid &&
    Boolean(checkIn) &&
    Boolean(checkOut) &&
    nights >= 1 &&
    priceValid &&
    availabilityOk &&
    !conflictLoading;

  const onCheckInChange = useCallback((v: string) => {
    setCheckIn(v);
    if (!v) return;
    const ci = parseISO(`${v}T12:00:00.000Z`);
    const co = checkOut ? parseISO(`${checkOut}T12:00:00.000Z`) : null;
    if (!co || co.getTime() <= ci.getTime()) {
      setCheckOut(format(addDays(ci, 1), 'yyyy-MM-dd'));
    }
  }, [checkOut]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!propertyId.trim()) throw new Error('VALIDATION');
      if (!guestName.trim()) throw new Error('VALIDATION');
      if (emailInvalid) throw new Error('EMAIL');
      if (!checkIn || !checkOut) throw new Error('VALIDATION');
      const ci = parseISO(`${checkIn}T12:00:00.000Z`);
      const co = parseISO(`${checkOut}T12:00:00.000Z`);
      if (differenceInCalendarDays(co, ci) < 1) throw new Error('RANGE');

      const major = parseFloat(totalMajor.replace(',', '.'));
      if (Number.isNaN(major) || major < 0) throw new Error('PRICE');

      const totalPriceMinor = Math.round(major * 100);
      /** Noon UTC of the selected calendar day — backend re-anchors in property timezone. */
      const ciIso = `${checkIn}T12:00:00.000Z`;
      const coIso = `${checkOut}T12:00:00.000Z`;

      const gc = guestsCount.trim() ? parseInt(guestsCount, 10) : undefined;
      const body = {
        propertyId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        guestEmail: guestEmail.trim() || undefined,
        notes: notes.trim() || undefined,
        directSource: directSource ? (directSource as (typeof DIRECT_BOOKING_SOURCES)[number]) : null,
        checkIn: ciIso,
        checkOut: coIso,
        totalPriceMinor,
        currency: currency.length === 3 ? currency.toUpperCase() : 'EUR',
        ...(gc !== undefined && !Number.isNaN(gc) && gc > 0 ? { guestsCount: gc } : {}),
      };

      const res = await apiClient.post<{ data: ApiBooking }>('/bookings', body);
      let booking = res.data.data;

      if (initialStatus === 'CONFIRMED') {
        const patchRes = await apiClient.patch<{ data: ApiBooking }>(`/bookings/${booking.id}/status`, {
          status: 'CONFIRMED',
        });
        booking = patchRes.data.data;
      }

      return mapApiBookingToReservation(booking, { checkIn, checkOut });
    },
    onSuccess: (reservation) => {
      upsertReservationInCalendarCache(queryClient, reservation);
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingConflictPreview'] });
      toast.success(t('success'));
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      if (isAxiosError(err) && err.response?.status === 409) {
        const data = err.response.data as { message?: { conflictWith?: ConflictPreview['conflictWith'] } };
        const cw = data?.message && typeof data.message === 'object' ? data.message.conflictWith : undefined;
        if (cw) {
          const from = format(parseISO(cw.checkIn.slice(0, 10)), 'd MMM');
          const to = format(parseISO(cw.checkOut.slice(0, 10)), 'd MMM');
          toast.error(t('conflictToast', { guest: cw.guestName, from, to }));
        } else toast.error(t('error'));
        return;
      }
      if (isAxiosError(err) && err.response?.status === 502) {
        toast.error(t('zodomusPushFailed'));
        return;
      }
      if (isAxiosError(err) && err.response?.status === 400) {
        const msg = err.response.data as {
          message?: string | string[] | { error?: string; message?: string; minStayRequired?: number };
        };
        const m = msg?.message;
        const s = Array.isArray(m) ? m[0] : typeof m === 'string' ? m : m?.error ?? m?.message;
        if (s === 'MINIMUM_ONE_NIGHT') {
          toast.error(t('availabilityMinNight'));
          return;
        }
        if (s === 'OTA_MIN_STAY') {
          const req =
            typeof m === 'object' && m && !Array.isArray(m) && typeof m.minStayRequired === 'number'
              ? m.minStayRequired
              : undefined;
          toast.error(req != null ? t('availabilityMinStay', { count: req }) : t('availabilityOtaBlocked'));
          return;
        }
        if (
          s === 'OTA_UNAVAILABLE' ||
          s === 'OTA_CLOSED' ||
          s === 'OTA_CLOSED_ON_ARRIVAL' ||
          s === 'OTA_CLOSED_ON_DEPARTURE'
        ) {
          toast.error(t('availabilityOtaBlocked'));
          return;
        }
      }
      const emsg = err instanceof Error ? err.message : '';
      if (emsg === 'RANGE') toast.error(t('validationRange'));
      else if (emsg === 'PRICE') toast.error(t('validationPrice'));
      else if (emsg === 'VALIDATION') toast.error(t('validationRequired'));
      else if (emsg === 'EMAIL') toast.error(t('validationEmail'));
      else toast.error(t('error'));
    },
  });

  const submit = useCallback(() => {
    mutation.mutate();
  }, [mutation]);

  const availabilityCard = (() => {
    if (!checkIn || !checkOut) return null;

    if (nights < 1) {
      return (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">{t('availabilityMinNight')}</p>
        </div>
      );
    }

    let body: ReactNode = null;
    if (conflictQueryError && conflictEnabled) {
      body = <p className="text-xs text-amber-700 dark:text-amber-300">{t('availabilityCheckError')}</p>;
    } else if (conflictLoading) {
      body = <p className="text-xs text-muted-foreground">{t('availabilityChecking')}</p>;
    } else if (conflictPreview?.reason === 'MINIMUM_ONE_NIGHT') {
      body = <p className="text-xs text-amber-700 dark:text-amber-300">{t('availabilityMinNight')}</p>;
    } else if (conflictPreview?.conflictWith) {
      const cw = conflictPreview.conflictWith;
      const from = format(parseISO(cw.checkIn.slice(0, 10)), 'd MMM');
      const to = format(parseISO(cw.checkOut.slice(0, 10)), 'd MMM');
      body = (
        <p className="text-xs font-medium text-destructive">
          {t('availabilityBlocked', { guest: cw.guestName, from, to })}
        </p>
      );
    } else if (
      conflictPreview?.reason === 'OTA_MIN_STAY' ||
      conflictPreview?.otaRestriction?.reason === 'OTA_MIN_STAY'
    ) {
      const req = conflictPreview.otaRestriction?.minStayRequired;
      body = (
        <p className="text-xs font-medium text-destructive">
          {req != null ? t('availabilityMinStay', { count: req }) : t('availabilityOtaBlocked')}
        </p>
      );
    } else if (
      conflictPreview?.reason === 'OTA_UNAVAILABLE' ||
      conflictPreview?.reason === 'OTA_CLOSED' ||
      conflictPreview?.reason === 'OTA_CLOSED_ON_ARRIVAL' ||
      conflictPreview?.reason === 'OTA_CLOSED_ON_DEPARTURE'
    ) {
      body = <p className="text-xs font-medium text-destructive">{t('availabilityOtaBlocked')}</p>;
    } else if (conflictPreview?.available) {
      body = (
        <div className="space-y-1">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {t('availabilityFree', { count: nights })}
          </p>
          {conflictPreview.otaRefreshed ? (
            <p className="text-[11px] text-muted-foreground">{t('availabilityOtaRefreshed')}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 shadow-sm dark:bg-muted/30">
        <p className="text-xs text-muted-foreground">{t('nightsCount', { count: nights })}</p>
        {body ? <div className="mt-1.5 border-t border-border/60 pt-1.5">{body}</div> : null}
      </div>
    );
  })();

  const formBody =
    properties.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('noPropertiesHint')}</p>
    ) : (
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <Label htmlFor="nb-property" className={labelClass}>
            {t('property')}
          </Label>
          <Select
            id="nb-property"
            className={fieldClass}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            {properties.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.title}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nb-guest" className={labelClass}>
            {t('guest')}
          </Label>
          <Input
            id="nb-guest"
            className={fieldClass}
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder={t('guestPlaceholder')}
            autoComplete="name"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nb-phone" className={labelClass}>
              {t('guestPhone')} <span className="font-normal text-muted-foreground/80">({t('optional')})</span>
            </Label>
            <Input
              id="nb-phone"
              type="tel"
              className={fieldClass}
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder={t('guestPhonePlaceholder')}
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nb-email" className={labelClass}>
              {t('guestEmail')} <span className="font-normal text-muted-foreground/80">({t('optional')})</span>
            </Label>
            <Input
              id="nb-email"
              type="email"
              className={fieldClass}
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder={t('guestEmailPlaceholder')}
              autoComplete="email"
            />
            {emailInvalid ? <p className="text-xs text-destructive">{t('validationEmail')}</p> : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="nb-in" className={labelClass}>
              {t('checkIn')}
            </Label>
            <Input
              id="nb-in"
              type="date"
              className={fieldClass}
              value={checkIn}
              onChange={(e) => onCheckInChange(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nb-out" className={labelClass}>
              {t('checkOut')}
            </Label>
            <Input
              id="nb-out"
              type="date"
              className={fieldClass}
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
        </div>
        {checkIn && checkOut ? (
          <p className="text-[11px] leading-snug text-muted-foreground">{t('checkoutExclusiveHint')}</p>
        ) : null}

        {availabilityCard}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="nb-price" className={labelClass}>
              {t('total')}
            </Label>
            <Input
              id="nb-price"
              inputMode="decimal"
              className={fieldClass}
              value={totalMajor}
              onChange={(e) => setTotalMajor(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nb-currency" className={labelClass}>
              {t('currency')}
            </Label>
            <Select
              id="nb-currency"
              className={fieldClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="BYN">BYN</option>
              <option value="RUB">RUB</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="nb-guests" className={labelClass}>
              {t('guestsCount')}
            </Label>
            <Input
              id="nb-guests"
              type="number"
              min={1}
              className={fieldClass}
              value={guestsCount}
              onChange={(e) => setGuestsCount(e.target.value)}
              placeholder="1"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nb-status" className={labelClass}>
              {t('initialStatus')}
            </Label>
            <Select
              id="nb-status"
              className={fieldClass}
              value={initialStatus}
              onChange={(e) => setInitialStatus(e.target.value as InitialStatus)}
            >
              <option value="PENDING">{t('statusPending')}</option>
              <option value="CONFIRMED">{t('statusConfirmed')}</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nb-source" className={labelClass}>
            {t('directSource')}
          </Label>
          <Select
            id="nb-source"
            className={fieldClass}
            value={directSource}
            onChange={(e) => setDirectSource(e.target.value)}
          >
            <option value="">{t('directSourceUnset')}</option>
            {DIRECT_BOOKING_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`directSource_${s}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nb-notes" className={labelClass}>
            {t('notes')}
          </Label>
          <Textarea
            id="nb-notes"
            rows={2}
            className="min-h-[2.5rem] resize-y text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notesPlaceholder')}
          />
        </div>
      </div>
    );

  const footer = (
    <div className="flex gap-2">
      <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => onOpenChange(false)}>
        {t('cancel')}
      </Button>
      <Button type="button" className="h-10 flex-1" onClick={submit} disabled={mutation.isPending || !canSubmit}>
        {mutation.isPending ? t('submitting') : t('submit')}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t('title')} description={t('description')} className="max-w-md" footer={footer}>
        {formBody}
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, startOfDay } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { useProperties } from '@/hooks/use-properties';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Property as CalendarProperty } from '../types';

type InitialStatus = 'PENDING' | 'CONFIRMED';

interface NewBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Objects from calendar payload (uuid = property id) */
  properties: CalendarProperty[];
}

export function NewBookingSheet({ open, onOpenChange, properties }: NewBookingSheetProps) {
  const t = useTranslations('calendar.newBookingForm');
  const queryClient = useQueryClient();
  const { properties: fullProperties } = useProperties();

  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [totalMajor, setTotalMajor] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [guestsCount, setGuestsCount] = useState('');
  const [initialStatus, setInitialStatus] = useState<InitialStatus>('PENDING');

  const defaultPropertyId = properties[0]?.uuid ?? '';

  useEffect(() => {
    if (open) {
      setPropertyId((id) => id || defaultPropertyId);
      setGuestName('');
      const today = format(new Date(), 'yyyy-MM-dd');
      const out = format(startOfDay(new Date(Date.now() + 86400000)), 'yyyy-MM-dd');
      setCheckIn(today);
      setCheckOut(out);
      setTotalMajor('');
      setGuestsCount('');
      setInitialStatus('PENDING');
    }
  }, [open, defaultPropertyId]);

  const currencyForProperty = useMemo(() => {
    const fp = fullProperties.find((p) => p.id === propertyId);
    return fp?.currency ?? 'EUR';
  }, [fullProperties, propertyId]);

  useEffect(() => {
    if (propertyId) {
      setCurrency(currencyForProperty);
    }
  }, [propertyId, currencyForProperty]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!propertyId.trim()) throw new Error('VALIDATION');
      if (!guestName.trim()) throw new Error('VALIDATION');
      if (!checkIn || !checkOut) throw new Error('VALIDATION');
      const ci = startOfDay(parseISO(`${checkIn}T12:00:00`));
      const co = startOfDay(parseISO(`${checkOut}T12:00:00`));
      if (co <= ci) throw new Error('RANGE');

      const major = parseFloat(totalMajor.replace(',', '.'));
      if (Number.isNaN(major) || major < 0) throw new Error('PRICE');

      const totalPriceMinor = Math.round(major * 100);
      const checkInIso = ci.toISOString();
      const checkOutIso = co.toISOString();

      const gc = guestsCount.trim() ? parseInt(guestsCount, 10) : undefined;
      const body = {
        propertyId,
        guestName: guestName.trim(),
        checkIn: checkInIso,
        checkOut: checkOutIso,
        totalPriceMinor,
        currency: currency.length === 3 ? currency.toUpperCase() : 'EUR',
        ...(gc !== undefined && !Number.isNaN(gc) && gc > 0 ? { guestsCount: gc } : {}),
      };

      const res = await apiClient.post<{ data: { id: string } }>('/bookings', body);
      const id = res.data.data.id;

      if (initialStatus === 'CONFIRMED') {
        await apiClient.patch(`/bookings/${id}/status`, { status: 'CONFIRMED' });
      }

      return id;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(t('success'));
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'RANGE') toast.error(t('validationRange'));
      else if (msg === 'PRICE') toast.error(t('validationPrice'));
      else if (msg === 'VALIDATION') toast.error(t('validationRequired'));
      else toast.error(t('error'));
    },
  });

  const submit = useCallback(() => {
    mutation.mutate();
  }, [mutation]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t('title')} description={t('description')} className="max-w-md">
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noPropertiesHint')}</p>
        ) : (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="nb-property">{t('property')}</Label>
            <Select
              id="nb-property"
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

          <div className="space-y-2">
            <Label htmlFor="nb-guest">{t('guest')}</Label>
            <Input
              id="nb-guest"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder={t('guestPlaceholder')}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nb-in">{t('checkIn')}</Label>
              <Input id="nb-in" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nb-out">{t('checkOut')}</Label>
              <Input id="nb-out" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nb-price">{t('total')}</Label>
              <Input
                id="nb-price"
                inputMode="decimal"
                value={totalMajor}
                onChange={(e) => setTotalMajor(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nb-currency">{t('currency')}</Label>
              <Input
                id="nb-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.slice(0, 3).toUpperCase())}
                maxLength={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nb-guests">{t('guestsCount')}</Label>
              <Input
                id="nb-guests"
                type="number"
                min={1}
                value={guestsCount}
                onChange={(e) => setGuestsCount(e.target.value)}
                placeholder="2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nb-status">{t('initialStatus')}</Label>
              <Select
                id="nb-status"
                value={initialStatus}
                onChange={(e) => setInitialStatus(e.target.value as InitialStatus)}
              >
                <option value="PENDING">{t('statusPending')}</option>
                <option value="CONFIRMED">{t('statusConfirmed')}</option>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? t('submitting') : t('submit')}
            </Button>
          </div>
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

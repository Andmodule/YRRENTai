'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useProperties } from '@/hooks/use-properties';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Property as CalendarProperty } from '../types';

interface SetOtaPriceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: CalendarProperty[];
  initialPropertyId?: string | null;
  /** Inclusive night range from grid (checkOut = last night + 1 exclusive). */
  initialGridDates?: { checkIn: string; checkOut: string } | null;
}

const fieldClass = 'h-9 text-sm';
const labelClass = 'text-xs font-medium text-muted-foreground';

function formatMoneyMajor(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function sampleNightlyPrice(
  prices: Record<string, number> | undefined,
  dateFrom: string,
  dateToExclusive: string,
): number | null {
  if (!prices || !dateFrom || !dateToExclusive || dateFrom >= dateToExclusive) return null;
  let cur = dateFrom;
  while (cur < dateToExclusive) {
    const p = prices[cur];
    if (p != null && p > 0) return p;
    const [y, m, d] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return null;
}

export function SetOtaPriceSheet({
  open,
  onOpenChange,
  properties,
  initialPropertyId = null,
  initialGridDates = null,
}: SetOtaPriceSheetProps) {
  const t = useTranslations('calendar.setOtaPriceForm');
  const queryClient = useQueryClient();
  const { properties: fullProperties } = useProperties();

  const linkedProperties = useMemo(
    () => properties.filter((p) => p.zodomusLinked || Boolean(p.zodomusPropertyId?.trim())),
    [properties],
  );

  const [propertyId, setPropertyId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateToInclusive, setDateToInclusive] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('EUR');

  const defaultPropertyId = linkedProperties[0]?.uuid ?? '';

  useEffect(() => {
    if (!open) return;
    const preferred =
      initialPropertyId && linkedProperties.some((p) => p.uuid === initialPropertyId)
        ? initialPropertyId
        : defaultPropertyId;
    setPropertyId(preferred);
    const from = initialGridDates?.checkIn ?? format(new Date(), 'yyyy-MM-dd');
    const toExclusive =
      initialGridDates?.checkOut ?? format(addDays(new Date(), 1), 'yyyy-MM-dd');
    setDateFrom(from);
    let inclusive = from;
    try {
      inclusive = format(addDays(parseISO(toExclusive), -1), 'yyyy-MM-dd');
    } catch {
      inclusive = from;
    }
    setDateToInclusive(inclusive);
    const prop = linkedProperties.find((p) => p.uuid === preferred);
    const sample = sampleNightlyPrice(prop?.otaNightlyPrices, from, toExclusive);
    setPrice(sample != null ? formatMoneyMajor(sample) : '');
  }, [open, initialPropertyId, initialGridDates, linkedProperties, defaultPropertyId]);

  useEffect(() => {
    if (!open || !propertyId) return;
    const full = fullProperties.find((p) => p.id === propertyId);
    if (full?.currency) setCurrency(full.currency);
  }, [open, propertyId, fullProperties]);

  const dateToExclusive = useMemo(() => {
    if (!dateToInclusive) return '';
    try {
      return format(addDays(parseISO(dateToInclusive), 1), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  }, [dateToInclusive]);

  const nights = useMemo(() => {
    if (!dateFrom || !dateToExclusive || dateFrom >= dateToExclusive) return 0;
    return differenceInCalendarDays(parseISO(dateToExclusive), parseISO(dateFrom));
  }, [dateFrom, dateToExclusive]);

  const mutation = useMutation({
    mutationFn: async () => {
      const priceNum = Number(price.replace(',', '.'));
      if (!propertyId) throw new Error('property');
      if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error('price');
      if (!dateFrom || !dateToExclusive || dateFrom >= dateToExclusive) throw new Error('dates');
      const res = await apiClient.post('/integrations/zodomus/push-rates', {
        propertyId,
        dateFrom,
        dateTo: dateToExclusive,
        price: priceNum,
        currencyCode: currency,
      });
      return res.data;
    },
    onSuccess: async () => {
      toast.success(t('success'));
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (e: unknown) => {
      if (isAxiosError(e)) {
        const msg =
          (e.response?.data as { message?: string | string[] } | undefined)?.message ??
          e.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg || t('error')));
        return;
      }
      toast.error(t('error'));
    },
  });

  const canSubmit =
    Boolean(propertyId) &&
    nights > 0 &&
    Number(price.replace(',', '.')) > 0 &&
    !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('title')}
        description={t('description')}
        footer={
          <div className="flex w-full gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!canSubmit}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              {t('submit')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={labelClass}>{t('property')}</Label>
            <Select
              className={fieldClass}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">{t('propertyPlaceholder')}</option>
              {linkedProperties.map((p) => (
                <option key={p.uuid} value={p.uuid}>
                  {p.title}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className={labelClass}>{t('dateFrom')}</Label>
              <Input
                type="date"
                className={fieldClass}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>{t('dateToInclusive')}</Label>
              <Input
                type="date"
                className={fieldClass}
                value={dateToInclusive}
                onChange={(e) => setDateToInclusive(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('nightsHint', { count: nights })}
          </p>
          <p className="text-[11px] text-muted-foreground">{t('freeOnlyHint')}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className={labelClass}>{t('nightlyPrice')}</Label>
              <Input
                className={fieldClass}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>{t('currency')}</Label>
              <Input
                className={fieldClass}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

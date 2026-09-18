'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ClipboardList, Copy, Loader2, MessageSquare, TriangleAlert, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/hooks/useDateLocale';
import type { Reservation } from '../types';
import { parseLocalCalendarDay } from '../lib/calendar-api-dates';
import { countNights } from '../lib/property-meta';
import { calendarStatusClasses } from '../lib/calendar-status-styles';
import { formatDisplayTotal } from '../lib/resolve-display-total';
import { InlineGuestContactFields } from './InlineGuestContactFields';

const statusLabelKey: Record<Reservation['status'], string> = {
  confirmed: 'statusConfirmed',
  pending: 'statusPending',
  cleaning: 'statusCleaning',
  blocked: 'statusBlocked',
  cancelled: 'statusCancelled',
};

const channelLabelKeys: Record<Reservation['channel'], string> = {
  booking: 'channelBooking',
  airbnb: 'channelAirbnb',
  direct: 'channelDirect',
  other: 'channelOther',
};

/** Sticky footer for booking modal — keep outside scroll area. */
export function ReservationDetailPanelFooter({
  reservation,
  onCreateTask,
  zodomusLinked = false,
}: {
  reservation: Reservation;
  /** Открыть тот же сценарий, что «+» у объекта на доске задач (SmartCreateSheet), с привязкой к брони. */
  onCreateTask: (reservation: Reservation) => void;
  /** Property linked to Zodomus — cancel schedules channel inventory reopen. */
  zodomusLinked?: boolean;
}) {
  const t = useTranslations('calendar');
  const queryClient = useQueryClient();
  const chatLabel = t('openChatShort');
  /** OTA cancellations arrive via Zodomus (Booking → Zodomus → CRM); CRM cancel is direct-only. */
  const canCancel =
    !reservation.fromOta &&
    reservation.status !== 'cancelled' &&
    reservation.status !== 'blocked';
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<{
        data: unknown;
        meta?: { availabilityPushScheduled?: boolean };
      }>(`/bookings/${reservation.uuid}/status`, {
        status: 'CANCELLED',
        cancelledBy: 'manager',
      });
      return res.data;
    },
    onSuccess: async () => {
      toast.success(zodomusLinked ? t('cancelBookingSuccessChannel') : t('cancelBookingSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (err: unknown) => {
      if (isAxiosError(err) && err.response?.status === 502) {
        toast.error(t('cancelBookingChannelPushError'));
        void queryClient.invalidateQueries({ queryKey: ['calendar'] });
        return;
      }
      toast.error(t('cancelBookingError'));
    },
  });

  return (
    <div className="flex flex-col gap-2">
      {reservation.fromOta && reservation.status !== 'cancelled' ? (
        <p className="text-xs text-muted-foreground">{t('otaCancelViaChannelHint')}</p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canCancel ? (
          <Button
            type="button"
            variant="destructive"
            className="min-h-10 min-w-0 flex-1 px-2 text-sm sm:px-4 sm:text-base"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="truncate">{t('cancelBooking')}</span>
          </Button>
        ) : null}
        {reservation.chatThreadId ? (
          <Button asChild className="min-h-10 min-w-0 flex-1 px-2 text-sm sm:px-4 sm:text-base">
            <Link
              href={`/chat?thread=${reservation.chatThreadId}`}
              className="truncate"
              title={t('openChat')}
              aria-label={t('openChat')}
            >
              {chatLabel}
            </Link>
          </Button>
        ) : (
          <Button
            disabled
            className="min-h-10 min-w-0 flex-1 px-2 text-sm sm:px-4 sm:text-base"
            title={t('chatUnavailable')}
            aria-label={t('chatUnavailable')}
          >
            {chatLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-10 min-w-0 flex-1 px-2 text-sm sm:px-4 sm:text-base"
          onClick={() => onCreateTask(reservation)}
        >
          <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{t('createTask')}</span>
        </Button>
      </div>
    </div>
  );
}

export function ReservationDetailPanel({
  reservation,
  onCopy,
  otaNightlyPrices,
  otaNightlyPricesFrom,
}: {
  reservation: Reservation;
  onCopy: () => void;
  otaNightlyPrices?: Record<string, number>;
  otaNightlyPricesFrom?: Record<string, number>;
}) {
  const t = useTranslations('calendar');
  const locale = useDateLocale();
  const queryClient = useQueryClient();
  const nights = countNights(reservation.checkIn, reservation.checkOut);
  const stClass = calendarStatusClasses[reservation.status];
  const paymentStatus = reservation.paymentStatus ?? 'unpaid';
  const isOta = Boolean(reservation.fromOta);
  const displayTotal = formatDisplayTotal(
    reservation.totalPrice,
    reservation.currency,
    reservation.checkIn,
    reservation.checkOut,
    otaNightlyPrices,
    t('priceUnavailable'),
    otaNightlyPricesFrom,
  );

  const [draftNotes, setDraftNotes] = useState(reservation.internalNotes ?? '');
  useEffect(() => {
    setDraftNotes(reservation.internalNotes ?? '');
  }, [reservation.uuid, reservation.internalNotes]);

  const patchMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiClient.patch<{ data: unknown }>(`/bookings/${reservation.uuid}`, body);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: () => {
      toast.error(t('patchBookingError'));
    },
  });

  const saveInternalNotes = () => {
    const trimmed = draftNotes.trim();
    const current = (reservation.internalNotes ?? '').trim();
    if (trimmed === current) return;
    patchMutation.mutate({ internalNotes: trimmed.length > 0 ? trimmed : null });
  };

  const hasGuestRows =
    Boolean(reservation.guestEmail?.trim()) ||
    Boolean(reservation.guestPhone?.trim()) ||
    (reservation.guestsCount != null && reservation.guestsCount > 0) ||
    (reservation.guestsAdults != null && reservation.guestsChildren != null);

  return (
    <div className="space-y-4">
      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', stClass)}>
        {t(statusLabelKey[reservation.status])}
      </span>
      {reservation.overbookingConflict ? (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{t('overbookingConflictTitle')}</p>
            <p className="text-xs leading-relaxed opacity-90">{t('overbookingConflictBody')}</p>
          </div>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t(channelLabelKeys[reservation.channel])}
        {reservation.fromOta ? (
          <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
            {t('otaSyncedBadge')}
          </span>
        ) : null}
      </p>
      <p className="text-sm">
        {format(parseLocalCalendarDay(reservation.checkIn), 'dd MMM yyyy', { locale })} →{' '}
        {format(parseLocalCalendarDay(reservation.checkOut), 'dd MMM yyyy', { locale })}
      </p>
      <p className="text-sm text-muted-foreground">
        {nights} {t('nights')}
      </p>
      <div className="space-y-2">
        <p className="text-base font-medium">{displayTotal}</p>
        {isOta ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t('otaPaymentFromChannel', { channel: t(channelLabelKeys[reservation.channel]) })}
            </p>
            {reservation.otaPaymentHint?.trim() ? (
              <p className="text-sm text-foreground/90">{reservation.otaPaymentHint.trim()}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <Label htmlFor={`pay-${reservation.uuid}`} className="text-xs text-muted-foreground">
              {t('paymentStatusLabel')}
            </Label>
            <Select
              id={`pay-${reservation.uuid}`}
              className="h-9 max-w-[220px] text-sm"
              value={paymentStatus}
              disabled={patchMutation.isPending}
              onChange={(e) => {
                const v = e.target.value as 'unpaid' | 'partial' | 'paid';
                if (v === paymentStatus) return;
                patchMutation.mutate({ paymentStatus: v });
              }}
            >
              <option value="unpaid">{t('paymentUnpaid')}</option>
              <option value="partial">{t('paymentPartial')}</option>
              <option value="paid">{t('paymentPaid')}</option>
            </Select>
          </div>
        )}
      </div>

      <Separator />
      <div className="space-y-3 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detailGuestSection')}</p>
        {!hasGuestRows ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {reservation.fromOta ? t('contactsNotFromChannel') : t('contactsNotSpecified')}
          </p>
        ) : null}
        <InlineGuestContactFields reservation={reservation} patchMutation={patchMutation} />
      </div>

      {reservation.notes?.trim() ? (
        <>
          <Separator />
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {t('detailNotes')}
            </p>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2 dark:bg-muted/30">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{reservation.notes.trim()}</p>
            </div>
          </div>
        </>
      ) : null}

      <Separator />
      <div className="space-y-2">
        <Label htmlFor={`mgr-notes-${reservation.uuid}`} className="text-xs font-medium text-muted-foreground">
          {t('managerNotesLabel')}
        </Label>
        <div className="relative">
          <Textarea
            id={`mgr-notes-${reservation.uuid}`}
            placeholder={t('managerNotesPlaceholder')}
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={() => saveInternalNotes()}
            rows={3}
            className="resize-y text-sm"
            disabled={patchMutation.isPending}
          />
          {patchMutation.isPending ? (
            <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
      </div>

      <Separator />
      <div className="space-y-2 text-xs text-muted-foreground">
        {reservation.fromOta && reservation.externalId !== reservation.uuid ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0">{t('detailChannelRef')}:</span>
            <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono">{reservation.externalId}</code>
            <button
              type="button"
              className="shrink-0 rounded p-1 hover:bg-muted"
              aria-label={t('copyId')}
              onClick={() => {
                void navigator.clipboard.writeText(reservation.externalId);
                onCopy();
              }}
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="shrink-0">{t('detailRentAiId')}:</span>
          <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono">{reservation.uuid}</code>
          <button
            type="button"
            className="shrink-0 rounded p-1 hover:bg-muted"
            aria-label={t('copyId')}
            onClick={() => {
              void navigator.clipboard.writeText(reservation.uuid);
              onCopy();
            }}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

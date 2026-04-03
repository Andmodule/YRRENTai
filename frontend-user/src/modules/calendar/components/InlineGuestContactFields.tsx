'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { Loader2, Mail, Phone, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Reservation } from '../types';

const inputClass =
  'h-9 border-transparent bg-muted/40 px-2.5 text-sm shadow-none transition-colors placeholder:text-muted-foreground/70 hover:bg-muted/60 focus-visible:border-border focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring';

type FieldKey = 'email' | 'phone' | 'guests';

function isValidEmail(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function InlineGuestContactFields({
  reservation,
  patchMutation,
}: {
  reservation: Reservation;
  patchMutation: UseMutationResult<unknown, Error, Record<string, unknown>, unknown>;
}) {
  const t = useTranslations('calendar');
  const [email, setEmail] = useState(reservation.guestEmail ?? '');
  const [phone, setPhone] = useState(reservation.guestPhone ?? '');
  const [guests, setGuests] = useState(() => guestDraftFromReservation(reservation));
  const [saving, setSaving] = useState<FieldKey | null>(null);

  useEffect(() => {
    setEmail(reservation.guestEmail ?? '');
    setPhone(reservation.guestPhone ?? '');
    setGuests(guestDraftFromReservation(reservation));
  }, [
    reservation.uuid,
    reservation.guestEmail,
    reservation.guestPhone,
    reservation.guestsCount,
    reservation.guestsAdults,
    reservation.guestsChildren,
  ]);

  const runPatch = useCallback(
    (body: Record<string, unknown>, field: FieldKey) => {
      setSaving(field);
      patchMutation.mutate(body, {
        onSettled: () => setSaving(null),
      });
    },
    [patchMutation],
  );

  const commitEmail = useCallback(() => {
    const next = email.trim();
    const prev = (reservation.guestEmail ?? '').trim();
    if (next === prev) return;
    if (!isValidEmail(next)) {
      toast.error(t('contactEmailInvalid'));
      setEmail(prev);
      return;
    }
    runPatch({ guestEmail: next.length > 0 ? next : null }, 'email');
  }, [email, reservation.guestEmail, runPatch, t]);

  const commitPhone = useCallback(() => {
    const next = phone.trim();
    const prev = (reservation.guestPhone ?? '').trim();
    if (next === prev) return;
    runPatch({ guestPhone: next.length > 0 ? next : null }, 'phone');
  }, [phone, reservation.guestPhone, runPatch]);

  const commitGuests = useCallback(() => {
    const raw = guests.trim();
    const prevCount = reservation.guestsCount;
    const prevFromBreakdown =
      reservation.guestsAdults != null && reservation.guestsChildren != null
        ? reservation.guestsAdults + reservation.guestsChildren
        : null;
    const prev = prevCount != null && prevCount > 0 ? prevCount : prevFromBreakdown;

    if (raw === '') {
      if (prev == null || prev === undefined) return;
      runPatch({ guestsCount: null }, 'guests');
      return;
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > 100) {
      toast.error(t('contactGuestsInvalid'));
      setGuests(prev != null ? String(prev) : '');
      return;
    }
    if (prev === n) return;
    runPatch({ guestsCount: n }, 'guests');
  }, [guests, reservation.guestsAdults, reservation.guestsChildren, reservation.guestsCount, runPatch, t]);

  const hasBreakdown =
    reservation.guestsAdults != null && reservation.guestsChildren != null;
  const pending = patchMutation.isPending;

  return (
    <div className="space-y-2.5">
      <ContactRow icon={Mail} label={t('detailEmail')} saving={saving === 'email'} pending={pending}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t('contactPlaceholderEmail')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={commitEmail}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disabled={pending}
          className={cn(inputClass, 'min-w-0 flex-1')}
          aria-label={t('detailEmail')}
        />
      </ContactRow>

      <ContactRow icon={Phone} label={t('detailPhone')} saving={saving === 'phone'} pending={pending}>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t('contactPlaceholderPhone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={commitPhone}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disabled={pending}
          className={cn(inputClass, 'min-w-0 flex-1')}
          aria-label={t('detailPhone')}
        />
      </ContactRow>

      <div>
        <ContactRow icon={Users} label={t('detailGuests')} saving={saving === 'guests'} pending={pending}>
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t('contactPlaceholderGuests')}
            value={guests}
            onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
            onBlur={commitGuests}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            disabled={pending}
            className={cn(inputClass, 'w-full max-w-[120px] sm:max-w-[140px]')}
            aria-label={t('detailGuests')}
          />
        </ContactRow>
        {hasBreakdown ? (
          <p className="mt-1 ml-1 text-[11px] leading-snug text-muted-foreground sm:ml-8">
            {t('contactChannelBreakdown', {
              adults: reservation.guestsAdults ?? 0,
              children: reservation.guestsChildren ?? 0,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function guestDraftFromReservation(r: Reservation): string {
  if (r.guestsCount != null && r.guestsCount > 0) return String(r.guestsCount);
  if (r.guestsAdults != null && r.guestsChildren != null) {
    return String(r.guestsAdults + r.guestsChildren);
  }
  return '';
}

function ContactRow({
  icon: Icon,
  label,
  children,
  saving,
  pending,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  saving: boolean;
  pending: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-transparent px-1 py-0.5 transition-colors',
        !pending && 'hover:border-border/60 hover:bg-muted/20',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
      <span className="w-[4.5rem] shrink-0 text-xs text-muted-foreground sm:w-[5.25rem]">
        {label}
        {':'}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {children}
        {saving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>
    </div>
  );
}

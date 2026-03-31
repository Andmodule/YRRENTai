'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AlertTriangle, Package } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/hooks/useDateLocale';
import { usePatchIncident, type Incident } from '../hooks/useIncidents';

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

interface IncidentDetailDrawerProps {
  incident: Incident | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IncidentDetailDrawer({ incident, open, onOpenChange }: IncidentDetailDrawerProps) {
  const t = useTranslations('tasks.kanban.incidentDetail');
  const tCard = useTranslations('tasks.kanban.incidentCard');
  const dateLocale = useDateLocale();
  const { mutate: patch, isPending } = usePatchIncident();
  const [managerNote, setManagerNote] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');

  useEffect(() => {
    if (incident && open) {
      setManagerNote(incident.managerNote ?? '');
      setEstimatedCost(incident.estimatedCost ?? '');
    }
  }, [incident, open]);

  if (!incident) {
    return null;
  }

  const isDamage = incident.type === 'damage';
  const isLostItem = incident.type === 'lost_item';
  const created = format(new Date(incident.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru });
  const canAct = incident.status === 'open' || incident.status === 'in_review';

  const lastPhone = incident.lastStayGuestPhone?.trim();
  const lastPhoneDigits = lastPhone ? phoneDigits(lastPhone) : '';
  const telHref = lastPhone ? `tel:${lastPhone.replace(/\s/g, '')}` : '';

  const saveMeta = () => {
    if (isLostItem) {
      patch({
        uuid: incident.uuid,
        managerNote: managerNote.trim() || null,
      });
      return;
    }
    patch({
      uuid: incident.uuid,
      managerNote: managerNote.trim() || null,
      estimatedCost: estimatedCost.trim() || null,
    });
  };

  const incidentStatusLabel = (s: Incident['status']) => {
    switch (s) {
      case 'open':
        return tCard('statusOpen');
      case 'in_review':
        return tCard('statusReview');
      case 'resolved':
        return tCard('statusResolved');
      case 'closed':
        return tCard('statusClosed');
      default:
        return s;
    }
  };

  const patchStatus = (status: Incident['status']) => {
    patch(
      { uuid: incident.uuid, status },
      {
        onSuccess: (updated) => {
          if (updated.status === 'resolved' || updated.status === 'closed') {
            onOpenChange(false);
          }
        },
      },
    );
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent title={incident.propertyTitle} description={t('subtitle')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
                isDamage ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-secondary-foreground',
              )}
            >
              {isDamage ? <AlertTriangle className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
              {isDamage ? t('typeDamage') : t('typeLost')}
            </span>
            <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
              {incidentStatusLabel(incident.status)}
            </span>
          </div>

          <p className="text-sm text-muted-foreground">{created}</p>

          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="whitespace-pre-wrap">{incident.description}</p>
          </div>

          {(incident.guestName || incident.itemDescription || incident.damageLocation) && (
            <dl className="grid gap-2 text-sm">
              {incident.guestName ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('guest')}</dt>
                  <dd>{incident.guestName}</dd>
                </div>
              ) : null}
              {incident.itemDescription ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('item')}</dt>
                  <dd>{incident.itemDescription}</dd>
                </div>
              ) : null}
              {incident.damageLocation ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('location')}</dt>
                  <dd>{incident.damageLocation}</dd>
                </div>
              ) : null}
            </dl>
          )}

          {incident.reporterName ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('reporter')}</span> {incident.reporterName}
            </p>
          ) : null}

          <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('lastStayTitle')}</p>
            {incident.lastStayGuestName || lastPhone || incident.lastStayCheckOut ? (
              <div className="mt-2 space-y-2 text-sm">
                {incident.lastStayGuestName ? (
                  <p>
                    <span className="text-muted-foreground">{t('lastStayGuest')}</span>{' '}
                    <span className="font-medium text-foreground">{incident.lastStayGuestName}</span>
                  </p>
                ) : null}
                {incident.lastStayCheckOut ? (
                  <p className="text-muted-foreground">
                    {t('lastStayCheckOutLabel')}{' '}
                    {format(new Date(incident.lastStayCheckOut), 'd MMMM yyyy', { locale: dateLocale })}
                  </p>
                ) : null}
                {lastPhoneDigits && telHref ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" variant="secondary" size="sm" asChild>
                      <a href={telHref}>{t('contactCall')}</a>
                    </Button>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a
                        href={`https://wa.me/${lastPhoneDigits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('contactWhatsApp')}
                      </a>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('lastStayEmpty')}</p>
            )}
          </div>

          {incident.photoUrls?.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('photos')}</p>
              <div className="flex flex-wrap gap-2">
                {incident.photoUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-md border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-24 w-24 object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="incident-note">{t('managerNote')}</Label>
            <Textarea
              id="incident-note"
              value={managerNote}
              onChange={(e) => setManagerNote(e.target.value)}
              rows={3}
              placeholder={t('managerNotePlaceholder')}
            />
          </div>

          {!isLostItem && (
            <div className="space-y-2">
              <Label htmlFor="incident-cost">{t('estimatedCost')}</Label>
              <Input
                id="incident-cost"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder={t('estimatedCostPlaceholder')}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => saveMeta()} disabled={isPending}>
              {isLostItem ? t('saveMetaNoteOnly') : t('saveMeta')}
            </Button>
          </div>

          {canAct && (
            <div className="space-y-2 border-t pt-4">
              {incident.status === 'open' && (
                <p className="text-xs leading-relaxed text-muted-foreground">{t('takeInWorkHint')}</p>
              )}
              <div className="flex flex-wrap gap-2">
              {incident.status === 'open' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  className="border border-border/70 bg-muted/50 font-medium text-foreground shadow-none hover:bg-muted/70"
                  onClick={() => patchStatus('in_review')}
                >
                  {t('takeInWork')}
                </Button>
              )}
              {(incident.status === 'open' || incident.status === 'in_review') && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => patchStatus('resolved')}
                  >
                    {t('markResolved')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => patchStatus('closed')}
                  >
                    {t('markClosed')}
                  </Button>
                </>
              )}
              </div>
            </div>
          )}

          <ResponsiveModalClose asChild>
            <Button type="button" variant="ghost" className="w-full">
              {t('closePanel')}
            </Button>
          </ResponsiveModalClose>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

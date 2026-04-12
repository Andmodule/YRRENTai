'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { format, type Locale } from 'date-fns';
import { de, enUS, es, pl, ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { AlertCircle, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ManagerSupplyMatrixView } from './ManagerSupplyMatrixView';
import { ManagerDeliveryRoutesView } from './ManagerDeliveryRoutesView';
import { ManagerSupplyCatalogModal } from './ManagerSupplyCatalogModal';
import {
  usePendingSupplyInterpretations,
  useResolveSupplyInterpretation,
  useRetrySupplyInterpretationLlm,
} from '../../hooks/usePendingSupplyInterpretations';
import type { PendingSupplyInterpretationEvent } from '../../types';
import {
  TASK_DETAIL_URL_QUERY,
  TASK_INCIDENT_URL_QUERY,
  TASK_MANAGER_PANEL_QUERY,
  TASK_MANAGER_SUPPLY_EVENT_QUERY,
} from '../../task-url-params';
import { ManagerSupplyCreateSheet } from './ManagerSupplyCreateSheet';

const DATE_LOCALES: Record<string, Locale> = {
  en: enUS,
  de,
  es,
  pl,
  ru,
};

type EnrichedSupplyEvent = PendingSupplyInterpretationEvent & { when: string };

function InterpretationQueueCard({
  e,
  highlighted,
  t,
  cardBusy,
  resolveWithToast,
  retryWithToast,
  openTarget,
}: {
  e: EnrichedSupplyEvent;
  highlighted: boolean;
  t: ReturnType<typeof useTranslations>;
  cardBusy: (id: string) => boolean;
  resolveWithToast: (eventId: string, action: 'acknowledge' | 'dismiss') => void;
  retryWithToast: (eventId: string) => void;
  openTarget: (e: PendingSupplyInterpretationEvent) => void;
}) {
  const isProcessing =
    e.workflowState === 'pending_llm' || e.llmStatus === 'processing';
  return (
    <li
      id={`supply-event-${e.id}`}
      className={cn(
        'rounded-xl border border-border/60 bg-card p-3 shadow-sm dark:border-border/50',
        highlighted && 'ring-2 ring-[#008CA4]/35 dark:ring-[#00d4ff]/30',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{e.propertyTitle}</p>
            {isProcessing ? (
              <Badge
                variant="secondary"
                className="shrink-0 gap-1 border-[#008CA4]/40 bg-[#008CA4]/10 text-[10px] font-semibold text-[#006b7d] dark:border-[#00d4ff]/35 dark:bg-[#00d4ff]/12 dark:text-[#a5f3fc]"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t('badgeLlmProcessing')}
              </Badge>
            ) : null}
            {e.workflowState === 'manual_review' && (
              <Badge variant="destructive" className="shrink-0 text-[10px] font-semibold">
                {t('badgeManualReview')}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {e.authorName || '—'} · {e.when}
          </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {e.entryPoint === 'task_create'
              ? t('entryTaskCreate')
              : e.entryPoint === 'history_supplement'
                ? t('entryHistory')
                : e.entryPoint === 'voice_task_report'
                  ? t('entryVoiceTaskReport')
                  : e.entryPoint === 'manager_supply_create'
                    ? t('entryManagerSupplyCreate')
                    : e.entryPoint}
            </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          disabled={cardBusy(e.id)}
          onClick={() => openTarget(e)}
        >
          {e.targetType === 'incident'
            ? t('openIncident')
            : e.targetType === 'property'
              ? t('openProperty')
              : t('openTask')}
          <ExternalLink className="h-3 w-3 opacity-70" />
        </Button>
      </div>
      <blockquote className="mt-2 border-l-2 border-[#008CA4]/40 pl-2 text-sm text-foreground/90">
        {e.textRaw}
      </blockquote>
      {e.workflowState === 'manual_review' && e.llmError && (
        <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {t('llmErrorPrefix')} {e.llmError}
        </p>
      )}
      {e.items.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t('itemsHeading')}</p>
          <ul className="flex flex-wrap gap-1.5" role="list">
            {e.items.map((it) => (
              <li
                key={it.id}
                className="rounded-md bg-muted/80 px-2 py-0.5 text-xs text-foreground"
              >
                {it.name}
                {(it.quantity ?? it.unit) && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {[it.quantity, it.unit].filter(Boolean).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3">
        {e.workflowState === 'manual_review' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cardBusy(e.id) || isProcessing}
            onClick={() => retryWithToast(e.id)}
          >
            {t('retryLlm')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="bg-[#008CA4] text-white hover:bg-[#007a90] dark:bg-[#00a8c4] dark:hover:bg-[#0090a8]"
          disabled={cardBusy(e.id) || isProcessing}
          onClick={() => resolveWithToast(e.id, 'acknowledge')}
        >
          {t('acknowledge')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cardBusy(e.id) || isProcessing}
          onClick={() => resolveWithToast(e.id, 'dismiss')}
        >
          {t('dismiss')}
        </Button>
      </div>
    </li>
  );
}

export function ManagerSupplyPanel({
  onFocusPropertyByTitle,
}: {
  /** When opening a property-scoped interpretation, switch to the task list and narrow search by title. */
  onFocusPropertyByTitle?: (propertyTitle: string) => void;
} = {}) {
  const [supplyView, setSupplyView] = useState<'matrix' | 'feed' | 'routes'>('matrix');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [createSupplyOpen, setCreateSupplyOpen] = useState(false);
  const queryClient = useQueryClient();
  const t = useTranslations('tasks.managerSupply');
  const tCreate = useTranslations('tasks.managerSupply.supplyCreate');
  const locale = useLocale();
  const dateLocale = DATE_LOCALES[locale] ?? enUS;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: events, isLoading, isError, refetch, isFetching } =
    usePendingSupplyInterpretations();
  const { mutate: resolveEvent, isPending: isResolving, variables: resolveVars } =
    useResolveSupplyInterpretation();
  const { mutate: retryLlm, isPending: isRetrying, variables: retryEventId } =
    useRetrySupplyInterpretationLlm();

  const resolveWithToast = (eventId: string, action: 'acknowledge' | 'dismiss') => {
    resolveEvent(
      { eventId, action },
      {
        onError: () => toast.error(t('resolveError')),
      },
    );
  };

  const cardBusy = (id: string) =>
    (isResolving && resolveVars?.eventId === id) || (isRetrying && retryEventId === id);

  const retryWithToast = (eventId: string) => {
    retryLlm(eventId, {
      onSuccess: () => toast.success(t('retryLlmStarted')),
      onError: () => toast.error(t('retryLlmError')),
    });
  };

  const focusSupplyEventId = searchParams.get(TASK_MANAGER_SUPPLY_EVENT_QUERY);

  const enriched = useMemo((): EnrichedSupplyEvent[] => {
    if (!events?.length) return [];
    return events.map((e) => ({
      ...e,
      when: (() => {
        try {
          return format(new Date(e.createdAt), 'PPp', { locale: dateLocale });
        } catch {
          return e.createdAt;
        }
      })(),
    }));
  }, [events, dateLocale]);

  const supplyQueue = useMemo(
    () => enriched.filter((e) => e.managerBucket === 'supply'),
    [enriched],
  );
  const hasIncidentBucketOnly = useMemo(
    () => enriched.length > 0 && supplyQueue.length === 0,
    [enriched.length, supplyQueue.length],
  );

  useEffect(() => {
    if (!focusSupplyEventId || !enriched.length) return;
    const el = document.getElementById(`supply-event-${focusSupplyEventId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusSupplyEventId, enriched]);

  const openTarget = (e: PendingSupplyInterpretationEvent) => {
    const params = new URLSearchParams(searchParams.toString());
    if (e.targetType === 'incident') {
      params.delete(TASK_DETAIL_URL_QUERY);
      params.set(TASK_INCIDENT_URL_QUERY, e.targetId);
    } else if (e.targetType === 'property') {
      params.delete(TASK_INCIDENT_URL_QUERY);
      params.delete(TASK_DETAIL_URL_QUERY);
      params.delete(TASK_MANAGER_SUPPLY_EVENT_QUERY);
      params.delete(TASK_MANAGER_PANEL_QUERY);
      router.push(`${pathname}?${params.toString()}`);
      const title = (e.propertyTitle ?? '').trim();
      if (title) onFocusPropertyByTitle?.(title);
      return;
    } else {
      params.delete(TASK_INCIDENT_URL_QUERY);
      params.set(TASK_DETAIL_URL_QUERY, e.targetId);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  if (supplyView === 'feed' && isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1">
        <Skeleton className="h-10 w-full max-w-md shrink-0 rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  if (supplyView === 'feed' && isError) {
    return (
      <div className="shrink-0 px-4 pb-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <ManagerSupplyCreateSheet open={createSupplyOpen} onOpenChange={setCreateSupplyOpen} />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div
            className="flex gap-1 rounded-full border border-border/50 bg-muted/30 p-0.5 dark:bg-muted/20"
            role="tablist"
            aria-label={t('supplySubViewAria')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={supplyView === 'matrix'}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                supplyView === 'matrix'
                  ? 'bg-[#E0F2F5] text-[#008CA4] shadow-sm dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc]'
                  : 'text-muted-foreground',
              )}
              onClick={() => setSupplyView('matrix')}
            >
              {t('matrixTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={supplyView === 'routes'}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                supplyView === 'routes'
                  ? 'bg-[#E0F2F5] text-[#008CA4] shadow-sm dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc]'
                  : 'text-muted-foreground',
              )}
              onClick={() => setSupplyView('routes')}
            >
              {t('routesTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={supplyView === 'feed'}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                supplyView === 'feed'
                  ? 'bg-[#E0F2F5] text-[#008CA4] shadow-sm dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc]'
                  : 'text-muted-foreground',
              )}
              onClick={() => setSupplyView('feed')}
            >
              {t('feedTab')}
            </button>
          </div>
          <button
            type="button"
            className={cn(
              'max-w-[min(100vw-8rem,16rem)] truncate rounded-full px-3 py-1 text-left text-xs font-medium transition-colors sm:max-w-none',
              catalogOpen
                ? 'bg-[#E0F2F5] text-[#008CA4] shadow-sm dark:bg-[#00d4ff]/14 dark:text-[#a5f3fc]'
                : 'text-muted-foreground',
            )}
            aria-expanded={catalogOpen}
            aria-haspopup="dialog"
            onClick={() => setCatalogOpen(true)}
          >
            {t('catalogPreviewTitle')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            className="gap-1.5 bg-[#008CA4] text-white hover:bg-[#007a90] dark:bg-[#00a8c4] dark:hover:bg-[#0090a8]"
            onClick={() => setCreateSupplyOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {tCreate('triggerButton')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              void refetch();
              void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix'] });
              void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-delivery-routes'] });
            }}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      <ManagerSupplyCatalogModal open={catalogOpen} onOpenChange={setCatalogOpen} />

      {supplyView === 'matrix' ? (
        <ManagerSupplyMatrixView />
      ) : supplyView === 'routes' ? (
        <ManagerDeliveryRoutesView />
      ) : enriched.length === 0 ? (
        <p className="mx-4 rounded-lg border border-dashed border-border/40 bg-muted/15 px-3 py-8 text-center text-sm text-muted-foreground md:rounded-xl md:px-4 md:py-10">
          {t('empty')}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 pb-4 [-webkit-overflow-scrolling:touch]">
          {hasIncidentBucketOnly ? (
            <p className="rounded-lg border border-dashed border-border/50 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              {t('incidentAlertsInTaskListHint')}
            </p>
          ) : null}
          {supplyQueue.length > 0 ? (
            <ul className="space-y-3" role="list">
              {supplyQueue.map((e) => (
                <InterpretationQueueCard
                  key={e.id}
                  e={e}
                  highlighted={focusSupplyEventId === e.id}
                  t={t}
                  cardBusy={cardBusy}
                  resolveWithToast={resolveWithToast}
                  retryWithToast={retryWithToast}
                  openTarget={openTarget}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

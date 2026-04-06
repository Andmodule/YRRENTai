'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';
import {
  useKbPending,
  kbBulkAdd,
  kbPatchPending,
  kbIgnore,
  type KbPendingItem,
} from '@/hooks/use-kb-pending';
import { KbImprovementCard } from '@/components/knowledge-base/kb-improvement-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS = 30;
const LIMIT = 200;

export default function KbImprovementPage() {
  const t = useTranslations('kbImprovement');
  const tKb = useTranslations('kb');
  const { items, total, isLoading, mutate } = useKbPending(DAYS, LIMIT);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const itemsKey = useMemo(() => items.map((i) => i.id).join('|'), [items]);

  useEffect(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  }, [itemsKey]);

  const selectedCount = items.filter((i) => selectedIds.has(i.id)).length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  }, [items]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const removeFromCache = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      mutate(
        (current) => {
          if (!current) return current;
          const nextItems = current.items.filter((i) => !idSet.has(i.id));
          const removed = current.items.length - nextItems.length;
          return {
            ...current,
            items: nextItems,
            total: Math.max(0, current.total - removed),
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const persistItem = useCallback(
    async (item: KbPendingItem, payload: { guestQuestion: string; managerAnswer: string }) => {
      const updated = await kbPatchPending(item.id, payload);
      await mutate(
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((i) => (i.id === item.id ? updated : i)),
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const handleIgnore = async (id: string) => {
    removeFromCache([id]);
    try {
      await kbIgnore(id);
    } catch {
      toast.error(t('ignoreError'));
      await mutate();
    }
  };

  const handleBulkAdd = async () => {
    const ids = items.filter((i) => selectedIds.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    removeFromCache(ids);
    try {
      const { added } = await kbBulkAdd(ids);
      if (added === 0) {
        await mutate();
        toast.error(t('addError'));
        return;
      }
      toast.success(t('addSuccess', { count: added }));
    } catch {
      toast.error(t('addError'));
      await mutate();
    }
  };

  const handleBulkIgnore = async () => {
    const ids = items.filter((i) => selectedIds.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    removeFromCache(ids);
    try {
      await Promise.all(ids.map((id) => kbIgnore(id)));
      toast.success(t('bulkIgnoreSuccess', { count: ids.length }));
    } catch {
      toast.error(t('ignoreError'));
      await mutate();
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:pb-28 2xl:max-w-[min(100%,96rem)]">
      <p className="text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{t('subtitle')}</p>

      <div className="flex border-b border-border/80">
        <div className="flex min-h-[44px] items-center gap-2 border-b-2 border-foreground/80 px-0.5 pb-2 text-sm font-medium text-foreground">
          {t('queueTab')}
          {total > 0 && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/80 py-12 text-center">
          <BookOpen className="mx-auto h-9 w-9 text-muted-foreground/35" strokeWidth={1.25} />
          <p className="mt-3 text-sm text-foreground">{t('noEscalations')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('noEscalationsHint')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex shrink-0 items-center rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 text-xs text-foreground/90">
              {tKb('filterAll')} <span className="ml-1 tabular-nums">{items.length}</span>
            </span>
            <button
              type="button"
              onClick={() => (allSelected ? deselectAll() : selectAll())}
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {allSelected ? t('deselectAll') : t('selectAll')}
            </button>
          </div>

          <div
            className="hidden gap-3 border-b border-border/60 px-3 pb-2 pt-0.5 text-[11px] font-medium text-muted-foreground sm:flex sm:px-4 sm:pr-11"
            role="row"
          >
            <span className="w-[18px] shrink-0" aria-hidden />
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              <div className="min-w-0">{t('guestQuestion')}</div>
              <div className="min-w-0">{t('answerForAi')}</div>
            </div>
          </div>

          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <KbImprovementCard
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggle={() => toggle(item.id)}
                    onIgnore={() => handleIgnore(item.id)}
                    onPersist={(payload) => persistItem(item, payload)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {selectedCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="pointer-events-auto flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-border/80 bg-background/95 p-3 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-background/85 sm:max-w-7xl sm:flex-row sm:items-center sm:justify-between sm:p-4 2xl:max-w-[min(100%,96rem)]">
            <p className="text-center text-sm text-muted-foreground sm:text-left">{t('selectedCount', { count: selectedCount })}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={handleBulkIgnore}>
                {t('deleteSelected')}
              </Button>
              <Button type="button" className="h-11 sm:h-9" onClick={handleBulkAdd}>
                {t('addSelectedToKb')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, BookOpen } from 'lucide-react';
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
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-foreground/80">
            <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="flex border-b border-border/80">
        <div className="flex items-center gap-2 border-b-2 border-foreground/80 px-0.5 pb-2 text-sm font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-70" />
          {t('queueTab')}
          {total > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-md" />
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

          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
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
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 dark:bg-background/95 lg:left-56">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t('selectedCount', { count: selectedCount })}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleBulkIgnore}>
                {t('deleteSelected')}
              </Button>
              <Button type="button" size="sm" onClick={handleBulkAdd}>
                {t('addSelectedToKb')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

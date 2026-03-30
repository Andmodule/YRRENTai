'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, BookOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { KbCard } from './kb-card';
import { KbDraftCard } from './kb-draft-card';
import { Skeleton } from '@/components/ui/skeleton';
import { KB_CATEGORIES, CATEGORY_ICONS, CATEGORY_STYLES } from './kb-category-badge';
import { ExpandableCategoryChips } from './expandable-category-chips';
import type { KbEntry, KbCategory } from '@/types';

interface KbBoardProps {
  entries: KbEntry[];
  isLoading: boolean;
  onCreate: (data: { title: string; content: string; category: string }) => Promise<unknown>;
  onUpdate: (id: string, data: { title?: string; content?: string; category?: string }) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
}

type Filter = KbCategory | 'all';

const FIRST_CATEGORY = KB_CATEGORIES[0]!;

export function KbBoard({ entries, isLoading, onCreate, onUpdate, onDelete }: KbBoardProps) {
  const t = useTranslations('kb');
  const tCat = useTranslations('kb.categories');

  const [openDrafts, setOpenDrafts] = useState<Partial<Record<KbCategory, boolean>>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const autoDraftOpenedRef = useRef(false);

  useEffect(() => {
    if (entries.length > 0) {
      autoDraftOpenedRef.current = false;
    }
  }, [entries.length]);

  useEffect(() => {
    if (isLoading || entries.length > 0) return;
    if (autoDraftOpenedRef.current) return;
    setOpenDrafts({ [FIRST_CATEGORY]: true });
    autoDraftOpenedRef.current = true;
  }, [isLoading, entries.length]);

  function openDraft(cat: KbCategory) {
    setOpenDrafts((prev) => ({ ...prev, [cat]: true }));
    if (filter !== 'all' && filter !== cat) setFilter('all');
  }

  function closeDraft(cat: KbCategory) {
    setOpenDrafts((prev) => ({ ...prev, [cat]: false }));
  }

  async function handleCreate(cat: KbCategory, data: { title: string; content: string; category: string }) {
    await onCreate({ ...data, category: cat });
    closeDraft(cat);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const grouped: Partial<Record<KbCategory, KbEntry[]>> = {};
  for (const entry of entries) {
    const cat = (entry.category ?? 'other') as KbCategory;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(entry);
  }

  const hasAnyDraft = Object.values(openDrafts).some(Boolean);
  const emptyKbNoDraft = entries.length === 0 && !hasAnyDraft;

  const populatedCategories = KB_CATEGORIES.filter(
    (c) => (grouped[c]?.length ?? 0) > 0 || openDrafts[c],
  );
  const emptyCategories = KB_CATEGORIES.filter(
    (c) => !(grouped[c]?.length) && !openDrafts[c],
  );

  const sectionsToShow: KbCategory[] =
    filter === 'all' ? populatedCategories : [filter];

  return (
    <div className="space-y-5">
      {entries.length === 0 && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm">
          <p className="text-sm font-semibold">{t('checklistTitle')}</p>
          <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">
            <li>{t('checklist.wifi')}</li>
            <li>{t('checklist.checkin')}</li>
            <li>{t('checklist.rules')}</li>
          </ul>
        </div>
      )}

      {emptyKbNoDraft && (
        <div className="rounded-xl border-2 border-dashed py-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('emptyDescription')}</p>
          <p className="mt-5 text-xs font-medium text-muted-foreground">{t('pickCategory')}</p>
          <div className="mt-3 px-2">
            <ExpandableCategoryChips
              categories={KB_CATEGORIES}
              onSelect={openDraft}
              variant="filled"
            />
          </div>
        </div>
      )}

      {!emptyKbNoDraft && (
        <>
          {entries.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/60',
                )}
              >
                {t('filterAll')} {entries.length}
              </button>
              {populatedCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilter(cat)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === cat
                      ? (CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other) + ' ring-1 ring-current'
                      : 'bg-muted text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <span>{CATEGORY_ICONS[cat]}</span>
                  <span>{grouped[cat]?.length ?? 0}</span>
                </button>
              ))}
            </div>
          )}

          {sectionsToShow.map((cat) => {
            const catEntries = grouped[cat] ?? [];
            const hasDraft = openDrafts[cat] ?? false;

            return (
              <div key={cat}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other,
                      )}
                    >
                      <span>{CATEGORY_ICONS[cat]}</span>
                      <span>{tCat(cat)}</span>
                    </span>
                    {catEntries.length > 0 && (
                      <span className="text-xs text-muted-foreground">{catEntries.length}</span>
                    )}
                  </div>
                  {!hasDraft && (
                    <button
                      type="button"
                      onClick={() => openDraft(cat)}
                      title={t('addToCategory')}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {catEntries.map((entry) => (
                    <KbCard
                      key={entry.id}
                      entry={entry}
                      onUpdate={(data) => onUpdate(entry.id, data)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  ))}
                  {hasDraft && (
                    <KbDraftCard
                      defaultCategory={cat}
                      onCreate={(data) => handleCreate(cat, data)}
                      onDiscard={() => closeDraft(cat)}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {emptyCategories.length > 0 && (
            <div className="pt-1">
              <ExpandableCategoryChips
                categories={emptyCategories}
                onSelect={openDraft}
                variant="dashed"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

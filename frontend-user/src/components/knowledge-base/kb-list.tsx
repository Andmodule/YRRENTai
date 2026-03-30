'use client';

import { useTranslations } from 'next-intl';
import { BookOpen } from 'lucide-react';
import { KbCategoryBadge, KB_CATEGORIES } from './kb-category-badge';
import { EditKbEntryDialog, DeleteKbEntryDialog } from './kb-entry-dialogs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { CreateKbEntryDialog } from './kb-entry-dialogs';
import type { KbEntry, KbCategory } from '@/types';

interface KbListProps {
  entries: KbEntry[];
  isLoading: boolean;
  onCreate: (data: { title: string; content: string; category: string }) => Promise<unknown>;
  onUpdate: (id: string, data: { title?: string; content?: string; category?: string }) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
}

export function KbList({ entries, isLoading, onCreate, onUpdate, onDelete }: KbListProps) {
  const t = useTranslations('kb');

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-12 w-12" />}
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={<CreateKbEntryDialog onCreate={onCreate} />}
      />
    );
  }

  const grouped: Partial<Record<KbCategory, KbEntry[]>> = {};
  for (const entry of entries) {
    const cat = (entry.category ?? 'other') as KbCategory;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(entry);
  }

  const orderedCategories = KB_CATEGORIES.filter((cat) => grouped[cat]?.length);

  return (
    <div className="space-y-6">
      {orderedCategories.map((cat) => (
        <div key={cat}>
          <div className="mb-2 flex items-center gap-2">
            <KbCategoryBadge category={cat} />
            <span className="text-xs text-muted-foreground">
              {grouped[cat]!.length}
            </span>
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {grouped[cat]!.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {entry.content}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <EditKbEntryDialog
                    entry={entry}
                    onUpdate={(data) => onUpdate(entry.id, data)}
                  />
                  <DeleteKbEntryDialog
                    entryTitle={entry.title}
                    onDelete={() => onDelete(entry.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

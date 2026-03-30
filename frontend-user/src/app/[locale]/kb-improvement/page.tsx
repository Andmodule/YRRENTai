'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Sparkles, CheckSquare, Square, Pencil, BookOpen, Check, X } from 'lucide-react';
import { useProperties } from '@/hooks/use-properties';
import { useEscalations } from '@/hooks/use-escalations';
import { useKnowledgeBase } from '@/hooks/use-knowledge-base';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const DAYS = 30;

interface EntryState {
  id: string;
  guestQuestion: string;
  staffReply: string;
  editedReply: string;
  isEditing: boolean;
  selected: boolean;
}

export default function KbImprovementPage() {
  const t = useTranslations('kbImprovement');
  const { properties, isLoading: propertiesLoading } = useProperties();
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const { escalations, total, isLoading, mutate } = useEscalations(
    selectedPropertyId || null,
    DAYS,
  );
  const { createEntry } = useKnowledgeBase(selectedPropertyId || null);

  const [entries, setEntries] = useState<EntryState[]>([]);

  const escalationIds = escalations.map((e) => e.id).join(',');

  useEffect(() => {
    setEntries(
      escalations.map((e) => ({
        id: e.id,
        guestQuestion: e.guestQuestion,
        staffReply: e.staffReply,
        editedReply: e.staffReply,
        isEditing: false,
        selected: true,
      })),
    );
  }, [escalationIds]);

  // Rebuild entries whenever escalations change
  const syncedEntries: EntryState[] = escalations.map((e) => {
    const existing = entries.find((en) => en.id === e.id);
    return existing ?? {
      id: e.id,
      guestQuestion: e.guestQuestion,
      staffReply: e.staffReply,
      editedReply: e.staffReply,
      isEditing: false,
      selected: true,
    };
  });

  function toggle(id: string) {
    setEntries((prev) =>
      prev.length > 0
        ? prev.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e))
        : syncedEntries.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)),
    );
  }

  function startEdit(id: string) {
    setEntries((prev) =>
      (prev.length > 0 ? prev : syncedEntries).map((e) =>
        e.id === id ? { ...e, isEditing: true } : e,
      ),
    );
  }

  function cancelEdit(id: string) {
    setEntries((prev) =>
      (prev.length > 0 ? prev : syncedEntries).map((e) =>
        e.id === id ? { ...e, isEditing: false, editedReply: e.staffReply } : e,
      ),
    );
  }

  function saveEdit(id: string) {
    setEntries((prev) =>
      (prev.length > 0 ? prev : syncedEntries).map((e) =>
        e.id === id ? { ...e, isEditing: false } : e,
      ),
    );
  }

  function setEditedReply(id: string, value: string) {
    setEntries((prev) =>
      (prev.length > 0 ? prev : syncedEntries).map((e) =>
        e.id === id ? { ...e, editedReply: value } : e,
      ),
    );
  }

  const displayEntries = entries.length > 0 ? entries : syncedEntries;
  const selectedCount = displayEntries.filter((e) => e.selected).length;

  async function handleAddToKb() {
    const toAdd = displayEntries.filter((e) => e.selected);
    if (!toAdd.length || !selectedPropertyId) return;
    setIsSaving(true);
    try {
      for (const entry of toAdd) {
        await createEntry({
          title: entry.guestQuestion.slice(0, 80),
          content: entry.editedReply,
          category: 'other',
        });
      }
      toast.success(t('addSuccess', { count: toAdd.length }));
      setEntries([]);
      await mutate();
    } catch {
      toast.error(t('addError'));
    } finally {
      setIsSaving(false);
    }
  }

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">{t('title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {propertiesLoading ? (
          <Skeleton className="h-9 w-56" />
        ) : (
          <Select
            value={selectedPropertyId}
            onChange={(e) => {
              setSelectedPropertyId(e.target.value);
              setEntries([]);
            }}
            className="w-auto min-w-[220px]"
          >
            <option value="">{t('selectProperty')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}

        {selectedProperty && !isLoading && (
          <p className="text-sm text-muted-foreground">
            {t('statsLabel', { days: DAYS })}:{' '}
            <span className="font-semibold text-foreground">
              {t('statsCount', { count: total })}
            </span>
          </p>
        )}
      </div>

      {!selectedPropertyId ? (
        <EmptyState
          icon={<Sparkles className="h-10 w-10" />}
          title={t('noProperty')}
          description=""
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : displayEntries.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-10 w-10" />}
          title={t('noEscalations')}
          description={t('noEscalationsHint')}
        />
      ) : (
        <>
          <div className="space-y-3">
            {displayEntries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'rounded-lg border bg-card p-4 shadow-sm transition-opacity',
                  !entry.selected && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(entry.id)}
                    className="mt-0.5 shrink-0 text-primary"
                    aria-label={entry.selected ? 'Uncheck' : 'Check'}
                  >
                    {entry.selected ? (
                      <CheckSquare className="h-5 w-5" />
                    ) : (
                      <Square className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {t('guestQuestion')}
                      </p>
                      <p className="mt-1 text-sm">{entry.guestQuestion}</p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {t('staffReply')}
                        </p>
                        {!entry.isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(entry.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                            {t('editReply')}
                          </button>
                        )}
                      </div>

                      {entry.isEditing ? (
                        <div className="mt-1 space-y-2">
                          <Textarea
                            value={entry.editedReply}
                            onChange={(e) => setEditedReply(entry.id, e.target.value)}
                            rows={3}
                            className="text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(entry.id)}
                              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEdit(entry.id)}
                              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-foreground">{entry.editedReply}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-4 flex justify-end">
            <Button
              onClick={handleAddToKb}
              disabled={selectedCount === 0 || isSaving}
              className="shadow-md"
            >
              {t('addToKb', { count: selectedCount })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

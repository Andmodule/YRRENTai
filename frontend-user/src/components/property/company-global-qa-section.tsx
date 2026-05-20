'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CompanyGlobalQaEntry } from '@rentai/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const MAX_ENTRIES = 50;

function newEntry(): CompanyGlobalQaEntry {
  return {
    id: crypto.randomUUID(),
    question: '',
    answer: '',
  };
}

interface CompanyGlobalQaSectionProps {
  entries: CompanyGlobalQaEntry[];
  onChange: (entries: CompanyGlobalQaEntry[]) => void;
}

export function CompanyGlobalQaSection({ entries, onChange }: CompanyGlobalQaSectionProps) {
  const t = useTranslations('properties.globalRules.qa');

  function updateEntry(id: string, patch: Partial<Pick<CompanyGlobalQaEntry, 'question' | 'answer'>>) {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeEntry(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }

  function addEntry() {
    if (entries.length >= MAX_ENTRIES) return;
    onChange([...entries, newEntry()]);
  }

  const readyToSave = entries.filter((e) => e.question.trim() && e.answer.trim());

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t('sectionTitle')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('sectionHint')}</p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground/80">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="space-y-3 rounded-lg border border-border/50 bg-background/80 p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('itemLabel', { index: index + 1 })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeEntry(entry.id)}
                  aria-label={t('remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`qa-q-${entry.id}`}>{t('questionLabel')}</Label>
                <Input
                  id={`qa-q-${entry.id}`}
                  value={entry.question}
                  onChange={(e) => updateEntry(entry.id, { question: e.target.value })}
                  placeholder={t('questionPlaceholder')}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`qa-a-${entry.id}`}>{t('answerLabel')}</Label>
                <Textarea
                  id={`qa-a-${entry.id}`}
                  value={entry.answer}
                  onChange={(e) => updateEntry(entry.id, { answer: e.target.value })}
                  placeholder={t('answerPlaceholder')}
                  rows={3}
                  maxLength={3000}
                  className="resize-y min-h-[72px]"
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={addEntry}
          disabled={entries.length >= MAX_ENTRIES}
        >
          <Plus className="h-4 w-4" />
          {t('add')}
        </Button>
        {readyToSave.length > 0 && entries.length !== readyToSave.length ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">{t('incompleteHint')}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Entries with both question and answer — sent to API on save. */
export function sanitizeQaEntriesForSave(entries: CompanyGlobalQaEntry[]): CompanyGlobalQaEntry[] {
  return entries
    .map((e) => ({
      id: e.id,
      question: e.question.trim(),
      answer: e.answer.trim(),
    }))
    .filter((e) => e.question && e.answer)
    .slice(0, MAX_ENTRIES);
}

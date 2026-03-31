'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { KbCategoryBadge } from './kb-category-badge';
import type { KbCategory } from '@/types';

interface KbDraftCardProps {
  defaultCategory?: KbCategory;
  onCreate: (data: { title: string; content: string; category: string }) => Promise<unknown>;
  onDiscard: () => void;
}

export function KbDraftCard({ defaultCategory = 'other', onCreate, onDiscard }: KbDraftCardProps) {
  const t = useTranslations('kb');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<KbCategory>(defaultCategory);
  const [isSaving, setIsSaving] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCategory(defaultCategory);
  }, [defaultCategory]);

  const resizeTextarea = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onDiscard(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  }

  function handleCardBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (!title.trim() && !content.trim()) {
      onDiscard();
      return;
    }
    if (title.trim()) void handleSave();
  }

  async function handleSave() {
    if (!title.trim() || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onCreate({ title: title.trim(), content, category });
      toast.success(t('createSuccess'));
    } catch {
      toast.error(t('createError'));
      setIsSaving(false);
    }
  }

  return (
    <div
      onBlur={handleCardBlur}
      onKeyDown={handleKeyDown}
      className="rounded-lg border-2 border-dashed border-primary/50 bg-primary/[0.03] shadow-sm"
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <KbCategoryBadge category={category} />
        <div className="flex min-h-4 shrink-0 items-center pt-0.5" aria-live="polite">
          {isSaving && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" aria-hidden />
          )}
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') { e.preventDefault(); contentRef.current?.focus(); }
        }}
        placeholder={t('form.titlePlaceholder')}
        autoFocus
        className="w-full border-0 bg-transparent px-4 py-1 text-sm font-semibold focus:outline-none placeholder:text-muted-foreground/40"
      />

      <textarea
        ref={contentRef}
        value={content}
        onChange={(e) => { setContent(e.target.value); resizeTextarea(); }}
        placeholder={t('form.contentPlaceholder')}
        rows={3}
        className="w-full resize-none border-0 bg-transparent px-4 pb-3 text-xs text-foreground/80 focus:outline-none placeholder:text-muted-foreground/40 leading-relaxed"
      />
    </div>
  );
}

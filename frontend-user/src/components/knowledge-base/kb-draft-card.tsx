'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
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
    if (!title.trim() && !content.trim()) onDiscard();
  }

  async function handleSave() {
    if (!title.trim()) {
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
      <div className="px-3 pt-2.5 pb-2">
        <KbCategoryBadge category={category} />
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
        className="w-full resize-none border-0 bg-transparent px-4 pb-2 text-xs text-foreground/80 focus:outline-none placeholder:text-muted-foreground/40 leading-relaxed"
      />

      <div className="flex items-center justify-between border-t border-primary/20 px-3 py-2">
        <span className="hidden sm:block text-[10px] text-muted-foreground/60">
          Esc — {t('form.cancel')} · ⌘↵ — {t('createSubmit')}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isSaving}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
            className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {isSaving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Check className="h-3.5 w-3.5" />
            }
          </button>
        </div>
      </div>
    </div>
  );
}

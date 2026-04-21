'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MoreHorizontal, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { KbCategoryBadge, CATEGORY_ICONS, CATEGORY_STYLES } from './kb-category-badge';
import type { KbEntry, KbCategory } from '@/types';

type CardStatus = 'idle' | 'editing' | 'saving' | 'confirm-delete' | 'deleting';

interface KbCardProps {
  entry: KbEntry;
  onUpdate: (data: { title?: string; content?: string; category?: string }) => Promise<unknown>;
  onDelete: () => Promise<void>;
}

export function KbCard({ entry, onUpdate, onDelete }: KbCardProps) {
  const t = useTranslations('kb');

  const [status, setStatus] = useState<CardStatus>('idle');
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [category, setCategory] = useState<KbCategory>((entry.category ?? 'other') as KbCategory);

  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (status === 'idle') {
      setTitle(entry.title);
      setContent(entry.content);
      setCategory((entry.category ?? 'other') as KbCategory);
    }
  }, [entry, status]);

  useEffect(() => {
    return () => {
      if (savedHintTimerRef.current) clearTimeout(savedHintTimerRef.current);
    };
  }, []);

  const resizeTextarea = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (status === 'editing') resizeTextarea();
  }, [status, content, resizeTextarea]);

  function enterEdit() {
    setStatus('editing');
    setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 30);
  }

  function scheduleSave(newTitle = title, newContent = content, newCategory = category) {
    isDirtyRef.current = true;
    setJustSaved(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void executeSave(newTitle, newContent, newCategory);
    }, 900);
  }

  async function executeSave(
    t2 = title,
    c2 = content,
    cat2 = category,
    collapse = false,
  ) {
    if (!isDirtyRef.current || !t2.trim()) return;
    isDirtyRef.current = false;
    const wasEditing = status === 'editing';
    setStatus('saving');
    try {
      await onUpdate({ title: t2.trim(), content: c2, category: cat2 });
      if (savedHintTimerRef.current) clearTimeout(savedHintTimerRef.current);
      setJustSaved(true);
      savedHintTimerRef.current = setTimeout(() => setJustSaved(false), 2200);
      setStatus(collapse ? 'idle' : wasEditing ? 'editing' : 'idle');
    } catch {
      toast.error(t('updateError'));
      setStatus('editing');
    }
  }

  function revert() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    isDirtyRef.current = false;
    setTitle(entry.title);
    setContent(entry.content);
    setCategory((entry.category ?? 'other') as KbCategory);
    setStatus('idle');
  }

  function handleCardBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (isDirtyRef.current) void executeSave(title, content, category, true);
    else setStatus('idle');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { revert(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void executeSave(title, content, category, true);
    }
  }

  async function handleDelete() {
    setStatus('deleting');
    try {
      await onDelete();
    } catch {
      toast.error(t('deleteError'));
      setStatus('idle');
    }
  }

  const catStyle = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.other;
  const catIcon = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other;

  const isRecent = (() => {
    const updated = entry.updatedAt ? new Date(entry.updatedAt) : null;
    if (!updated) return false;
    const diffDays = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  })();

  if (status === 'confirm-delete') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {t('deleteConfirmInline')}: <span className="font-medium text-foreground">{entry.title}</span>
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setStatus('idle')}
            className="rounded-md border border-input bg-input-fill px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {t('form.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-destructive/20 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5"
          >
            {t('confirmDelete')}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'idle') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={enterEdit}
        onKeyDown={(e) => e.key === 'Enter' && enterEdit()}
        className={cn(
          'group relative flex items-start gap-3 rounded-lg border bg-card px-4 py-3 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isRecent && 'border-primary/30 bg-primary/[0.02]',
        )}
      >
        <span className={cn('mt-0.5 shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-sm', catStyle)}>
          {catIcon}
        </span>
        <div className="flex-1 min-w-0 pr-8">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-snug">{entry.title}</p>
            {isRecent && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                new
              </span>
            )}
          </div>
          {entry.content && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap leading-relaxed">
              {entry.content}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setStatus('confirm-delete'); }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label={t('confirmDelete')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      onBlur={handleCardBlur}
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-primary/50 bg-card shadow-sm ring-1 ring-primary/20"
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <KbCategoryBadge category={category} />
        <div
          className="flex min-h-4 shrink-0 items-center gap-1 pt-0.5 text-[10px] text-muted-foreground/45"
          aria-live="polite"
        >
          {status === 'saving' && (
            <Loader2 className="h-3 w-3 animate-spin opacity-60" aria-hidden />
          )}
          {status !== 'saving' && justSaved && (
            <span className="font-normal tracking-tight">{t('form.saved')}</span>
          )}
        </div>
      </div>

      <input
        ref={titleRef}
        value={title}
        onChange={(e) => { setTitle(e.target.value); scheduleSave(e.target.value, content, category); }}
        onKeyDown={(e) => e.key === 'Tab' && !content && (e.preventDefault(), contentRef.current?.focus())}
        placeholder={t('form.titlePlaceholder')}
        className="w-full border-0 bg-transparent px-4 py-1 text-sm font-semibold focus:outline-none placeholder:text-muted-foreground/40"
      />

      <textarea
        ref={contentRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          scheduleSave(title, e.target.value, category);
          resizeTextarea();
        }}
        placeholder={t('form.contentPlaceholder')}
        rows={3}
        className="w-full resize-none border-0 bg-transparent px-4 pb-3 text-xs text-foreground/80 focus:outline-none placeholder:text-muted-foreground/40 leading-relaxed"
      />
    </div>
  );
}

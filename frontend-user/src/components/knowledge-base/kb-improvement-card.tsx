'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils/format-date';
import type { KbPendingItem } from '@/hooks/use-kb-pending';

type EditStatus = 'idle' | 'editing' | 'saving';

export interface KbImprovementCardProps {
  item: KbPendingItem;
  selected: boolean;
  onToggle: () => void;
  onIgnore: () => void;
  /** Persist changes (debounced + blur + ⌘↵); card stays in edit until success */
  onPersist: (payload: { guestQuestion: string; managerAnswer: string }) => Promise<void>;
}

export function KbImprovementCard({
  item,
  selected,
  onToggle,
  onIgnore,
  onPersist,
}: KbImprovementCardProps) {
  const t = useTranslations('kbImprovement');
  const tKb = useTranslations('kb');

  const [status, setStatus] = useState<EditStatus>('idle');
  const [question, setQuestion] = useState(item.guestQuestion);
  const [answer, setAnswer] = useState(item.managerAnswer);

  const questionRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (status === 'idle') {
      setQuestion(item.guestQuestion);
      setAnswer(item.managerAnswer);
    }
  }, [item, status]);

  /** Auto-height without layout jump: shrink-wrap to content, min-height from CSS. */
  const syncTextareaHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const resizeQuestion = useCallback(() => {
    syncTextareaHeight(questionRef.current);
  }, [syncTextareaHeight]);

  const resizeAnswer = useCallback(() => {
    syncTextareaHeight(answerRef.current);
  }, [syncTextareaHeight]);

  /** Sync height once when entering edit (avoids jump vs idle min-heights; typing uses onChange resize). */
  useLayoutEffect(() => {
    if (status !== 'editing') return;
    syncTextareaHeight(questionRef.current);
    syncTextareaHeight(answerRef.current);
  }, [status, syncTextareaHeight]);

  function focusTextareaAtEnd(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.focus();
    const len = el.value.length;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    });
  }

  function enterEdit() {
    setQuestion(item.guestQuestion);
    setAnswer(item.managerAnswer);
    isDirtyRef.current = false;
    setStatus('editing');
    setTimeout(() => {
      focusTextareaAtEnd(questionRef.current);
    }, 30);
  }

  function scheduleSave(q = question, a = answer) {
    isDirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void executeSave(q, a, false);
    }, 900);
  }

  async function executeSave(
    q = question,
    a = answer,
    collapse: boolean,
  ): Promise<boolean> {
    const qt = q.trim();
    const at = a.trim();
    if (!isDirtyRef.current) {
      if (collapse) setStatus('idle');
      return true;
    }
    if (!qt) {
      toast.error(t('emptyQuestion'));
      return false;
    }
    if (!at) {
      toast.error(t('emptyAnswer'));
      return false;
    }
    setStatus('saving');
    try {
      await onPersist({ guestQuestion: qt, managerAnswer: at });
      isDirtyRef.current = false;
      setStatus('idle');
      return true;
    } catch {
      toast.error(t('patchError'));
      setStatus('editing');
      isDirtyRef.current = true;
      return false;
    }
  }

  function revert() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    isDirtyRef.current = false;
    setQuestion(item.guestQuestion);
    setAnswer(item.managerAnswer);
    setStatus('idle');
  }

  function handleCardBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (status === 'saving') return;
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (status !== 'editing') return;
    if (isDirtyRef.current) void executeSave(question, answer, true);
    else setStatus('idle');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (status === 'saving') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      revert();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void executeSave(question, answer, true);
    }
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card transition-colors',
        'border-border/80 shadow-none',
        'hover:border-border hover:bg-muted/15',
        selected && 'border-primary/35 bg-muted/10 ring-1 ring-primary/10',
        status === 'editing' && 'border-primary/45 ring-1 ring-primary/20',
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onIgnore();
        }}
        className={cn(
          'absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md',
          'text-muted-foreground/70 transition-colors hover:bg-red-500/10 hover:text-red-600',
          'dark:hover:text-red-400',
        )}
        aria-label={t('ignore')}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <div className="flex gap-3 pr-11 pl-3 pt-3 pb-2 sm:pl-4">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border-2 transition-colors duration-200 ease-in-out',
            selected
              ? 'border-primary bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
              : 'border-muted-foreground/40 bg-background hover:border-muted-foreground/65',
          )}
          aria-label={selected ? t('a11y.uncheck') : t('a11y.check')}
        >
          {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="max-w-full truncate rounded bg-muted/60 px-1.5 py-px font-medium text-foreground/80">
              {item.propertyName}
            </span>
            <time className="tabular-nums" dateTime={item.createdAt}>
              {formatDateTime(item.createdAt)}
            </time>
          </div>

          {status === 'idle' ? (
            <>
              <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={enterEdit}
                    aria-label={t('guestQuestion')}
                    className={cn(
                      'w-full min-h-[2.5rem] cursor-text rounded-md border border-border/80 bg-background px-2 py-1.5 text-left text-[15px] font-normal leading-snug text-foreground shadow-none',
                      'whitespace-pre-wrap break-words transition-colors hover:bg-muted/25',
                      'dark:border-transparent dark:bg-transparent dark:hover:bg-muted/15',
                    )}
                  >
                    {item.guestQuestion}
                  </button>
                </div>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={enterEdit}
                    aria-label={t('answerForAi')}
                    className={cn(
                      'w-full min-h-[2.5rem] cursor-text rounded-md border border-border/80 bg-background px-2 py-1.5 text-left text-sm leading-relaxed text-foreground shadow-none',
                      'whitespace-pre-wrap break-words transition-colors hover:bg-muted/25',
                      'dark:border-transparent dark:bg-transparent dark:hover:bg-muted/15',
                    )}
                  >
                    {item.managerAnswer}
                  </button>
                </div>
              </div>
              <div className="mt-2 flex min-h-[22px] items-center justify-end gap-2 pt-0.5" aria-hidden>
                <span className="mr-auto hidden text-[10px] text-muted-foreground/70 sm:invisible sm:block">
                  Esc — {tKb('form.cancel')} · ⌘↵ — {tKb('form.saveClose')}
                </span>
              </div>
            </>
          ) : (
            <div onBlur={handleCardBlur} onKeyDown={handleKeyDown} className="mt-2">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
                <div className="min-w-0">
                  <textarea
                    ref={questionRef}
                    value={question}
                    readOnly={status === 'saving'}
                    aria-label={t('guestQuestion')}
                    onChange={(e) => {
                      setQuestion(e.target.value);
                      scheduleSave(e.target.value, answer);
                      resizeQuestion();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && !e.shiftKey) {
                        e.preventDefault();
                        focusTextareaAtEnd(answerRef.current);
                      }
                    }}
                    rows={1}
                    className={cn(
                      'box-border w-full min-h-[2.5rem] max-h-[min(40vh,280px)] resize-none overflow-y-auto rounded-md border px-2 py-1.5 text-[15px] leading-snug text-foreground shadow-none',
                      'border-border/80 bg-background dark:border-slate-600 dark:bg-slate-950/95',
                      'whitespace-pre-wrap break-words placeholder:text-muted-foreground/40',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 read-only:opacity-60',
                    )}
                    placeholder={t('guestQuestion')}
                  />
                </div>

                <div className="min-w-0">
                  <textarea
                    ref={answerRef}
                    value={answer}
                    readOnly={status === 'saving'}
                    aria-label={t('answerForAi')}
                    onChange={(e) => {
                      setAnswer(e.target.value);
                      scheduleSave(question, e.target.value);
                      resizeAnswer();
                    }}
                    rows={1}
                    className={cn(
                      'box-border w-full min-h-[2.5rem] max-h-[min(45vh,320px)] resize-none overflow-y-auto rounded-md border px-2 py-1.5 text-sm leading-relaxed text-foreground shadow-none',
                      'border-border/80 bg-background dark:border-slate-600 dark:bg-slate-950/95',
                      'whitespace-pre-wrap break-words placeholder:text-muted-foreground/40',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 read-only:opacity-60',
                    )}
                    placeholder={t('answerForAi')}
                  />
                </div>
              </div>

              <div className="mt-2 flex min-h-[22px] items-center justify-end gap-2 pt-0.5">
                <span className="mr-auto hidden text-[10px] text-muted-foreground/70 sm:block">
                  Esc — {tKb('form.cancel')} · ⌘↵ — {tKb('form.saveClose')}
                </span>
                {status === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

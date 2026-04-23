'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, parseISO, isValid } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, MessageSquareText, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskNoteFeedItem } from '../../types';
import { useManagerStaffNotesFeed } from '../../hooks/useManagerStaffNotesFeed';
import {
  TASK_STAFF_MSG_ASSIGNEE_QUERY,
  TASK_STAFF_MSG_ASSIGNEE_UNASSIGNED,
  TASK_STAFF_MSG_UNREAD_QUERY,
} from '../../task-url-params';

function isProbablyVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function formatNoteTime(iso: string, locale: string): string {
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return iso;
    const loc = locale.startsWith('ru') ? ru : enUS;
    return format(d, 'd MMM yyyy, HH:mm', { locale: loc });
  } catch {
    return iso;
  }
}

export function ManagerStaffMessagesPanel({
  onOpenTask,
}: {
  onOpenTask: (taskId: string, options?: { focusStaffNotes?: boolean }) => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { data: items, isLoading, isError, refetch } = useManagerStaffNotesFeed(true);

  const unreadOnly = searchParams.get(TASK_STAFF_MSG_UNREAD_QUERY) === '1';
  const assigneeFilter = searchParams.get(TASK_STAFF_MSG_ASSIGNEE_QUERY)?.trim() ?? '';

  const filtered = useMemo(() => {
    const list = (items ?? []) as TaskNoteFeedItem[];
    let out = list;
    if (unreadOnly) {
      out = out.filter((n) => n.isUnseen);
    }
    if (assigneeFilter) {
      if (assigneeFilter === TASK_STAFF_MSG_ASSIGNEE_UNASSIGNED) {
        out = out.filter((n) => n.assigneeId == null || n.assigneeId === '');
      } else {
        out = out.filter((n) => n.assigneeId === assigneeFilter);
      }
    }
    return [...out].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
  }, [items, unreadOnly, assigneeFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-4 py-2 md:px-4">
        <p className="text-xs text-muted-foreground md:text-sm">{t('staffMessagesHint')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2 sm:px-4 sm:py-3">
        {isLoading && (
          <div className="flex justify-center py-16 text-muted-foreground" aria-busy>
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p>{t('staffMessagesLoadError')}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
              {t('staffMessagesRetry')}
            </Button>
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 bg-muted/10 px-6 py-16 text-center">
            <MessageSquareText className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('staffMessagesEmpty')}</p>
          </div>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <ul className="mx-auto flex max-w-5xl flex-col gap-1.5 sm:gap-2">
            {filtered.map((n: TaskNoteFeedItem) => (
              <li key={n.uuid}>
                <button
                  type="button"
                  onClick={() => onOpenTask(n.taskId, { focusStaffNotes: true })}
                  className={cn(
                    'w-full rounded-xl border bg-card text-left shadow-sm transition-colors hover:bg-muted/30',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'px-3 py-2 sm:px-3 sm:py-2.5',
                    n.isUnseen ? 'border-primary/35 ring-1 ring-primary/10' : 'border-border/60',
                  )}
                >
                  <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-12 md:gap-3">
                    <div className="min-w-0 md:col-span-3">
                      <p
                        className={cn(
                          'truncate text-sm text-foreground',
                          n.isUnseen ? 'font-bold' : 'font-medium',
                        )}
                      >
                        {n.authorName}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.propertyTitle}
                        {n.taskTitle ? ` · ${n.taskTitle}` : ''}
                      </p>
                    </div>
                    <div className="min-w-0 md:col-span-6">
                      <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-foreground">
                        {n.text}
                      </p>
                      {n.photoUrl ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Paperclip className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                          <span>
                            {isProbablyVideoUrl(n.photoUrl) ? t('staffMessagesAttachmentVideo') : t('staffMessagesAttachmentPhoto')}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex justify-start md:col-span-3 md:justify-end">
                      <time
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        dateTime={n.createdAt}
                      >
                        {formatNoteTime(n.createdAt, locale)}
                      </time>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

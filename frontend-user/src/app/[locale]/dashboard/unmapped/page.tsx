'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  useUnmappedReports,
  useAttachUnmappedReport,
  useDismissUnmappedReport,
} from '@/hooks/use-unmapped-reports';
import { useTasks } from '@/modules/tasks/hooks/useTasks';
import { DEFAULT_TASK_FILTERS } from '@/stores/tasks-filters.store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export default function UnmappedInboxPage() {
  const t = useTranslations('unmappedInbox');
  const { data: reports, isLoading, isError, refetch } = useUnmappedReports();
  const { data: tasksData, isLoading: tasksLoading } = useTasks(DEFAULT_TASK_FILTERS);
  const { mutate: attach, isPending: attaching } = useAttachUnmappedReport();
  const { mutate: dismiss, isPending: dismissing } = useDismissUnmappedReport();
  const [taskByReport, setTaskByReport] = useState<Record<string, string>>({});

  const tasks = tasksData?.tasks ?? [];
  const taskOptions = useMemo(
    () =>
      [...tasks]
        .filter((x) => x.status === 'pending' || x.status === 'in_progress')
        .slice(0, 200),
    [tasks],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-destructive">{t('loadError')}</p>
        <Button variant="outline" className="mt-2" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const list = reports ?? [];

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-6 px-6 pb-6">
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {list.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {r.staffName} · {new Date(r.createdAt).toLocaleString()}
                  </p>
                  {r.transcript && (
                    <p className="mt-2 whitespace-pre-wrap text-sm">{r.transcript}</p>
                  )}
                </div>
              </div>
              {r.photoUrl && (
                <img
                  src={r.photoUrl}
                  alt=""
                  className="mt-3 max-h-48 w-auto rounded-md border object-contain"
                />
              )}
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="text-xs text-muted-foreground">{t('attachToTask')}</label>
                  <select
                    className={cn(
                      'mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    disabled={tasksLoading}
                    value={taskByReport[r.id] ?? ''}
                    onChange={(e) =>
                      setTaskByReport((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                  >
                    <option value="">{t('selectTask')}</option>
                    {taskOptions.map((task) => (
                      <option key={task.uuid} value={task.uuid}>
                        {task.propertyTitle} — {task.title.slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  disabled={attaching || !taskByReport[r.id]}
                  onClick={() => {
                    const tid = taskByReport[r.id];
                    if (!tid) return;
                    attach({ id: r.id, taskId: tid });
                  }}
                >
                  {t('attach')}
                </Button>
                <Button
                  variant="outline"
                  disabled={dismissing}
                  onClick={() => dismiss(r.id)}
                >
                  {t('dismiss')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </>
  );
}

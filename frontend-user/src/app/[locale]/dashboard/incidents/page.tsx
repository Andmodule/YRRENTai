'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useIncidents,
  usePatchIncident,
  useDispatchIncident,
} from '@/modules/incidents/hooks/useIncidents';
import { Button } from '@/components/ui/button';
import { useStaffUsers } from '@/hooks/use-staff-users';
import { cn } from '@/lib/utils';
import { INCIDENT_TYPE_LABEL_KEY } from '@/modules/incidents/components/IncidentTypePill';

function IncidentsPageInner() {
  const searchParams = useSearchParams();
  const incidentParam = searchParams.get('incident');
  const { data: incidents, isLoading, isError, refetch } = useIncidents();
  const { mutate: patch, isPending } = usePatchIncident();
  const { mutate: dispatch, isPending: dispatching } = useDispatchIncident();
  const { staff } = useStaffUsers();
  const staffOnly = staff.filter((s) => s.role === 'STAFF');
  const [assigneeByIncident, setAssigneeByIncident] = useState<Record<string, string>>({});
  const tType = useTranslations('tasks.kanban.incidentCard');

  useEffect(() => {
    if (!incidentParam || !incidents?.length) return;
    const el = document.getElementById(`incident-${incidentParam}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [incidentParam, incidents]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Загрузка…</div>;
  }
  if (isError) {
    return (
      <div className="p-6">
        <p className="text-destructive">Не удалось загрузить инциденты.</p>
        <Button variant="outline" className="mt-2" onClick={() => void refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  const list = incidents ?? [];

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-6 px-6 pb-6">
        <p className="text-sm text-muted-foreground">Забытые вещи и повреждения от персонала</p>
      <ul className="space-y-3">
        {list.length === 0 ? (
          <li className="rounded-lg border bg-card p-6 text-center text-muted-foreground">Пока нет записей</li>
        ) : (
          list.map((i) => (
            <li
              id={`incident-${i.uuid}`}
              key={i.uuid}
              className={`rounded-lg border bg-card p-4 shadow-sm ${
                incidentParam === i.uuid ? 'ring-2 ring-primary/40' : ''
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span
                    className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                      i.type === 'lost_item' && 'bg-secondary text-secondary-foreground',
                      i.type === 'damage' && 'bg-destructive/15 text-destructive',
                      i.type === 'rule_violation' && 'bg-orange-500/15 text-orange-950 dark:text-orange-100',
                      i.type === 'emergency' && 'bg-violet-500/20 text-violet-950 dark:text-violet-100',
                    )}
                  >
                    {tType(INCIDENT_TYPE_LABEL_KEY[i.type])}
                  </span>
                  <span className="ml-2 font-medium">{i.propertyTitle}</span>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Date(i.createdAt).toLocaleString('ru-RU')}
                  </p>
                </div>
                <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">{i.status}</span>
              </div>
              <p className="mt-2 text-sm">{i.description}</p>
              {i.photoUrls?.[0] && (
                <img
                  src={i.photoUrls[0]}
                  alt=""
                  className="mt-2 h-20 w-20 rounded object-cover"
                />
              )}
              {i.dispatchedTaskId && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Задача технику создана (id: {i.dispatchedTaskId.slice(0, 8)}…)
                </p>
              )}
              {(i.status === 'awaiting_dispatch' || (i.status === 'open' && !i.dispatchedTaskId)) && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <p className="text-xs text-muted-foreground">Назначить техника</p>
                    <select
                      className={cn(
                        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                      value={assigneeByIncident[i.uuid] ?? ''}
                      onChange={(e) =>
                        setAssigneeByIncident((prev) => ({
                          ...prev,
                          [i.uuid]: e.target.value,
                        }))
                      }
                    >
                      <option value="">Выберите сотрудника</option>
                      {staffOnly.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    size="sm"
                    disabled={dispatching || !assigneeByIncident[i.uuid]}
                    onClick={() => {
                      const aid = assigneeByIncident[i.uuid];
                      if (!aid) return;
                      dispatch({ uuid: i.uuid, assigneeId: aid });
                    }}
                  >
                    Проверить и назначить
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => patch({ uuid: i.uuid, status: 'open' })}
                  >
                    Взять в работу
                  </Button>
                </div>
              )}
            </li>
          ))
        )}
      </ul>
      </div>
    </>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Загрузка…</div>}>
      <IncidentsPageInner />
    </Suspense>
  );
}

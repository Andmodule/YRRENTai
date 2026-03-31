'use client';

import { useIncidents, usePatchIncident } from '@/modules/incidents/hooks/useIncidents';
import { Button } from '@/components/ui/button';

export default function IncidentsPage() {
  const { data: incidents, isLoading, isError, refetch } = useIncidents();
  const { mutate: patch, isPending } = usePatchIncident();

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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Инциденты</h1>
        <p className="text-sm text-muted-foreground">Забытые вещи и повреждения от персонала</p>
      </div>
      <ul className="space-y-3">
        {list.length === 0 ? (
          <li className="rounded-lg border bg-card p-6 text-center text-muted-foreground">Пока нет записей</li>
        ) : (
          list.map((i) => (
            <li key={i.uuid} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                      i.type === 'lost_item'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-destructive/15 text-destructive'
                    }`}
                  >
                    {i.type === 'lost_item' ? 'Забытая вещь' : 'Повреждение'}
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
              {i.status === 'open' && (
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={isPending}
                  onClick={() => patch({ uuid: i.uuid, status: 'in_review' })}
                >
                  Взять в работу
                </Button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

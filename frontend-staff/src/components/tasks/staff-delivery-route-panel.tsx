'use client';

import { Loader2, MapPin, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Task } from '@/hooks/use-tasks';
import {
  useArriveStop,
  useCompleteStop,
  useReorderDeliveryStops,
  useStaffDeliveryRouteActive,
  useStartDeliveryRoute,
} from '@/hooks/use-staff-delivery-route';

export function StaffDeliveryRoutePanel({
  tasksForFallback,
}: {
  tasksForFallback: Task[];
}) {
  const { data: route, isLoading, isError, refetch } = useStaffDeliveryRouteActive();
  const { mutate: startRoute, isPending: startPending } = useStartDeliveryRoute();
  const { mutate: arrive, isPending: arrivePending } = useArriveStop();
  const { mutate: complete, isPending: completePending } = useCompleteStop();
  const { mutate: reorder, isPending: reorderPending } = useReorderDeliveryStops();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-700">
        Не удалось загрузить маршрут.{' '}
        <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
          Повторить
        </button>
      </p>
    );
  }

  if (!route) {
    const routeSorted = [...tasksForFallback].sort((a, b) =>
      (a.streetAddress || a.propertyAddress).localeCompare(b.streetAddress || b.propertyAddress, 'ru'),
    );
    return (
      <>
        <p className="mb-3 text-sm text-slate-600">
          Нет назначенного маршрута на сегодня — откройте адреса по задачам.
        </p>
        <ul className="space-y-2">
          {routeSorted.map((t) => {
            const addr = encodeURIComponent(t.streetAddress || t.propertyAddress);
            return (
              <li key={t.uuid}>
                <a
                  href={`https://maps.google.com/?q=${addr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t.streetAddress || t.propertyAddress}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  const warehouse = route.stops.find((s) => s.kind === 'warehouse');
  const propertyStops = [...route.stops.filter((s) => s.kind === 'property')].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const moveStop = (stopId: string, dir: -1 | 1) => {
    if (!route.driverCanReorderStops) return;
    const idx = propertyStops.findIndex((s) => s.id === stopId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= propertyStops.length) return;
    const next = [...propertyStops];
    const tmp = next[idx];
    const swap = next[j];
    if (tmp && swap) {
      next[idx] = swap;
      next[j] = tmp;
    }
    reorder({
      routeId: route.id,
      orderedPropertyStopIds: next.map((s) => s.id),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Дата: {route.scheduledDate}
        {route.warehouseLabel ? ` · ${route.warehouseLabel}` : ''}
      </p>

      {route.status === 'assigned' && (
        <Button
          type="button"
          className="w-full rounded-xl"
          disabled={startPending}
          onClick={() => startRoute(route.id)}
        >
          {startPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Начать маршрут
        </Button>
      )}

      {route.status === 'in_progress' && (
        <>
          <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3">
            <p className="text-xs font-semibold uppercase text-teal-800">Сбор на складе</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-800">
              {route.pickingLines.map((pl) => (
                <li key={`${pl.name}-${pl.quantity}`} className="flex gap-2">
                  <Package className="h-4 w-4 shrink-0 text-teal-600" />
                  <span>
                    {pl.name}{' '}
                    <span className="text-slate-600">
                      {pl.quantity}
                      {pl.unit ? ` ${pl.unit}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {warehouse && warehouse.status !== 'done' ? (
              <Button
                type="button"
                className="mt-3 w-full rounded-xl"
                disabled={completePending}
                onClick={() => complete(warehouse.id)}
              >
                {completePending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Погрузка завершена
              </Button>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Остановки</p>
            <ul className="mt-2 space-y-3">
              {propertyStops.map((s, i) => (
                <li key={s.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{s.propertyTitle ?? 'Объект'}</p>
                      {s.propertyAddress ? (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(s.propertyAddress)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 flex items-start gap-1 text-xs text-teal-700 underline"
                        >
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          {s.propertyAddress}
                        </a>
                      ) : null}
                      {s.lines.length > 0 ? (
                        <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                          {s.lines.map((ln) => (
                            <li key={ln.name}>
                              {ln.name}: {[ln.quantity, ln.unit].filter(Boolean).join(' ')}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                      {s.status}
                    </span>
                  </div>
                  {route.driverCanReorderStops && propertyStops.length > 1 ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 text-xs"
                        disabled={reorderPending || i === 0}
                        onClick={() => moveStop(s.id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 text-xs"
                        disabled={reorderPending || i === propertyStops.length - 1}
                        onClick={() => moveStop(s.id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.status === 'pending' && warehouse?.status === 'done' ? (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-lg"
                        disabled={arrivePending}
                        onClick={() => arrive(s.id)}
                      >
                        На месте
                      </Button>
                    ) : null}
                    {s.status === 'arrived' && warehouse?.status === 'done' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="rounded-lg"
                        disabled={completePending}
                        onClick={() => complete(s.id)}
                      >
                        Завершить остановку
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {route.status === 'assigned' && (
        <p className="text-xs text-slate-500">После «Начать маршрут» откроется сбор и остановки.</p>
      )}

      {route.status === 'completed' ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Маршрут завершён.
        </p>
      ) : null}
    </div>
  );
}

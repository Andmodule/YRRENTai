import type { Task } from '@/hooks/use-tasks';
import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';

/**
 * Задача-«якорь» для голоса/текста miniapp (нужен taskUuid): по активной остановке
 * (совпадение propertyId) или первая открытая задача из списка.
 */
export function resolveDriverAnchorTask(
  route: StaffDeliveryRouteDetail | null | undefined,
  tasks: Task[] | undefined,
): Task | null {
  if (!route?.stops?.length || !tasks?.length) return null;

  const sorted = [...route.stops].sort((a, b) => a.sortOrder - b.sortOrder);
  const firstOpen = sorted.find((s) => s.status !== 'done');
  const focus = firstOpen ?? sorted[0];
  if (!focus) return null;

  const matchByProperty = (propertyId: string | null | undefined) => {
    if (!propertyId) return null;
    return tasks.find((t) => t.propertyId === propertyId) ?? null;
  };

  if (focus.kind === 'property') {
    const hit = matchByProperty(focus.propertyId);
    if (hit) return hit;
  }

  if (focus.kind === 'warehouse') {
    const nextProp = sorted.find((s) => s.kind === 'property' && s.propertyId);
    const hit = matchByProperty(nextProp?.propertyId ?? null);
    if (hit) return hit;
  }

  return tasks.find((t) => t.status !== 'done') ?? tasks[0] ?? null;
}

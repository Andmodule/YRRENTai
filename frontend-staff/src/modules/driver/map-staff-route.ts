import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';
import type { ActiveRouteData, RouteItem, RouteStop, StopStatus } from './types/route.types';

function parseQty(raw: string | null | undefined): number {
  const n = parseFloat(String(raw ?? '1').replace(',', '.'));
  return Number.isFinite(n) ? n : 1;
}

function resolveActiveStopId(
  sorted: StaffDeliveryRouteDetail['stops'],
  routeStatus: string,
  driverNextStopId: string | null | undefined,
): string | null {
  if (routeStatus !== 'in_progress') return null;

  const wh = sorted.find((s) => s.kind === 'warehouse');
  const whDone = !wh || wh.status === 'done';
  if (!whDone && wh) return wh.id;

  const next = driverNextStopId?.trim();
  if (next) {
    const chosen = sorted.find((s) => s.id === next && s.kind === 'property' && s.status !== 'done');
    if (chosen) return chosen.id;
  }
  const firstOpen = sorted.find((s) => s.status !== 'done');
  return firstOpen?.id ?? null;
}

export function mapStaffRouteToActiveData(route: StaffDeliveryRouteDetail): ActiveRouteData | null {
  if (!route.stops?.length) return null;

  const sorted = [...route.stops].sort((a, b) => a.sortOrder - b.sortOrder);
  const completedStops = sorted.filter((s) => s.status === 'done').length;
  const totalStops = sorted.length;

  const driverNextStopId = route.driverNextStopId ?? null;
  const activeId = resolveActiveStopId(sorted, route.status, driverNextStopId);

  const stops: RouteStop[] = sorted.map((s) => {
    const isWarehouse = s.kind === 'warehouse';

    let items: RouteItem[];
    if (isWarehouse) {
      items = route.pickingLines.map((pl, i) => ({
        id: `wh-pick-${i}-${pl.name}`,
        name: pl.name,
        quantity: parseQty(pl.quantity),
        unit: pl.unit ?? '',
        actionType: 'pickup',
      }));
    } else {
      items = s.lines.map((ln, i) => ({
        id: ln.supplyRequestItemId ?? `ln-${i}-${ln.name}`,
        name: ln.name,
        quantity: parseQty(ln.quantity),
        unit: ln.unit ?? '',
        actionType: 'dropoff',
      }));
    }

    let status: StopStatus;
    if (s.status === 'done') {
      status = 'completed';
    } else if (activeId && s.id === activeId) {
      status = 'active';
    } else {
      status = 'pending';
    }

    return {
      id: s.id,
      kind: isWarehouse ? 'warehouse' : 'property',
      propertyId: isWarehouse ? null : s.propertyId,
      warehouseLabel: isWarehouse ? route.warehouseLabel : null,
      propertyTitle: isWarehouse ? null : s.propertyTitle,
      propertyAddress: isWarehouse ? null : s.propertyAddress,
      status,
      items,
      backendStatus: s.status,
    };
  });

  return {
    routeId: route.id,
    driverNextStopId,
    totalStops,
    completedStops,
    stops,
    routeStatus: route.status,
    scheduledDate: route.scheduledDate,
  };
}

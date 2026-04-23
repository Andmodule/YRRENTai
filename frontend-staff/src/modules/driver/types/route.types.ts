export type StopStatus = 'pending' | 'active' | 'completed';

export type ItemActionType = 'pickup' | 'dropoff';

export interface RouteItem {
  id: string;
  name: string;
  quantity: number;
  /** Единица измерения; подпись с словаря */
  unit: string;
  actionType: ItemActionType;
}

export interface RouteStop {
  id: string;
  kind: 'warehouse' | 'property';
  /** Для сопоставления с задачами персонала */
  propertyId?: string | null;
  warehouseLabel?: string | null;
  propertyTitle?: string | null;
  propertyAddress?: string | null;
  timeTarget?: string;
  status: StopStatus;
  items: RouteItem[];
  /** Сырой статус остановки с API: pending | arrived | done */
  backendStatus: string;
}

export interface ActiveRouteData {
  routeId: string;
  /** Выбор водителя: следующая точка-объект после склада (сервер). */
  driverNextStopId: string | null;
  totalStops: number;
  completedStops: number;
  stops: RouteStop[];
  routeStatus: string;
  scheduledDate: string;
  /** Локальное «выполнить до» с маршрута (HH:mm) */
  completeByTime: string | null;
}

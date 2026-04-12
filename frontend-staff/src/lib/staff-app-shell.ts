/**
 * Какую оболочку staff-приложения показывать. Задаётся в панели менеджера
 * «Персонал» как `staffJobType` (см. backend `users.staffJobType`).
 *
 * - `cleaning` — текущий UI: чеклисты, задачи, уборка (cleaner, maintenance, other, null).
 * - `driver` — отдельный UI логистики / водителя.
 */
export const STAFF_JOB_TYPE_DRIVER = 'driver' as const;

export type StaffAppShell = 'cleaning' | 'driver';

export function resolveStaffAppShell(staffJobType: string | null | undefined): StaffAppShell {
  if (staffJobType === STAFF_JOB_TYPE_DRIVER) return 'driver';
  return 'cleaning';
}

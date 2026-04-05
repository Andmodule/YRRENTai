/** Frontline role for STAFF users (PMS + Telegram). */
export const STAFF_JOB_TYPES = ['cleaner', 'maintenance', 'driver', 'other'] as const;

export type StaffJobType = (typeof STAFF_JOB_TYPES)[number];

export function isStaffJobType(value: string): value is StaffJobType {
  return (STAFF_JOB_TYPES as readonly string[]).includes(value);
}

/** Appended by `backend/src/database/seed-staff-tasks.ts` for DB cleanup only — hide in UI. */
const STAFF_SEED_TASK_MARKER = '[seed-staff-tasks]';

/** Strips seed marker and surrounding whitespace from task `notes` for display/editing. */
export function stripStaffSeedTaskMarker(text: string | null | undefined): string {
  if (text == null || text === '') return '';
  return text.replace(new RegExp(`\\s*${escapeRegExp(STAFF_SEED_TASK_MARKER)}\\s*`, 'g'), '').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

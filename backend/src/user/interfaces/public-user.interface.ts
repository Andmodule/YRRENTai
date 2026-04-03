export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  language: string;
  telegramChatId: string | null;
  employerOwnerId: string | null;
  /** STAFF only: last explicit shift completion (ISO string or null). */
  staffShiftCompletedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal staff member dto for assignee selectors. */
export interface StaffMemberDto {
  id: string;
  displayName: string;
  role: string;
}

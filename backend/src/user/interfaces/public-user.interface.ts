export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  language: string;
  telegramChatId: string | null;
  /** Tenant; null for SUPERADMIN only. */
  companyId: string | null;
  companyName: string | null;
  employerOwnerId: string | null;
  /** STAFF: frontline role key (cleaner, maintenance, …). */
  staffJobType: string | null;
  /** STAFF: optional @username (no @) before bot links chat id. */
  telegramUsername: string | null;
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

/** STAFF-only directory row for /dashboard/staff (tenant-scoped). */
export interface StaffDirectoryRowDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobType: string | null;
  telegramUsername: string | null;
  telegramLinked: boolean;
  createdAt: string;
}

export interface StaffPersonnelPayloadDto {
  members: StaffDirectoryRowDto[];
  /** True when `TELEGRAM_BOT_USERNAME` is set — invite links can be generated. */
  telegramBotConfigured: boolean;
}

export interface StaffInviteCreatedDto {
  userId: string;
  /** Null when bot username is not configured (user is still created). */
  inviteLink: string | null;
  expiresAt: string | null;
  telegramBotConfigured: boolean;
}

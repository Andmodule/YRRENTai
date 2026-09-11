import { z } from 'zod';
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
} from './schemas/auth.schema';
import {
  createPropertySchema,
  updatePropertySchema,
} from './schemas/property.schema';
import {
  createBookingSchema,
  updateBookingSchema,
  transitionBookingSchema,
} from './schemas/booking.schema';
import { updateUserSchema } from './schemas/user.schema';
import { paginationSchema } from './schemas/pagination.schema';
import {
  sendChatMessageSchema,
  chatMessageSchema,
  chatMessageRoleSchema,
  replyAnalyticsQuerySchema,
} from './schemas/chat.schema';
import {
  conversationPublicSchema,
  listConversationsQuerySchema,
  managerReplySchema,
  aiDraftApproveSchema,
} from './schemas/conversation.schema';
import type { ZodomusPropertyStatus } from './constants/zodomus-property-status';

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export type CreatePropertyDto = z.infer<typeof createPropertySchema>;
export type UpdatePropertyDto = z.infer<typeof updatePropertySchema>;

/** Справочник OTA (из GET /ota-platforms). */
export interface OtaPlatformRef {
  id: string;
  code: string;
  zodomusChannelId: number;
  sortOrder: number;
}

/** Одна строка: объект в конкретном OTA с внешним id в этом канале. */
export interface PropertyChannelListing {
  id: string;
  otaPlatformId: string;
  otaPlatform?: OtaPlatformRef;
  externalListingId: string;
  zodomusRoomId?: string | null;
  sortOrder?: number;
}

export interface Property {
  id: string;
  name: string;
  country: string;
  city: string;
  address: string;
  description?: string;
  timezone: string;
  currency: string;
  maxGuests?: number;
  /** Каналы с внешними id (источник истины для интеграций). */
  channelListings?: PropertyChannelListing[];
  /** Legacy: первый канал / зеркало для совместимости. */
  otaPlatformId?: string | null;
  otaPlatform?: OtaPlatformRef | null;
  /** Legacy: внешний id Zodomus для первого канала. */
  zodomusPropertyId?: string | null;
  zodomusRoomId?: string | null;
  /**
   * Last known Zodomus listing status (`active` / `evaluation` / …).
   * Null when no external id is linked.
   */
  zodomusStatus?: ZodomusPropertyStatus | null;
  /** Raw upstream message for the last status probe. */
  zodomusStatusDetail?: string | null;
  /** When `zodomusStatus` was last refreshed from Zodomus. */
  zodomusStatusCheckedAt?: string | null;
  /** External iCal feed URLs for calendar import. */
  icalImportUrls?: string[];
  /** Meta WhatsApp Cloud API phone number id (routing inbound webhooks). */
  whatsappPhoneNumberId?: string | null;
  /** True when a WhatsApp token is stored (masked in API). */
  whatsappAccessTokenSet?: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type UpdateBookingDto = z.infer<typeof updateBookingSchema>;
export type TransitionBookingDto = z.infer<typeof transitionBookingSchema>;

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export type PaginationQuery = z.infer<typeof paginationSchema>;

export type SendChatMessageDto = z.infer<typeof sendChatMessageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;

export type ReplyAnalyticsQuery = z.infer<typeof replyAnalyticsQuerySchema>;

export interface ReplyAnalyticsPayload {
  ai: number;
  staff: number;
  /** Share of AI replies among assistant messages (0–100); null if none. */
  aiPercent: number | null;
  from: string;
  to: string;
}

export type ConversationPublicDto = z.infer<typeof conversationPublicSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ManagerReplyDto = z.infer<typeof managerReplySchema>;
export type AiDraftApproveDto = z.infer<typeof aiDraftApproveSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  error?: string;
}

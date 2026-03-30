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
} from './schemas/chat.schema';

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export type CreatePropertyDto = z.infer<typeof createPropertySchema>;
export type UpdatePropertyDto = z.infer<typeof updatePropertySchema>;

export interface Property {
  id: string;
  name: string;
  address: string;
  description?: string;
  timezone: string;
  currency: string;
  maxGuests?: number;
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

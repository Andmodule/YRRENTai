import { z } from 'zod';
import type { BookingComMessageMetadata } from './booking-com-email';
import { bookingComMessageMetadataSchema } from './booking-com-email';
import type { WhatsappInboundMessageMetadata } from './whatsapp-chat-metadata';
import { whatsappInboundMessageMetadataSchema } from './whatsapp-chat-metadata';
import type { StaffOutboundMessageMetadata } from './staff-outbound-metadata';
import { staffOutboundMessageMetadataSchema } from './staff-outbound-metadata';

/** One file row mirrored into `chat_messages.metadata` for EMAIL channel (Unified Inbox). */
export const emailInboundAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
});

export type EmailInboundAttachment = z.infer<typeof emailInboundAttachmentSchema>;

export const emailInboundMessageMetadataSchema = z.object({
  channel: z.literal('email_inbound'),
  messagingMessageId: z.string().uuid(),
  attachments: z.array(emailInboundAttachmentSchema),
  /** When the body was also parsed as Booking.com, keep structured card + attachments. */
  bookingCom: bookingComMessageMetadataSchema.optional(),
});

export type EmailInboundMessageMetadata = z.infer<typeof emailInboundMessageMetadataSchema>;

/** Persisted JSON on `chat_messages.metadata` (Booking.com, email + R2, WhatsApp + R2). */
export type ChatMessageMetadata =
  | BookingComMessageMetadata
  | EmailInboundMessageMetadata
  | WhatsappInboundMessageMetadata
  | StaffOutboundMessageMetadata;

export const chatMessageMetadataUnionSchema = z.union([
  bookingComMessageMetadataSchema,
  emailInboundMessageMetadataSchema,
  whatsappInboundMessageMetadataSchema,
  staffOutboundMessageMetadataSchema,
]);

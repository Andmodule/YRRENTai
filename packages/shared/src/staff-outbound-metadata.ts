import { z } from 'zod';

/** Persisted on `chat_messages.metadata` for staff assistant messages with outbound files (R2 keys). */
export const staffOutboundAttachmentStoredSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  /** Omitted in API/WebSocket payloads (server keeps it in DB only). */
  storageKey: z.string().optional(),
});

export type StaffOutboundAttachmentStored = z.infer<typeof staffOutboundAttachmentStoredSchema>;

export const staffOutboundMessageMetadataSchema = z.object({
  channel: z.literal('staff_outbound'),
  attachments: z.array(staffOutboundAttachmentStoredSchema),
});

export type StaffOutboundMessageMetadata = z.infer<typeof staffOutboundMessageMetadataSchema>;

/** API/WebSocket payload: no storage keys. */
export type StaffOutboundAttachmentPublic = Omit<StaffOutboundAttachmentStored, 'storageKey'>;

export function staffOutboundMetadataForClient(
  meta: StaffOutboundMessageMetadata,
): { channel: 'staff_outbound'; attachments: StaffOutboundAttachmentPublic[] } {
  return {
    channel: 'staff_outbound',
    attachments: meta.attachments.map(({ id, fileName, contentType, sizeBytes }) => ({
      id,
      fileName,
      contentType,
      sizeBytes,
    })),
  };
}

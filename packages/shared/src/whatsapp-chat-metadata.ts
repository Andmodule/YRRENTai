import { z } from 'zod';

/** WhatsApp Cloud API inbound message kinds we persist. */
export const whatsappWaTypeSchema = z.enum([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
  'reaction',
  'order',
  'system',
  'unsupported',
]);

export type WhatsappWaType = z.infer<typeof whatsappWaTypeSchema>;

export const whatsappInboundMessageMetadataSchema = z.object({
  channel: z.literal('whatsapp_inbound'),
  waType: whatsappWaTypeSchema,
  /** Meta media id (before download to R2). */
  waMediaId: z.string().optional(),
  /** R2/S3 key after upload (private bucket). */
  storageKey: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  sizeBytes: z.number().optional(),
  caption: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  locationName: z.string().optional(),
  locationAddress: z.string().optional(),
  /** Original webhook `messages[0].type` when mapped to `unsupported`. */
  rawWaType: z.string().optional(),
  /** For reactions: target message wamid. */
  reactionMessageId: z.string().optional(),
  reactionEmoji: z.string().optional(),
});

export type WhatsappInboundMessageMetadata = z.infer<typeof whatsappInboundMessageMetadataSchema>;

import type { MessagingChannel } from './entities/messaging-thread.entity';

/** Parsed from Resend webhook / receiving API `attachments` array. */
export interface InboundAttachmentMeta {
  filename: string;
  sizeBytes: number | null;
}

/** Binary + MIME from Resend attachment list + `download_url` fetch (inbound pipeline). */
export interface InboundAttachmentFile {
  filename: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
}

/**
 * Normalize Resend inbound attachment objects (field names vary; extra keys ignored).
 */
export function parseResendInboundAttachments(raw: unknown): InboundAttachmentMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: InboundAttachmentMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name =
      (typeof o.filename === 'string' && o.filename.trim()) ||
      (typeof o.name === 'string' && o.name.trim()) ||
      (typeof o.file_name === 'string' && o.file_name.trim()) ||
      '';
    if (!name) continue;
    let sizeBytes: number | null = null;
    if (typeof o.size === 'number' && Number.isFinite(o.size)) {
      sizeBytes = o.size;
    } else if (typeof o.size === 'string') {
      const n = parseInt(o.size, 10);
      sizeBytes = Number.isFinite(n) ? n : null;
    } else if (typeof o.content_length === 'number') {
      sizeBytes = o.content_length;
    }
    out.push({ filename: name, sizeBytes });
  }
  return out;
}

/**
 * Short hint for the LLM: guest sent file(s); filenames stay out of model text (UI shows chips / Telegram sends files).
 */
export function formatAttachmentsForAgent(attachments: InboundAttachmentMeta[]): string {
  if (!attachments.length) return '';
  return attachments.length === 1
    ? 'The guest attached a file to this email (content not inlined).'
    : `The guest attached ${attachments.length} files to this email (content not inlined).`;
}

/**
 * Text passed to the agent / KB: optional attachment lines + normalized inquiry body.
 * `extractBookingInquiry` should be {@link MessageParserService#extractBookingGuestInquiryForAgent} for booking, else identity on trimmed clean text.
 */
export function buildGuestAgentText(
  channel: MessagingChannel,
  cleanText: string,
  subjectTrim: string,
  attachments: InboundAttachmentMeta[],
  extractBookingInquiry: (t: string) => string,
): string {
  const attBlock = formatAttachmentsForAgent(attachments);
  const inquiry =
    channel === 'booking'
      ? extractBookingInquiry(cleanText.trim())
      : cleanText.trim();

  const parts: string[] = [];
  if (attBlock) parts.push(attBlock);
  if (inquiry) parts.push(inquiry);

  let combined = parts.join('\n\n').trim();

  if (!combined) {
    combined = subjectTrim.trim() || 'The guest sent an empty or non-text message.';
  } else if (!inquiry) {
    if (subjectTrim.trim()) {
      combined = attBlock ? `${attBlock}\n\n${subjectTrim.trim()}` : subjectTrim.trim();
    }
  }

  return combined;
}

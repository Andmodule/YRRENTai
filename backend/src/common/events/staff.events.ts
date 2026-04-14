import type { ChatMessageMetadata } from '@rentai/shared';

export class StaffRepliedEvent {
  constructor(
    public readonly propertyId: string,
    public readonly messageId: string,
    public readonly content: string,
    public readonly createdAt: string,
    public readonly conversationId?: string,
    public readonly channel?: string,
    public readonly deliveryStatus?: string,
    /** Sanitized for clients (e.g. no R2 keys on staff attachments). */
    public readonly metadata?: ChatMessageMetadata | null,
  ) {}
}

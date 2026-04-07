import type { MessagingMessageRole } from '../entities/messaging-message.entity';

export interface MessagingAttachmentPublicDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface MessagingMessagePublicDto {
  id: string;
  threadId: string;
  role: MessagingMessageRole;
  text: string;
  agentText: string | null;
  rawEmailId: string | null;
  sentAt: string | null;
  createdAt: string;
  attachments: MessagingAttachmentPublicDto[];
}

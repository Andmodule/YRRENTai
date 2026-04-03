/** Emitted after staff reply is persisted and pushed to sockets — relay to guest email when applicable. */
export const STAFF_REPLY_EMAIL_RELAY_EVENT = 'messaging.staffReplyEmailRelay' as const;

export interface StaffReplyEmailRelayPayload {
  conversationId: string;
  content: string;
}

import type { ConversationChannel } from '@rentai/shared';
import { CONVERSATION_CHANNEL } from '@rentai/shared';
import { MessageChannel } from './enums/message-channel.enum';

/** Maps inbox conversation channel to persisted per-message routing channel. */
export function conversationChannelToMessageChannel(channel: ConversationChannel): MessageChannel {
  switch (channel) {
    case CONVERSATION_CHANNEL.WEB_APP:
    case CONVERSATION_CHANNEL.BOOKING_COM:
      return MessageChannel.BOOKING_API;
    case CONVERSATION_CHANNEL.EMAIL:
      return MessageChannel.EMAIL;
    case CONVERSATION_CHANNEL.TELEGRAM:
      return MessageChannel.TELEGRAM;
    case CONVERSATION_CHANNEL.WHATSAPP:
      return MessageChannel.WHATSAPP;
    default:
      return MessageChannel.BOOKING_API;
  }
}

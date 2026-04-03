import { Injectable } from '@nestjs/common';
import { parseBookingComEmail, type BookingComMessageMetadata } from '@rentai/shared';
import { ChatService } from './chat.service';

@Injectable()
export class BookingComMetadataService {
  constructor(private readonly chatService: ChatService) {}

  /**
   * When inbound text matches a Booking.com notification, returns structured metadata.
   * First message for this reservation in the thread → `full`; later → `followup` (UI shows question only).
   */
  async buildForUserMessage(
    conversationId: string,
    content: string,
  ): Promise<BookingComMessageMetadata | null> {
    const parsed = parseBookingComEmail(content);
    if (!parsed) return null;

    const prior = await this.chatService.countPriorBookingComUserMessages(
      conversationId,
      parsed.bookingNumber,
    );
    const variant: BookingComMessageMetadata['variant'] = prior > 0 ? 'followup' : 'full';

    return {
      channel: 'booking_com',
      variant,
      bookingNumber: parsed.bookingNumber,
      guestName: parsed.guestName,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      propertyName: parsed.propertyName,
      guestQuestion: parsed.guestQuestion,
    };
  }
}

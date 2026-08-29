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
    opts?: { hotelIdFromEmail?: string | null; guestEmailHint?: string | null },
  ): Promise<BookingComMessageMetadata | null> {
    const parsed = parseBookingComEmail(content);
    if (!parsed) return null;

    const prior = await this.chatService.countPriorBookingComUserMessages(
      conversationId,
      parsed.bookingNumber,
    );
    const variant: BookingComMessageMetadata['variant'] = prior > 0 ? 'followup' : 'full';

    const hotelIdHint = opts?.hotelIdFromEmail?.trim();
    const hotelId = hotelIdHint || parsed.hotelId;

    const hintEmail = opts?.guestEmailHint?.trim().toLowerCase();
    const guestEmail =
      (hintEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hintEmail) ? hintEmail : undefined) ??
      parsed.guestEmail;

    return {
      channel: 'booking_com',
      variant,
      bookingNumber: parsed.bookingNumber,
      guestName: parsed.guestName,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      propertyName: parsed.propertyName,
      guestQuestion: parsed.guestQuestion,
      ...(guestEmail ? { guestEmail } : {}),
      ...(parsed.totalGuests ? { totalGuests: parsed.totalGuests } : {}),
      ...(parsed.totalRooms ? { totalRooms: parsed.totalRooms } : {}),
      ...(hotelId ? { hotelId } : {}),
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { BookingEntity } from '../booking/entities/booking.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export interface VoiceContextBundle {
  propertyContext: string;
  kbContext: string;
  reservationContext: string;
  kbSourceIds: string[];
}

@Injectable()
export class VoiceKbService {
  private readonly logger = new Logger(VoiceKbService.name);

  constructor(
    private readonly kbService: KnowledgeBaseService,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
  ) {}

  /**
   * Builds a compact, voice-optimised context bundle.
   * Prioritises short, fact-dense content over long narratives.
   */
  async buildContextBundle(input: {
    propertyId: string | null;
    reservationId: string | null;
    guestQuery: string;
  }): Promise<VoiceContextBundle> {
    const { propertyId, reservationId, guestQuery } = input;

    const [propertyContext, reservationContext] = await Promise.all([
      propertyId ? this.buildPropertyContext(propertyId) : Promise.resolve(''),
      reservationId ? this.buildReservationContext(reservationId) : Promise.resolve(''),
    ]);

    let kbContext = '';
    const kbSourceIds: string[] = [];

    if (propertyId) {
      try {
        const result = await this.kbService.searchRelevant(propertyId, guestQuery, 5);
        if (!result.isWeakMatch && result.entries.length > 0) {
          kbContext = result.entries
            .map((e) => `[${e.title}]: ${e.content.slice(0, 400)}`)
            .join('\n---\n');
          kbSourceIds.push(...result.entries.map((e) => e.id));
        } else if (result.entries.length > 0) {
          // Weak match — include but flag for policy
          kbContext = result.entries
            .slice(0, 3)
            .map((e) => `[${e.title}]: ${e.content.slice(0, 300)}`)
            .join('\n---\n');
          kbSourceIds.push(...result.entries.slice(0, 3).map((e) => e.id));
        }
      } catch (err) {
        this.logger.warn(`KB search failed: ${(err as Error).message}`);
      }
    }

    return { propertyContext, kbContext, reservationContext, kbSourceIds };
  }

  private async buildPropertyContext(propertyId: string): Promise<string> {
    const property = await this.propertyRepo.findOne({ where: { id: propertyId } });
    if (!property) return '';

    return [
      `Объект: ${property.name}`,
      `Адрес: ${property.address}, ${property.city}, ${property.country}`,
      property.description ? `Описание: ${property.description.slice(0, 300)}` : '',
      `Макс. гостей: ${property.maxGuests ?? 'н/у'}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async buildReservationContext(reservationId: string): Promise<string> {
    const booking = await this.bookingRepo.findOne({ where: { id: reservationId } });
    if (!booking) return '';

    const checkIn = booking.checkIn.toLocaleDateString('ru-RU');
    const checkOut = booking.checkOut.toLocaleDateString('ru-RU');

    return [
      `Бронь: ${booking.guestName}`,
      `Заезд: ${checkIn}, Выезд: ${checkOut}`,
      `Статус: ${booking.status}`,
      `Гостей: ${booking.guestsCount ?? '—'}`,
      booking.notes ? `Заметки: ${booking.notes.slice(0, 200)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ZODOMUS_CLIENT } from './zodomus.tokens';
import { ZodomusClient } from './zodomus.client';
import type {
  ZodomusAccount,
  ZodomusChannel,
  ZodomusReservation,
  ZodomusReservationQueueItem,
} from './zodomus.types';

@Injectable()
export class ZodomusService {
  private readonly logger = new Logger(ZodomusService.name);

  constructor(
    @Optional() @Inject(ZODOMUS_CLIENT)
    private readonly client: ZodomusClient | null,
  ) {}

  get isEnabled(): boolean {
    return this.client !== null;
  }

  private ensureEnabled(): ZodomusClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Zodomus integration is disabled (set ZODOMUS_ENABLED=true and credentials)',
      );
    }
    return this.client;
  }

  async getAccount(): Promise<ZodomusAccount> {
    return this.ensureEnabled().get<ZodomusAccount>('/account');
  }

  async getChannels(): Promise<ZodomusChannel[]> {
    const res = await this.ensureEnabled().get<unknown>('/channels');
    return this.normalizeArray(res);
  }

  /** Список моделей цен для канала — нужен `priceModelId` для POST /property-activation */
  async getPriceModels(channelId: number): Promise<unknown> {
    return this.ensureEnabled().get<unknown>('/price-model', {
      channelId: String(channelId),
    });
  }

  /** Комнаты и тарифы из OTA для объекта — источник корректных roomId/rateId для POST /rooms-activation */
  async getRoomRates(channelId: number, propertyId: string): Promise<unknown> {
    return this.ensureEnabled().get<unknown>('/room-rates', {
      channelId: String(channelId),
      propertyId,
    });
  }

  async getReservationQueue(
    channelId: number,
    propertyId: string,
  ): Promise<ZodomusReservationQueueItem[]> {
    const res = await this.ensureEnabled().get<unknown>('/reservations-queue', {
      channelId: String(channelId),
      propertyId,
    });
    return this.normalizeArray(res);
  }

  async getReservation(channelId: number, reservationId: string): Promise<ZodomusReservation> {
    return this.ensureEnabled().get<ZodomusReservation>('/reservations', {
      channelId: String(channelId),
      reservationId,
    });
  }

  /**
   * Confirm queue item processed — path may differ; adjust per official Zodomus docs.
   */
  async ackReservation(channelId: number, reservationId: string): Promise<void> {
    await this.ensureEnabled().post('/reservations-queue/ack', { channelId, reservationId });
  }

  async setAvailability(
    channelId: number,
    propertyId: string,
    roomId: string,
    dates: Array<{ date: string; available: number }>,
  ): Promise<void> {
    await this.ensureEnabled().post('/availability', { channelId, propertyId, roomId, dates });
  }

  /** Маппинг комнат/тарифов OTA — см. GET /property-check → `mappedProducts`, затем POST /rooms-activation */
  async activateRooms(
    channelId: number,
    propertyId: string,
    rooms: Array<{ roomId: string; rateId: string; priceModelId: string | number }>,
  ): Promise<unknown> {
    return this.ensureEnabled().post('/rooms-activation', {
      channelId,
      propertyId,
      rooms,
    });
  }

  private normalizeArray<T>(res: unknown): T[] {
    if (Array.isArray(res)) return res as T[];
    if (res && typeof res === 'object' && 'channels' in res && Array.isArray((res as { channels: unknown }).channels)) {
      return (res as { channels: T[] }).channels;
    }
    if (res && typeof res === 'object' && 'items' in res && Array.isArray((res as { items: unknown }).items)) {
      return (res as { items: T[] }).items;
    }
    this.logger.warn('Unexpected Zodomus list shape; returning empty array');
    return [];
  }
}

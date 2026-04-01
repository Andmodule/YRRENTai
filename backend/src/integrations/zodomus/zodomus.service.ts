import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ZODOMUS_CLIENT } from './zodomus.tokens';
import { ZodomusClient } from './zodomus.client';
import type {
  ZodomusAccount,
  ZodomusChannel,
  ZodomusReservation,
  ZodomusReservationQueueItem,
  ZodomusRoomActivationRoom,
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

  /**
   * GET /price-model — No request payload per Zodomus docs.
   * `channelId` is NOT sent as a query param.
   */
  async getPriceModels(): Promise<unknown> {
    return this.ensureEnabled().get<unknown>('/price-model');
  }

  /** Комнаты и тарифы из OTA для объекта — источник корректных roomId/rateId для POST /rooms-activation */
  async getRoomRates(channelId: number, propertyId: string): Promise<unknown> {
    const res = await this.ensureEnabled().get<unknown>('/room-rates', {
      channelId: String(channelId),
      propertyId,
    });
    return this.normalizeArray(res);
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

  /** Zodomus requires `propertyId` on GET /reservations (same external id as for reservations-queue).
   *  Calling this endpoint automatically removes the reservation from the queue (no separate ACK needed). */
  async getReservation(
    channelId: number,
    reservationId: string,
    propertyId: string,
  ): Promise<ZodomusReservation> {
    const raw = await this.ensureEnabled().get<unknown>('/reservations', {
      channelId: String(channelId),
      reservationId,
      propertyId,
    });
    return this.normalizeReservation(raw, reservationId);
  }

  /**
   * GET /reservations-summary — returns all active future reservations for a property.
   * Used for initial onboarding to populate historical/future bookings without waiting for queue events.
   */
  async getReservationSummary(
    channelId: number,
    propertyId: string,
  ): Promise<ZodomusReservation[]> {
    const raw = await this.ensureEnabled().get<unknown>('/reservations-summary', {
      channelId: String(channelId),
      propertyId,
    });
    const list = this.normalizeArray<unknown>(raw);
    return list.map((item, i) => this.normalizeReservation(item, `summary-${i}`));
  }

  /**
   * POST /availability — set room availability for a date range.
   * Correct format per Zodomus docs: dateFrom/dateTo/availability (not dates[]).
   */
  async setAvailability(
    channelId: number,
    propertyId: string,
    roomId: string,
    dateFrom: string,
    dateTo: string,
    availability: number,
  ): Promise<void> {
    await this.ensureEnabled().post('/availability', {
      channelId,
      propertyId,
      roomId,
      dateFrom,
      dateTo,
      availability,
    });
  }

  /**
   * POST /rooms-activation — формат из гайда Zodomus: roomName, quantity, status, rates[] (id тарифов).
   */
  async activateRooms(
    channelId: number,
    propertyId: string,
    rooms: ZodomusRoomActivationRoom[],
  ): Promise<unknown> {
    return this.ensureEnabled().post('/rooms-activation', {
      channelId,
      propertyId,
      rooms,
    });
  }

  /**
   * Normalizes any Zodomus list response to a typed array.
   * Handles: plain array, { channels[] }, { items[] }, { reservations[] }, { rooms[] }.
   */
  private normalizeArray<T>(res: unknown): T[] {
    if (Array.isArray(res)) return res as T[];
    if (!res || typeof res !== 'object') {
      this.logger.warn('Unexpected Zodomus list shape; returning empty array');
      return [];
    }
    const o = res as Record<string, unknown>;
    for (const key of ['channels', 'items', 'reservations', 'rooms', 'rates', 'properties']) {
      if (Array.isArray(o[key])) return o[key] as T[];
    }
    this.logger.warn(`Unexpected Zodomus list shape (keys: ${Object.keys(o).join(',')}); returning []`);
    return [];
  }

  /**
   * GET /reservations may return a flat object, `{ reservation: {...} }`, `reservations[]`, or (live API)
   * `{ reservations: { reservation, customer, rooms[] } }`.
   * Ensures `reservationId` is set (from body or query id).
   */
  private normalizeReservation(raw: unknown, fallbackId: string): ZodomusReservation {
    const fid = String(fallbackId ?? '').trim();
    let obj: Record<string, unknown> | null = null;

    if (raw == null) {
      return { reservationId: fid };
    }
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        obj = first as Record<string, unknown>;
      }
    } else if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      const block = o.reservations;
      const blockRec =
        block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>) : null;
      if (
        blockRec &&
        (this.isRecord(blockRec.reservation) ||
          this.isRecord(blockRec.customer) ||
          Array.isArray(blockRec.rooms))
      ) {
        obj = this.flattenZodomusReservationsBlock(blockRec);
      } else if (
        this.isRecord(o.reservation) &&
        (Array.isArray(o.rooms) || this.isRecord(o.customer))
      ) {
        obj = this.flattenZodomusReservationsBlock({
          reservation: o.reservation,
          customer: this.isRecord(o.customer) ? o.customer : {},
          rooms: Array.isArray(o.rooms) ? o.rooms : [],
        });
      } else if (this.isRecord(o.reservation)) {
        obj = o.reservation as Record<string, unknown>;
      } else if (Array.isArray(o.reservations) && o.reservations[0] && typeof o.reservations[0] === 'object') {
        obj = o.reservations[0] as Record<string, unknown>;
      } else {
        obj = o;
      }
    }

    if (!obj) {
      return { reservationId: fid };
    }

    const rid = String(obj.reservationId ?? obj.id ?? fid).trim();
    const merged = { ...obj, reservationId: rid || fid } as ZodomusReservation;
    return merged;
  }

  private isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** Live Zodomus: `reservations: { reservation, customer, rooms[] }` — merge into one flat shape for upsertBooking. */
  private flattenZodomusReservationsBlock(rb: Record<string, unknown>): Record<string, unknown> {
    const resObj = this.isRecord(rb.reservation) ? { ...rb.reservation } : {};
    const cust = this.isRecord(rb.customer) ? rb.customer : {};
    const rooms = Array.isArray(rb.rooms) ? rb.rooms : [];
    const firstRoom = rooms[0] && this.isRecord(rooms[0]) ? rooms[0] : null;

    const numPrice = (v: unknown): number | undefined => {
      if (v == null || v === '') return undefined;
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    };

    return {
      ...resObj,
      guestFirstName: cust.firstName,
      guestLastName: cust.lastName,
      guestEmail: cust.email,
      currency: (resObj.currencyCode ?? resObj.currency) as unknown,
      checkIn: (firstRoom?.arrivalDate ?? resObj.checkIn) as unknown,
      checkOut: (firstRoom?.departureDate ?? resObj.checkOut) as unknown,
      totalPrice: numPrice(resObj.totalPrice),
      status:
        resObj.status !== undefined && resObj.status !== null ? String(resObj.status) : undefined,
    };
  }
}

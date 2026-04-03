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

  /** Полное тело GET /room-rates (для превью объекта до сохранения в БД). */
  async getRoomRatesRaw(channelId: number, propertyId: string): Promise<unknown> {
    return this.ensureEnabled().get<unknown>('/room-rates', {
      channelId: String(channelId),
      propertyId: propertyId.trim(),
    });
  }

  /** Комнаты и тарифы из OTA для объекта — источник корректных roomId/rateId для POST /rooms-activation */
  async getRoomRates(channelId: number, propertyId: string): Promise<unknown> {
    const res = await this.getRoomRatesRaw(channelId, propertyId);
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
   * GET /availability — room availability for channel/property/date range (upstream query params).
   */
  async getAvailability(
    channelId: number,
    propertyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<unknown> {
    return this.ensureEnabled().get<unknown>('/availability', {
      channelId: String(channelId),
      propertyId,
      dateFrom,
      dateTo,
    });
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
   * POST /reservations-createtest — sandbox-only test reservation; triggers webhook if configured.
   * Upstream body per Zodomus: channelId, propertyId (OTA string), status, optional reservationId.
   */
  async createTestReservation(
    channelId: number,
    propertyId: string,
    opts: { status: string; reservationId?: string },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      channelId,
      propertyId,
      status: opts.status,
    };
    const rid = opts.reservationId?.trim();
    if (rid) body.reservationId = rid;
    return this.ensureEnabled().post('/reservations-createtest', body);
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
    let merged: ZodomusReservation = { ...obj, reservationId: rid || fid } as ZodomusReservation;
    const m = merged as Record<string, unknown>;

    /**
     * GET /reservations-summary (and some alternate shapes) may return `customer` / `rooms` at the top level
     * without going through the earlier flatten branches — then `guestEmail` never lands on the root and upsert skips it.
     */
    const hasNestedGuestShape =
      this.isRecord(m.customer) ||
      Array.isArray(m.rooms) ||
      (this.isRecord(m.reservation) && (this.isRecord(m.customer) || Array.isArray(m.rooms)));

    if (hasNestedGuestShape) {
      const resForFlat = this.isRecord(m.reservation)
        ? (m.reservation as Record<string, unknown>)
        : (Object.fromEntries(
            Object.entries(m).filter(([k]) => k !== 'customer' && k !== 'rooms'),
          ) as Record<string, unknown>);
      const flat = this.flattenZodomusReservationsBlock({
        reservation: resForFlat,
        customer: this.isRecord(m.customer) ? m.customer : {},
        rooms: Array.isArray(m.rooms) ? m.rooms : [],
      });
      const rid2 = String(flat.reservationId ?? m.reservationId ?? m.id ?? fid).trim();
      merged = { ...m, ...flat, reservationId: rid2 || fid } as ZodomusReservation;
    }

    return merged;
  }

  private isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * Booking / Airbnb may return `phone` as a string (with or without +) or as `{ countryCode, number }`.
   * `phoneCountryCode` on the customer is often merged when the string has no leading +.
   */
  private normalizeCustomerPhone(cust: Record<string, unknown>): string {
    const str = (v: unknown): string => {
      if (v == null || v === '') return '';
      return String(v).trim();
    };

    const rawPhone = cust.phone;
    if (this.isRecord(rawPhone)) {
      const o = rawPhone;
      const cc = str(o.countryCode ?? o.phoneCountryCode);
      const num = str(o.number ?? o.nationalNumber ?? o.phoneNumber ?? o.raw);
      if (!num && !cc) return '';
      if (num.startsWith('+')) return num;
      const ccNorm = cc.replace(/^\+/, '');
      if (ccNorm && num) return `+${ccNorm} ${num}`.replace(/^\++/, '+');
      return num || `+${ccNorm}`;
    }

    const phoneRaw = str(rawPhone);
    const ccExtra = str(cust.phoneCountryCode);
    if (phoneRaw.length === 0) return '';
    if (phoneRaw.startsWith('+')) return phoneRaw;
    if (ccExtra.length > 0) {
      const ccNoPlus = ccExtra.replace(/^\+/, '');
      return `+${ccNoPlus} ${phoneRaw}`.trim();
    }
    return phoneRaw;
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

    const str = (v: unknown): string => {
      if (v == null || v === '') return '';
      return String(v).trim();
    };

    const guestPhone = this.normalizeCustomerPhone(cust) || undefined;

    const adults = Number(firstRoom?.numberOfAdults ?? 0);
    const childrenRaw = firstRoom?.numberOChildren ?? (firstRoom as Record<string, unknown>)?.numberOfChildren;
    const children = Number(childrenRaw ?? 0);
    const numGuests = Number(firstRoom?.numberOfGuests ?? 0);
    const adultsN = Number.isFinite(adults) ? adults : 0;
    const childrenN = Number.isFinite(children) ? children : 0;
    const sumAC = adultsN + childrenN;
    const numGuestsN = Number.isFinite(numGuests) && numGuests > 0 ? Math.round(numGuests) : 0;

    let guestsCount: number | undefined;
    let guestBreakdownFromRoom: boolean | undefined;
    let guestAdults: number | undefined;
    let guestChildren: number | undefined;

    if (firstRoom && sumAC > 0) {
      guestsCount = Math.min(999, sumAC);
      guestBreakdownFromRoom = true;
      guestAdults = Math.min(999, Math.round(adultsN));
      guestChildren = Math.min(999, Math.round(childrenN));
    } else if (firstRoom && numGuestsN > 0) {
      guestsCount = numGuestsN;
      guestBreakdownFromRoom = false;
    }

    const noteLines: string[] = [];
    const cr = str(cust.remarks);
    const rr = str(resObj.remarks);
    const rmr = str(firstRoom?.remarks);
    const meal = str(firstRoom?.mealPlan);
    if (cr) noteLines.push(cr);
    if (rr) noteLines.push(rr);
    if (rmr) noteLines.push(rmr);
    if (meal) noteLines.push(meal);
    const notesMerged = noteLines.length > 0 ? noteLines.join('\n\n') : undefined;

    return {
      ...resObj,
      guestFirstName: cust.firstName,
      guestLastName: cust.lastName,
      guestEmail: cust.email,
      guestPhone,
      guestsCount,
      guestBreakdownFromRoom,
      guestAdults,
      guestChildren,
      notes: notesMerged,
      currency: (resObj.currencyCode ?? resObj.currency) as unknown,
      checkIn: (firstRoom?.arrivalDate ?? resObj.checkIn) as unknown,
      checkOut: (firstRoom?.departureDate ?? resObj.checkOut) as unknown,
      totalPrice: numPrice(resObj.totalPrice),
      status:
        resObj.status !== undefined && resObj.status !== null ? String(resObj.status) : undefined,
    };
  }
}

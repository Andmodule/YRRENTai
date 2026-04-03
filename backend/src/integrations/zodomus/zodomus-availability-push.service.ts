import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { ZodomusService } from './zodomus.service';

/** Statuses that do not block inventory on OTAs. */
const NON_BLOCKING = new Set<string>([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DECLINED]);

export type PushAvailabilityOptions = {
  /** When true, push even if ZODOMUS_AUTO_PUSH_AVAILABILITY is false (manual, dirty retry, nightly). */
  ignoreAutoPushDisable?: boolean;
};

@Injectable()
export class ZodomusAvailabilityPushService implements OnModuleDestroy {
  private readonly logger = new Logger(ZodomusAvailabilityPushService.name);
  private readonly pendingByProperty = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly zodomus: ZodomusService,
    private readonly config: ConfigService,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  onModuleDestroy(): void {
    for (const t of this.pendingByProperty.values()) {
      clearTimeout(t);
    }
    this.pendingByProperty.clear();
  }

  /**
   * Debounced push after local booking / iCal / sync events (coalesces bursts, reduces race overlap).
   * Respects ZODOMUS_AUTO_PUSH_AVAILABILITY unless you use pushAvailabilityNow with ignoreAutoPushDisable.
   */
  scheduleAvailabilityPush(propertyId: string): void {
    const debounceMs = this.config.get<number>('ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS') ?? 2000;
    const run = () => {
      void this.pushAvailabilityNow(propertyId).catch((e) =>
        this.logger.warn(`Debounced Zodomus availability push failed for ${propertyId}: ${String(e)}`),
      );
    };
    if (debounceMs <= 0) {
      run();
      return;
    }
    const existing = this.pendingByProperty.get(propertyId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingByProperty.delete(propertyId);
      run();
    }, debounceMs);
    this.pendingByProperty.set(propertyId, timer);
  }

  /**
   * Immediate full push. On success clears zodomusAvailabilityDirty; on failure sets dirty for cron retry.
   * Manual and batch jobs should pass { ignoreAutoPushDisable: true } so push runs when event-driven auto is off.
   */
  async pushAvailabilityNow(propertyId: string, options?: PushAvailabilityOptions): Promise<void> {
    try {
      const didPush = await this.executePush(propertyId, options);
      if (didPush) await this.clearDirty(propertyId);
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) {
        await this.markDirty(propertyId);
      }
      throw e;
    }
  }

  /** Cron: retry all properties flagged after a failed push. */
  async retryDirtyProperties(): Promise<void> {
    if (!this.zodomus.isEnabled) return;
    const rows = await this.propertyRepo.find({
      where: {
        zodomusAvailabilityDirty: true,
        zodomusPropertyId: Not(IsNull()),
      },
      select: { id: true },
    });
    if (rows.length === 0) return;
    const gap = this.config.get<number>('ZODOMUS_AVAILABILITY_BATCH_GAP_MS') ?? 1000;
    this.logger.log(`Zodomus availability dirty retry: ${rows.length} property(ies)`);
    for (const p of rows) {
      try {
        await this.pushAvailabilityNow(p.id, { ignoreAutoPushDisable: true });
      } catch (e) {
        this.logger.warn(`Dirty retry failed for ${p.id}: ${String(e)}`);
      }
      if (gap > 0) await this.sleep(gap);
    }
  }

  /** Nightly drift guard: push for every property with zodomusPropertyId. */
  async nightlyReconcileAll(): Promise<void> {
    const enabled = this.config.get<boolean>('ZODOMUS_AVAILABILITY_NIGHTLY_FULL_PUSH') ?? true;
    if (!enabled || !this.zodomus.isEnabled) return;
    const rows = await this.propertyRepo.find({
      where: { zodomusPropertyId: Not(IsNull()) },
      select: { id: true },
    });
    if (rows.length === 0) return;
    const gap = this.config.get<number>('ZODOMUS_AVAILABILITY_BATCH_GAP_MS') ?? 1000;
    this.logger.log(`Zodomus nightly availability reconcile: ${rows.length} property(ies)`);
    for (const p of rows) {
      try {
        await this.pushAvailabilityNow(p.id, { ignoreAutoPushDisable: true });
      } catch (e) {
        this.logger.warn(`Nightly reconcile failed for ${p.id}: ${String(e)}`);
      }
      if (gap > 0) await this.sleep(gap);
    }
  }

  /** @returns true if at least one segment was sent to Zodomus. */
  private async executePush(propertyId: string, options?: PushAvailabilityOptions): Promise<boolean> {
    const auto = this.config.get<boolean>('ZODOMUS_AUTO_PUSH_AVAILABILITY') ?? true;
    if (!auto && !options?.ignoreAutoPushDisable) return false;
    if (!this.zodomus.isEnabled) {
      throw new ServiceUnavailableException('Zodomus integration is disabled');
    }

    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['otaPlatform'],
    });
    if (!property) return false;
    const extProp = property.zodomusPropertyId?.trim();
    if (!extProp) return false;

    const channelId =
      property.otaPlatform?.zodomusChannelId ??
      this.config.get<number>('ZODOMUS_DEFAULT_CHANNEL_ID') ??
      1;
    const horizonDays = Math.min(
      730,
      Math.max(1, this.config.get<number>('ZODOMUS_AVAILABILITY_HORIZON_DAYS') ?? 366),
    );

    const roomId = await this.resolveRoomId(property, channelId);
    if (!roomId) {
      this.logger.warn(
        `Zodomus availability: no room id for property ${propertyId} — set zodomusRoomId or ensure GET /room-rates returns rooms`,
      );
      return false;
    }

    const tz = property.timezone?.trim() || 'UTC';
    const now = new Date();
    const todayKey = formatInTimeZone(now, tz, 'yyyy-MM-dd');

    const bookings = await this.bookingRepo.find({ where: { propertyId } });
    const blocking = bookings.filter((b) => !NON_BLOCKING.has(String(b.status)));

    const days: { key: string; availability: number }[] = [];
    for (let i = 0; i < horizonDays; i++) {
      const d = addDays(fromZonedTime(`${todayKey}T12:00:00`, tz), i);
      const nightKey = formatInTimeZone(d, tz, 'yyyy-MM-dd');
      const occupied = blocking.some((b) => this.nightOverlapsBooking(nightKey, b, tz));
      days.push({ key: nightKey, availability: occupied ? 0 : 1 });
    }

    const segments = this.mergeSegments(days, tz);
    if (segments.length > 200) {
      this.logger.warn(`Zodomus availability: ${segments.length} segments for ${propertyId}`);
    }

    for (const seg of segments) {
      await this.zodomus.setAvailability(
        channelId,
        extProp,
        roomId,
        seg.dateFrom,
        seg.dateToExclusive,
        seg.availability,
      );
    }

    this.logger.log(
      `Zodomus availability: property ${propertyId} — ${segments.length} range(s), ${horizonDays} nights`,
    );
    return true;
  }

  private async markDirty(propertyId: string): Promise<void> {
    await this.propertyRepo
      .createQueryBuilder()
      .update(PropertyEntity)
      .set({ zodomusAvailabilityDirty: true })
      .where('id = :id', { id: propertyId })
      .andWhere('zodomusPropertyId IS NOT NULL')
      .execute();
  }

  private async clearDirty(propertyId: string): Promise<void> {
    await this.propertyRepo
      .createQueryBuilder()
      .update(PropertyEntity)
      .set({ zodomusAvailabilityDirty: false })
      .where('id = :id', { id: propertyId })
      .andWhere('zodomusPropertyId IS NOT NULL')
      .execute();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private nightOverlapsBooking(nightKey: string, b: BookingEntity, tz: string): boolean {
    const ci = formatInTimeZone(b.checkIn, tz, 'yyyy-MM-dd');
    const co = formatInTimeZone(b.checkOut, tz, 'yyyy-MM-dd');
    return ci <= nightKey && nightKey < co;
  }

  private mergeSegments(
    days: { key: string; availability: number }[],
    tz: string,
  ): Array<{ dateFrom: string; dateToExclusive: string; availability: number }> {
    const first = days[0];
    if (!first) return [];
    const out: Array<{ dateFrom: string; dateToExclusive: string; availability: number }> = [];
    let segStart = first.key;
    let segAvail = first.availability;
    for (let i = 1; i < days.length; i++) {
      const d = days[i];
      const prev = days[i - 1];
      if (!d || !prev) continue;
      if (d.availability === segAvail) continue;
      out.push({
        dateFrom: segStart,
        dateToExclusive: this.dayAfterInTz(prev.key, tz),
        availability: segAvail,
      });
      segStart = d.key;
      segAvail = d.availability;
    }
    const last = days[days.length - 1];
    if (last) {
      out.push({
        dateFrom: segStart,
        dateToExclusive: this.dayAfterInTz(last.key, tz),
        availability: segAvail,
      });
    }
    return out;
  }

  private dayAfterInTz(nightKey: string, tz: string): string {
    const d = addDays(fromZonedTime(`${nightKey}T12:00:00`, tz), 1);
    return formatInTimeZone(d, tz, 'yyyy-MM-dd');
  }

  private async resolveRoomId(property: PropertyEntity, channelId: number): Promise<string | null> {
    const stored = property.zodomusRoomId?.trim();
    if (stored) return stored;
    const ext = property.zodomusPropertyId?.trim();
    if (!ext) return null;
    const raw = await this.zodomus.getRoomRates(channelId, ext);
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) return null;

    if (list.length > 1) {
      const summary = list
        .slice(0, 12)
        .map((r) => {
          const o = r as { id?: string | number; name?: string };
          const rid = o.id != null ? String(o.id) : '?';
          const label = o.name?.trim();
          return label ? `${rid} (${label})` : rid;
        })
        .join('; ');
      this.logger.warn(
        `Zodomus availability: property ${property.id} — Zodomus returned ${list.length} rooms but zodomusRoomId is empty. ` +
          `Availability will be pushed only for the first room (wrong for multi-room listings). ` +
          `Set property.zodomusRoomId to the RentAI listing’s room. Rooms from API: ${summary}${
            list.length > 12 ? ' …' : ''
          }`,
      );
    }

    const first = list[0] as { id?: string | number } | undefined;
    const id = first?.id;
    return id != null && String(id).trim() !== '' ? String(id) : null;
  }
}

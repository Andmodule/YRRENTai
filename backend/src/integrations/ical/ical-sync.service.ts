import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { addDays } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { parseICal, type ICalEvent } from './ical-parse.util';
import { generateICal } from './ical-generate.util';
import { isAirbnbWindowTail, isStoredAirbnbWindowTail } from './ical-airbnb-tail.util';
import { ZodomusAvailabilityPushService } from '../zodomus/zodomus-availability-push.service';

export interface ICalImportResult {
  url: string;
  imported: number;
  updated: number;
  cancelled: number;
  /** Airbnb booking-window tails («Airbnb (Not available)» to about a year ahead): not bookings, not imported. */
  skipped: number;
  failed: number;
  error?: string;
}

/** Uids of one import run: Airbnb window tails skipped, and events imported as real ones. */
interface SeenUids {
  tails: Set<string>;
  kept: Set<string>;
  /** A feed could not be read: what it holds is unknown, so stored rows are judged by uid only. */
  failed: boolean;
}
const newSeen = (): SeenUids => ({ tails: new Set(), kept: new Set(), failed: false });

@Injectable()
export class ICalSyncService {
  private readonly logger = new Logger(ICalSyncService.name);

  constructor(
    private readonly propertyService: PropertyService,
    private readonly zodomusAvailabilityPush: ZodomusAvailabilityPushService,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  // ── URL management ────────────────────────────────────────────────────────

  async setImportUrls(
    userId: string,
    role: string,
    propertyId: string,
    urls: string[],
  ): Promise<string[]> {
    const property = await this.propertyService.findOneForUser(propertyId, userId, role);
    const sanitised = urls
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http://') || u.startsWith('https://') || u.startsWith('webcal://'));

    property.icalImportUrls = sanitised.map((u) => u.replace(/^webcal:\/\//i, 'https://'));
    await this.propertyRepo.save(property);
    return property.icalImportUrls;
  }

  // ── Import ────────────────────────────────────────────────────────────────

  /**
   * Import a single iCal URL for a property (fetch → parse → upsert bookings).
   */
  async importUrl(
    userId: string,
    role: string,
    propertyId: string,
    url: string,
  ): Promise<ICalImportResult> {
    const property = await this.propertyService.findOneForUser(propertyId, userId, role);
    const seen = newSeen();
    const result = await this.importUrlRaw(property, url, seen);
    result.cancelled += await this.cancelImportedWindowTails(property, seen);
    this.zodomusAvailabilityPush.scheduleAvailabilityPush(property.id);
    return result;
  }

  /**
   * Import all saved iCal URLs for a property.
   */
  async syncProperty(
    userId: string,
    role: string,
    propertyId: string,
  ): Promise<ICalImportResult[]> {
    const property = await this.propertyService.findOneForUser(propertyId, userId, role);
    return this.syncPropertyEntity(property);
  }

  /**
   * Import all iCal URLs for all properties in the system (used by cron).
   */
  async syncAllProperties(): Promise<{ properties: number; results: ICalImportResult[] }> {
    const properties = await this.propertyService.findAllWithZodomus();
    // find ALL properties, not just zodomus-linked
    const all = await this.propertyRepo.find();
    const withUrls = all.filter((p) => p.icalImportUrls?.length > 0);

    const allResults: ICalImportResult[] = [];
    for (const property of withUrls) {
      const results = await this.syncPropertyEntity(property);
      allResults.push(...results);
    }
    return { properties: withUrls.length, results: allResults };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * Generate an iCal feed (.ics) for a property.
   * Public endpoint — no owner check (uses property ID only).
   * Shows "Reserved" instead of guest name for privacy.
   */
  async exportPropertyFeed(propertyId: string): Promise<string> {
    const property = await this.propertyRepo.findOne({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const bookings = await this.bookingRepo.find({
      where: { propertyId, status: BOOKING_STATUS.CONFIRMED },
      order: { checkIn: 'ASC' },
    });

    return generateICal({
      propertyName: property.name,
      events: bookings.map((b) => ({
        uid: b.icalUid ?? b.zodomusReservationId ?? `rentai-${b.id}@rentai`,
        dtStart: b.checkIn,
        dtEnd: b.checkOut,
        summary: 'Reserved',
        lastModified: b.updatedAt,
      })),
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async syncPropertyEntity(property: PropertyEntity): Promise<ICalImportResult[]> {
    const urls = property.icalImportUrls ?? [];
    if (urls.length === 0) return [];

    const results: ICalImportResult[] = [];
    const seen = newSeen();
    for (const url of urls) {
      results.push(await this.importUrlRaw(property, url, seen));
    }
    // Once per property, after all feeds: counted on the first result.
    results[0]!.cancelled += await this.cancelImportedWindowTails(property, seen);
    this.zodomusAvailabilityPush.scheduleAvailabilityPush(property.id);
    return results;
  }

  /**
   * `seen.tails` collects the uids of the Airbnb window tails skipped in this feed, `seen.kept` those imported as
   * real events (the cleanup must not cancel what this very run imported).
   */
  private async importUrlRaw(property: PropertyEntity, url: string, seen: SeenUids): Promise<ICalImportResult> {
    const result: ICalImportResult = { url, imported: 0, updated: 0, cancelled: 0, skipped: 0, failed: 0 };

    let text: string;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RentAI PMS iCal Importer/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      result.error = `Fetch failed: ${String(e)}`;
      this.logger.warn(`iCal import failed for ${url}: ${result.error}`);
      seen.failed = true;
      return result;
    }

    let events: ICalEvent[];
    try {
      events = parseICal(text);
    } catch (e) {
      result.error = `Parse failed: ${String(e)}`;
      this.logger.warn(`iCal parse failed for ${url}: ${result.error}`);
      seen.failed = true;
      return result;
    }

    const now = new Date();
    for (const ev of events) {
      try {
        if (isAirbnbWindowTail(ev.summary, ev.dtStart, ev.dtEnd, now)) {
          result.skipped += 1;
          seen.tails.add(ev.uid);
          this.logger.log(
            `iCal ${property.id}: Airbnb window tail skipped uid=${ev.uid} ${ev.dtStart.toISOString().slice(0, 10)}..${ev.dtEnd.toISOString().slice(0, 10)}`,
          );
          continue;
        }
        seen.kept.add(ev.uid);
        await this.upsertFromICalEvent(property, ev, result);
      } catch (e) {
        result.failed += 1;
        this.logger.warn(`iCal upsert failed for uid=${ev.uid}: ${String(e)}`);
      }
    }

    this.logger.log(
      `iCal import ${url}: +${result.imported} ~${result.updated} cancelled=${result.cancelled} skipped=${result.skipped} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * Window tails imported before this rule are no bookings: confirmed iCal bookings of the property that are the
   * tail skipped now (same uid) or look like a recent tail (it moves daily, its uid may change) → cancelled.
   * Never throws; returns how many were cancelled.
   */
  private async cancelImportedWindowTails(property: PropertyEntity, seen: SeenUids): Promise<number> {
    const now = new Date();
    let n = 0;
    try {
      const rows = await this.bookingRepo.find({
        where: { propertyId: property.id, status: BOOKING_STATUS.CONFIRMED, icalUid: Not(IsNull()) },
      });
      for (const b of rows) {
        if (b.icalUid == null || seen.kept.has(b.icalUid)) continue; // imported as a real event in this run
        const sameTail = seen.tails.has(b.icalUid);
        if (!sameTail && (seen.failed || !isStoredAirbnbWindowTail(b.notes, b.checkIn, b.checkOut, now))) continue;
        await this.bookingRepo.update({ id: b.id }, { status: BOOKING_STATUS.CANCELLED });
        n += 1;
        this.logger.log(
          `iCal ${property.id}: Airbnb window tail cancelled booking=${b.id} uid=${b.icalUid} ${b.checkIn.toISOString().slice(0, 10)}..${b.checkOut.toISOString().slice(0, 10)}`,
        );
      }
    } catch (e) {
      this.logger.warn(`iCal tail cleanup failed for property ${property.id}: ${String(e)}`);
    }
    return n;
  }

  private async upsertFromICalEvent(
    property: PropertyEntity,
    ev: ICalEvent,
    counter: ICalImportResult,
  ): Promise<void> {
    const existing = await this.bookingRepo.findOne({ where: { icalUid: ev.uid, propertyId: property.id } });

    const isCancelled =
      ev.status === 'CANCELLED' ||
      ev.summary?.toUpperCase().includes('NOT AVAILABLE') === false &&
        ev.summary?.toUpperCase().includes('CANCELLED');

    if (isCancelled) {
      if (existing && existing.status !== BOOKING_STATUS.CANCELLED) {
        existing.status = BOOKING_STATUS.CANCELLED;
        await this.bookingRepo.save(existing);
        counter.cancelled += 1;
      }
      return;
    }

    // Ensure dtEnd > dtStart (Airbnb/Booking use DATE-exclusive end)
    const checkIn = ev.dtStart;
    let checkOut = ev.dtEnd;
    if (checkOut.getTime() <= checkIn.getTime()) {
      checkOut = addDays(checkIn, 1);
    }

    if (existing) {
      existing.checkIn = checkIn;
      existing.checkOut = checkOut;
      existing.guestName = existing.guestName || 'Guest (iCal)';
      if (ev.summary) existing.notes = ev.summary;
      existing.status = BOOKING_STATUS.CONFIRMED;
      await this.bookingRepo.save(existing);
      counter.updated += 1;
      return;
    }

    const row = this.bookingRepo.create({
      propertyId: property.id,
      createdBy: property.ownerId,
      guestName: 'Guest (iCal)',
      notes: ev.summary,
      checkIn,
      checkOut,
      totalPriceMinor: 0,
      currency: property.currency,
      status: BOOKING_STATUS.CONFIRMED,
      icalUid: ev.uid,
    });
    await this.bookingRepo.save(row);
    counter.imported += 1;
  }
}

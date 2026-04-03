import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { addDays } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { parseICal, type ICalEvent } from './ical-parse.util';
import { generateICal } from './ical-generate.util';
import { ZodomusAvailabilityPushService } from '../zodomus/zodomus-availability-push.service';

export interface ICalImportResult {
  url: string;
  imported: number;
  updated: number;
  cancelled: number;
  failed: number;
  error?: string;
}

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
    ownerUserId: string,
    propertyId: string,
    urls: string[],
  ): Promise<string[]> {
    const property = await this.propertyService.findOne(propertyId, ownerUserId);
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
    ownerUserId: string,
    propertyId: string,
    url: string,
  ): Promise<ICalImportResult> {
    const property = await this.propertyService.findOne(propertyId, ownerUserId);
    return this.importUrlRaw(property, url);
  }

  /**
   * Import all saved iCal URLs for a property.
   */
  async syncProperty(
    ownerUserId: string,
    propertyId: string,
  ): Promise<ICalImportResult[]> {
    const property = await this.propertyService.findOne(propertyId, ownerUserId);
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
    for (const url of urls) {
      results.push(await this.importUrlRaw(property, url));
    }
    this.zodomusAvailabilityPush.scheduleAvailabilityPush(property.id);
    return results;
  }

  private async importUrlRaw(property: PropertyEntity, url: string): Promise<ICalImportResult> {
    const result: ICalImportResult = { url, imported: 0, updated: 0, cancelled: 0, failed: 0 };

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
      return result;
    }

    let events: ICalEvent[];
    try {
      events = parseICal(text);
    } catch (e) {
      result.error = `Parse failed: ${String(e)}`;
      this.logger.warn(`iCal parse failed for ${url}: ${result.error}`);
      return result;
    }

    for (const ev of events) {
      try {
        await this.upsertFromICalEvent(property, ev, result);
      } catch (e) {
        result.failed += 1;
        this.logger.warn(`iCal upsert failed for uid=${ev.uid}: ${String(e)}`);
      }
    }

    this.logger.log(
      `iCal import ${url}: +${result.imported} ~${result.updated} cancelled=${result.cancelled} failed=${result.failed}`,
    );
    return result;
  }

  private async upsertFromICalEvent(
    property: PropertyEntity,
    ev: ICalEvent,
    counter: ICalImportResult,
  ): Promise<void> {
    const existing = await this.bookingRepo.findOne({ where: { icalUid: ev.uid } });

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

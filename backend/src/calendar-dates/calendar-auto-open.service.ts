import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyEntity } from '../property/entities/property.entity';
import { CalendarDatesService, todayInTz } from './calendar-dates.service';
import { addDaysYmd, type CalendarDatesAction, type NightChange } from './calendar-dates.util';
import {
  CalendarAutoOpenSettingsEntity,
  type AutoOpenResult,
} from './entities/calendar-auto-open-settings.entity';

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
  }
  return fallback;
}

const toMinor = (major: number): number => Math.round(major * 100);
const toMajor = (minor: number): number => minor / 100;

export type AutoOpenView = {
  /** ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED. */
  enabled: boolean;
  /** ZODOMUS_CALENDAR_AUTO_OPEN_DRY_RUN: runs only report what they would open. */
  dryRun: boolean;
  /** UTC hour of the daily run. */
  hourUtc: number;
  settings: {
    enabled: boolean;
    horizonDays: number;
    price: number;
    weekendPrice: number | null;
    openedUntil: string | null;
    keepClosed: number;
    lastRunAt: string | null;
    lastResult: AutoOpenResult | null;
  } | null;
};

export type AutoOpenInput = {
  propertyId: string;
  enabled: boolean;
  horizonDays: number;
  price: number;
  weekendPrice?: number | null;
};

/**
 * «Автопродление календаря» (ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED, off by default; needs
 * ZODOMUS_CALENDAR_DATES_ENABLED and the migration 1778500000000-calendar-auto-open-settings).
 *
 * Once a day it opens on Booking the nights that newly entered «today + N days», at the property's
 * own price — what the administrator did by hand in the extranet before the channel manager
 * connection locked it. Only nights from the moment it was switched on are its business: nights
 * before `openedUntil` (closed by hand, never opened) are left as they are, nights closed by hand
 * beyond it are remembered and left closed, open nights keep their price. Dry run by default.
 */
@Injectable()
export class CalendarAutoOpenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarAutoOpenService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRunUtcDate: string | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dates: CalendarDatesService,
    @InjectRepository(CalendarAutoOpenSettingsEntity)
    private readonly repo: Repository<CalendarAutoOpenSettingsEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  get enabled(): boolean {
    return this.dates.enabled && toBool(this.config.get('ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED'), false);
  }

  get dryRun(): boolean {
    return toBool(this.config.get('ZODOMUS_CALENDAR_AUTO_OPEN_DRY_RUN'), true);
  }

  get hourUtc(): number {
    const n = Number(this.config.get('ZODOMUS_CALENDAR_AUTO_OPEN_HOUR_UTC') ?? 4);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 4;
  }

  onModuleInit(): void {
    this.dates.setAppliedListener((propertyId, action, applied) => this.rememberManual(propertyId, action, applied));
    if (!this.enabled) return;
    this.logger.log(
      `Calendar auto-extension ENABLED — daily at ${String(this.hourUtc).padStart(2, '0')}:00 UTC, dryRun=${this.dryRun}`,
    );
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private assertOn(): void {
    this.dates.assertEnabled();
    if (!this.enabled) {
      throw new ServiceUnavailableException('Автопродление календаря выключено (ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED=false)');
    }
  }

  /** Once per UTC day, at or after the configured hour (a restart later that day runs it then). */
  async tick(now: Date = new Date()): Promise<void> {
    if (!this.enabled || this.running) return;
    if (now.getUTCHours() < this.hourUtc) return;
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunUtcDate === day) return;
    this.lastRunUtcDate = day;
    await this.runAll();
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let rows: CalendarAutoOpenSettingsEntity[];
      try {
        rows = await this.repo.find({ where: { enabled: true } });
      } catch (e) {
        this.logger.error(`auto-extension: settings unreadable (migration 1778500000000 not run?): ${String(e)}`);
        return;
      }
      for (const row of rows) {
        await this.runOne(row);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOne(row: CalendarAutoOpenSettingsEntity): Promise<void> {
    const property = await this.propertyRepo.findOne({ where: { id: row.propertyId } });
    if (!property) return;
    const today = todayInTz(property.timezone);
    const end = addDaysYmd(today, row.horizonDays);
    const start = row.openedUntil && row.openedUntil > today ? row.openedUntil : today;
    const keepClosed = new Set((row.keepClosed ?? []).filter((d) => d >= today));
    const result: AutoOpenResult = {
      at: new Date().toISOString(),
      dryRun: this.dryRun,
      from: start,
      toExclusive: end,
      opened: 0,
      skipped: 0,
      failed: 0,
      mismatched: 0,
    };

    if (start < end) {
      try {
        const res = await this.dates.runAuto(
          row.propertyId,
          {
            action: 'open',
            dateFrom: start,
            dateToExclusive: end,
            price: toMajor(row.priceMinor),
            weekendPrice: row.weekendPriceMinor != null ? toMajor(row.weekendPriceMinor) : null,
            onlyClosed: true,
          },
          { keepClosed, dryRun: this.dryRun },
        );
        if (!res) {
          result.error = 'BUSY';
        } else {
          result.skipped = Object.values(res.plan.skipped).reduce((a, b) => a + b, 0);
          if (this.dryRun) {
            result.opened = res.plan.changes.length;
          } else if (res.job) {
            const failedNights = res.job.failed.reduce(
              (sum, f) => sum + res.plan.changes.filter((c) => c.date >= f.dateFrom && c.date < f.dateToExclusive).length,
              0,
            );
            result.failed = failedNights;
            result.opened = res.plan.changes.length - failedNights;
            result.mismatched = res.job.verify?.mismatched.length ?? 0;
            if (res.job.state === 'done' && res.job.failed.length === 0) row.openedUntil = end;
          } else {
            // Nothing to open: every night is already open, sold or kept closed.
            row.openedUntil = end;
          }
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        this.logger.warn(`auto-extension property=${row.propertyId} failed: ${result.error}`);
      }
    }

    row.keepClosed = [...keepClosed].sort();
    row.lastRunAt = new Date();
    row.lastResult = result;
    await this.repo.save(row);
  }

  /** Nights closed by hand beyond the edge stay closed; opening them by hand forgets that. */
  private async rememberManual(propertyId: string, action: CalendarDatesAction, applied: NightChange[]): Promise<void> {
    if (!this.enabled) return;
    const row = await this.repo.findOne({ where: { propertyId } });
    if (!row) return;
    const edge = row.openedUntil ?? '';
    const set = new Set(row.keepClosed ?? []);
    for (const c of applied) {
      if (action === 'close' && c.closed && c.date >= edge) set.add(c.date);
      if (action === 'open' && !c.closed) set.delete(c.date);
    }
    row.keepClosed = [...set].sort();
    await this.repo.save(row);
  }

  // ─── settings API ──────────────────────────────────────────────────────────

  private async settingsRow(propertyId: string): Promise<CalendarAutoOpenSettingsEntity | null> {
    try {
      return await this.repo.findOne({ where: { propertyId } });
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException(
          'Таблица автопродления не создана: запустите миграцию 1778500000000-calendar-auto-open-settings',
        );
      }
      throw e;
    }
  }

  private view(row: CalendarAutoOpenSettingsEntity | null): AutoOpenView {
    return {
      enabled: this.enabled,
      dryRun: this.dryRun,
      hourUtc: this.hourUtc,
      settings: row
        ? {
            enabled: row.enabled,
            horizonDays: row.horizonDays,
            price: toMajor(row.priceMinor),
            weekendPrice: row.weekendPriceMinor != null ? toMajor(row.weekendPriceMinor) : null,
            openedUntil: row.openedUntil,
            keepClosed: (row.keepClosed ?? []).length,
            lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
            lastResult: row.lastResult,
          }
        : null,
    };
  }

  async get(user: JwtPayload, propertyId: string): Promise<AutoOpenView> {
    this.assertOn();
    await this.dates.assertAccess(user, propertyId);
    return this.view(await this.settingsRow(propertyId));
  }

  async save(user: JwtPayload, input: AutoOpenInput): Promise<AutoOpenView> {
    this.assertOn();
    await this.dates.assertAccess(user, input.propertyId);
    const property = await this.propertyRepo.findOne({ where: { id: input.propertyId } });
    if (!property) throw new NotFoundException('Объект не найден');
    const min = await this.dates.minPriceOf(input.propertyId);
    for (const p of [input.price, input.weekendPrice]) {
      if (p != null && min != null && p < min) {
        throw new BadRequestException(`Цена ${p} ниже минимальной цены объекта (${min}) — «Цены → Минимальные цены»`);
      }
    }
    const existing = await this.settingsRow(input.propertyId);
    const today = todayInTz(property.timezone);
    const row = existing ?? this.repo.create({ propertyId: input.propertyId, keepClosed: [], openedUntil: null });
    // Switching on starts from the far edge: nights before it are opened by hand («Открыть даты»).
    if (input.enabled && !existing?.enabled) row.openedUntil = addDaysYmd(today, input.horizonDays);
    row.enabled = input.enabled;
    row.horizonDays = input.horizonDays;
    row.priceMinor = toMinor(input.price);
    row.weekendPriceMinor = input.weekendPrice != null ? toMinor(input.weekendPrice) : null;
    await this.repo.save(row);
    return this.view(await this.settingsRow(input.propertyId));
  }
}

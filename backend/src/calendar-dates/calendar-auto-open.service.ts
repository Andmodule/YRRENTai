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
    /** null: the row only keeps «closed by hand» nights, auto-extension was never set up. */
    price: number | null;
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
    this.dates.setAppliedListener((propertyId, action, applied, alreadyClosed) =>
      this.rememberManual(propertyId, action, applied, alreadyClosed),
    );
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
    try {
      await this.runAll();
    } catch (e) {
      // Called from setInterval: an escaping rejection would take the whole process down.
      this.logger.error(`auto-extension run failed: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let ids: string[];
      try {
        ids = (await this.repo.find({ where: { enabled: true }, select: { propertyId: true } })).map((r) => r.propertyId);
      } catch (e) {
        this.logger.error(`auto-extension: settings unreadable (migration 1778500000000 not run?): ${String(e)}`);
        return;
      }
      for (const id of ids) {
        try {
          await this.runOne(id);
        } catch (e) {
          this.logger.error(`auto-extension property=${id} failed: ${e instanceof Error ? e.stack : String(e)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * One property. Reads its settings right now (they may have changed since the run started) and writes
   * back only what the run owns — the person may be editing the same row meanwhile.
   */
  private async runOne(propertyId: string): Promise<void> {
    const row = await this.repo.findOne({ where: { propertyId } });
    if (!row || !row.enabled || row.priceMinor == null) return;
    const property = await this.propertyRepo.findOne({ where: { id: propertyId } });
    if (!property) return;
    const today = todayInTz(property.timezone);
    const wanted = addDaysYmd(today, row.horizonDays);
    const cap = this.dates.horizonEnd(property.timezone);
    const end = wanted > cap ? cap : wanted;
    const start = row.openedUntil && row.openedUntil > today ? row.openedUntil : today;
    const keepClosed = new Set((row.keepClosed ?? []).filter((d) => d >= today));
    let openedUntil: string | null = null;
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
          propertyId,
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
            if (res.job.state === 'done' && res.job.failed.length === 0) openedUntil = end;
          } else {
            // Nothing to open: every night is already open, sold or kept closed.
            openedUntil = end;
          }
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        this.logger.warn(`auto-extension property=${propertyId} failed: ${result.error}`);
      }
    }

    await this.repo.update(
      { propertyId },
      {
        lastRunAt: new Date(),
        lastResult: result as never,
        ...(openedUntil ? { openedUntil } : {}),
      },
    );
  }

  /**
   * Nights closed by hand at or beyond the edge stay closed; opening them by hand forgets that.
   * Recorded whenever the dates tool is on and the table exists — also before auto-extension is
   * switched on, so dates closed meanwhile are not opened later. A property without settings gets a
   * switched-off row just for this list.
   */
  private async rememberManual(
    propertyId: string,
    action: CalendarDatesAction,
    applied: NightChange[],
    alreadyClosed: string[],
  ): Promise<void> {
    if (!this.dates.enabled) return;
    const closedNow = action === 'close' ? [...applied.filter((c) => c.closed).map((c) => c.date), ...alreadyClosed] : [];
    const openedNow = action === 'open' ? applied.filter((c) => !c.closed).map((c) => c.date) : [];
    if (closedNow.length === 0 && openedNow.length === 0) return;
    const recent = addDaysYmd(new Date().toISOString().slice(0, 10), -1);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const row = await this.repo.findOne({ where: { propertyId } });
        const edge = row?.openedUntil ?? '';
        const set = new Set((row?.keepClosed ?? []).filter((d) => d >= recent));
        for (const d of closedNow) if (d >= edge) set.add(d);
        for (const d of openedNow) set.delete(d);
        const keepClosed = [...set].sort();
        if (row) {
          await this.repo.update({ propertyId }, { keepClosed });
          return;
        }
        if (keepClosed.length === 0) return;
        try {
          await this.repo.insert({ propertyId, enabled: false, horizonDays: 90, priceMinor: null, keepClosed, openedUntil: null });
          return;
        } catch (e) {
          // Created by «Сохранить» meanwhile: read it again and update.
          if (attempt > 0) throw e;
        }
      }
    } catch (e) {
      const missing =
        e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01';
      if (missing) this.logger.debug('auto-extension table missing: closed nights not remembered');
      else this.logger.warn(`auto-extension: could not remember nights closed by hand: ${String(e)}`);
    }
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
            price: row.priceMinor != null ? toMajor(row.priceMinor) : null,
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
    // Switching off must always work, even when the minimum price was raised since.
    if (input.enabled) {
      const min = await this.dates.minPriceOf(input.propertyId);
      for (const p of [input.price, input.weekendPrice]) {
        if (p != null && min != null && p < min) {
          throw new BadRequestException(`Цена ${p} ниже минимальной цены объекта (${min}) — «Цены → Минимальные цены»`);
        }
      }
    }
    const existing = await this.settingsRow(input.propertyId);
    const fields = {
      enabled: input.enabled,
      horizonDays: input.horizonDays,
      priceMinor: toMinor(input.price),
      weekendPriceMinor: input.weekendPrice != null ? toMinor(input.weekendPrice) : null,
      // Switching on starts from the far edge: nights before it are opened by hand («Открыть даты»).
      // Never back: nights before the old edge were not remembered when closed by hand.
      ...(input.enabled && !existing?.enabled
        ? {
            openedUntil: maxYmd(
              existing?.openedUntil ?? null,
              minYmd(addDaysYmd(todayInTz(property.timezone), input.horizonDays), this.dates.horizonEnd(property.timezone)),
            ),
          }
        : {}),
    };
    // Only these fields: the «keep closed» list may be written by a manual run at the same time.
    if (existing) await this.repo.update({ propertyId: input.propertyId }, fields);
    else await this.repo.insert({ propertyId: input.propertyId, keepClosed: [], openedUntil: null, ...fields });
    return this.view(await this.settingsRow(input.propertyId));
  }
}

function maxYmd(a: string | null, b: string): string {
  return a && a > b ? a : b;
}

function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}

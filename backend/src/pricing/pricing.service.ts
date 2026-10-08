import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UserService } from '../user/user.service';
import { PropertyService } from '../property/property.service';
import type { PropertyEntity } from '../property/entities/property.entity';
import { PricingConfig } from './pricing-config';
import { PromotionExecutorService } from './promotion-executor.service';
import { PromotionQueueService } from './promotion-queue.service';
import { PromotionSyncService } from './promotion-sync.service';
import { resolveOtaChannelCurrency } from '../integrations/zodomus/zodomus-reservation-price.util';
import {
  addDaysYmd,
  findOverlaps,
  isYmd,
  nightsCount,
  normalizeWeekdays,
  todayInTz,
  toMajor,
  toMinor,
  type ExistingPromotionLite,
  type OverlapInfo,
} from './pricing-math.util';
import { isTargetingRateType } from './pricing-targeting.util';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import {
  PricePromotionTargetEntity,
  type PromotionTargetState,
} from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import { PropertyPricingSettingsEntity } from './entities/property-pricing-settings.entity';
import type { CreatePromotionDto, PricingSettingsDto, UpdatePromotionDto } from './dto/pricing.dto';

type Actor = { ownerId: string; userId: string; label: string };

export type ExcludedProperty = {
  propertyId: string;
  name: string;
  reason: 'NO_BOOKING' | 'NO_ACCESS' | 'NOT_IN_PILOT';
};

const EXCLUDED_REASON_TEXT: Record<ExcludedProperty['reason'], string> = {
  NO_BOOKING: 'нет Booking',
  NO_ACCESS: 'нет доступа к акциям',
  NOT_IN_PILOT: 'не в списке пилота',
};

/**
 * «Booking has it»: an extranet promotion is there by definition; ours — only once it was found
 * in Booking's list (right after the push or by the regular sync). Until then the UI must not
 * call it «Включена».
 */
function isConfirmed(
  source: PricePromotionEntity['source'],
  t: Pick<PricePromotionTargetEntity, 'state' | 'verifiedAt'>,
): boolean {
  return t.state === 'on' && (source === 'booking' || !!t.verifiedAt);
}

export type PromotionPlan = {
  eligible: Array<{ property: PropertyEntity; externalPropertyId: string }>;
  excluded: ExcludedProperty[];
  overlaps: OverlapInfo[];
};

export type PropertyPricingRow = {
  id: string;
  name: string;
  timezone: string;
  bookingConnected: boolean;
  externalPropertyId: string | null;
  minPrice: number | null;
  geniusPct: number | null;
  /** Largest Mobile / Country rate seen on Booking — stacks on top of Genius and our discount. */
  targetingPct: number | null;
  /** false = pilot mode is on and the property is not in the list: nothing is sent for it. */
  inPilot: boolean;
  promotionsAccess: 'ok' | 'denied' | 'unknown' | null;
  promotionsAccessCode: string | null;
  /** What Zodomus answered on the last failed check (shown as is, trimmed). */
  promotionsAccessDetail: string | null;
  promotionsAccessCheckedAt: string | null;
};

const PRICE_TODAY_TTL_MS = 10 * 60_000;
const EVENTS_LIMIT = 200;

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly priceTodayCache = new Map<
    string,
    { at: number; value: Record<string, unknown> }
  >();

  constructor(
    private readonly cfg: PricingConfig,
    private readonly userService: UserService,
    private readonly propertyService: PropertyService,
    private readonly executor: PromotionExecutorService,
    private readonly queue: PromotionQueueService,
    private readonly sync: PromotionSyncService,
    private readonly dataSource: DataSource,
    @InjectRepository(PricePromotionEntity)
    private readonly promotionRepo: Repository<PricePromotionEntity>,
    @InjectRepository(PricePromotionTargetEntity)
    private readonly targetRepo: Repository<PricePromotionTargetEntity>,
    @InjectRepository(PricePromotionEventEntity)
    private readonly eventRepo: Repository<PricePromotionEventEntity>,
    @InjectRepository(PropertyPricingSettingsEntity)
    private readonly settingsRepo: Repository<PropertyPricingSettingsEntity>,
  ) {}

  /** Always available (also when disabled) — the UI decides whether to show «Цены». */
  status() {
    const f = this.cfg.flags;
    return {
      enabled: f.enabled,
      dryRun: f.dryRun,
      pilot: f.allowlist.size > 0,
      channelId: f.channelId,
    };
  }

  private assertEnabled(): void {
    if (!this.cfg.flags.enabled) {
      throw new ServiceUnavailableException(
        'Скидки Booking выключены (ZODOMUS_PROMOTIONS_ENABLED=false)',
      );
    }
  }

  private async actor(user: JwtPayload): Promise<Actor> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const u = await this.userService.findById(user.sub);
    const name = [u?.firstName, u?.lastName]
      .filter((s) => s && s.trim())
      .join(' ')
      .trim();
    const role =
      user.role === 'OWNER'
        ? 'владелец'
        : user.role === 'MANAGER'
          ? 'менеджер'
          : user.role.toLowerCase();
    return { ownerId, userId: user.sub, label: `${name || user.email} · ${role}` };
  }

  // ─── «Минимальные цены» ────────────────────────────────────────────────────

  async listProperties(user: JwtPayload): Promise<PropertyPricingRow[]> {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    return this.propertyRows(ownerId);
  }

  private async propertyRows(ownerId: string): Promise<PropertyPricingRow[]> {
    const props = await this.propertyService.findAllByOwner(ownerId);
    const ids = props.map((p) => p.id);
    const [settings, targeting] = await Promise.all([
      this.sync.accessMap(ids),
      this.sync.targetingPctMap(ids),
    ]);
    return props.map((p) => {
      const s = settings.get(p.id);
      const ext = this.sync.externalIdOf(p);
      return {
        id: p.id,
        name: p.name,
        timezone: p.timezone,
        bookingConnected: !!ext,
        externalPropertyId: ext,
        minPrice: toMajor(s?.minPriceMinor),
        geniusPct: s?.geniusPct ?? null,
        targetingPct: targeting.get(p.id) ?? null,
        inPilot: this.cfg.isInAllowlist(p.id, ext),
        promotionsAccess: ext ? (s?.promotionsAccess ?? 'unknown') : null,
        promotionsAccessCode: s?.promotionsAccessCode ?? null,
        promotionsAccessDetail: s?.promotionsAccessCode
          ? (s.promotionsAccessDetail ?? '').slice(0, 300) || null
          : null,
        promotionsAccessCheckedAt: s?.promotionsAccessCheckedAt
          ? s.promotionsAccessCheckedAt.toISOString()
          : null,
      };
    });
  }

  async updateSettings(user: JwtPayload, dto: PricingSettingsDto): Promise<PropertyPricingRow[]> {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    const owned = new Set((await this.propertyService.findAllByOwner(ownerId)).map((p) => p.id));
    for (const item of dto.items) {
      if (!owned.has(item.propertyId))
        throw new NotFoundException(`Property ${item.propertyId} not found`);
    }
    for (const item of dto.items) {
      const row: Partial<PropertyPricingSettingsEntity> & { propertyId: string } = {
        propertyId: item.propertyId,
      };
      if (item.minPrice !== undefined)
        row.minPriceMinor = item.minPrice === null ? null : toMinor(item.minPrice);
      if (item.geniusPct !== undefined) row.geniusPct = item.geniusPct;
      await this.settingsRepo.upsert(row, ['propertyId']);
    }
    return this.propertyRows(ownerId);
  }

  /** Read-only check of Booking promotions access, in the background. */
  async accessCheck(user: JwtPayload, propertyIds?: string[]): Promise<{ started: number }> {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    const wanted = propertyIds ? new Set(propertyIds) : null;
    const props = (await this.propertyService.findAllByOwner(ownerId)).filter(
      (p) => (!wanted || wanted.has(p.id)) && this.sync.externalIdOf(p),
    );
    void this.sync
      .syncProperties(props)
      .catch((e) => this.logger.error(`access check failed: ${String(e)}`));
    return { started: props.length };
  }

  /** Booking rack price for today + Genius price (cached 10 min; read-only). */
  async priceToday(user: JwtPayload, propertyId: string): Promise<Record<string, unknown>> {
    this.assertEnabled();
    const property = await this.propertyService.findOneForUser(propertyId, user.sub, user.role);
    const ext = this.sync.externalIdOf(property);
    if (!ext) throw new BadRequestException('Объект не подключён к Booking');
    const hit = this.priceTodayCache.get(property.id);
    if (hit && Date.now() - hit.at < PRICE_TODAY_TTL_MS) return hit.value;

    const channelId = this.cfg.flags.channelId;
    const today = todayInTz(property.timezone);
    let price: number | null = null;
    try {
      const { roomIds, rateIds } = await this.executor.resolveRoomRate(property, channelId, ext);
      price =
        (
          await this.executor.lowestNightlyPrice(
            channelId,
            ext,
            roomIds[0]!,
            rateIds[0]!,
            today,
            today,
            null,
          )
        )?.price ?? null;
    } catch (e) {
      throw new ServiceUnavailableException({
        message: 'Не удалось получить цену из Booking',
        detail: String(e),
      });
    }
    const settings = await this.settingsRepo.findOne({ where: { propertyId: property.id } });
    const g = settings?.geniusPct ?? null;
    const value = {
      propertyId: property.id,
      date: today,
      price,
      geniusPct: g,
      geniusPrice: price !== null ? Math.round(price * (100 - (g ?? 0))) / 100 : null,
      /** Channel currency as the calendar resolves it (ARI usually omits it). */
      currency: resolveOtaChannelCurrency({ propertyCurrency: property.currency, timezone: property.timezone }),
    };
    this.priceTodayCache.set(property.id, { at: Date.now(), value });
    return value;
  }

  // ─── «Скидки» ──────────────────────────────────────────────────────────────

  /** All discounts of the tenant; with `propertyId` — only those that include this property (+ its state). */
  async list(user: JwtPayload, propertyId?: string) {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    const [promos, props] = await Promise.all([
      this.promotionRepo.find({
        where: { ownerId },
        relations: ['targets'],
        order: { createdAt: 'DESC' },
        take: 200,
      }),
      this.propertyService.findAllByOwner(ownerId),
    ]);
    const byId = new Map(props.map((p) => [p.id, p]));
    if (!propertyId) return promos.map((p) => this.summary(p, byId));
    return promos.flatMap((p) => {
      const t = p.targets.find((x) => x.propertyId === propertyId);
      if (!t) return [];
      return [
        {
          ...this.summary(p, byId),
          target: {
            propertyId: t.propertyId,
            desiredState: t.desiredState,
            state: t.state,
            confirmed: isConfirmed(p.source, t),
            lastErrorCode: t.lastErrorCode,
            stats: t.stats,
          },
        },
      ];
    });
  }

  /**
   * Discounts that touch [from, to] for the calendar: per property and state.
   * Last-minute / early-booker deals are narrowed to the dates they can actually apply to.
   */
  async calendar(user: JwtPayload, from: string, to: string) {
    this.assertEnabled();
    if (!isYmd(from) || !isYmd(to) || from > to || nightsCount(from, to) > 120) {
      throw new BadRequestException('from/to must be yyyy-MM-dd, from ≤ to, at most 120 days');
    }
    const { ownerId } = await this.actor(user);
    const promos = await this.promotionRepo.find({
      where: { ownerId, status: 'active' },
      relations: ['targets'],
    });
    const today = todayInTz('UTC');
    // Not-sent ones (skipped / error) are shown too: a discount that silently is not on Booking
    // must not look the same as «no discount» — or as the extranet's own deal on the same nights.
    const shown: PromotionTargetState[] = ['on', 'pending', 'dry_run', 'skipped', 'error'];
    return promos.flatMap((p) => {
      const window = effectiveStayWindow(p, today);
      if (!window || window.from > to || window.to < from) return [];
      const properties = p.targets
        .filter((t) => t.desiredState === 'on' && shown.includes(t.state))
        .map((t) => ({
          propertyId: t.propertyId,
          state: t.state,
          confirmed: isConfirmed(p.source, t),
          errorCode: t.state === 'skipped' || t.state === 'error' ? t.lastErrorCode : null,
        }));
      if (properties.length === 0) return [];
      return [
        {
          id: p.id,
          name: p.name,
          source: p.source,
          promotionType: p.promotionType,
          discountPct: p.discountPct,
          from: window.from,
          to: window.to,
          activeWeekdays: p.activeWeekdays,
          properties,
        },
      ];
    });
  }

  async get(user: JwtPayload, id: string) {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    return this.detail(ownerId, id);
  }

  private async detail(ownerId: string, id: string) {
    const promo = await this.loadOwned(ownerId, id);
    const [props, events] = await Promise.all([
      this.propertyService.findAllByOwner(ownerId),
      this.eventRepo.find({
        where: { promotionId: id },
        order: { createdAt: 'DESC' },
        take: EVENTS_LIMIT,
      }),
    ]);
    const byId = new Map(props.map((p) => [p.id, p]));
    return {
      ...this.summary(promo, byId),
      targets: promo.targets.map((t) => ({
        propertyId: t.propertyId,
        propertyName: byId.get(t.propertyId)?.name ?? '—',
        desiredState: t.desiredState,
        state: t.state,
        confirmed: isConfirmed(promo.source, t),
        externalPromotionId: t.externalPromotionId,
        lastErrorCode: t.lastErrorCode,
        lastError: t.lastError,
        attempts: t.attempts,
        nextAttemptAt: t.nextAttemptAt?.toISOString() ?? null,
        verifiedAt: t.verifiedAt?.toISOString() ?? null,
        verifyNote: t.verifyNote,
        stats: t.stats,
        lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
      })),
      events: events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        actorLabel: e.actorLabel,
        action: e.action,
        message: e.message,
        propertyId: e.propertyId,
        details: e.details,
      })),
    };
  }

  /** `excludePromotionId` — when editing, the discount itself is not an overlap. */
  async preview(user: JwtPayload, dto: CreatePromotionDto, excludePromotionId?: string) {
    this.assertEnabled();
    const { ownerId } = await this.actor(user);
    const plan = await this.plan(ownerId, dto, excludePromotionId);
    return {
      eligible: plan.eligible.map((e) => ({ propertyId: e.property.id, name: e.property.name })),
      excluded: plan.excluded,
      overlaps: plan.overlaps,
    };
  }

  /** Who gets the discount, who does not (and why), and where it overlaps existing promotions. */
  async plan(
    ownerId: string,
    spec: { propertyIds?: string[]; stayFrom: string; stayTo: string; discountPct: number },
    excludePromotionId?: string,
  ): Promise<PromotionPlan> {
    const props = await this.propertyService.findAllByOwner(ownerId);
    const byId = new Map(props.map((p) => [p.id, p]));
    if (spec.propertyIds) {
      const unknown = spec.propertyIds.filter((id) => !byId.has(id));
      if (unknown.length) throw new NotFoundException(`Property ${unknown[0]} not found`);
    }
    const selected = spec.propertyIds ? spec.propertyIds.map((id) => byId.get(id)!) : props;
    const access = await this.sync.accessMap(selected.map((p) => p.id));

    const eligible: PromotionPlan['eligible'] = [];
    const excluded: ExcludedProperty[] = [];
    for (const p of selected) {
      const ext = this.sync.externalIdOf(p);
      if (!ext) excluded.push({ propertyId: p.id, name: p.name, reason: 'NO_BOOKING' });
      else if (access.get(p.id)?.promotionsAccess === 'denied')
        excluded.push({ propertyId: p.id, name: p.name, reason: 'NO_ACCESS' });
      else if (!this.cfg.isInAllowlist(p.id, ext))
        excluded.push({ propertyId: p.id, name: p.name, reason: 'NOT_IN_PILOT' });
      else eligible.push({ property: p, externalPropertyId: ext });
    }

    const active = await this.promotionRepo.find({
      where: { ownerId, status: 'active' },
      relations: ['targets'],
    });
    // Mobile / Country rates stack with our deal instead of competing with it — not an overlap.
    const existing: ExistingPromotionLite[] = active
      .filter(
        (p) =>
          p.id !== excludePromotionId &&
          p.stayFrom &&
          p.stayTo &&
          !(p.source === 'booking' && isTargetingRateType(p.promotionType)),
      )
      .map((p) => ({
        promotionId: p.id,
        name: p.name,
        discountPct: p.discountPct,
        source: p.source,
        from: p.stayFrom!,
        to: p.stayTo!,
        propertyIds: p.targets
          .filter(
            (t) =>
              t.desiredState === 'on' &&
              (['on', 'pending'] as PromotionTargetState[]).includes(t.state),
          )
          .map((t) => t.propertyId),
      }));
    const overlaps = findOverlaps(
      {
        from: spec.stayFrom,
        to: spec.stayTo,
        discountPct: spec.discountPct,
        propertyIds: eligible.map((e) => e.property.id),
      },
      existing,
    );
    return { eligible, excluded, overlaps };
  }

  async create(user: JwtPayload, dto: CreatePromotionDto) {
    this.assertEnabled();
    const actor = await this.actor(user);
    this.assertNotInPast(dto.stayTo);
    const plan = await this.plan(actor.ownerId, dto);
    if (plan.eligible.length === 0) {
      throw new BadRequestException(
        plan.excluded.some((x) => x.reason === 'NOT_IN_PILOT')
          ? 'Пилотный режим: выбранных объектов нет в списке пилота (ZODOMUS_PROMOTIONS_PROPERTY_ALLOWLIST) — в Booking ничего не уйдёт'
          : 'Нет объектов, которым можно включить скидку на Booking',
      );
    }

    const name = dto.name?.trim() || `Скидка ${dto.discountPct}%`;
    const promotionId = await this.dataSource.transaction(async (em) => {
      const promoRepo = em.getRepository(PricePromotionEntity);
      const targetRepo = em.getRepository(PricePromotionTargetEntity);
      const eventRepo = em.getRepository(PricePromotionEventEntity);
      const promo = await promoRepo.save(
        promoRepo.create({
          ownerId: actor.ownerId,
          companyId: plan.eligible[0]!.property.companyId ?? null,
          name,
          source: 'rentai',
          promotionType: 'basic',
          discountPct: dto.discountPct,
          stayFrom: dto.stayFrom,
          stayTo: dto.stayTo,
          activeWeekdays: normalizeWeekdays(dto.weekdays),
          protectMinPrice: dto.protectMinPrice ?? true,
          status: 'active',
          externalMeta: null,
          createdByUserId: actor.userId,
        }),
      );
      await targetRepo.save(
        plan.eligible.map((e) =>
          targetRepo.create({
            promotionId: promo.id,
            propertyId: e.property.id,
            channelId: this.cfg.flags.channelId,
            externalPropertyId: e.externalPropertyId,
            desiredState: 'on',
            state: 'pending',
            needsPush: true,
            previousExternalIds: [],
          }),
        ),
      );
      const events = [
        eventRepo.create({
          promotionId: promo.id,
          propertyId: null,
          actorUserId: actor.userId,
          actorLabel: actor.label,
          action: 'created',
          message: `Скидка −${dto.discountPct}% создана на ${plan.eligible.length} ${plural(plan.eligible.length, 'объекте', 'объектах', 'объектах')}`,
          details: {
            stayFrom: dto.stayFrom,
            stayTo: dto.stayTo,
            weekdays: normalizeWeekdays(dto.weekdays),
            dryRun: this.cfg.flags.dryRun,
          },
        }),
      ];
      if (plan.excluded.length) {
        events.push(
          eventRepo.create({
            promotionId: promo.id,
            propertyId: null,
            actorUserId: null,
            actorLabel: 'RentAI',
            action: 'excluded',
            message: `Не вошли: ${plan.excluded.map((x) => `${x.name} (${EXCLUDED_REASON_TEXT[x.reason]})`).join(', ')}`,
            details: { excluded: plan.excluded },
          }),
        );
      }
      await eventRepo.save(events);
      return promo.id;
    });

    this.queue.kick();
    return this.detail(actor.ownerId, promotionId);
  }

  async update(user: JwtPayload, id: string, dto: UpdatePromotionDto) {
    this.assertEnabled();
    const actor = await this.actor(user);
    const promo = await this.loadOwned(actor.ownerId, id);
    this.assertEditable(promo);
    if (promo.status !== 'active') {
      throw new BadRequestException('Скидка выключена — включите её снова или создайте новую');
    }

    const stayFrom = dto.stayFrom ?? promo.stayFrom!;
    const stayTo = dto.stayTo ?? promo.stayTo!;
    if (stayFrom > stayTo) throw new BadRequestException('stayTo must not be before stayFrom');
    this.assertNotInPast(stayTo);
    const weekdays =
      dto.weekdays !== undefined ? normalizeWeekdays(dto.weekdays) : promo.activeWeekdays;
    const discountPct = dto.discountPct ?? promo.discountPct;

    const changes: string[] = [];
    if (discountPct !== promo.discountPct)
      changes.push(`−${promo.discountPct}% → −${discountPct}%`);
    if (stayFrom !== promo.stayFrom || stayTo !== promo.stayTo)
      changes.push(`${promo.stayFrom}–${promo.stayTo} → ${stayFrom}–${stayTo}`);
    if (JSON.stringify(weekdays) !== JSON.stringify(promo.activeWeekdays))
      changes.push('дни недели');
    const paramsChanged = changes.length > 0;
    if (dto.name !== undefined && dto.name.trim() && dto.name.trim() !== promo.name)
      changes.push('название');
    if (dto.protectMinPrice !== undefined && dto.protectMinPrice !== promo.protectMinPrice)
      changes.push('защита минимальной цены');

    const targets = [...promo.targets];
    const newTargets: PricePromotionTargetEntity[] = [];
    if (dto.propertyIds) {
      const plan = await this.plan(
        actor.ownerId,
        { propertyIds: dto.propertyIds, stayFrom, stayTo, discountPct },
        promo.id,
      );
      const wanted = new Map(plan.eligible.map((e) => [e.property.id, e.externalPropertyId]));
      const names = new Map(
        (await this.propertyService.findAllByOwner(actor.ownerId)).map((p) => [p.id, p.name]),
      );
      for (const t of targets) {
        if (!wanted.has(t.propertyId) && t.desiredState === 'on') {
          this.requeue(t, 'off');
          changes.push(`убран объект «${names.get(t.propertyId) ?? t.propertyId}»`);
        } else if (wanted.has(t.propertyId) && t.desiredState === 'off') {
          this.requeue(t, 'on');
        }
      }
      for (const [propertyId, ext] of wanted) {
        if (targets.some((t) => t.propertyId === propertyId)) continue;
        newTargets.push(
          this.targetRepo.create({
            promotionId: promo.id,
            propertyId,
            channelId: this.cfg.flags.channelId,
            externalPropertyId: ext,
            desiredState: 'on',
            state: 'pending',
            needsPush: true,
            previousExternalIds: [],
          }),
        );
      }
      if (newTargets.length) changes.push(`добавлено объектов: ${newTargets.length}`);
    }
    // Objects switched off by hand stay off — Booking re-activates a promotion on every update.
    if (paramsChanged) {
      for (const t of targets) if (t.desiredState === 'on') this.requeue(t, 'on');
    }

    promo.name = dto.name?.trim() || promo.name;
    promo.discountPct = discountPct;
    promo.stayFrom = stayFrom;
    promo.stayTo = stayTo;
    promo.activeWeekdays = weekdays;
    if (dto.protectMinPrice !== undefined) promo.protectMinPrice = dto.protectMinPrice;

    await this.dataSource.transaction(async (em) => {
      const { targets: _ignored, ...promoFields } = promo;
      await em.getRepository(PricePromotionEntity).save(promoFields as PricePromotionEntity);
      await em.getRepository(PricePromotionTargetEntity).save([...targets, ...newTargets]);
      await em.getRepository(PricePromotionEventEntity).save(
        em.getRepository(PricePromotionEventEntity).create({
          promotionId: promo.id,
          propertyId: null,
          actorUserId: actor.userId,
          actorLabel: actor.label,
          action: 'updated',
          message: changes.length
            ? `Скидка изменена: ${changes.join('; ')}`
            : 'Скидка сохранена без изменений',
          details: { changes },
        }),
      );
    });

    this.queue.kick();
    return this.detail(actor.ownerId, promo.id);
  }

  async setPromotionActive(user: JwtPayload, id: string, on: boolean) {
    this.assertEnabled();
    const actor = await this.actor(user);
    const promo = await this.loadOwned(actor.ownerId, id);
    this.assertEditable(promo);
    if (on) {
      if (promo.stayTo) this.assertNotInPast(promo.stayTo);
      promo.status = 'active';
    } else {
      promo.status = 'off';
    }
    for (const t of promo.targets) this.requeue(t, on ? 'on' : 'off');

    await this.dataSource.transaction(async (em) => {
      const { targets, ...promoFields } = promo;
      await em.getRepository(PricePromotionEntity).save(promoFields as PricePromotionEntity);
      await em.getRepository(PricePromotionTargetEntity).save(targets);
      await em.getRepository(PricePromotionEventEntity).save(
        em.getRepository(PricePromotionEventEntity).create({
          promotionId: promo.id,
          propertyId: null,
          actorUserId: actor.userId,
          actorLabel: actor.label,
          action: on ? 'activated' : 'deactivated',
          message: on
            ? 'Скидка включена снова на всех объектах'
            : 'Скидка выключена для всех объектов',
          details: null,
        }),
      );
    });
    this.queue.kick();
    return this.detail(actor.ownerId, promo.id);
  }

  async targetAction(
    user: JwtPayload,
    id: string,
    propertyId: string,
    action: 'on' | 'off' | 'retry',
  ) {
    this.assertEnabled();
    const actor = await this.actor(user);
    const promo = await this.loadOwned(actor.ownerId, id);
    this.assertEditable(promo);
    const target = promo.targets.find((t) => t.propertyId === propertyId);
    if (!target) throw new NotFoundException('Объект не участвует в этой скидке');
    if (action === 'on' && promo.status !== 'active') {
      throw new BadRequestException('Скидка выключена — сначала включите её');
    }
    const propertyName =
      (await this.propertyService.findAllByOwner(actor.ownerId)).find((p) => p.id === propertyId)
        ?.name ?? propertyId;
    this.requeue(target, action === 'retry' ? target.desiredState : action);

    const message =
      action === 'off'
        ? `Выключена для «${propertyName}»`
        : action === 'on'
          ? `Включена снова для «${propertyName}»`
          : `Повторная отправка для «${propertyName}»`;
    await this.targetRepo.save(target);
    await this.eventRepo.save(
      this.eventRepo.create({
        promotionId: promo.id,
        propertyId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: action === 'retry' ? 'retry' : action === 'on' ? 'activated' : 'deactivated',
        message,
        details: null,
      }),
    );
    this.queue.kick();
    return this.detail(actor.ownerId, promo.id);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private requeue(t: PricePromotionTargetEntity, desired: 'on' | 'off'): void {
    t.desiredState = desired;
    t.needsPush = true;
    t.attempts = 0;
    t.nextAttemptAt = null;
    if (desired === 'on' && t.state !== 'on') t.state = 'pending';
  }

  private assertEditable(promo: PricePromotionEntity): void {
    if (promo.source !== 'rentai') {
      throw new ForbiddenException(
        'Скидка создана в экстранете Booking — изменить или выключить её можно там',
      );
    }
  }

  /** Server-side guard; the per-property «today» (timezone) is enforced again by the executor. */
  private assertNotInPast(stayTo: string): void {
    const yesterdayUtc = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (stayTo < yesterdayUtc) throw new BadRequestException('Даты проживания уже прошли');
  }

  private async loadOwned(ownerId: string, id: string): Promise<PricePromotionEntity> {
    const promo = await this.promotionRepo.findOne({ where: { id }, relations: ['targets'] });
    if (!promo || promo.ownerId !== ownerId) throw new NotFoundException('Скидка не найдена');
    return promo;
  }

  private summary(p: PricePromotionEntity, props: Map<string, PropertyEntity>) {
    const counts: Record<PromotionTargetState, number> = {
      pending: 0,
      on: 0,
      off: 0,
      error: 0,
      skipped: 0,
      dry_run: 0,
    };
    let bookings = 0;
    let nights = 0;
    let cancellations = 0;
    let hasStats = false;
    /** Sent and accepted, but not (yet) seen in Booking's own list. */
    let unconfirmed = 0;
    const revenueByCurrency: Record<string, number> = {};
    for (const t of p.targets ?? []) {
      counts[t.state] = (counts[t.state] ?? 0) + 1;
      if (t.state === 'on' && !isConfirmed(p.source, t)) unconfirmed++;
      if (t.stats) {
        hasStats = true;
        bookings += t.stats.bookings ?? 0;
        nights += t.stats.nights ?? 0;
        cancellations += t.stats.cancellations ?? 0;
        if (t.stats.revenue != null) {
          const cur = t.stats.currency ?? '—';
          revenueByCurrency[cur] = (revenueByCurrency[cur] ?? 0) + t.stats.revenue;
        }
      }
    }
    const tz = props.get(p.targets?.[0]?.propertyId ?? '')?.timezone ?? 'UTC';
    const today = todayInTz(tz);
    const derivedStatus =
      p.status === 'off' ? 'off' : p.stayTo && p.stayTo < today ? 'finished' : 'active';
    return {
      id: p.id,
      name: p.name,
      source: p.source,
      promotionType: p.promotionType,
      discountPct: p.discountPct,
      stayFrom: p.stayFrom,
      stayTo: p.stayTo,
      activeWeekdays: p.activeWeekdays,
      protectMinPrice: p.protectMinPrice,
      status: p.status,
      derivedStatus,
      externalMeta: p.externalMeta,
      createdAt: p.createdAt.toISOString(),
      counts: { total: p.targets?.length ?? 0, ...counts, unconfirmed },
      stats: hasStats ? { bookings, nights, cancellations, revenueByCurrency } : null,
    };
  }
}

/**
 * Dates a promotion can apply to as seen today: last-minute deals only near check-in,
 * early-booker deals only far enough ahead. Approximation for the calendar view.
 */
export function effectiveStayWindow(
  p: Pick<PricePromotionEntity, 'stayFrom' | 'stayTo' | 'promotionType' | 'externalMeta'>,
  today: string,
): { from: string; to: string } | null {
  if (!p.stayFrom || !p.stayTo) return null;
  let from = p.stayFrom;
  let to = p.stayTo;
  const meta = (p.externalMeta ?? {}) as {
    lastMinute?: { unit?: string; value?: number } | null;
    earlyBookerDays?: number | null;
  };
  if (p.promotionType === 'last_minute' && meta.lastMinute?.value) {
    const days =
      meta.lastMinute.unit === 'hour'
        ? Math.max(1, Math.ceil(meta.lastMinute.value / 24))
        : meta.lastMinute.value;
    if (from < today) from = today;
    const lastDay = addDaysYmd(today, Math.max(0, days - 1));
    if (to > lastDay) to = lastDay;
  } else if (p.promotionType === 'early_booker' && meta.earlyBookerDays) {
    const firstDay = addDaysYmd(today, meta.earlyBookerDays);
    if (from < firstDay) from = firstDay;
  }
  return from <= to ? { from, to } : null;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

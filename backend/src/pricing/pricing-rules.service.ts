import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PropertyService } from '../property/property.service';
import { PricingConfig } from './pricing-config';
import { PricingService } from './pricing.service';
import { PromotionQueueService } from './promotion-queue.service';
import { normalizeWeekdays, todayInTz } from './pricing-math.util';
import {
  parseRuleStepMeta,
  ruleStayTo,
  ruleStepName,
  worstTargetState,
  type RuleStepMeta,
} from './pricing-rules.util';
import { PricePromotionEntity } from './entities/price-promotion.entity';
import {
  PricePromotionTargetEntity,
  type PromotionTargetState,
} from './entities/price-promotion-target.entity';
import { PricePromotionEventEntity } from './entities/price-promotion-event.entity';
import type { CreateRuleDto } from './dto/pricing-rules.dto';

/** Targets in these states are sent again by «Отправить в Booking». */
const RESENDABLE: PromotionTargetState[] = ['dry_run', 'error', 'skipped'];

/**
 * «Цены → Автоправила»: a ladder of Booking last-minute deals created once for a long stay period.
 * Booking applies the right step by itself as arrival gets closer (no schedule, no repeated calls).
 * Steps are ordinary PricePromotionEntity rows, so queue, executor, sync and history are shared.
 * Everything here answers 503 until ZODOMUS_PROMOTIONS_AUTORULES_ENABLED=true.
 */
@Injectable()
export class PricingRulesService {
  private readonly logger = new Logger(PricingRulesService.name);

  constructor(
    private readonly cfg: PricingConfig,
    private readonly pricing: PricingService,
    private readonly propertyService: PropertyService,
    private readonly queue: PromotionQueueService,
    private readonly dataSource: DataSource,
    @InjectRepository(PricePromotionEntity)
    private readonly promotionRepo: Repository<PricePromotionEntity>,
    @InjectRepository(PricePromotionTargetEntity)
    private readonly targetRepo: Repository<PricePromotionTargetEntity>,
  ) {}

  /**
   * Anything that can put a discount on Booking needs the auto-rules flag. Reading and SWITCHING OFF only need
   * promotions to be enabled: with the flag off the rules must still be visible and stoppable.
   */
  private assertRulesEnabled(): void {
    this.pricing.assertEnabled();
    if (!this.cfg.flags.autoRules) {
      throw new ServiceUnavailableException(
        'Автоправила выключены (ZODOMUS_PROMOTIONS_AUTORULES_ENABLED=false)',
      );
    }
  }

  async create(user: JwtPayload, dto: CreateRuleDto) {
    this.assertRulesEnabled();
    const actor = await this.pricing.actor(user);
    const today = todayInTz('UTC');
    const plan = await this.pricing.plan(actor.ownerId, {
      propertyIds: dto.propertyIds,
      stayFrom: today,
      stayTo: today,
      discountPct: Math.max(...dto.steps.map((s) => s.discountPct)),
    });
    if (plan.eligible.length === 0) {
      throw new BadRequestException('Нет объектов, которым можно включить правило на Booking');
    }

    let replaced: PricePromotionEntity[] = [];
    if (dto.replaceGroupId) {
      replaced = await this.stepsOf(actor.ownerId, dto.replaceGroupId);
      if (replaced.length === 0) throw new NotFoundException('Правило не найдено');
    }

    // «Today» differs per time zone: start from the earliest one, each property trims it itself.
    const stayFrom = plan.eligible
      .map((e) => todayInTz(e.property.timezone))
      .sort()[0] as string;
    const horizonMonths = dto.horizonMonths ?? 6;
    const stayTo = ruleStayTo(stayFrom, horizonMonths);
    const weekdays = normalizeWeekdays(dto.weekdays);
    const groupId = randomUUID();
    const name = dto.name.trim();

    await this.dataSource.transaction(async (em) => {
      const promoRepo = em.getRepository(PricePromotionEntity);
      const targetRepo = em.getRepository(PricePromotionTargetEntity);
      const eventRepo = em.getRepository(PricePromotionEventEntity);
      for (const [stepIndex, step] of dto.steps.entries()) {
        const lastMinute = { unit: step.unit, value: step.value } as const;
        // «Any time of the day» is the same as no restriction — don't send a pointless 0–24 window.
        const bookTime =
          step.bookTime && !(step.bookTime.start === 0 && step.bookTime.end === 24) ? step.bookTime : null;
        const meta = {
          rule: { groupId, name, stepIndex, horizonMonths },
          lastMinute,
          bookTime,
        };
        const promo = await promoRepo.save(
          promoRepo.create({
            ownerId: actor.ownerId,
            companyId: plan.eligible[0]!.property.companyId ?? null,
            name: ruleStepName(lastMinute, bookTime),
            source: 'rentai',
            promotionType: 'last_minute',
            discountPct: step.discountPct,
            stayFrom,
            stayTo,
            activeWeekdays: weekdays,
            protectMinPrice: dto.protectMinPrice ?? true,
            status: 'active',
            externalMeta: meta,
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
        await eventRepo.save(
          eventRepo.create({
            promotionId: promo.id,
            propertyId: null,
            actorUserId: actor.userId,
            actorLabel: actor.label,
            action: 'created',
            message: `Правило «${name}»: шаг «${promo.name}» −${step.discountPct}% создан (объектов: ${plan.eligible.length})`,
            details: {
              groupId,
              stepIndex,
              stayFrom,
              stayTo,
              dryRun: this.cfg.flags.dryRun,
              excluded: plan.excluded,
            },
          }),
        );
      }
    });
    this.queue.kick();

    // Editing: the new rule is already saved; now switch the old one off. Until the queue has done it both
    // are live and Booking shows the higher discount (the queue always handles switch-offs first).
    const warnings: string[] = [];
    for (const old of replaced) {
      if (old.status !== 'active') continue;
      try {
        await this.pricing.setPromotionActive(user, old.id, false);
      } catch (e) {
        this.logger.warn(`rule ${dto.replaceGroupId}: could not switch step ${old.id} off: ${String(e)}`);
        warnings.push(`Не удалось выключить старый шаг «${old.name}» — выключите старое правило вручную`);
      }
    }
    return { ...(await this.view(actor.ownerId, groupId)), warnings };
  }

  /** Works with the flag off too — the rules must stay visible (and stoppable) after an emergency switch-off. */
  async list(user: JwtPayload) {
    this.pricing.assertEnabled();
    const { ownerId } = await this.pricing.actor(user);
    return this.views(ownerId);
  }

  async setActive(user: JwtPayload, groupId: string, on: boolean) {
    if (on) this.assertRulesEnabled();
    else this.pricing.assertEnabled();
    const actor = await this.pricing.actor(user);
    const steps = await this.stepsOf(actor.ownerId, groupId);
    if (steps.length === 0) throw new NotFoundException('Правило не найдено');
    for (const step of steps) await this.pricing.setPromotionActive(user, step.id, on);
    return this.view(actor.ownerId, groupId);
  }

  /** Switch the rule off / on for ONE property (all its steps), e.g. while that apartment is under repair. */
  async setPropertyActive(user: JwtPayload, groupId: string, propertyId: string, on: boolean) {
    if (on) this.assertRulesEnabled();
    else this.pricing.assertEnabled();
    const actor = await this.pricing.actor(user);
    const steps = await this.stepsOf(actor.ownerId, groupId);
    if (steps.length === 0) throw new NotFoundException('Правило не найдено');
    const mine = steps.filter((s) => s.targets.some((t) => t.propertyId === propertyId));
    if (mine.length === 0) throw new NotFoundException('Объект не участвует в этом правиле');
    for (const step of mine) {
      // A step that is switched off as a whole is turned on only with the whole rule.
      if (on && step.status !== 'active') continue;
      // Only what really changes goes to the queue (each push costs several Zodomus reads).
      const target = step.targets.find((t) => t.propertyId === propertyId)!;
      if (target.desiredState === (on ? 'on' : 'off')) continue;
      await this.pricing.targetAction(user, step.id, propertyId, on ? 'on' : 'off');
    }
    return this.view(actor.ownerId, groupId);
  }

  /**
   * Sends the rule to Booking again where it was only simulated (test mode), failed or was skipped.
   * Objects switched off by hand stay off.
   */
  async resend(user: JwtPayload, groupId: string) {
    this.assertRulesEnabled();
    const actor = await this.pricing.actor(user);
    const steps = await this.stepsOf(actor.ownerId, groupId);
    if (steps.length === 0) throw new NotFoundException('Правило не найдено');
    const changed: PricePromotionTargetEntity[] = [];
    for (const step of steps) {
      if (step.status !== 'active') continue;
      for (const t of step.targets) {
        if (t.desiredState !== 'on' || !RESENDABLE.includes(t.state)) continue;
        t.needsPush = true;
        t.attempts = 0;
        t.nextAttemptAt = null;
        t.state = 'pending';
        changed.push(t);
      }
    }
    if (changed.length > 0) {
      await this.targetRepo.save(changed);
      this.queue.kick();
    }
    return this.view(actor.ownerId, groupId);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /** Steps of one rule in ladder order. */
  private async stepsOf(ownerId: string, groupId: string): Promise<PricePromotionEntity[]> {
    return (await this.loadSteps(ownerId))
      .filter((s) => s.meta.rule.groupId === groupId)
      .sort((a, b) => a.meta.rule.stepIndex - b.meta.rule.stepIndex)
      .map((s) => s.promo);
  }

  private async loadSteps(ownerId: string): Promise<Array<{ promo: PricePromotionEntity; meta: RuleStepMeta }>> {
    const promos = await this.promotionRepo.find({
      where: { ownerId, source: 'rentai', promotionType: 'last_minute' },
      relations: ['targets'],
      order: { createdAt: 'DESC' },
      // No row limit on purpose: a limit could cut a rule in half. The set is small (rules × ≤ 8 steps).
    });
    return promos.flatMap((promo) => {
      const meta = parseRuleStepMeta(promo.externalMeta);
      return meta ? [{ promo, meta }] : [];
    });
  }

  private async view(ownerId: string, groupId: string) {
    const rule = (await this.views(ownerId)).find((r) => r.groupId === groupId);
    if (!rule) throw new NotFoundException('Правило не найдено');
    return rule;
  }

  private async views(ownerId: string) {
    const [steps, props] = await Promise.all([
      this.loadSteps(ownerId),
      this.propertyService.findAllByOwner(ownerId),
    ]);
    const byId = new Map(props.map((p) => [p.id, p]));
    const groups = new Map<string, Array<{ promo: PricePromotionEntity; meta: RuleStepMeta }>>();
    for (const s of steps) {
      const list = groups.get(s.meta.rule.groupId) ?? [];
      list.push(s);
      groups.set(s.meta.rule.groupId, list);
    }

    return [...groups.entries()].map(([groupId, list]) => {
      list.sort((a, b) => a.meta.rule.stepIndex - b.meta.rule.stepIndex);
      const first = list[0]!;
      const summaries = list.map((s) => ({ s, sum: this.pricing.summary(s.promo, byId) }));

      const counts: Record<PromotionTargetState, number> & { total: number } = {
        pending: 0,
        on: 0,
        off: 0,
        error: 0,
        skipped: 0,
        dry_run: 0,
        total: 0,
      };
      const statesByProperty = new Map<string, PromotionTargetState[]>();
      for (const { s } of summaries) {
        for (const t of s.promo.targets ?? []) {
          counts[t.state] += 1;
          counts.total += 1;
          const states = statesByProperty.get(t.propertyId) ?? [];
          states.push(t.desiredState === 'off' ? 'off' : t.state);
          statesByProperty.set(t.propertyId, states);
        }
      }

      const allOff = summaries.every(({ sum }) => sum.status === 'off');
      const allFinished = summaries.every(({ sum }) => sum.derivedStatus !== 'active');
      const status: 'active' | 'off' | 'finished' = allOff ? 'off' : allFinished ? 'finished' : 'active';

      return {
        groupId,
        name: first.meta.rule.name,
        createdAt: first.promo.createdAt.toISOString(),
        weekdays: first.promo.activeWeekdays,
        protectMinPrice: first.promo.protectMinPrice,
        horizonMonths: first.meta.rule.horizonMonths,
        stayFrom: first.promo.stayFrom,
        stayTo: first.promo.stayTo,
        status,
        counts,
        steps: summaries.map(({ s, sum }) => ({
          id: s.promo.id,
          name: s.promo.name,
          discountPct: s.promo.discountPct,
          lastMinute: s.meta.lastMinute,
          bookTime: s.meta.bookTime,
          status: sum.status,
          derivedStatus: sum.derivedStatus,
          counts: sum.counts,
          /** Targets where Booking stored the step differently from what was sent. */
          mismatch: s.promo.targets.filter((t) => t.verifyNote?.startsWith('MISMATCH')).length,
        })),
        properties: [...statesByProperty.entries()].map(([propertyId, states]) => ({
          propertyId,
          propertyName: byId.get(propertyId)?.name ?? '—',
          state: worstTargetState(states) ?? 'off',
        })),
      };
    });
  }
}

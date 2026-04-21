import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ChatService } from '../../chat/chat.service';
import { MessageChannel } from '../../chat/enums/message-channel.enum';
import { PropertyService } from '../../property/property.service';
import { TasksService } from '../../tasks/tasks.service';
import type { CreateAutomationRuleInput } from './dto/create-automation-rule.schema';
import type { ListRulesQuery } from './dto/list-rules-query.schema';
import type { UpdateRuleParamsDto } from './dto/update-rule-params.dto';
import type { UpdateRuleStatusDto } from './dto/update-rule-status.dto';
import {
  AUTOMATION_IDEMPOTENCY_DONE_TTL_MS,
  AUTOMATION_IDEMPOTENCY_PROCESSING_TTL_MS,
} from './automations.constants';
import { AutomationRuleEntity } from './entities/automation-rule.entity';
import { AiIntentDetectedPayload, AiIntentDetectedSchema } from './events/ai-intent.payload';
import { RedisLockService } from '../redis/redis-lock.service';

const CleanerDelayedParamsSchema = z.object({
  notifyManager: z.boolean().default(true),
  delayThreshold: z.coerce.number().min(0).default(30),
});

const CleanerDelayedExtractedSchema = z.object({
  delayMinutes: z.coerce.number().finite().min(0),
  reason: z.string().optional(),
});

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @InjectRepository(AutomationRuleEntity)
    private readonly automationRuleRepository: Repository<AutomationRuleEntity>,
    private readonly propertyService: PropertyService,
    private readonly tasksService: TasksService,
    private readonly chatService: ChatService,
    private readonly redisLock: RedisLockService,
  ) {}

  /**
   * Ensures the caller may access the property, then returns rules for the category.
   */
  async listRules(query: ListRulesQuery, user: JwtPayload): Promise<AutomationRuleEntity[]> {
    await this.propertyService.findOneForUser(query.propertyId, user.sub, user.role);
    return this.automationRuleRepository.find({
      where: { propertyId: query.propertyId, category: query.category },
      order: { key: 'ASC' },
    });
  }

  async createRule(dto: CreateAutomationRuleInput, user: JwtPayload): Promise<AutomationRuleEntity> {
    await this.propertyService.findOneForUser(dto.propertyId, user.sub, user.role);

    const existing = await this.automationRuleRepository.findOne({
      where: { propertyId: dto.propertyId, key: dto.key },
    });
    if (existing) {
      throw new ConflictException(`Automation rule "${dto.key}" already exists for this property`);
    }

    let params: Record<string, unknown> = dto.params && typeof dto.params === 'object' ? { ...dto.params } : {};
    if (dto.key === 'CLEANER_DELAYED') {
      const merged = {
        notifyManager: true,
        delayThreshold: 30,
        ...params,
      };
      const parsed = CleanerDelayedParamsSchema.safeParse(merged);
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.flatten());
      }
      params = parsed.data as Record<string, unknown>;
    }

    const row = this.automationRuleRepository.create({
      propertyId: dto.propertyId,
      key: dto.key,
      category: dto.category,
      status: dto.status ?? 'active',
      params,
    });
    return this.automationRuleRepository.save(row);
  }

  async updateRuleStatus(
    ruleId: string,
    dto: UpdateRuleStatusDto,
    user: JwtPayload,
  ): Promise<AutomationRuleEntity> {
    const rule = await this.requireRuleForUser(ruleId, user);
    rule.status = dto.status;
    return this.automationRuleRepository.save(rule);
  }

  async updateRuleParams(
    ruleId: string,
    dto: UpdateRuleParamsDto,
    user: JwtPayload,
  ): Promise<AutomationRuleEntity> {
    const rule = await this.requireRuleForUser(ruleId, user);
    const prev =
      rule.params && typeof rule.params === 'object' && !Array.isArray(rule.params)
        ? rule.params
        : {};
    rule.params = { ...prev, ...dto.params };
    return this.automationRuleRepository.save(rule);
  }

  private async requireRuleForUser(ruleId: string, user: JwtPayload): Promise<AutomationRuleEntity> {
    const rule = await this.automationRuleRepository.findOne({ where: { id: ruleId } });
    if (!rule) {
      throw new NotFoundException('Automation rule not found');
    }
    await this.propertyService.findOneForUser(rule.propertyId, user.sub, user.role);
    return rule;
  }

  /**
   * Idempotency: Redis `SET … PX … NX` lease via {@link RedisLockService}, then `setDone` or `releaseLock` on failure.
   * TTL values are **milliseconds** (`PX`).
   */
  @OnEvent('ai.intent.detected', { async: true })
  async handleAiIntentExecution(rawPayload: unknown): Promise<void> {
    const payloadResult = AiIntentDetectedSchema.safeParse(rawPayload);
    if (!payloadResult.success) {
      this.logger.error(`Invalid ai.intent.detected payload: ${payloadResult.error.message}`);
      return;
    }
    const payload = payloadResult.data;
    const idempotencyKey = `automations:idemp:${payload.intentKey}:${payload.eventId}`;

    const existing = await this.redisLock.get(idempotencyKey);
    if (existing === 'done') {
      this.logger.warn(
        `Event ${payload.eventId} skipped for intent ${payload.intentKey} (already completed)`,
      );
      return;
    }

    const acquired = await this.redisLock.acquireLock(
      idempotencyKey,
      AUTOMATION_IDEMPOTENCY_PROCESSING_TTL_MS,
    );
    if (!acquired) {
      const v = await this.redisLock.get(idempotencyKey);
      if (v === 'done') {
        return;
      }
      this.logger.warn(
        `Event ${payload.eventId} skipped for intent ${payload.intentKey} (lease held or duplicate)`,
      );
      return;
    }

    try {
      const rule = await this.automationRuleRepository.findOne({
        where: {
          propertyId: payload.propertyId,
          key: payload.intentKey,
          status: 'active',
        },
      });

      if (rule) {
        this.logger.log(
          `Matched active rule id=${rule.id} key=${rule.key} propertyId=${payload.propertyId} eventId=${payload.eventId}`,
        );
        await this.executeActionRouter(rule, payload);
      } else {
        this.logger.debug(
          `No active rule for propertyId=${payload.propertyId} intentKey=${payload.intentKey} eventId=${payload.eventId}`,
        );
      }

      await this.redisLock.setDone(idempotencyKey, AUTOMATION_IDEMPOTENCY_DONE_TTL_MS);
    } catch (error) {
      await this.redisLock.releaseLock(idempotencyKey);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Execution failed for eventId=${payload.eventId} intent=${payload.intentKey}; idempotency key released for retry. ${msg}`,
        stack,
      );
      throw error;
    }
  }

  private async executeActionRouter(
    rule: AutomationRuleEntity,
    payload: AiIntentDetectedPayload,
  ): Promise<void> {
    switch (rule.key) {
      case 'CLEANER_DELAYED':
        await this.handleCleanerDelayed(rule, payload);
        break;
      default:
        this.logger.warn(`No automation executor implemented for rule key=${rule.key}`);
    }
  }

  private async handleCleanerDelayed(
    rule: AutomationRuleEntity,
    payload: AiIntentDetectedPayload,
  ): Promise<void> {
    const paramsResult = CleanerDelayedParamsSchema.safeParse(rule.params);
    if (!paramsResult.success) {
      this.logger.error(
        `Invalid CLEANER_DELAYED params for rule ${rule.id}: ${paramsResult.error.message}`,
      );
      return;
    }
    const params = paramsResult.data;

    const extractedResult = CleanerDelayedExtractedSchema.safeParse(payload.extractedData);
    if (!extractedResult.success) {
      this.logger.error(
        `Invalid CLEANER_DELAYED extractedData for event ${payload.eventId}: ${extractedResult.error.message}`,
      );
      return;
    }
    const extracted = extractedResult.data;

    try {
      if (params.notifyManager) {
        const content =
          `⚠️ Задержка уборки: ${extracted.delayMinutes} мин. (триггер: ${payload.triggerUserId}). ` +
          `Причина: ${extracted.reason?.trim() ? extracted.reason.trim() : 'не указана'}.`;
        await this.chatService.saveMessage({
          propertyId: payload.propertyId,
          content,
          role: 'system',
          source: 'ai',
          channel: MessageChannel.TELEGRAM,
          skipAutomationEvent: true,
        });
        this.logger.log(
          `CLEANER_DELAYED: manager notification persisted for propertyId=${payload.propertyId} eventId=${payload.eventId}`,
        );
      }

      if (extracted.delayMinutes >= params.delayThreshold) {
        const ownerId = await this.propertyService.getOwnerIdByPropertyId(payload.propertyId);
        if (!ownerId) {
          this.logger.error(
            `CLEANER_DELAYED: cannot create task — owner not found for propertyId=${payload.propertyId}`,
          );
          return;
        }
        const notes =
          `Автоматизация CLEANER_DELAYED (eventId=${payload.eventId}, trigger=${payload.triggerUserId}). ` +
          `Задержка: ${extracted.delayMinutes} мин, порог: ${params.delayThreshold}. ` +
          `Причина: ${extracted.reason?.trim() ? extracted.reason.trim() : 'не указана'}.`;

        await this.tasksService.createForManager(ownerId, 'OWNER', {
          propertyId: payload.propertyId,
          title: `Срочно: пересмотр уборки (${extracted.delayMinutes} мин)`,
          type: 'other',
          priority: 'urgent',
          notes,
        });
        this.logger.log(
          `CLEANER_DELAYED: urgent task created for propertyId=${payload.propertyId} eventId=${payload.eventId}`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `CLEANER_DELAYED: downstream action failed (rule ${rule.id}, event ${payload.eventId}): ${msg}`,
      );
      throw error;
    }
  }
}

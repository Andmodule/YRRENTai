import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PropertyVoicePolicyEntity,
  AfterHoursMode,
} from './entities/property-voice-policy.entity';

export interface VoicePolicyDto {
  voiceAssistantEnabled?: boolean;
  autoAnswerEnabled?: boolean;
  recordCallsEnabled?: boolean;
  clarifyThreshold?: number;
  escalateThreshold?: number;
  maxTurns?: number;
  fallbackTransferNumber?: string | null;
  afterHoursMode?: AfterHoursMode;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  emergencyEscalationEnabled?: boolean;
  complaintAutoEscalate?: boolean;
  preferredLanguages?: string;
  shortAnswerMode?: boolean;
  allowedTopics?: string | null;
  escalationTopics?: string | null;
  customFallbackPhrases?: Record<string, string[]> | null;
}

const SAFE_DEFAULTS: Omit<PropertyVoicePolicyEntity, 'id' | 'propertyId' | 'createdAt' | 'updatedAt'> = {
  voiceAssistantEnabled: false,
  autoAnswerEnabled: false,
  recordCallsEnabled: false,
  clarifyThreshold: 0.55,
  escalateThreshold: 0.35,
  maxTurns: 12,
  fallbackTransferNumber: null,
  afterHoursMode: 'short_ai',
  quietHoursStart: 22,
  quietHoursEnd: 8,
  emergencyEscalationEnabled: true,
  complaintAutoEscalate: true,
  preferredLanguages: 'ru',
  shortAnswerMode: true,
  allowedTopics: null,
  escalationTopics: null,
  customFallbackPhrases: null,
  transcriptRetentionDays: 90,
  redactionEnabled: false,
  exportAllowed: true,
  recordingStorageEnabled: false,
  recordingRetentionDays: 30,
};

@Injectable()
export class PropertyVoicePolicyService {
  private readonly logger = new Logger(PropertyVoicePolicyService.name);
  /** In-memory cache keyed by propertyId — TTL: 5 minutes */
  private readonly cache = new Map<string, { policy: PropertyVoicePolicyEntity; at: number }>();
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(PropertyVoicePolicyEntity)
    private readonly policyRepo: Repository<PropertyVoicePolicyEntity>,
  ) {}

  /**
   * Returns the policy for a property, creating a safe-default row if one does not exist.
   * Cached for 5 minutes to stay off the DB hot path on every turn.
   */
  async getOrCreatePolicy(propertyId: string): Promise<PropertyVoicePolicyEntity> {
    const cached = this.cache.get(propertyId);
    if (cached && Date.now() - cached.at < this.TTL_MS) {
      return cached.policy;
    }

    let policy = await this.policyRepo.findOne({ where: { propertyId } });

    if (!policy) {
      this.logger.log(`Creating default voice policy for property ${propertyId}`);
      policy = this.policyRepo.create({ ...SAFE_DEFAULTS, propertyId });
      await this.policyRepo.save(policy);
    }

    this.cache.set(propertyId, { policy, at: Date.now() });
    return policy;
  }

  async upsert(propertyId: string, dto: VoicePolicyDto): Promise<PropertyVoicePolicyEntity> {
    const existing = await this.policyRepo.findOne({ where: { propertyId } });

    if (existing) {
      await this.policyRepo.update(existing.id, dto);
      const updated = await this.policyRepo.findOneOrFail({ where: { propertyId } });
      this.cache.set(propertyId, { policy: updated, at: Date.now() });
      return updated;
    }

    const policy = this.policyRepo.create({ ...SAFE_DEFAULTS, ...dto, propertyId });
    const saved = await this.policyRepo.save(policy);
    this.cache.set(propertyId, { policy: saved, at: Date.now() });
    return saved;
  }

  invalidateCache(propertyId: string): void {
    this.cache.delete(propertyId);
  }

  /**
   * Quick capability check used by orchestrator / policy service —
   * avoids full entity load when only a flag is needed.
   */
  async isVoiceEnabled(propertyId: string): Promise<boolean> {
    const p = await this.getOrCreatePolicy(propertyId);
    return p.voiceAssistantEnabled;
  }
}

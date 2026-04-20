import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CallTranscriptSegmentEntity } from './entities/call-transcript-segment.entity';
import { CallEventEntity } from './entities/call-event.entity';
import { CallSessionEntity } from './entities/call-session.entity';
import { PropertyVoicePolicyService } from './property-voice-policy.service';
import { CallStatusMachine } from './call-status.machine';

/**
 * Privacy & data retention enforcement.
 * - Runs nightly to delete or redact transcript/event data past retention window
 * - Redacts PII from transcript content before archiving
 */
@Injectable()
export class VoicePrivacyService {
  private readonly logger = new Logger(VoicePrivacyService.name);

  /** Regex patterns for PII redaction in transcript text */
  private static readonly REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
    // Phone numbers (E.164, Russian, international)
    { pattern: /\+?[78]\s?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g, replacement: '[PHONE]' },
    { pattern: /\+\d{1,3}\s?\d{6,14}/g, replacement: '[PHONE]' },
    // Email addresses
    { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
    // Russian passport numbers (10 digits with spaces)
    { pattern: /\b\d{4}\s\d{6}\b/g, replacement: '[PASSPORT]' },
    // Card-like numbers (16 digits)
    { pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, replacement: '[CARD]' },
  ];

  constructor(
    @InjectRepository(CallTranscriptSegmentEntity)
    private readonly segmentRepo: Repository<CallTranscriptSegmentEntity>,
    @InjectRepository(CallEventEntity)
    private readonly eventRepo: Repository<CallEventEntity>,
    @InjectRepository(CallSessionEntity)
    private readonly sessionRepo: Repository<CallSessionEntity>,
    private readonly policyService: PropertyVoicePolicyService,
  ) {}

  /**
   * Nightly retention job: runs at 03:15 UTC.
   * Processes expired transcripts per property policy.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runRetentionCleanup(): Promise<void> {
    this.logger.log('Voice retention cleanup: starting');
    try {
      await this.processExpiredSessions();
    } catch (err) {
      this.logger.error(`Retention cleanup failed: ${(err as Error).message}`);
    }
  }

  /** Redact a single text string in-memory (used before storing or on-demand) */
  static redact(text: string): string {
    let result = text;
    for (const { pattern, replacement } of VoicePrivacyService.REDACTION_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * On-demand redaction of all transcript segments for a session.
   * Called by the operator when they mark a session for PII removal.
   */
  async redactSession(sessionId: string): Promise<number> {
    const segments = await this.segmentRepo.find({ where: { sessionId } });
    let redacted = 0;

    for (const seg of segments) {
      const clean = VoicePrivacyService.redact(seg.content);
      if (clean !== seg.content) {
        await this.segmentRepo.update(seg.id, { content: clean });
        redacted++;
      }
    }

    this.logger.log(`Redacted ${redacted} segments for session ${sessionId}`);
    return redacted;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async processExpiredSessions(): Promise<void> {
    // Find all terminal sessions older than the max possible retention window (365d)
    const maxLookback = new Date();
    maxLookback.setDate(maxLookback.getDate() - 365);

    const sessions = await this.sessionRepo.find({
      where: { createdAt: LessThan(maxLookback) },
      select: ['id', 'propertyId', 'createdAt'],
    });

    let deletedSegments = 0;
    let deletedEvents = 0;

    for (const session of sessions) {
      if (!session.propertyId) continue;
      const policy = await this.policyService.getOrCreatePolicy(session.propertyId);

      if (policy.transcriptRetentionDays === 0) continue; // 0 = keep forever

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - policy.transcriptRetentionDays);

      if (session.createdAt > cutoff) continue;

      // Within retention window — redact if enabled, else delete
      if (policy.redactionEnabled) {
        await this.redactSession(session.id);
      } else {
        const segResult = await this.segmentRepo.delete({ sessionId: session.id });
        deletedSegments += segResult.affected ?? 0;

        const evtResult = await this.eventRepo.delete({ sessionId: session.id });
        deletedEvents += evtResult.affected ?? 0;
      }
    }

    this.logger.log(
      `Retention cleanup done: ${deletedSegments} segments, ${deletedEvents} events removed`,
    );
  }
}

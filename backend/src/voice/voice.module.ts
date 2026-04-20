import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// ── Controllers ───────────────────────────────────────────────────────────────
import { VoiceController }        from './voice.controller';
import { VoiceWebhookController } from './voice-webhook.controller';
import { VoicePolicyAdminController } from './voice-policy-admin.controller';
import { VoiceAlertsController }    from './controllers/voice-alerts.controller';
import { VoiceRolloutController }   from './controllers/voice-rollout.controller';
import { VoiceAuditController }     from './controllers/voice-audit.controller';
import { VoiceQaController }        from './controllers/voice-qa.controller';
import { VoiceReadinessController } from './controllers/voice-readiness.controller';
import { VoiceRetellController }    from './controllers/voice-retell.controller';

// ── Entities ──────────────────────────────────────────────────────────────────
import { CallSessionEntity }            from './entities/call-session.entity';
import { CallEventEntity }              from './entities/call-event.entity';
import { CallTranscriptSegmentEntity }  from './entities/call-transcript-segment.entity';
import { CallHandoffEntity }            from './entities/call-handoff.entity';
import { PropertyVoicePolicyEntity }    from './entities/property-voice-policy.entity';
import { CallReviewEntity }             from './entities/call-review.entity';
import { VoiceAlertRuleEntity }         from './entities/voice-alert-rule.entity';
import { VoiceAlertEntity }             from './entities/voice-alert.entity';
import { PropertyVoiceRolloutEntity }   from './entities/property-voice-rollout.entity';
import { VoiceAuditLogEntity }          from './entities/voice-audit-log.entity';

// ── Adapters ──────────────────────────────────────────────────────────────────
import { VoiceProviderAdapter } from './adapters/voice-provider.adapter';
import { RetellVoiceProvider }  from './adapters/retell.provider';
import { VapiVoiceProvider }    from './adapters/vapi.provider';

// ── Services ──────────────────────────────────────────────────────────────────
import { VoiceService }             from './voice.service';
import { VoiceSessionService }      from './voice-session.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceKbService }           from './voice-kb.service';
import { VoicePolicyService }       from './voice-policy.service';
import { PropertyVoicePolicyService } from './property-voice-policy.service';
import { VoiceHandoffService }      from './voice-handoff.service';
import { VoiceRealtimeService }     from './voice-realtime.service';
import { VoiceMetricsService }      from './voice-metrics.service';
import { VoicePostCallService }     from './voice-post-call.service';
import { VoicePrivacyService }      from './voice-privacy.service';
import { VoiceGateway }             from './voice.gateway';
import { VoiceEvalService }         from './eval/voice-eval.service';
import { VoiceStatsService }          from './voice-stats.service';
import { VoiceAlertsService }         from './voice-alerts.service';
import { VoiceRolloutService }        from './voice-rollout.service';
import { VoiceAuditService }          from './voice-audit.service';
import { VoiceAlertSchedulerService } from './voice-alert-scheduler.service';
import { VoiceReadinessService }       from './voice-readiness.service';
import { VoiceSmokeTestService }       from './voice-smoke-test.service';
import { VoiceProviderConfigService }    from './config/voice-provider.config';
import { VoiceContextBuilderService }    from './services/voice-context-builder.service';
import { VoicePropertyResolverService }  from './services/voice-property-resolver.service';

// ── External modules ──────────────────────────────────────────────────────────
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { BookingEntity }       from '../booking/entities/booking.entity';
import { PropertyEntity }      from '../property/entities/property.entity';

@Module({
  imports: [
    // Register ScheduleModule so @Cron decorators work.
    // If ScheduleModule is already registered in AppModule, this forRoot() is safe to call again
    // (NestJS deduplicates global modules). If it causes conflicts, remove it here and ensure
    // AppModule has ScheduleModule.forRoot().
    ScheduleModule.forRoot(),

    TypeOrmModule.forFeature([
      CallSessionEntity,
      CallEventEntity,
      CallTranscriptSegmentEntity,
      CallHandoffEntity,
      PropertyVoicePolicyEntity,
      CallReviewEntity,
      VoiceAlertRuleEntity,
      VoiceAlertEntity,
      PropertyVoiceRolloutEntity,
      VoiceAuditLogEntity,
      BookingEntity,
      PropertyEntity,
    ]),
    KnowledgeBaseModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject:  [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [
    VoiceController,
    VoiceWebhookController,
    VoicePolicyAdminController,
    // ── Domain-specific controllers ──
    VoiceAlertsController,
    VoiceRolloutController,
    VoiceAuditController,
    VoiceQaController,
    VoiceReadinessController,
    VoiceRetellController,
  ],
  providers: [
    VoiceService,
    VoiceSessionService,
    VoiceKbService,
    VoicePolicyService,
    PropertyVoicePolicyService,
    VoiceRealtimeService,
    VoiceMetricsService,
    VoicePostCallService,
    VoicePrivacyService,
    VoiceEvalService,
    VoiceStatsService,
    VoiceAlertsService,
    VoiceRolloutService,
    VoiceAuditService,
    VoiceAlertSchedulerService,
    VoiceReadinessService,
    VoiceSmokeTestService,
    VoiceProviderConfigService,
    VoiceContextBuilderService,
    VoicePropertyResolverService,
    VoiceGateway,
    {
      provide: VoiceProviderAdapter,
      useFactory: (
        config:  ConfigService,
        retell:  RetellVoiceProvider,
        vapi:    VapiVoiceProvider,
      ) => {
        const provider = config.get<string>('INBOUND_VOICE_PROVIDER', 'retell');
        return provider === 'vapi' ? vapi : retell;
      },
      inject: [ConfigService, RetellVoiceProvider, VapiVoiceProvider],
    },
    RetellVoiceProvider,
    VapiVoiceProvider,
    VoiceHandoffService,
    VoiceOrchestratorService,
  ],
  exports: [
    VoiceSessionService,
    VoiceRealtimeService,
    PropertyVoicePolicyService,
    VoiceMetricsService,
    VoiceAuditService,
  ],
})
export class VoiceModule {}

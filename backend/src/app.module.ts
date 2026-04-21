import { join } from 'path';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { envSchema } from './config/env.schema';
import { DatabaseInitModule } from './database/database-init.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PropertyModule } from './property/property.module';
import { BookingModule } from './booking/booking.module';
import { AgentModule } from './agent/agent.module';
import { ChatModule } from './chat/chat.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { VoiceModule } from './voice/voice.module';
import { NotificationModule } from './notification/notification.module';
import { TelegramModule } from './telegram/telegram.module';
import { FileModule } from './file/file.module';
import { BillingModule } from './billing/billing.module';
import { HealthModule } from './health/health.module';
import { CalendarModule } from './calendar/calendar.module';
import { TasksModule } from './tasks/tasks.module';
import { IncidentsModule } from './incidents/incidents.module';
import { OperationsModule } from './operations/operations.module';
import { ZodomusModule } from './integrations/zodomus/zodomus.module';
import { ICalModule } from './integrations/ical/ical.module';
import { MessagingModule } from './messaging/messaging.module';
import { AdminModule } from './admin/admin.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { RedisModule } from './modules/redis/redis.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      /**
       * Monorepo: `pnpm dev:backend` runs with cwd `backend/`. A single `.env` at repo root must load
       * (RESEND_*, PORT, etc.). Paths relative to `__dirname` only hit `backend/.env` from `dist/src`.
       */
      envFilePath: [
        join(process.cwd(), '..', '.env'),
        join(process.cwd(), '.env'),
        join(__dirname, '..', '..', '..', '.env'),
        join(__dirname, '..', '..', '.env'),
      ],
      validate: (config) => envSchema.parse(config),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: config.get<string>('NODE_ENV') === 'development',
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url:
            config.get<string>('REDIS_URL')?.trim() ||
            'redis://127.0.0.1:6379',
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    RedisModule,
    ScheduleModule.forRoot(),
    DatabaseInitModule,
    EmbeddingModule,
    AuthModule,
    UserModule,
    PropertyModule,
    BookingModule,
    AgentModule,
    ChatModule,
    KnowledgeBaseModule,
    VoiceModule,
    NotificationModule,
    TelegramModule,
    FileModule,
    BillingModule,
    HealthModule,
    CalendarModule,
    TasksModule,
    IncidentsModule,
    OperationsModule,
    ZodomusModule,
    ICalModule,
    MessagingModule,
    AdminModule,
    AutomationsModule,
    AiChatModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}

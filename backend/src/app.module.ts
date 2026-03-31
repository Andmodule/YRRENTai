import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(__dirname, '..', '..', '.env'),
        join(__dirname, '..', '.env'),
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
    EventEmitterModule.forRoot(),
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
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}

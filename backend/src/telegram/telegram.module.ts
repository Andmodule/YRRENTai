import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { MetricsController } from './metrics.controller';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramEscalationSenderService } from './telegram-escalation-sender.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { EscalationEntity } from './entities/escalation.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { TelegramProcessedUpdateEntity } from './entities/telegram-processed-update.entity';
import { UnmappedReportEntity } from './entities/unmapped-report.entity';
import { StaffTelegramPendingVoiceIncidentEntity } from './entities/staff-telegram-pending-voice-incident.entity';
import { StaffTelegramPendingAttachmentEntity } from './entities/staff-telegram-pending-attachment.entity';
import { ChatModule } from '../chat/chat.module';
import { MessagingModule } from '../messaging/messaging.module';
import { UserModule } from '../user/user.module';
import { PropertyModule } from '../property/property.module';
import { TasksModule } from '../tasks/tasks.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { StaffNotificationService } from './staff-notification.service';
import { StaffTelegramBotService } from './staff-telegram-bot.service';
import { UnmappedReportsService } from './unmapped-reports.service';
import { UnmappedReportsController } from './unmapped-reports.controller';
import { StorageModule } from '../modules/storage/storage.module';

@Module({
  imports: [
    StorageModule,
    TypeOrmModule.forFeature([
      EscalationEntity,
      IncidentEntity,
      TelegramProcessedUpdateEntity,
      UnmappedReportEntity,
      StaffTelegramPendingVoiceIncidentEntity,
      StaffTelegramPendingAttachmentEntity,
    ]),
    forwardRef(() => ChatModule),
    forwardRef(() => MessagingModule),
    forwardRef(() => TasksModule),
    forwardRef(() => IncidentsModule),
    UserModule,
    PropertyModule,
  ],
  controllers: [TelegramController, TelegramWebhookController, MetricsController, UnmappedReportsController],
  providers: [
    TelegramMetricsService,
    TelegramEscalationSenderService,
    TelegramDeliveryService,
    StaffNotificationService,
    StaffTelegramBotService,
    UnmappedReportsService,
    TelegramService,
  ],
  exports: [
    TelegramService,
    TelegramDeliveryService,
    TelegramMetricsService,
    StaffNotificationService,
    StaffTelegramBotService,
    UnmappedReportsService,
  ],
})
export class TelegramModule {}

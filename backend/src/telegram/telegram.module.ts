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
import { ChatModule } from '../chat/chat.module';
import { MessagingModule } from '../messaging/messaging.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EscalationEntity, IncidentEntity]),
    forwardRef(() => ChatModule),
    forwardRef(() => MessagingModule),
    UserModule,
  ],
  controllers: [TelegramController, TelegramWebhookController, MetricsController],
  providers: [
    TelegramMetricsService,
    TelegramEscalationSenderService,
    TelegramDeliveryService,
    TelegramService,
  ],
  exports: [TelegramService, TelegramDeliveryService, TelegramMetricsService],
})
export class TelegramModule {}

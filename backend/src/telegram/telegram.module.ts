import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { EscalationEntity } from './entities/escalation.entity';
import { PropertyNotificationSettingsEntity } from './entities/property-notification-settings.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { ChatModule } from '../chat/chat.module';
import { UserModule } from '../user/user.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EscalationEntity, PropertyNotificationSettingsEntity, IncidentEntity]),
    forwardRef(() => ChatModule),
    forwardRef(() => TasksModule),
    UserModule,
  ],
  controllers: [TelegramController, TelegramWebhookController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

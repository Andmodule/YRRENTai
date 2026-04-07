import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from '../agent/agent.module';
import { BookingModule } from '../booking/booking.module';
import { ChatModule } from '../chat/chat.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { PropertyModule } from '../property/property.module';
import { UserModule } from '../user/user.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MessagingThreadEntity } from './entities/messaging-thread.entity';
import { MessagingMessageEntity } from './entities/messaging-message.entity';
import { InboundEmailDedupEntity } from './entities/inbound-email-dedup.entity';
import { InboundSenderFilterSettingsEntity } from './entities/inbound-sender-filter-settings.entity';
import { MessageParserService } from './message-parser.service';
import { ReplySenderService } from './reply-sender.service';
import { MessagingService } from './messaging.service';
import { AttachmentsController } from './attachments.controller';
import { MessagingRestController, MessagingWebhookController } from './messaging.controller';
import { ResendWebhookGuard } from './guards/resend-webhook.guard';
import { InboundEmailDedupService } from './inbound-email-dedup.service';
import { InboundSenderFilterService } from './inbound-sender-filter.service';
import { InboundSenderFilterSettingsController } from './inbound-sender-filter-settings.controller';
import { MessagingAttachmentEntity } from './entities/messaging_attachments.entity';
import { StorageModule } from '../modules/storage/storage.module';

@Module({
  imports: [
    StorageModule,
    TypeOrmModule.forFeature([
      MessagingThreadEntity,
      MessagingMessageEntity,
      MessagingAttachmentEntity,
      InboundEmailDedupEntity,
      InboundSenderFilterSettingsEntity,
    ]),
    forwardRef(() => ChatModule),
    forwardRef(() => TelegramModule),
    PropertyModule,
    UserModule,
    BookingModule,
    KnowledgeBaseModule,
    AgentModule,
  ],
  controllers: [
    MessagingWebhookController,
    MessagingRestController,
    AttachmentsController,
    InboundSenderFilterSettingsController,
  ],
  providers: [
    MessagingService,
    MessageParserService,
    ReplySenderService,
    ResendWebhookGuard,
    InboundEmailDedupService,
    InboundSenderFilterService,
  ],
  exports: [MessagingService],
})
export class MessagingModule {}

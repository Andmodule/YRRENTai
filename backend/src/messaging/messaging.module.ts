import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from '../agent/agent.module';
import { BookingModule } from '../booking/booking.module';
import { ChatModule } from '../chat/chat.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { PropertyModule } from '../property/property.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MessagingThreadEntity } from './entities/messaging-thread.entity';
import { MessagingMessageEntity } from './entities/messaging-message.entity';
import { MessageParserService } from './message-parser.service';
import { ReplySenderService } from './reply-sender.service';
import { MessagingService } from './messaging.service';
import { MessagingRestController, MessagingWebhookController } from './messaging.controller';
import { ResendWebhookGuard } from './guards/resend-webhook.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessagingThreadEntity, MessagingMessageEntity]),
    forwardRef(() => ChatModule),
    forwardRef(() => TelegramModule),
    PropertyModule,
    BookingModule,
    KnowledgeBaseModule,
    AgentModule,
  ],
  controllers: [MessagingWebhookController, MessagingRestController],
  providers: [
    MessagingService,
    MessageParserService,
    ReplySenderService,
    ResendWebhookGuard,
  ],
  exports: [MessagingService],
})
export class MessagingModule {}

import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { BookingComMetadataService } from './booking-com-metadata.service';
import { StaffReplyService } from './staff-reply.service';
import { StaffOutboundDeliveryService } from './staff-outbound-delivery.service';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { WhatsappProcessedMessageEntity } from './entities/whatsapp-processed-message.entity';
import { MessagingAttachmentEntity } from '../messaging/entities/messaging_attachments.entity';
import { ConversationService } from './conversation.service';
import { AgentModule } from '../agent/agent.module';
import { PropertyModule } from '../property/property.module';
import { UserModule } from '../user/user.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MessagingModule } from '../messaging/messaging.module';
import { StorageModule } from '../modules/storage/storage.module';
import { AiChatModule } from '../modules/ai-chat/ai-chat.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappCloudApiService } from './whatsapp-cloud-api.service';
import { GuestAiPipelineService } from './guest-ai-pipeline.service';
import { ChatRealtimeService } from './chat-realtime.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatMessageEntity,
      ConversationEntity,
      WhatsappProcessedMessageEntity,
      MessagingAttachmentEntity,
    ]),
    JwtModule.register({}),
    AgentModule,
    PropertyModule,
    UserModule,
    KnowledgeBaseModule,
    forwardRef(() => TelegramModule),
    forwardRef(() => MessagingModule),
    StorageModule,
    AiChatModule,
  ],
  controllers: [ChatController, WhatsappWebhookController],
  providers: [
    ChatService,
    ConversationService,
    ChatGateway,
    ChatRealtimeService,
    GuestAiPipelineService,
    WhatsappCloudApiService,
    WhatsappInboundService,
    StaffReplyService,
    StaffOutboundDeliveryService,
    BookingComMetadataService,
  ],
  exports: [
    ChatService,
    ConversationService,
    ChatGateway,
    ChatRealtimeService,
    GuestAiPipelineService,
    StaffReplyService,
    StaffOutboundDeliveryService,
    BookingComMetadataService,
  ],
})
export class ChatModule {}

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
import { ConversationService } from './conversation.service';
import { AgentModule } from '../agent/agent.module';
import { PropertyModule } from '../property/property.module';
import { UserModule } from '../user/user.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessageEntity, ConversationEntity]),
    JwtModule.register({}),
    AgentModule,
    PropertyModule,
    UserModule,
    KnowledgeBaseModule,
    forwardRef(() => TelegramModule),
    forwardRef(() => MessagingModule),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationService,
    ChatGateway,
    StaffReplyService,
    StaffOutboundDeliveryService,
    BookingComMetadataService,
  ],
  exports: [
    ChatService,
    ConversationService,
    ChatGateway,
    StaffReplyService,
    StaffOutboundDeliveryService,
    BookingComMetadataService,
  ],
})
export class ChatModule {}

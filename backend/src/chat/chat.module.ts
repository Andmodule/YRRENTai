import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { AgentModule } from '../agent/agent.module';
import { PropertyModule } from '../property/property.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessageEntity]),
    JwtModule.register({}),
    AgentModule,
    PropertyModule,
    KnowledgeBaseModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}

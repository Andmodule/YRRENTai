import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentService } from '../agent/agent.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { TelegramService } from '../telegram/telegram.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { WhatsappCloudApiService } from './whatsapp-cloud-api.service';
import { conversationChannelToMessageChannel } from './chat-channel.mapper';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessagingAttachmentEntity } from '../messaging/entities/messaging_attachments.entity';
import type { EscalationAttachmentRef } from '../telegram/types/escalation-attachments.types';
import type { EmailInboundMessageMetadata } from '@rentai/shared';
import {
  resolveGuestEscalationFallback,
  formatKnowledgeBaseEntriesForAgent,
  buildAgentKnowledgeContext,
  parseAssistantEscalation,
  shouldForceEscalationGuestReply,
  assistantReplyIndicatesEscalationWithoutMarker,
} from '../agent/constants/agent-prompts';
import { CompanyGlobalRulesService } from '../company/company-global-rules.service';
export interface StreamClientLike {
  emit: (ev: string, data: unknown) => void;
}

/**
 * Shared AI reply path for web (Socket.IO) and WhatsApp inbound webhooks.
 */
@Injectable()
export class GuestAiPipelineService {
  private readonly logger = new Logger(GuestAiPipelineService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly companyGlobalRulesService: CompanyGlobalRulesService,
    private readonly agentService: AgentService,
    private readonly telegramService: TelegramService,
    private readonly chatRealtime: ChatRealtimeService,
    private readonly whatsappCloudApi: WhatsappCloudApiService,
    @InjectRepository(MessagingAttachmentEntity)
    private readonly messagingAttachmentRepo: Repository<MessagingAttachmentEntity>,
  ) {}

  /**
   * Runs KB search + LLM stream, persists assistant message, updates conversation, optional WhatsApp delivery.
   */
  async runAfterGuestUserMessage(params: {
    property: { id: string; name: string; ownerId: string };
    conversation: ConversationEntity;
    userMessage: ChatMessageEntity;
    content: string;
    listPreview: string;
    streamClient: StreamClientLike | null;
    /** When `whatsapp`, sends final guest text via Cloud API. */
    guestReplyChannel: 'web_socket' | 'whatsapp';
  }): Promise<void> {
    const { property, conversation, userMessage, content, listPreview, streamClient, guestReplyChannel } =
      params;

    const [kbSearch, globalRulesRow] = await Promise.all([
      this.knowledgeBaseService.searchRelevant(property.id, content, 8),
      this.companyGlobalRulesService.getForProperty(property.id),
    ]);
    const { entries: kbEntries, isWeakMatch: kbWeakMatch } = kbSearch;
    const propertyKbText = kbWeakMatch ? '' : formatKnowledgeBaseEntriesForAgent(kbEntries);
    const globalRules = globalRulesRow ?? {
      globalDescription: null,
      globalRules: null,
      globalQaEntries: [],
    };
    const { kbContextForAgent, hasAnyKnowledge } = buildAgentKnowledgeContext({
      globalRules,
      propertyKbText,
      propertyKbWeakMatch: kbWeakMatch,
    });
    const history = await this.chatService.getRecentHistory(property.id, 20, conversation.id);

    if (streamClient) {
      streamClient.emit('agent:streamStart', { propertyId: property.id, conversationId: conversation.id });
    }

    await this.agentService.processMessageStream(
      property.name,
      kbContextForAgent,
      content,
      history,
      {
        onChunk: (text) => {
          streamClient?.emit('agent:streamChunk', {
            propertyId: property.id,
            conversationId: conversation.id,
            text,
          });
        },
        onDone: async (fullText) => {
          const { rawEndsEscalate, textWithoutMarker } = parseAssistantEscalation(fullText);

          const kbEmpty = !hasAnyKnowledge;
          const forcedByForbidden = shouldForceEscalationGuestReply(textWithoutMarker);
          const modelSaysEscalateWithoutMarker =
            assistantReplyIndicatesEscalationWithoutMarker(textWithoutMarker);

          const kbWeakWithoutCoverage = kbWeakMatch && !hasAnyKnowledge;

          const notifyStaff =
            kbEmpty ||
            forcedByForbidden ||
            kbWeakWithoutCoverage ||
            rawEndsEscalate ||
            modelSaysEscalateWithoutMarker;

          /** Canned reply iff there is no KB-backed answer to show: empty/weak KB, forbidden wording, or model escalates. */
          const guestEscalationUi =
            kbEmpty ||
            forcedByForbidden ||
            kbWeakWithoutCoverage ||
            rawEndsEscalate ||
            modelSaysEscalateWithoutMarker;

          const escalationFallback = resolveGuestEscalationFallback(content);

          /** Always use the fixed localized phrase for escalation — model wording is too variable. */
          let cleanText: string;
          if (!guestEscalationUi) {
            cleanText = textWithoutMarker;
          } else {
            cleanText = escalationFallback;
          }

          if (!cleanText.trim()) {
            cleanText = escalationFallback;
          }

          cleanText = await this.agentService.ensureReplyMatchesGuestLanguage(content, cleanText);

          const agentMessage = await this.chatService.saveMessage({
            propertyId: property.id,
            conversationId: conversation.id,
            content: cleanText,
            role: 'assistant',
            source: 'ai',
            channel: conversationChannelToMessageChannel(conversation.channel),
          });

          await this.conversationService.touch(conversation.id, cleanText);

          const inboxAiPayload = {
            ...this.chatService.toSocketPayload(agentMessage),
            conversationId: conversation.id,
          };
          this.chatRealtime.emitToInbox(property.id, 'message:saved', inboxAiPayload);

          if (guestReplyChannel === 'whatsapp') {
            try {
              await this.whatsappCloudApi.sendAssistantReplyToGuest(
                property.id,
                conversation.externalGuestKey,
                cleanText,
              );
            } catch (err) {
              this.logger.error(
                `WhatsApp: failed to send AI reply property=${property.id} conv=${conversation.id}`,
                err as Error,
              );
            }
          } else if (streamClient) {
            streamClient.emit('agent:streamEnd', {
              id: agentMessage.id,
              propertyId: property.id,
              conversationId: conversation.id,
              content: cleanText,
              role: 'assistant',
              source: 'ai',
              createdAt: agentMessage.createdAt.toISOString(),
              channel: agentMessage.channel,
              deliveryStatus: agentMessage.deliveryStatus,
            });
          }

          if (notifyStaff) {
            await this.conversationService.setStatus(conversation.id, 'needs_human');
            this.chatRealtime.emitToInbox(property.id, 'conversation:updated', {
              conversationId: conversation.id,
              status: 'needs_human',
              lastMessagePreview: cleanText.slice(0, 200),
              lastActivityAt: agentMessage.createdAt.toISOString(),
            });
            let escalationAttachments: EscalationAttachmentRef[] | undefined;
            const inboundMeta = userMessage.metadata as EmailInboundMessageMetadata | undefined;
            if (inboundMeta?.channel === 'email_inbound' && inboundMeta.messagingMessageId) {
              const rows = await this.messagingAttachmentRepo.find({
                where: { messageId: inboundMeta.messagingMessageId },
              });
              if (rows.length > 0) {
                escalationAttachments = rows.map((a) => ({
                  storageKey: a.storageKey,
                  contentType: a.contentType,
                  fileName: a.fileName,
                }));
              }
            }
            void this.telegramService.sendEscalationIfConfigured({
              propertyId: property.id,
              ownerId: property.ownerId,
              propertyName: property.name,
              guestQuestion: listPreview,
              guestMessageId: userMessage.id,
              conversationId: conversation.id,
              escalationAttachments,
            });
          } else {
            await this.conversationService.setStatus(conversation.id, 'resolved');
            this.chatRealtime.emitToInbox(property.id, 'conversation:updated', {
              conversationId: conversation.id,
              status: 'resolved',
              lastMessagePreview: cleanText.slice(0, 200),
              lastActivityAt: agentMessage.createdAt.toISOString(),
            });
          }
        },
        onError: (error) => {
          streamClient?.emit('agent:error', {
            propertyId: property.id,
            conversationId: conversation.id,
            message: error.message || 'Agent processing failed',
          });
        },
      },
    );
  }
}

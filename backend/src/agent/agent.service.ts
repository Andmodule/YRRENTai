import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  buildSystemPrompt,
  guestReplyScriptMismatch,
  isLikelyEscalationGuestReply,
  resolveGuestEscalationFallback,
} from './constants/agent-prompts';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private openaiClient: OpenAI | null = null;
  private deepseekClient: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): { client: OpenAI; model: string } {
    const provider = this.configService.get<string>('AI_PROVIDER', 'deepseek');

    if (provider === 'openai') {
      if (!this.openaiClient) {
        this.openaiClient = new OpenAI({
          apiKey: this.configService.get<string>('OPENAI_API_KEY'),
        });
      }
      return { client: this.openaiClient, model: 'gpt-4o' };
    }

    if (!this.deepseekClient) {
      this.deepseekClient = new OpenAI({
        apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
        baseURL: this.configService.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      });
    }
    return { client: this.deepseekClient, model: 'deepseek-chat' };
  }

  async processMessageStream(
    propertyName: string,
    knowledgeBase: string,
    userMessage: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const { client, model } = this.getClient();
    const systemPrompt = buildSystemPrompt(propertyName, knowledgeBase);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-20),
      { role: 'user', content: userMessage },
    ];

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.35,
      });

      let fullText = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onChunk(delta);
        }
      }

      callbacks.onDone(fullText);
      this.logger.log(`Agent response complete, ${fullText.length} chars`);
    } catch (error) {
      this.logger.error(`Agent error: ${(error as Error).message}`);
      callbacks.onError(error as Error);
    }
  }

  async processMessage(
    propertyName: string,
    knowledgeBase: string,
    userMessage: string,
    chatHistory: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const { client, model } = this.getClient();
    const systemPrompt = buildSystemPrompt(propertyName, knowledgeBase);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-20),
      { role: 'user', content: userMessage },
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  /**
   * If the model answered in the wrong script vs. the guest (e.g. Russian guest, English reply),
   * replace escalation-style lines with the localized canned message or rewrite the full reply.
   */
  async ensureReplyMatchesGuestLanguage(guestMessage: string, reply: string): Promise<string> {
    const t = reply.trim();
    if (!t) return resolveGuestEscalationFallback(guestMessage);
    if (!guestReplyScriptMismatch(guestMessage, t)) return t;
    if (isLikelyEscalationGuestReply(t)) {
      return resolveGuestEscalationFallback(guestMessage);
    }
    return this.rewriteReplyToGuestLanguage(guestMessage, t);
  }

  private async rewriteReplyToGuestLanguage(guestMessage: string, reply: string): Promise<string> {
    const { client, model } = this.getClient();
    try {
      const out = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the assistant reply so it is entirely in the same natural language as the guest message. ' +
              'Preserve every fact, number, and meaning; do not add or remove information. ' +
              'Output only the rewritten reply, no quotes or preamble.',
          },
          {
            role: 'user',
            content: `Guest message (match this language):\n${guestMessage}\n\nAssistant reply:\n${reply}`,
          },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      });
      const rewritten = out.choices[0]?.message?.content?.trim();
      if (rewritten) return rewritten;
    } catch (e) {
      this.logger.warn(`rewriteReplyToGuestLanguage failed: ${(e as Error).message}`);
    }
    return resolveGuestEscalationFallback(guestMessage);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  VoiceProviderAdapter,
  NormalizedCallEvent,
  StartSessionOptions,
  SendToolResultOptions,
  TransferCallOptions,
} from './voice-provider.adapter';

/**
 * Vapi voice provider.
 * Docs: https://docs.vapi.ai
 *
 * Transfer model:
 *   - Dynamic transfer: server URL receives assistant-request, we respond with transferCall action
 *   - Control URL: POST /call/:id with action payload during live call
 *   - Transfer lifecycle: end-of-call-report carries "ended_reason": "transfer" | "hangup"
 */
@Injectable()
export class VapiVoiceProvider extends VoiceProviderAdapter {
  readonly providerName = 'vapi';
  private readonly logger = new Logger(VapiVoiceProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.vapi.ai';

  constructor(private readonly config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('VAPI_API_KEY', '');
  }

  validateWebhook(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('VAPI_WEBHOOK_SECRET', '');
    if (!secret) return true;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    this.logger.log(`Vapi: startSession for call ${options.providerCallId}`);
  }

  handleEvent(raw: Record<string, unknown>): NormalizedCallEvent | null {
    const msg = (raw['message'] ?? raw) as Record<string, unknown>;
    const type = msg['type'] as string | undefined;
    const call = msg['call'] as Record<string, unknown> | undefined;
    const callId = (call?.['id'] ?? '') as string;
    const ts = new Date();

    switch (type) {
      case 'call-start':
      case 'phone-call-started': {
        const phoneNumber = msg['phoneNumber'] as Record<string, unknown> | undefined;
        const customer = msg['customer'] as Record<string, unknown> | undefined;
        return {
          type: 'call_started',
          providerCallId: callId,
          toNumber: (phoneNumber?.['number'] as string) ?? undefined,
          fromNumber: (customer?.['number'] as string) ?? undefined,
          metadata: msg,
          timestamp: ts,
        };
      }

      case 'end-of-call-report': {
        const endedReason = msg['endedReason'] as string | undefined;
        const wasTransfer = endedReason === 'transfer' || endedReason === 'transfer-dialplan';
        return {
          type: wasTransfer ? 'transfer_requested' : 'call_ended',
          providerCallId: callId,
          metadata: { ...msg, transferStatus: wasTransfer ? 'completed' : 'none' },
          timestamp: ts,
        };
      }

      case 'transcript': {
        const isFinal = msg['transcriptType'] === 'final';
        return {
          type: 'transcript',
          providerCallId: callId,
          transcript: {
            role: msg['role'] === 'assistant' ? 'ai' : 'guest',
            content: (msg['transcript'] as string) ?? '',
            isFinal,
            timestamp: ts,
          },
          timestamp: ts,
        };
      }

      case 'assistant-request':
        // Vapi custom LLM mode: respond via HTTP response with assistant message
        // Our orchestrator handles this via the webhook response path
        return {
          type: 'transcript',
          providerCallId: callId,
          transcript: {
            role: 'guest',
            content: (msg['call'] as Record<string, unknown>)?.['customer']?.toString() ?? '',
            isFinal: true,
            timestamp: ts,
          },
          timestamp: ts,
        };

      case 'tool-calls':
        // Tool call results — forwarded to orchestrator
        return {
          type: 'transcript',
          providerCallId: callId,
          metadata: msg,
          timestamp: ts,
        };

      default:
        this.logger.debug(`Vapi: unhandled event type "${type ?? 'unknown'}"`);
        return null;
    }
  }

  async sendToolResult(options: SendToolResultOptions): Promise<void> {
    this.logger.debug(`Vapi: sendToolResult for call ${options.providerCallId}`);
    await this.vapiPost(`/call/${options.providerCallId}/tool-result`, {
      toolCallId: options.toolCallId,
      result: options.result,
    });
  }

  async endCall(providerCallId: string): Promise<void> {
    await this.vapiPost(`/call/${providerCallId}/end`, {});
  }

  /**
   * Vapi dynamic transfer via control URL (supportsControlUrl = true).
   * Sends a transferCall action during the live call.
   */
  async transferCall(options: TransferCallOptions): Promise<void> {
    this.logger.log(`Vapi: transferCall ${options.providerCallId} → ${options.destinationNumber}`);

    // Vapi control: send an action to the running call
    await this.vapiPost(`/call/${options.providerCallId}/control`, {
      type: 'transferCall',
      destination: options.destinationNumber
        ? { type: 'number', number: options.destinationNumber }
        : { type: 'sip', sipUri: options.destinationSip },
    });
  }

  private async vapiPost(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.error(`Vapi API ${path} → ${res.status}: ${await res.text()}`);
    }
    return res.json().catch(() => null);
  }
}

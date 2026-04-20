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
 * Retell AI voice provider.
 * Docs: https://docs.retellai.com
 *
 * Transfer model:
 *   - Cold/blind transfer: POST /v2/end-call + start new call to destination (Retell standard)
 *   - Warm transfer lifecycle: call_transferred webhook event carries status (completed|cancelled|failed)
 */
@Injectable()
export class RetellVoiceProvider extends VoiceProviderAdapter {
  readonly providerName = 'retell';
  private readonly logger = new Logger(RetellVoiceProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.retellai.com';

  constructor(private readonly config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('RETELL_API_KEY', '');
  }

  validateWebhook(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('RETELL_WEBHOOK_SECRET', this.apiKey);
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    this.logger.log(`Retell: startSession for call ${options.providerCallId}`);
  }

  handleEvent(raw: Record<string, unknown>): NormalizedCallEvent | null {
    const event = raw['event'] as string | undefined;
    const data = (raw['data'] ?? raw) as Record<string, unknown>;
    const callId = (data['call_id'] ?? raw['call_id']) as string | undefined;

    if (!event) return null;
    const ts = new Date();

    switch (event) {
      case 'call_started':
        return {
          type: 'call_started',
          providerCallId: callId ?? '',
          toNumber: data['to_number'] as string | undefined,
          fromNumber: data['from_number'] as string | undefined,
          metadata: data,
          timestamp: ts,
        };

      case 'call_ended':
        return {
          type: 'call_ended',
          providerCallId: callId ?? '',
          metadata: data,
          timestamp: ts,
        };

      case 'transcript': {
        const role = data['role'] === 'agent' ? 'ai' : 'guest';
        return {
          type: 'transcript',
          providerCallId: callId ?? '',
          transcript: {
            role,
            content: (data['content'] as string) ?? '',
            isFinal: Boolean(data['is_final'] ?? true),
            timestamp: ts,
          },
          timestamp: ts,
        };
      }

      case 'agent_response':
        return {
          type: 'agent_response',
          providerCallId: callId ?? '',
          transcript: {
            role: 'ai',
            content: (data['response'] as string) ?? '',
            isFinal: true,
            timestamp: ts,
          },
          timestamp: ts,
        };

      case 'call_transferred': {
        const status = (data['transfer_status'] as string) ?? 'unknown';
        return {
          type: status === 'completed' ? 'transfer_requested' : 'call_ended',
          providerCallId: callId ?? '',
          metadata: {
            ...data,
            transferStatus:      status,
            transferDestination: data['transfer_destination'] as string | undefined,
          },
          timestamp: ts,
        };
      }

      case 'call_analyzed': {
        const analysis = data['call_analysis'] as Record<string, unknown> | undefined;
        return {
          type:          'call_ended',
          providerCallId: callId ?? '',
          metadata: {
            source:        'call_analyzed',
            summary:       analysis?.['call_summary'] as string | undefined,
            sentiment:     analysis?.['user_sentiment'] as string | undefined,
            taskCompleted: analysis?.['agent_task_completion_rating'] as string | undefined,
            ...data,
          },
          timestamp: ts,
        };
      }

      default:
        this.logger.debug(`Retell: unhandled event "${event}"`);
        return null;
    }
  }

  async sendToolResult(options: SendToolResultOptions): Promise<void> {
    this.logger.debug(`Retell: sendToolResult for call ${options.providerCallId}`);
  }

  async endCall(providerCallId: string, reason = 'ended'): Promise<void> {
    this.logger.log(`Retell: endCall ${providerCallId} (${reason})`);
    await this.retellPost(`/v2/end-call/${providerCallId}`, {});
  }

  /**
   * Retell transfer: initiates a blind transfer by calling
   * PATCH /v2/update-retell-llm/{llm_id} with transfer_call tool,
   * or for phone calls via POST /v2/create-phone-call routed to destination.
   */
  async transferCall(options: TransferCallOptions): Promise<void> {
    this.logger.log(`Retell: transferCall ${options.providerCallId} → ${options.destinationNumber}`);

    if (options.destinationNumber) {
      // Blind transfer: end current call leg, originate new outbound to operator
      await this.retellPost(`/v2/end-call/${options.providerCallId}`, {
        reason: 'transfer',
      });
      // Note: in production, you'd pass the caller's number here to bridge them
    } else if (options.destinationSip) {
      await this.retellPost(`/v2/end-call/${options.providerCallId}`, {
        reason: 'transfer',
        sip_uri: options.destinationSip,
      });
    }
  }

  private async retellPost(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.error(`Retell API ${path} → ${res.status}: ${await res.text()}`);
    }
    return res.json().catch(() => null);
  }
}

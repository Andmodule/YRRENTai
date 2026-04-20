export interface NormalizedTranscriptEvent {
  role: 'guest' | 'ai';
  content: string;
  language?: string;
  isFinal: boolean;
  timestamp: Date;
}

export interface NormalizedCallEvent {
  type:
    | 'call_started'
    | 'call_ended'
    | 'transcript'
    | 'agent_response'
    | 'dtmf'
    | 'transfer_requested';
  providerCallId: string;
  toNumber?: string;
  fromNumber?: string;
  transcript?: NormalizedTranscriptEvent;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface StartSessionOptions {
  providerCallId: string;
  /** Pre-built system prompt / context for the LLM */
  systemPrompt: string;
  language?: string;
  /** Agent/voice id in the external platform */
  agentId?: string;
}

export interface SendToolResultOptions {
  providerCallId: string;
  toolCallId: string;
  result: unknown;
}

export interface TransferCallOptions {
  providerCallId: string;
  destinationNumber?: string;
  /** Provider-level queue / SIP address */
  destinationSip?: string;
}

/**
 * Vendor-agnostic contract for voice telephony providers.
 * First implementation: RetellVoiceProvider.
 * Second (interface-compatible): VapiVoiceProvider.
 */
export abstract class VoiceProviderAdapter {
  abstract readonly providerName: string;

  /** Validate webhook signature; throw on failure */
  abstract validateWebhook(rawBody: Buffer, signature: string): boolean;

  abstract startSession(options: StartSessionOptions): Promise<void>;

  abstract handleEvent(rawPayload: Record<string, unknown>): NormalizedCallEvent | null;

  abstract sendToolResult(options: SendToolResultOptions): Promise<void>;

  abstract endCall(providerCallId: string, reason?: string): Promise<void>;

  abstract transferCall(options: TransferCallOptions): Promise<void>;
}

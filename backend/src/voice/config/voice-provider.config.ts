import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.schema';

/** Snapshot of all voice-provider related env config. */
export interface VoiceProviderConfig {
  provider:               'retell' | 'vapi';
  featureFlagEnabled:     boolean;
  realtimeFlagEnabled:    boolean;
  // Retell
  retellApiKey:           string | undefined;
  retellWebhookSecret:    string | undefined;
  retellAgentId:          string | undefined;
  retellInboundNumber:    string | undefined;
  // Vapi
  vapiApiKey:             string | undefined;
  vapiWebhookSecret:      string | undefined;
  // Shared
  handoffTransferNumber:  string | undefined;
  inboundDidPropertyMap:  string | undefined;
  publicBackendUrl:       string | undefined;
}

@Injectable()
export class VoiceProviderConfigService {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  get(): VoiceProviderConfig {
    const provider = this.config.get('INBOUND_VOICE_PROVIDER', { infer: true }) ?? 'retell';
    return {
      provider: provider as 'retell' | 'vapi',
      featureFlagEnabled:    !!this.config.get('FF_VOICE_ENABLED', { infer: true }),
      realtimeFlagEnabled:   !!this.config.get('FF_REALTIME_CALLS_ENABLED', { infer: true }),
      retellApiKey:          this.config.get('RETELL_API_KEY', { infer: true }),
      retellWebhookSecret:   this.config.get('RETELL_WEBHOOK_SECRET', { infer: true }),
      retellAgentId:         this.config.get('RETELL_AGENT_ID', { infer: true }),
      retellInboundNumber:   this.config.get('RETELL_INBOUND_NUMBER', { infer: true }),
      vapiApiKey:            this.config.get('VAPI_API_KEY', { infer: true }),
      vapiWebhookSecret:     this.config.get('VAPI_WEBHOOK_SECRET', { infer: true }),
      handoffTransferNumber: this.config.get('HANDOFF_TRANSFER_NUMBER', { infer: true }),
      inboundDidPropertyMap: this.config.get('INBOUND_DID_PROPERTY_MAP', { infer: true }),
      publicBackendUrl:      this.config.get('PUBLIC_BACKEND_URL', { infer: true }),
    };
  }

  /** Webhook URL displayed in manager UI and go-live checklist. */
  webhookUrl(path: string): string {
    const base = this.get().publicBackendUrl ?? '<YOUR_BACKEND_URL>';
    return `${base}/api/v1/${path}`;
  }
}

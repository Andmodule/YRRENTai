/**
 * Per-provider capability matrix.
 * Orchestration decisions must NOT assume identical behaviour across providers.
 * Check capabilities before using provider-specific features.
 */
export interface ProviderCapabilities {
  /** Warm transfer: provider keeps caller on hold while connecting operator */
  supportsWarmTransfer: boolean;
  /** Cold (blind) transfer: drops caller immediately to destination */
  supportsColdTransfer: boolean;
  /** Supervisor join: operator listens without guest knowing */
  supportsSupervisorJoin: boolean;
  /** Partial (streaming) transcripts before final */
  supportsPartialTranscripts: boolean;
  /** Dynamic control URL / side-channel to push instructions during a call */
  supportsControlUrl: boolean;
  /** Custom LLM mode: provider defers all AI to our backend */
  supportsCustomLlm: boolean;
  /** Webhook signature verification supported */
  supportsWebhookSignature: boolean;
  /** DTMF keypress detection */
  supportsDtmf: boolean;
}

const RETELL_CAPABILITIES: ProviderCapabilities = {
  supportsWarmTransfer: false,
  supportsColdTransfer: true,
  supportsSupervisorJoin: false,
  supportsPartialTranscripts: true,
  supportsControlUrl: false,
  supportsCustomLlm: true,
  supportsWebhookSignature: true,
  supportsDtmf: true,
};

const VAPI_CAPABILITIES: ProviderCapabilities = {
  supportsWarmTransfer: true,
  supportsColdTransfer: true,
  supportsSupervisorJoin: false,
  supportsPartialTranscripts: true,
  supportsControlUrl: true,
  supportsCustomLlm: true,
  supportsWebhookSignature: true,
  supportsDtmf: false,
};

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  retell: RETELL_CAPABILITIES,
  vapi: VAPI_CAPABILITIES,
};

export function getCapabilities(providerName: string): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[providerName] ?? {
    supportsWarmTransfer: false,
    supportsColdTransfer: false,
    supportsSupervisorJoin: false,
    supportsPartialTranscripts: false,
    supportsControlUrl: false,
    supportsCustomLlm: false,
    supportsWebhookSignature: false,
    supportsDtmf: false,
  };
}

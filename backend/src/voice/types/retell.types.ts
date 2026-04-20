/**
 * Typed shapes for Retell AI webhook payloads.
 * Docs: https://docs.retellai.com/api-references/webhook
 */

// ── Inbound call configuration webhook ───────────────────────────────────────

/**
 * Payload Retell sends to your inbound webhook URL when a call comes in.
 * Retell waits for the response (≤ 5s) to get call configuration.
 */
export interface RetellInboundCallPayload {
  /** Unique call ID assigned by Retell */
  call_id: string;
  /** Agent ID configured on the phone number */
  agent_id: string;
  /** Always "inbound_phone_call" for inbound calls */
  call_type: 'inbound_phone_call';
  /** Caller phone number in E.164 */
  from_number: string;
  /** Your Retell phone number (DID) in E.164 */
  to_number: string;
  /** Call direction */
  direction: 'inbound';
  /** Current call status when webhook fires */
  call_status: string;
  /** Optional metadata sent with the number config */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Your response to the Retell inbound webhook.
 * Returned synchronously — must respond within ~5 seconds.
 */
export interface RetellInboundCallResponse {
  /** Override the agent for this specific call (optional) */
  agent_id?: string;
  /**
   * Variables accessible in the agent prompt via {{variable_name}}.
   * Strings only — Retell does not support nested objects here.
   */
  dynamic_variables?: Record<string, string>;
  /** Pass-through metadata stored by Retell for this call */
  metadata?: Record<string, string | number | boolean>;
}

// ── General event webhook ─────────────────────────────────────────────────────

export type RetellEventType =
  | 'call_started'
  | 'call_ended'
  | 'call_analyzed'
  | 'transcript'
  | 'agent_response'
  | 'call_transferred';

export interface RetellWordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface RetellTranscriptTurn {
  role: 'agent' | 'user';
  content: string;
  words?: RetellWordTimestamp[];
}

/** Post-call analysis data from Retell AI */
export interface RetellCallAnalysis {
  call_successful?: boolean;
  call_summary?: string;
  user_sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'Unknown';
  agent_task_completion_rating?: 'Complete' | 'Incomplete' | 'Partial';
  agent_task_completion_rating_reason?: string;
  custom_analysis_data?: Record<string, unknown>;
}

export interface RetellCallObject {
  call_id: string;
  agent_id?: string;
  call_type?: string;
  from_number?: string;
  to_number?: string;
  call_status?: string;
  /** Unix ms when call started */
  start_timestamp?: number;
  /** Unix ms when call ended */
  end_timestamp?: number;
  /** Full transcript as plain text */
  transcript?: string;
  /** Structured transcript turns */
  transcript_object?: RetellTranscriptTurn[];
  /** Populated on call_analyzed event */
  call_analysis?: RetellCallAnalysis;
  /** Dynamic variables used in this call */
  retell_llm_dynamic_variables?: Record<string, string>;
  metadata?: Record<string, string | number | boolean>;
  /** Transfer destination for call_transferred events */
  transfer_destination?: string;
  /** Transfer status: "completed" | "failed" | "cancelled" */
  transfer_status?: string;
}

/** Shape of a Retell general event webhook POST body */
export interface RetellEventWebhookPayload {
  event: RetellEventType | string;
  call: RetellCallObject;
}

// ── Normalised transfer event ─────────────────────────────────────────────────

export interface RetellTransferEvent {
  callId: string;
  destination: string | undefined;
  status: 'completed' | 'failed' | 'cancelled' | 'unknown';
}

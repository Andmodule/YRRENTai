import { Injectable, Logger } from '@nestjs/common';
import type { PropertyVoicePolicyEntity } from './entities/property-voice-policy.entity';
import { getSafeResponse } from './voice-safe-responses';

export type PolicyDecision =
  | 'confident_answer'
  | 'clarify'
  | 'refuse'
  | 'escalate'
  | 'emergency'
  | 'complaint_escalate'
  | 'handoff_request'
  | 'quiet_hours'
  | 'feature_disabled'
  | 'max_turns_exceeded';

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  shouldEscalate: boolean;
  shouldTransferNow: boolean;
  escalationReason: string | null;
  /** Ready-to-speak safe phrase; null when AI should generate its own response */
  safeResponse: string | null;
  /** True when this decision bypassed the LLM entirely */
  preEmpted: boolean;
}

// ── Emergency keywords (pre-LLM guard ─────────────────────────────────────
const EMERGENCY_PATTERNS: RegExp[] = [
  /пожар|огонь|задыма/i,
  /газ\b|утечка\s+газа/i,
  /взрыв|взорв/i,
  /скорую|скорая\s+помощь/i,
  /полиц/i,
  /кровь|истека/i,
  /без\s*сознани/i,
  /не\s*дышит/i,
  /emergency|fire\b|gas\s+leak/i,
  /ambulance|call\s+police/i,
  /explosion/i,
  /unconscious|not\s+breathing/i,
];

const COMPLAINT_PATTERNS: RegExp[] = [
  /жалоб|претензи/i,
  /возврат\s+денег|вернуть\s+деньги/i,
  /требую\s+возврат/i,
  /судья|суд\b/i,
  /роспотреб/i,
  /refund|money\s+back/i,
  /complaint|lawsuit/i,
];

const HANDOFF_PATTERNS: RegExp[] = [
  /оператор|менеджер|живой\s+человек/i,
  /переключите|соедините|позовите/i,
  /хочу\s+говорить\s+с/i,
  /operator|manager|human|real\s+person/i,
  /transfer\s+me|connect\s+me/i,
];

const LEGAL_PRIVACY_PATTERNS: RegExp[] = [
  /персональн|gdpr|персдан/i,
  /адвокат|юрист/i,
  /legal|attorney|lawyer/i,
  /data\s+protection/i,
];

/**
 * Two-phase policy evaluation:
 *
 * Phase 1 — PreLLM guard (fast, rule-based):
 *   Runs BEFORE the LLM turn. Handles emergency, handoff_request, quiet_hours, feature_disabled.
 *   Returns a PolicyEvaluationResult with preEmpted=true so the orchestrator skips LLM entirely.
 *
 * Phase 2 — PostLLM guard (confidence-based):
 *   Runs AFTER the LLM responds. Enforces confidence thresholds, complaint routing, max_turns.
 *   Returns a PolicyEvaluationResult with preEmpted=false.
 */
@Injectable()
export class VoicePolicyService {
  private readonly logger = new Logger(VoicePolicyService.name);

  /**
   * Phase 1: pre-LLM guard — must complete in < 5ms.
   * Returns a pre-emption result if a hard rule fires, or null to let LLM proceed.
   */
  evaluatePreLlm(input: {
    guestQuery: string;
    language: string;
    policy: PropertyVoicePolicyEntity;
    turnIndex: number;
    propertyTimezone?: string;
  }): PolicyEvaluationResult | null {
    const q = input.guestQuery;
    const lang = input.language;
    const p = input.policy;

    // Gate 1: feature disabled
    if (!p.voiceAssistantEnabled) {
      return this.result('feature_disabled', true, true, 'feature_disabled', 'transfer', lang, true);
    }

    // Gate 2: emergency (highest priority — never goes to LLM)
    if (p.emergencyEscalationEnabled && this.matches(q, EMERGENCY_PATTERNS)) {
      this.logger.warn('Emergency guard triggered');
      return this.result('emergency', true, true, 'emergency', 'emergency', lang, true);
    }

    // Gate 3: explicit handoff request
    if (this.matches(q, HANDOFF_PATTERNS)) {
      return this.result('handoff_request', true, true, 'guest_request', 'transfer', lang, true);
    }

    // Gate 4: quiet hours
    if (this.isQuietHours(p)) {
      return this.result('quiet_hours', true, false, 'quiet_hours', 'after_hours', lang, true);
    }

    // Gate 5: max turns
    if (input.turnIndex >= p.maxTurns) {
      return this.result('max_turns_exceeded', true, false, 'max_turns_exceeded', 'max_turns', lang, true);
    }

    // Gate 6: legal/privacy sensitive — escalate but let AI say it politely
    if (this.matches(q, LEGAL_PRIVACY_PATTERNS)) {
      return this.result('escalate', true, false, 'legal_privacy', 'transfer', lang, true);
    }

    return null; // no pre-emption → proceed to LLM
  }

  /**
   * Phase 2: post-LLM evaluation — merges LLM output with business rules.
   */
  evaluatePostLlm(input: {
    guestQuery: string;
    confidence: number;
    language: string;
    policy: PropertyVoicePolicyEntity;
    turnIndex: number;
  }): PolicyEvaluationResult {
    const { confidence, language: lang, policy: p } = input;
    const q = input.guestQuery;

    // Complaint routing (may not have fired pre-LLM if complaint is subtle)
    if (p.complaintAutoEscalate && this.matches(q, COMPLAINT_PATTERNS)) {
      return this.result('complaint_escalate', true, false, 'complaint', 'complaint_received', lang, false);
    }

    // Confidence-based decision
    if (confidence < p.escalateThreshold) {
      return this.result('escalate', true, false, 'low_confidence', 'low_confidence', lang, false);
    }

    if (confidence < p.clarifyThreshold) {
      return this.result('clarify', false, false, null, null, lang, false);
    }

    return this.result('confident_answer', false, false, null, null, lang, false);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private result(
    decision: PolicyDecision,
    shouldEscalate: boolean,
    shouldTransferNow: boolean,
    escalationReason: string | null,
    safeResponseKey: import('./voice-safe-responses').ResponseKey | null,
    language: string,
    preEmpted: boolean,
  ): PolicyEvaluationResult {
    return {
      decision,
      shouldEscalate,
      shouldTransferNow,
      escalationReason,
      safeResponse: safeResponseKey ? getSafeResponse(safeResponseKey, language) : null,
      preEmpted,
    };
  }

  private matches(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
  }

  private isQuietHours(policy: PropertyVoicePolicyEntity): boolean {
    try {
      const now = new Date();
      const hour = now.getHours(); // UTC approximation; property TZ handled elsewhere
      const { quietHoursStart: start, quietHoursEnd: end } = policy;
      return start > end
        ? hour >= start || hour < end   // spans midnight
        : hour >= start && hour < end;  // same day
    } catch {
      return false;
    }
  }
}

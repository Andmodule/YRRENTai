import { Injectable, Logger } from '@nestjs/common';
import { VoicePolicyService } from '../voice-policy.service';
import { EVAL_FIXTURES, EvalFixture } from './voice-eval.fixtures';
import type { PropertyVoicePolicyEntity } from '../entities/property-voice-policy.entity';

export interface EvalResult {
  id: string;
  category: string;
  guestQuery: string;
  pass: boolean;
  expected: EvalFixture['expected'];
  actual: {
    policyDecision: string;
    shouldEscalate: boolean;
    shouldTransferNow: boolean;
    preEmpted: boolean;
  };
  failures: string[];
}

export interface EvalRunSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<string, { total: number; passed: number }>;
  failures: EvalResult[];
  durationMs: number;
}

@Injectable()
export class VoiceEvalService {
  private readonly logger = new Logger(VoiceEvalService.name);

  constructor(private readonly policyService: VoicePolicyService) {}

  /**
   * Runs all fixtures against the policy engine without touching the DB or LLM.
   * Tests only the pre-LLM guard (Phase 1) — the deterministic layer.
   * LLM-dependent outcomes are skipped (marked as 'skipped').
   */
  async runEval(overridePolicy?: Partial<PropertyVoicePolicyEntity>): Promise<EvalRunSummary> {
    const t0 = Date.now();
    const results: EvalResult[] = [];
    const policy = this.buildTestPolicy(overridePolicy);

    for (const fixture of EVAL_FIXTURES) {
      const result = this.evaluateFixture(fixture, policy);
      results.push(result);
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;

    const byCategory: Record<string, { total: number; passed: number }> = {};
    for (const r of results) {
      if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
      byCategory[r.category]!.total++;
      if (r.pass) byCategory[r.category]!.passed++;
    }

    const summary: EvalRunSummary = {
      total: results.length,
      passed,
      failed,
      passRate: Math.round((passed / results.length) * 100),
      byCategory,
      failures: results.filter((r) => !r.pass),
      durationMs: Date.now() - t0,
    };

    this.logger.log(
      `Eval complete: ${passed}/${results.length} passed (${summary.passRate}%) in ${summary.durationMs}ms`,
    );
    if (summary.failed > 0) {
      this.logger.warn(
        `Failures: ${summary.failures.map((f) => `${f.id}: ${f.failures.join(', ')}`).join(' | ')}`,
      );
    }

    return summary;
  }

  private evaluateFixture(
    fixture: EvalFixture,
    policy: PropertyVoicePolicyEntity,
  ): EvalResult {
    // Simulate quiet hours if fixture requires it
    const testPolicy: PropertyVoicePolicyEntity = fixture.quietHours
      ? { ...policy, quietHoursStart: 0, quietHoursEnd: 23 } // always quiet
      : policy;

    const preResult = this.policyService.evaluatePreLlm({
      guestQuery: fixture.guestQuery,
      language: fixture.language,
      policy: testPolicy,
      turnIndex: fixture.turnIndex ?? 0,
    });

    const actual = preResult
      ? {
          policyDecision: preResult.decision,
          shouldEscalate: preResult.shouldEscalate,
          shouldTransferNow: preResult.shouldTransferNow,
          preEmpted: true,
        }
      : {
          policyDecision: 'lllm_deferred' as const,
          shouldEscalate: false,
          shouldTransferNow: false,
          preEmpted: false,
        };

    const failures: string[] = [];

    const exp = fixture.expected;

    // If fixture expects pre-emption, pre-LLM must have fired
    if (exp.preEmpted === true && !actual.preEmpted) {
      failures.push(`expected pre-emption (${exp.policyDecision}) but LLM was deferred`);
    }

    // If fixture expects LLM deference, pre-LLM must NOT have fired
    if (exp.preEmpted === false && actual.preEmpted) {
      failures.push(`expected LLM processing but was pre-empted (${actual.policyDecision})`);
    }

    // Policy decision check (only when pre-empted)
    if (exp.preEmpted !== false && actual.preEmpted) {
      if (actual.policyDecision !== exp.policyDecision) {
        failures.push(`policyDecision: expected=${exp.policyDecision} actual=${actual.policyDecision}`);
      }
    }

    // shouldEscalate check (when pre-empted)
    if (actual.preEmpted && actual.shouldEscalate !== exp.shouldEscalate) {
      failures.push(`shouldEscalate: expected=${String(exp.shouldEscalate)} actual=${String(actual.shouldEscalate)}`);
    }

    // shouldTransferNow check (when pre-empted)
    if (actual.preEmpted && actual.shouldTransferNow !== exp.shouldTransferNow) {
      failures.push(`shouldTransferNow: expected=${String(exp.shouldTransferNow)} actual=${String(actual.shouldTransferNow)}`);
    }

    return {
      id: fixture.id,
      category: fixture.category,
      guestQuery: fixture.guestQuery,
      pass: failures.length === 0,
      expected: exp,
      actual,
      failures,
    };
  }

  private buildTestPolicy(
    overrides?: Partial<PropertyVoicePolicyEntity>,
  ): PropertyVoicePolicyEntity {
    return {
      id: 'eval-test',
      propertyId: 'eval-test',
      voiceAssistantEnabled: true,
      autoAnswerEnabled: false,
      recordCallsEnabled: false,
      clarifyThreshold: 0.55,
      escalateThreshold: 0.35,
      maxTurns: 12,
      fallbackTransferNumber: null,
      afterHoursMode: 'short_ai',
      quietHoursStart: 22,
      quietHoursEnd: 8,
      emergencyEscalationEnabled: true,
      complaintAutoEscalate: true,
      preferredLanguages: 'ru',
      shortAnswerMode: true,
      allowedTopics: null,
      escalationTopics: null,
      customFallbackPhrases: null,
      transcriptRetentionDays: 90,
      redactionEnabled: false,
      exportAllowed: true,
      recordingStorageEnabled: false,
      recordingRetentionDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }
}

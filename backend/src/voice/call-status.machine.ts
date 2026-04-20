import { BadRequestException } from '@nestjs/common';
import type { CallStatus } from './entities/call-session.entity';
import type { HandoffStatus } from './entities/call-session.entity';

/**
 * Strict state machine for CallSession.status.
 * Prevents impossible transitions at the service layer.
 *
 * Valid graph:
 *   ringing → in_progress → ai_handling → handoff_pending → handed_off → completed
 *                         ↘                                              ↗
 *                           ──────────────── completed ────────────────
 *                         ↓
 *                        failed
 *   (any) → failed, completed, no_answer  (terminal states)
 */

type StatusTransitions = Record<CallStatus, ReadonlyArray<CallStatus>>;

const ALLOWED_STATUS_TRANSITIONS: StatusTransitions = {
  ringing:        ['in_progress', 'ai_handling', 'no_answer', 'failed'],
  in_progress:    ['ai_handling', 'handoff_pending', 'completed', 'failed'],
  ai_handling:    ['handoff_pending', 'handed_off', 'completed', 'failed'],
  handoff_pending:['handed_off', 'completed', 'failed'],
  handed_off:     ['completed', 'failed'],
  completed:      [],
  failed:         [],
  no_answer:      [],
};

type HandoffTransitions = Record<HandoffStatus, ReadonlyArray<HandoffStatus>>;

const ALLOWED_HANDOFF_TRANSITIONS: HandoffTransitions = {
  none:       ['requested'],
  requested:  ['in_progress', 'completed'],
  in_progress:['completed'],
  completed:  [],
};

/** Terminal statuses — no further transitions allowed */
export const TERMINAL_STATUSES: ReadonlySet<CallStatus> = new Set([
  'completed', 'failed', 'no_answer',
]);

export class CallStatusMachine {
  static assertStatusTransition(from: CallStatus, to: CallStatus): void {
    if (from === to) return;
    const allowed = ALLOWED_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid CallSession status transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`,
      );
    }
  }

  static assertHandoffTransition(from: HandoffStatus, to: HandoffStatus): void {
    if (from === to) return;
    const allowed = ALLOWED_HANDOFF_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid handoff status transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`,
      );
    }
  }

  static isTerminal(status: CallStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  /** Compute next auto-status after a provider event */
  static resolveStatusFromEvent(
    event: 'call_started' | 'call_answered' | 'call_ended' | 'ai_turn' | 'handoff',
    current: CallStatus,
  ): CallStatus | null {
    if (CallStatusMachine.isTerminal(current)) return null;
    switch (event) {
      case 'call_started':  return 'ringing';
      case 'call_answered': return current === 'ringing' ? 'ai_handling' : null;
      case 'ai_turn':       return current === 'in_progress' ? 'ai_handling' : null;
      case 'handoff':       return 'handoff_pending';
      case 'call_ended':    return 'completed';
      default:              return null;
    }
  }
}

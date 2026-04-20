import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export type CallSocketEvent =
  | 'call.created'
  | 'call.updated'
  | 'call.transcript.segment'
  | 'call.ai_state.changed'
  | 'call.intent.detected'
  | 'call.escalation.requested'
  | 'call.handoff.started'
  | 'call.handoff.completed'
  | 'call.transfer.started'
  | 'call.transfer.ended'
  | 'call.ended';

@Injectable()
export class VoiceRealtimeService {
  private readonly logger = new Logger(VoiceRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  /** Broadcast to all authenticated operators (room: 'operators') */
  emit(event: CallSocketEvent, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('VoiceRealtimeService: server not attached');
      return;
    }
    this.server.to('operators').emit(event, payload);
  }

  /** Broadcast to all clients watching a specific call */
  emitToSession(sessionId: string, event: CallSocketEvent, payload: unknown): void {
    if (!this.server) return;
    this.server.to(`call:${sessionId}`).emit(event, payload);
    // Also broadcast to operators room so any watching operator gets it
    this.server.to('operators').emit(event, payload);
  }

  emitCallCreated(sessionId: string, payload: unknown): void {
    this.emit('call.created', { sessionId, ...toObj(payload) });
  }

  emitCallUpdated(sessionId: string, payload: unknown): void {
    this.emitToSession(sessionId, 'call.updated', { sessionId, ...toObj(payload) });
  }

  emitTranscriptSegment(sessionId: string, segment: unknown): void {
    this.emitToSession(sessionId, 'call.transcript.segment', { sessionId, segment });
  }

  emitAiStateChanged(sessionId: string, state: 'ai_speaking' | 'guest_speaking' | 'processing'): void {
    this.emitToSession(sessionId, 'call.ai_state.changed', { sessionId, state });
  }

  emitIntentDetected(
    sessionId: string,
    intent: string,
    confidence: number,
    kbSources: string[],
  ): void {
    this.emitToSession(sessionId, 'call.intent.detected', {
      sessionId,
      intent,
      confidence,
      kbSources,
    });
  }

  emitEscalationRequested(
    sessionId: string,
    reason: string,
    recommendedAction: string,
  ): void {
    this.emitToSession(sessionId, 'call.escalation.requested', {
      sessionId,
      reason,
      recommendedAction,
    });
  }

  emitHandoffStarted(sessionId: string, payload: unknown): void {
    this.emitToSession(sessionId, 'call.handoff.started', { sessionId, ...toObj(payload) });
  }

  emitHandoffCompleted(sessionId: string, payload: unknown): void {
    this.emitToSession(sessionId, 'call.handoff.completed', { sessionId, ...toObj(payload) });
  }

  emitTransferStarted(sessionId: string, payload: { destination: string | null }): void {
    this.emitToSession(sessionId, 'call.transfer.started', { sessionId, ...payload });
  }

  emitTransferEnded(
    sessionId: string,
    payload: { status: 'completed' | 'failed' | 'cancelled' | string; destination: string | null },
  ): void {
    this.emitToSession(sessionId, 'call.transfer.ended', { sessionId, ...payload });
  }

  emitCallEnded(sessionId: string, payload: unknown): void {
    this.emitToSession(sessionId, 'call.ended', { sessionId, ...toObj(payload) });
  }
}

function toObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

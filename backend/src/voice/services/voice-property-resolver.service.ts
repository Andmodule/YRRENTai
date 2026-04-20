import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';

// ── Public types ──────────────────────────────────────────────────────────────

export type PropertyResolutionStatus = 'resolved' | 'ambiguous' | 'not_found';

export interface PropertyCandidate {
  propertyId: string;
  name: string;
  address: string;
}

export interface PropertyResolutionResult {
  status: PropertyResolutionStatus;
  /** Set only when status === 'resolved' */
  property: PropertyCandidate | null;
  /** Full list of candidates (length >= 2 when ambiguous, 0 when not_found) */
  candidates: PropertyCandidate[];
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Resolves a property from free-form voice input.
 *
 * Two-pass strategy:
 *   Pass 1 — ILIKE contains on property name (fast, exact-ish)
 *   Pass 2 — Token overlap fallback across all properties (fuzzy)
 *
 * Disambiguation by address hint filters a prior candidate set.
 */
@Injectable()
export class VoicePropertyResolverService {
  private readonly logger = new Logger(VoicePropertyResolverService.name);

  constructor(
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  /**
   * Attempts to resolve a property from the guest's utterance.
   * Typical input: "Апартаменты на Садовой", "Луч", "Sun Valley"
   */
  async resolveByVoiceInput(rawText: string): Promise<PropertyResolutionResult> {
    const normalized = this.normalize(rawText);
    if (normalized.length < 2) {
      return { status: 'not_found', property: null, candidates: [] };
    }

    this.logger.debug(`resolveByVoiceInput: "${normalized}"`);

    // Pass 1: direct ILIKE on name
    const byName = await this.propertyRepo.find({
      where: { name: ILike(`%${normalized}%`) },
      select: ['id', 'name', 'address'],
    });

    if (byName.length === 1) {
      const only = byName[0]!;
      const candidate = toCandidate(only);
      return { status: 'resolved', property: candidate, candidates: [candidate] };
    }
    if (byName.length > 1) {
      return { status: 'ambiguous', property: null, candidates: byName.map(toCandidate) };
    }

    // Pass 2: token overlap fallback
    const tokens = this.significantTokens(normalized);
    if (tokens.length === 0) {
      return { status: 'not_found', property: null, candidates: [] };
    }

    const all = await this.propertyRepo.find({ select: ['id', 'name', 'address'] });
    const scored = all
      .map(p => ({ candidate: toCandidate(p), score: this.tokenOverlap(p.name, tokens) }))
      .filter(r => r.score >= 0.4)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      const top = scored[0]!;
      return {
        status: 'resolved',
        property: top.candidate,
        candidates: [top.candidate],
      };
    }
    if (scored.length > 1) {
      return { status: 'ambiguous', property: null, candidates: scored.map(s => s.candidate) };
    }

    return { status: 'not_found', property: null, candidates: [] };
  }

  /**
   * Disambiguates between a prior candidate set using an address/street hint.
   * Input: guest says "на Пушкинской" or "Садовая улица"
   */
  async resolveByAddressHint(
    rawText: string,
    candidateIds: string[],
  ): Promise<PropertyResolutionResult> {
    if (candidateIds.length === 0) {
      return { status: 'not_found', property: null, candidates: [] };
    }

    const normalized = this.normalize(rawText);
    const tokens = this.significantTokens(normalized);

    const candidates = await this.propertyRepo.find({
      where: { id: In(candidateIds) },
      select: ['id', 'name', 'address'],
    });

    const matched = candidates.filter(p => {
      const normAddr = this.normalize(p.address);
      return tokens.some(t => normAddr.includes(t));
    });

    if (matched.length === 1) {
      const onlyMatch = matched[0]!;
      const candidate = toCandidate(onlyMatch);
      return { status: 'resolved', property: candidate, candidates: [candidate] };
    }
    if (matched.length > 1) {
      return { status: 'ambiguous', property: null, candidates: matched.map(toCandidate) };
    }
    // No match in address — return original candidates so caller can re-prompt
    return { status: 'not_found', property: null, candidates: candidates.map(toCandidate) };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[«»""'''.,!?;:()\[\]{}\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private significantTokens(normalized: string): string[] {
    const stopWords = new Set([
      'и', 'в', 'на', 'по', 'за', 'к', 'у', 'с', 'из', 'от', 'до', 'о', 'об', 'для',
      'the', 'a', 'an', 'in', 'on', 'at', 'for', 'of', 'by',
    ]);
    return normalized.split(/\s+/).filter(t => t.length >= 3 && !stopWords.has(t));
  }

  private tokenOverlap(propertyName: string, queryTokens: string[]): number {
    if (queryTokens.length === 0) return 0;
    const normName = this.normalize(propertyName);
    const hits = queryTokens.filter(t => normName.includes(t)).length;
    return hits / queryTokens.length;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toCandidate(p: { id: string; name: string; address: string }): PropertyCandidate {
  return { propertyId: p.id, name: p.name, address: p.address };
}

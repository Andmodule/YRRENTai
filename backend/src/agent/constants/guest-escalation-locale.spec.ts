import {
  GUEST_ESCALATION_FALLBACK_MESSAGE,
  GUEST_ESCALATION_FALLBACK_MESSAGE_DE,
  GUEST_ESCALATION_FALLBACK_MESSAGE_EN,
  GUEST_ESCALATION_FALLBACK_MESSAGE_PL,
} from './guest-escalation-messages';
import { resolveGuestEscalationFallback } from './guest-escalation-locale';

describe('resolveGuestEscalationFallback', () => {
  it('uses Polish for ASCII Polish without diacritics', () => {
    expect(resolveGuestEscalationFallback('masz taras na dachu 3?')).toBe(
      GUEST_ESCALATION_FALLBACK_MESSAGE_PL,
    );
  });

  it('uses English for clear English despite franc bias toward pol on some strings', () => {
    expect(resolveGuestEscalationFallback('Hello do you have wifi password please')).toBe(
      GUEST_ESCALATION_FALLBACK_MESSAGE_EN,
    );
  });

  it('uses German when German lexical hints are present', () => {
    expect(resolveGuestEscalationFallback('Guten Tag wo ist der Parkplatz?')).toBe(
      GUEST_ESCALATION_FALLBACK_MESSAGE_DE,
    );
  });

  it('uses Russian for Cyrillic without Ukrainian letters', () => {
    expect(resolveGuestEscalationFallback('Есть ли парковка?')).toBe(GUEST_ESCALATION_FALLBACK_MESSAGE);
  });
});

import {
  detectGuestCyrillicLanguage,
  guestCyrillicLanguageMismatch,
  replySignalsUkrainian,
} from './guest-message-language';

describe('detectGuestCyrillicLanguage', () => {
  it('defaults Cyrillic without Ukrainian letters to Russian', () => {
    expect(detectGuestCyrillicLanguage('Есть ли парковка?')).toBe('ru');
    expect(detectGuestCyrillicLanguage('Где код от двери?')).toBe('ru');
  });

  it('detects Ukrainian from distinct letters', () => {
    expect(detectGuestCyrillicLanguage('Де паркування?')).toBe('uk');
  });

  it('detects Ukrainian from vocabulary', () => {
    expect(detectGuestCyrillicLanguage('Мені потрібен пароль від wifi')).toBe('uk');
  });

  it('returns null for non-Cyrillic', () => {
    expect(detectGuestCyrillicLanguage('Hello there')).toBeNull();
  });
});

describe('guestCyrillicLanguageMismatch', () => {
  it('flags Ukrainian reply to Russian guest', () => {
    expect(
      guestCyrillicLanguageMismatch(
        'Есть ли парковка?',
        'Так, паркування є біля будинку.',
      ),
    ).toBe(true);
  });

  it('allows Russian reply to Russian guest', () => {
    expect(
      guestCyrillicLanguageMismatch(
        'Есть ли парковка?',
        'Да, парковка есть рядом с домом.',
      ),
    ).toBe(false);
  });

  it('flags Russian reply to Ukrainian guest', () => {
    expect(
      guestCyrillicLanguageMismatch(
        'Де паркування?',
        'Да, парковка есть рядом с домом.',
      ),
    ).toBe(true);
  });
});

describe('replySignalsUkrainian', () => {
  it('detects Ukrainian escalation template', () => {
    expect(
      replySignalsUkrainian(
        'Мені потрібно уточнити деталі у менеджера. Повернуся до вас з відповіддю найближчим часом. Дякую!',
      ),
    ).toBe(true);
  });
});

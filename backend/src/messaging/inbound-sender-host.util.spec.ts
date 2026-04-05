import {
  isInboundSenderHostAllowed,
  isTrustedOtaInfrastructureHost,
  matchesHostPattern,
} from './inbound-sender-host.util';

describe('matchesHostPattern', () => {
  it('matches exact host', () => {
    expect(matchesHostPattern('guest.booking.com', 'guest.booking.com')).toBe(true);
    expect(matchesHostPattern('guest.booking.com', 'other.com')).toBe(false);
  });

  it('matches *.suffix to subdomains', () => {
    expect(matchesHostPattern('mail.booking.com', '*.booking.com')).toBe(true);
    expect(matchesHostPattern('booking.com', '*.booking.com')).toBe(true);
    expect(matchesHostPattern('a.b.booking.com', '*.booking.com')).toBe(true);
    expect(matchesHostPattern('notbooking.com', '*.booking.com')).toBe(false);
  });
});

describe('isTrustedOtaInfrastructureHost', () => {
  it('allows booking.com tree', () => {
    expect(isTrustedOtaInfrastructureHost('guest.booking.com')).toBe(true);
    expect(isTrustedOtaInfrastructureHost('notify.booking.com')).toBe(true);
    expect(isTrustedOtaInfrastructureHost('booking.com')).toBe(true);
  });

  it('allows airbnb.com tree', () => {
    expect(isTrustedOtaInfrastructureHost('guest.airbnb.com')).toBe(true);
  });

  it('rejects unrelated', () => {
    expect(isTrustedOtaInfrastructureHost('gmail.com')).toBe(false);
    expect(isTrustedOtaInfrastructureHost('')).toBe(false);
  });
});

describe('isInboundSenderHostAllowed', () => {
  it('allows OTA even when allowlist is empty', () => {
    expect(isInboundSenderHostAllowed('x.booking.com', [], false)).toBe(true);
    expect(isInboundSenderHostAllowed('x.airbnb.com', [], false)).toBe(true);
  });

  it('allows gmail when flag set', () => {
    expect(isInboundSenderHostAllowed('gmail.com', [], true)).toBe(true);
    expect(isInboundSenderHostAllowed('gmail.com', [], false)).toBe(false);
  });

  it('allows explicit host from list', () => {
    expect(isInboundSenderHostAllowed('partner.example.com', ['partner.example.com'], false)).toBe(true);
  });
});

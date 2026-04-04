import { shouldDropInboundByMailHeaders } from './inbound-email-heuristics';

describe('shouldDropInboundByMailHeaders', () => {
  it('drops Auto-Submitted: auto-generated', () => {
    expect(
      shouldDropInboundByMailHeaders({ 'auto-submitted': 'auto-generated' }),
    ).toEqual({ drop: true, reason: 'Auto-Submitted: auto-generated' });
  });

  it('drops X-Autoreply: yes', () => {
    expect(shouldDropInboundByMailHeaders({ 'x-autoreply': 'yes' })).toEqual({
      drop: true,
      reason: 'X-Autoreply',
    });
  });

  it('drops Precedence: bulk', () => {
    expect(shouldDropInboundByMailHeaders({ precedence: 'bulk' })).toEqual({
      drop: true,
      reason: 'Precedence: bulk',
    });
  });

  it('passes normal mail', () => {
    expect(shouldDropInboundByMailHeaders({ from: 'a@b.com' })).toEqual({ drop: false });
  });
});

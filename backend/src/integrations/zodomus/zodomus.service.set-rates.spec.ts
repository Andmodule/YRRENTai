/**
 * POST /rates body: `closed` goes out only when asked for — «Цена на канале» keeps sending exactly
 * what it sent before «Открыть / закрыть даты» existed.
 */
import { ZodomusService } from './zodomus.service';
import type { ZodomusClient } from './zodomus.client';

function service() {
  const post = jest.fn().mockResolvedValue({});
  const svc = new ZodomusService({ post } as unknown as ZodomusClient);
  return { svc, post };
}

const BASE = {
  channelId: 1,
  propertyId: '11021398',
  roomId: '1102139801',
  rateId: '39993723',
  dateFrom: '2026-11-01',
  dateToExclusive: '2026-11-02',
  currencyCode: 'PLN',
  price: 1180,
};

describe('ZodomusService.setRates', () => {
  it('sends no `closed` when it is not given', async () => {
    const { svc, post } = service();
    await svc.setRates(BASE);
    expect(post).toHaveBeenCalledWith('/rates', {
      channelId: 1,
      propertyId: '11021398',
      roomId: '1102139801',
      rateId: '39993723',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-02',
      currencyCode: 'PLN',
      prices: { price: '1180' },
    });
  });

  it('sends closed "0" to open and "1" to close (the strings Zodomus documents)', async () => {
    const { svc, post } = service();
    await svc.setRates({ ...BASE, closed: false });
    await svc.setRates({ ...BASE, closed: true });
    expect(post.mock.calls[0]![1]).toMatchObject({ closed: '0', prices: { price: '1180' } });
    expect(post.mock.calls[1]![1]).toMatchObject({ closed: '1' });
  });
});

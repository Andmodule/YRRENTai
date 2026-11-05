import { AirbnbOwnPriceService } from './airbnb-own-price.service';

const PID = '46889a43-e073-46d3-8457-f03525dbb1c9';

function setup(flag: unknown, opts: { fail?: boolean; markup?: number | null } = {}) {
  const config = { get: jest.fn(() => flag) };
  const fail = async () => {
    throw new Error('relation does not exist');
  };
  const base = { find: jest.fn(opts.fail ? fail : async () => [{ date: '2027-02-01', priceMinor: 38500 }, { date: '2027-02-02', priceMinor: 40000 }]) };
  const typed = { find: jest.fn(async () => [{ date: '2027-02-02', priceMinor: 29000, channel: 'airbnb' }]) };
  const channels = { findOne: jest.fn(async () => (opts.markup === undefined ? { markupPct: -30 } : opts.markup === null ? null : { markupPct: opts.markup })) };
  const svc = new AirbnbOwnPriceService(config as never, base as never, channels as never, typed as never);
  return { svc, base, typed, channels };
}

describe('AirbnbOwnPriceService', () => {
  it('off (default, false, junk) → null, nothing read', async () => {
    for (const flag of [undefined, false, 'false', '0', 'nope']) {
      const s = setup(flag);
      expect(s.svc.enabled).toBe(false);
      expect(await s.svc.prices(PID, '2027-02-01', '2027-02-04', null)).toBeNull();
      expect(s.base.find).not.toHaveBeenCalled();
    }
  });

  it('on: typed Airbnb price wins, else base with the Airbnb markup; only the Airbnb channel is read', async () => {
    for (const flag of [true, 'true', '1', 'yes']) {
      const s = setup(flag);
      expect(await s.svc.prices(PID, '2027-02-01', '2027-02-04', null)).toEqual(new Map([['2027-02-01', 270], ['2027-02-02', 290]]));
      expect(s.typed.find.mock.calls[0]).toEqual([expect.objectContaining({ where: expect.objectContaining({ channel: 'airbnb', propertyId: PID }) })]);
      expect(s.channels.findOne).toHaveBeenCalledWith({ where: { propertyId: PID, channel: 'airbnb' } });
    }
  });

  it('no Airbnb rule saved → markup 0; the minimum applies', async () => {
    const s = setup(true, { markup: null });
    expect(await s.svc.prices(PID, '2027-02-01', '2027-02-02', 390)).toEqual(new Map([['2027-02-01', 390]]));
  });

  it('empty range → null; tables unreadable → null (the Booking rule applies), no throw', async () => {
    expect(await setup(true).svc.prices(PID, '2027-02-04', '2027-02-04', null)).toBeNull();
    expect(await setup(true, { fail: true }).svc.prices(PID, '2027-02-01', '2027-02-04', null)).toBeNull();
  });
});

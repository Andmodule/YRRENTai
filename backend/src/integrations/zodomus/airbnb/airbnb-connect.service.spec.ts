import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AirbnbConnectService } from './airbnb-connect.service';
import type { ZodomusAirbnbHostEntity } from './airbnb-host.entity';

const OWNER = { sub: 'owner-1', email: 'o@example.test', role: 'OWNER' };
const PILOT = '1017407411799040875';

function setup(opts: { enabled?: boolean; client?: boolean; row?: Partial<ZodomusAirbnbHostEntity> | null } = {}) {
  let row: ZodomusAirbnbHostEntity | null = opts.row ? ({ token: 'tok', clientId: 'cid', statusCode: null, statusText: null, checkedAt: null, ...opts.row, ownerId: OWNER.sub } as ZodomusAirbnbHostEntity) : null;
  const hosts = {
    findOne: jest.fn(async () => row),
    create: jest.fn((r: Partial<ZodomusAirbnbHostEntity>) => r as ZodomusAirbnbHostEntity),
    save: jest.fn(async (r: ZodomusAirbnbHostEntity) => {
      row = r;
      return r;
    }),
  };
  const client = { get: jest.fn(), post: jest.fn() };
  const config = { get: jest.fn((k: string) => (k === 'ZODOMUS_AIRBNB_ENABLED' ? (opts.enabled ?? true) : undefined)) };
  const svc = new AirbnbConnectService(config as never, hosts as never, opts.client === false ? null : (client as never));
  return { svc, hosts, client, row: () => row };
}

describe('AirbnbConnectService — flag', () => {
  it('status with the flag off: enabled false, no DB read, no Zodomus call', async () => {
    const s = setup({ enabled: false });
    await expect(s.svc.status(OWNER)).resolves.toMatchObject({ enabled: false, host: null });
    expect(s.hosts.findOne).not.toHaveBeenCalled();
    expect(s.client.get).not.toHaveBeenCalled();
  });

  it('every action answers 503 with the flag off or without Zodomus, and calls nothing', async () => {
    for (const s of [setup({ enabled: false }), setup({ client: false })]) {
      await expect(s.svc.activate(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(s.svc.refresh(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(s.svc.listings(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(s.client.post).not.toHaveBeenCalled();
      expect(s.client.get).not.toHaveBeenCalled();
      expect(s.hosts.save).not.toHaveBeenCalled();
    }
  });

  it('a missing table becomes 503 naming the migration', async () => {
    const s = setup();
    s.hosts.findOne.mockRejectedValueOnce(Object.assign(new QueryFailedError('q', [], new Error('x')), { driverError: { code: '42P01' } }));
    await expect(s.svc.status(OWNER)).rejects.toThrow('1778900000000-zodomus-airbnb-hosts');
  });
});

describe('AirbnbConnectService — host', () => {
  it('status without a host: host null; with one not active: the authorization page', async () => {
    await expect(setup().svc.status(OWNER)).resolves.toMatchObject({ enabled: true, host: null, pilotListingIds: [PILOT] });
    const v = await setup({ row: { statusCode: 1 } }).svc.status(OWNER);
    expect(v.host?.active).toBe(false);
    expect(v.host?.authUrl).toContain('state=tok');
  });

  it('activate: POST /airbnb-host-activation with an empty body, stores token and client id, returns the page', async () => {
    const s = setup();
    s.client.post.mockResolvedValue({ token: 'T1', client_id: 'C1' });
    const v = await s.svc.activate(OWNER);
    expect(s.client.post).toHaveBeenCalledWith('/airbnb-host-activation', {});
    expect(s.row()).toMatchObject({ ownerId: OWNER.sub, token: 'T1', clientId: 'C1', statusCode: null });
    expect(v.host?.authUrl).toContain('client_id=C1');
  });

  it('activate of an active host calls nothing and keeps the token', async () => {
    const s = setup({ row: { statusCode: 5 } });
    const v = await s.svc.activate(OWNER);
    expect(s.client.post).not.toHaveBeenCalled();
    expect(v.host).toMatchObject({ active: true, authUrl: null });
  });

  it('activate of a not yet active host asks for a new token (the old page may have expired)', async () => {
    const s = setup({ row: { statusCode: 1, token: 'old' } });
    s.client.post.mockResolvedValue({ token: 'new', client_id: 'C' });
    await s.svc.activate(OWNER);
    expect(s.row()?.token).toBe('new');
  });

  it('activate: an answer without token → 502, nothing stored', async () => {
    const s = setup();
    s.client.post.mockResolvedValue({ status: { returnCode: '200' } });
    await expect(s.svc.activate(OWNER)).rejects.toBeInstanceOf(BadGatewayException);
    expect(s.hosts.save).not.toHaveBeenCalled();
  });

  it('refresh: GET /airbnb-host-status with the token, stores the code', async () => {
    const s = setup({ row: { statusCode: null } });
    s.client.get.mockResolvedValue({ status: { returnCode: 200 }, host: { statusCode: '5', statusMessage: 'Host is active' } });
    const v = await s.svc.refresh(OWNER);
    expect(s.client.get).toHaveBeenCalledWith('/airbnb-host-status', { token: 'tok' });
    expect(s.row()).toMatchObject({ statusCode: 5, statusText: 'Host is active' });
    expect(s.row()?.checkedAt).toBeInstanceOf(Date);
    expect(v.host?.active).toBe(true);
  });

  it('refresh without a host calls nothing', async () => {
    const s = setup();
    await expect(s.svc.refresh(OWNER)).resolves.toMatchObject({ host: null });
    expect(s.client.get).not.toHaveBeenCalled();
  });
});

describe('AirbnbConnectService — listings', () => {
  it('needs an active host', async () => {
    for (const row of [null, { statusCode: 1 }]) {
      const s = setup({ row });
      await expect(s.svc.listings(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(s.client.get).not.toHaveBeenCalled();
    }
  });

  it('returns only the pilot listing; the others are counted, never returned', async () => {
    const s = setup({ row: { statusCode: 5 } });
    s.client.get.mockResolvedValue({ listings: [{ id: '1', name: 'Other A' }, { id: PILOT, name: 'K22 Andersa' }, { id: '2', name: 'Other B' }] });
    const v = await s.svc.listings(OWNER);
    expect(v).toEqual({ pilot: { id: PILOT, name: 'K22 Andersa' }, others: 2, truncated: false });
    expect(JSON.stringify(v)).not.toContain('Other');
  });

  it('follows the cursor until the pilot listing is found, then stops', async () => {
    const s = setup({ row: { statusCode: 5 } });
    s.client.get
      .mockResolvedValueOnce({ listings: [{ id: '1' }], _cursor: 'p2' })
      .mockResolvedValueOnce({ listings: [{ id: PILOT }], _cursor: 'p3' });
    const v = await s.svc.listings(OWNER);
    expect(s.client.get).toHaveBeenCalledTimes(2);
    expect(s.client.get).toHaveBeenLastCalledWith('/airbnb-listings', { token: 'tok', _limit: '50', _cursor: 'p2' });
    expect(v).toEqual({ pilot: { id: PILOT, name: null }, others: 1, truncated: true });
  });

  it('reads at most 3 pages when the pilot listing is not there', async () => {
    const s = setup({ row: { statusCode: 5 } });
    s.client.get.mockResolvedValue({ listings: [{ id: '1' }], _cursor: 'more' });
    const v = await s.svc.listings(OWNER);
    expect(s.client.get).toHaveBeenCalledTimes(3);
    expect(v).toEqual({ pilot: null, others: 3, truncated: true });
  });
});

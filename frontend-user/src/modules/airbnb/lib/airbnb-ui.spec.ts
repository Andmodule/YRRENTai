import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AirbnbHostView, AirbnbJob, AirbnbListingView, AirbnbPlanSummary } from '../api';
import { canConnect, canSend, lastNight, operationDates, steps, usablePlan, ymdLong } from './airbnb-ui';

const plan: AirbnbPlanSummary = {
  listingId: '1017407411799040875',
  from: '2026-10-30',
  toExclusive: '2027-10-31',
  nights: 366,
  forSale: 300,
  occupied: 50,
  noPrice: 16,
  operations: 40,
  requests: 1,
  sample: [],
  minPrice: 216,
  maxPrice: 420,
  fingerprint: 'abc-40',
};
const job = (over: Partial<AirbnbJob> = {}): AirbnbJob => ({
  propertyId: 'p',
  kind: 'check',
  state: 'done',
  startedAt: '2026-10-30T09:58:00Z',
  finishedAt: '2026-10-30T09:59:00Z',
  error: null,
  plan,
  result: null,
  ...over,
});
const hostActive: AirbnbHostView = { enabled: true, pilotListingIds: ['1'], host: { statusCode: 5, statusText: 'Host is active', active: true, checkedAt: null, authUrl: null } };
const hostWaiting: AirbnbHostView = { enabled: true, pilotListingIds: ['1'], host: { statusCode: null, statusText: null, active: false, checkedAt: null, authUrl: 'https://www.airbnb.com/oauth2/auth' } };
const listing = (over: Partial<AirbnbListingView> = {}): AirbnbListingView => ({
  listingId: '1',
  connected: false,
  activatedAt: null,
  planEnd: null,
  lastSyncAt: null,
  lastSync: null,
  takenByOther: false,
  job: null,
  freshPlan: null,
  ...over,
});

describe('operationDates / ymdLong / lastNight', () => {
  it('formats a range, a single night and a garbage value', () => {
    assert.equal(operationDates({ dates: ['2026-11-10:2026-11-12'], availability: 'available' }), '10.11 – 12.11');
    assert.equal(operationDates({ dates: ['2026-11-10:2026-11-10'], availability: 'available' }), '10.11');
    assert.equal(operationDates({ dates: ['x'], availability: 'available' }), 'x');
    assert.equal(operationDates({ dates: [], availability: 'available' }), '');
  });
  it('long date and the last night of an exclusive end (month / year / leap day)', () => {
    assert.equal(ymdLong('2026-10-30'), '30.10.2026');
    assert.equal(ymdLong(null), '');
    assert.equal(lastNight('2027-10-31'), '2027-10-30');
    assert.equal(lastNight('2027-01-01'), '2026-12-31');
    assert.equal(lastNight('2028-03-01'), '2028-02-29');
  });
});

describe('usablePlan', () => {
  const fresh = { ...plan, checkedAt: '2026-10-30T09:59:00Z', expiresAt: '2026-10-30T10:14:00Z' };
  it('gives the server fresh check', () => {
    assert.equal(usablePlan(listing({ freshPlan: fresh })), fresh);
  });
  it('none while a job runs, without a fresh check or without the listing', () => {
    assert.equal(usablePlan(listing({ freshPlan: fresh, job: job({ state: 'running' }) })), null);
    assert.equal(usablePlan(listing()), null);
    assert.equal(usablePlan(undefined), null);
  });
});

describe('steps', () => {
  it('host first, then check, then connect; connected = all done', () => {
    assert.deepEqual(steps(undefined, undefined, null), ['current', 'locked', 'locked']);
    assert.deepEqual(steps(hostWaiting, listing(), plan), ['current', 'locked', 'locked']);
    assert.deepEqual(steps(hostActive, listing(), null), ['done', 'current', 'locked']);
    assert.deepEqual(steps(hostActive, listing(), plan), ['done', 'done', 'current']);
    assert.deepEqual(steps(hostActive, listing({ connected: true }), null), ['done', 'done', 'done']);
    // A connected listing stays open even when the host status turns bad.
    assert.deepEqual(steps(hostWaiting, listing({ connected: true }), null), ['current', 'done', 'done']);
  });
});

describe('canConnect / canSend', () => {
  const ok = { host: hostActive, listing: listing(), plan, acknowledged: true };
  it('all conditions met → yes', () => {
    assert.equal(canConnect(ok), true);
  });
  it('each missing condition blocks it', () => {
    assert.equal(canConnect({ ...ok, host: hostWaiting }), false);
    assert.equal(canConnect({ ...ok, plan: null }), false);
    assert.equal(canConnect({ ...ok, acknowledged: false }), false);
    assert.equal(canConnect({ ...ok, listing: undefined }), false);
    assert.equal(canConnect({ ...ok, listing: listing({ connected: true }) }), false);
    assert.equal(canConnect({ ...ok, listing: listing({ takenByOther: true }) }), false);
    assert.equal(canConnect({ ...ok, listing: listing({ job: job({ state: 'running' }) }) }), false);
  });
  it('send: connected, fresh plan, nothing running', () => {
    assert.equal(canSend({ listing: listing({ connected: true }), plan }), true);
    assert.equal(canSend({ listing: listing({ connected: false }), plan }), false);
    assert.equal(canSend({ listing: listing({ connected: true }), plan: null }), false);
    assert.equal(canSend({ listing: listing({ connected: true, job: job({ state: 'running' }) }), plan }), false);
  });
});

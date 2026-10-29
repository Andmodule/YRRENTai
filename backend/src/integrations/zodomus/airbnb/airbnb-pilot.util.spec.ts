import { ForbiddenException } from '@nestjs/common';
import {
  AIRBNB_PILOT_LISTING_IDS,
  airbnbAuthUrl,
  assertAirbnbPilotListing,
  isAirbnbPilotListing,
  normalizeListingId,
  parseHostActivation,
  parseHostStatus,
  parseListings,
} from './airbnb-pilot.util';

const PILOT = '1017407411799040875';

describe('airbnb pilot allowlist', () => {
  it('holds exactly the one pilot listing (K22 Andersa)', () => {
    expect(AIRBNB_PILOT_LISTING_IDS).toEqual([PILOT]);
  });

  it('accepts the pilot id as a string, trimmed', () => {
    expect(isAirbnbPilotListing(PILOT)).toBe(true);
    expect(isAirbnbPilotListing(` ${PILOT} `)).toBe(true);
    expect(assertAirbnbPilotListing(PILOT)).toBe(PILOT);
  });

  it('refuses any other listing, an empty id, null, objects and a near miss', () => {
    for (const bad of ['1017407411799040876', '', '   ', null, undefined, {}, [PILOT], `${PILOT}0`, PILOT.slice(1)]) {
      expect(isAirbnbPilotListing(bad)).toBe(false);
      expect(() => assertAirbnbPilotListing(bad)).toThrow(ForbiddenException);
    }
  });

  it('a number id is normalized, but the pilot id as a JS number loses precision and is refused', () => {
    expect(normalizeListingId(123)).toBe('123');
    expect(normalizeListingId(Number.NaN)).toBe('');
    // 1017407411799040875 > 2^53: as a number it is no longer the same id — must not pass.
    expect(isAirbnbPilotListing(Number(PILOT))).toBe(false);
  });
});

describe('airbnbAuthUrl', () => {
  it('builds the Airbnb authorization page with the Zodomus redirect, property scope and token as state', () => {
    const u = new URL(airbnbAuthUrl('cid 1', 'tok&2'));
    expect(u.origin + u.pathname).toBe('https://www.airbnb.com/oauth2/auth');
    expect(u.searchParams.get('client_id')).toBe('cid 1');
    expect(u.searchParams.get('redirect_uri')).toBe('https://api.zodomus.com/airbnb-webhook-redirect');
    expect(u.searchParams.get('scope')).toBe('property_management');
    expect(u.searchParams.get('state')).toBe('tok&2');
  });
});

describe('parseHostActivation', () => {
  it('reads token and client_id at the top level, in data or in status', () => {
    expect(parseHostActivation({ token: 't', client_id: 'c' })).toEqual({ token: 't', clientId: 'c' });
    expect(parseHostActivation({ data: { token: 't', clientId: 'c' } })).toEqual({ token: 't', clientId: 'c' });
    expect(parseHostActivation({ status: { returnCode: '200' }, token: ' t ', client_id: 'c' })).toEqual({ token: 't', clientId: 'c' });
  });

  it('is null when either is missing or empty', () => {
    expect(parseHostActivation({ token: 't' })).toBeNull();
    expect(parseHostActivation({ client_id: 'c' })).toBeNull();
    expect(parseHostActivation({ token: '', client_id: 'c' })).toBeNull();
    expect(parseHostActivation(null)).toBeNull();
    expect(parseHostActivation('x')).toBeNull();
  });
});

describe('parseHostStatus', () => {
  it('status 5 is an active host, number or string', () => {
    expect(parseHostStatus({ statusCode: 5, statusMessage: 'Host is active' })).toEqual({ code: 5, text: 'Host is active', active: true });
    expect(parseHostStatus({ data: { statusCode: '5' } }).active).toBe(true);
  });

  it('any other code, or none, is not active', () => {
    expect(parseHostStatus({ statusCode: 1 }).active).toBe(false);
    expect(parseHostStatus({ statusCode: 'abc' })).toEqual({ code: null, text: null, active: false });
    expect(parseHostStatus({})).toEqual({ code: null, text: null, active: false });
  });
});

describe('parseListings', () => {
  it('reads ids (as strings) and names from listings / data / data.listings, with the next cursor', () => {
    expect(parseListings({ listings: [{ id: PILOT, name: 'K22' }, { id: 7, title: 'B' }], _cursor: 'n2' })).toEqual({
      listings: [{ id: PILOT, name: 'K22' }, { id: '7', name: 'B' }],
      nextCursor: 'n2',
    });
    expect(parseListings({ data: [{ listingId: '9' }] }).listings).toEqual([{ id: '9', name: null }]);
    expect(parseListings({ data: { listings: [{ listing_id: '8' }] } }).listings).toEqual([{ id: '8', name: null }]);
  });

  it('skips items without an id and copes with no list at all', () => {
    expect(parseListings({ listings: [{ name: 'no id' }, null, 3] }).listings).toEqual([]);
    expect(parseListings(null)).toEqual({ listings: [], nextCursor: null });
  });
});

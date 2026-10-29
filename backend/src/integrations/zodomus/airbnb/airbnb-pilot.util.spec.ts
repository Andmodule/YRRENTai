import { ForbiddenException } from '@nestjs/common';
import {
  AIRBNB_PILOT_LISTING_IDS,
  airbnbAuthUrl,
  assertAirbnbPilotListing,
  isAirbnbPilotListing,
  isAirbnbWrite,
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
    // As in the Zodomus docs: the token is a number.
    expect(parseHostActivation({ status: { returnCode: 200 }, token: 9851359133, client_id: '3333cB' })).toEqual({ token: '9851359133', clientId: '3333cB' });
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
  it('reads the host block of the Zodomus answer: status 5 is an active host, number or string', () => {
    const doc = { status: { returnCode: 200, returnMessage: 'Airbnb host status retrieved' }, host: { statusCode: '5', statusMessage: 'Host is active' } };
    expect(parseHostStatus(doc)).toEqual({ code: 5, text: 'Host is active', active: true });
    expect(parseHostStatus({ response: { host: { statusCode: 5 } } }).active).toBe(true);
  });

  it('any other code, a code outside `host`, or none, is not active', () => {
    expect(parseHostStatus({ host: { statusCode: '1' } }).active).toBe(false);
    expect(parseHostStatus({ host: { statusCode: 'abc' } })).toEqual({ code: null, text: null, active: false });
    // The call's own status must not be taken for the host's.
    expect(parseHostStatus({ status: { returnCode: 200, statusCode: 5, returnMessage: 'OK' } })).toEqual({ code: null, text: null, active: false });
    expect(parseHostStatus({ statusCode: 5 }).active).toBe(false);
    expect(parseHostStatus(null)).toEqual({ code: null, text: null, active: false });
  });
});

describe('parseListings', () => {
  it('reads the Zodomus answer: response.listings with idStr, and paging.nextCursor', () => {
    const doc = {
      status: { returnCode: 200 },
      response: { listings: [{ id: 51224597, idStr: '51224597', name: 'Lisboa' }], paging: { totalCount: 3, nextCursor: 'FgIW' } },
    };
    expect(parseListings(doc)).toEqual({ listings: [{ id: '51224597', name: 'Lisboa' }], nextCursor: 'FgIW' });
  });

  it('the pilot id survives JSON.parse only through idStr: a rounded numeric id is not used', () => {
    const raw = `{"response":{"listings":[{"id":${PILOT},"idStr":"${PILOT}","name":"K22"},{"id":${PILOT},"name":"no idStr"}]}}`;
    const parsed = JSON.parse(raw);
    expect(String(parsed.response.listings[0].id)).not.toBe(PILOT);
    const out = parseListings(parsed).listings;
    expect(out).toEqual([{ id: PILOT, name: 'K22' }]);
    expect(out.map((l) => isAirbnbPilotListing(l.id))).toEqual([true]);
  });

  it('reads older shapes too (listings / data / data.listings) and a safe numeric id', () => {
    expect(parseListings({ listings: [{ id: 7, title: 'B' }], _cursor: 'n2' })).toEqual({ listings: [{ id: '7', name: 'B' }], nextCursor: 'n2' });
    expect(parseListings({ data: [{ listingId: '9' }] }).listings).toEqual([{ id: '9', name: null }]);
    expect(parseListings({ data: { listings: [{ listing_id: '8' }] } }).listings).toEqual([{ id: '8', name: null }]);
  });

  it('skips items without an id and copes with no list at all', () => {
    expect(parseListings({ response: { listings: [{ name: 'no id' }, null, 3] } }).listings).toEqual([]);
    expect(parseListings(null)).toEqual({ listings: [], nextCursor: null });
  });
});

describe('isAirbnbWrite — the generic «Zodomus API» page never writes to Airbnb', () => {
  it('any /airbnb-… path, with or without a slash, any case', () => {
    for (const p of ['/airbnb-host-cancellation', 'airbnb-calendar', '/AIRBNB-listings', '//airbnb-host-activation']) {
      expect(isAirbnbWrite(p, undefined, {})).toBe(true);
    }
  });
  it('any call for channel 3, in the request or in the body (number or string)', () => {
    expect(isAirbnbWrite('/property-activation', 3, {})).toBe(true);
    expect(isAirbnbWrite('/property-activation', undefined, { channelId: 3 })).toBe(true);
    expect(isAirbnbWrite('/availability', 1, { channelId: '3' })).toBe(true);
  });
  it('Booking calls pass', () => {
    expect(isAirbnbWrite('/property-activation', 1, { channelId: 1 })).toBe(false);
    expect(isAirbnbWrite('/rates', undefined, {})).toBe(false);
  });
});

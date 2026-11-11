import { ForbiddenException } from '@nestjs/common';
import {
  AIRBNB_PILOT_LISTING_IDS,
  AIRBNB_PILOT_PAIRS,
  airbnbAuthUrl,
  airbnbPilotListingForProperty,
  assertAirbnbPilotPair,
  airbnbWebhookListingId,
  assertAirbnbPostAllowed,
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
  it('holds exactly the five K22 listings, each paired with its own RentAI property', () => {
    expect(AIRBNB_PILOT_LISTING_IDS).toEqual([
      PILOT,
      '859458401639089947',
      '947811739695459519',
      '1078671637452575972',
      '1114631344050060493',
    ]);
    expect(AIRBNB_PILOT_PAIRS.map((p) => p.propertyId)).toEqual([
      '46889a43-e073-46d3-8457-f03525dbb1c9',
      '0a240ac8-46a3-4a1b-aa09-359b1b560531',
      '81545370-ec23-4035-866e-39ca7195bb70',
      '69c58f05-e5c5-405e-b77d-ee8a43c7dce7',
      '357f034d-a04f-467c-9564-f770fb25a34f',
    ]);
    // One listing per property and one property per listing.
    expect(new Set(AIRBNB_PILOT_LISTING_IDS).size).toBe(AIRBNB_PILOT_PAIRS.length);
    expect(new Set(AIRBNB_PILOT_PAIRS.map((p) => p.propertyId)).size).toBe(AIRBNB_PILOT_PAIRS.length);
    // Not «VIP Centrum open-space Bagno» (owner's answer 2026-11-11).
    expect(AIRBNB_PILOT_LISTING_IDS).not.toContain('989944996874896319');
  });

  it('a property gets only its own listing; a listing of the list for another property is refused', () => {
    for (const p of AIRBNB_PILOT_PAIRS) {
      expect(airbnbPilotListingForProperty(p.propertyId)).toBe(p.listingId);
      expect(airbnbPilotListingForProperty(p.propertyId.toUpperCase())).toBe(p.listingId);
      expect(assertAirbnbPilotPair(p.propertyId, p.listingId)).toBe(p.listingId);
      for (const other of AIRBNB_PILOT_PAIRS) {
        if (other === p) continue;
        expect(() => assertAirbnbPilotPair(p.propertyId, other.listingId)).toThrow(ForbiddenException);
      }
    }
    for (const bad of ['9e597576-3ff5-40f7-a8cb-55c73f23c279', '', null, undefined, 42]) {
      expect(airbnbPilotListingForProperty(bad)).toBeNull();
      expect(() => assertAirbnbPilotPair(bad, PILOT)).toThrow(ForbiddenException);
    }
    expect(() => assertAirbnbPilotPair(AIRBNB_PILOT_PAIRS[0]!.propertyId, '989944996874896319')).toThrow(ForbiddenException);
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

describe('assertAirbnbPostAllowed — the last guard in ZodomusClient.post', () => {
  it('Booking calls pass untouched', () => {
    for (const [p, b] of [
      ['/rates', { channelId: 1, propertyId: '11021398' }],
      ['/property-cancellation', { channelId: 1, propertyId: '11021398' }],
      ['/availability-multiple', { channelId: '1' }],
      ['/promotions/activate?x=1', {}],
    ] as [string, unknown][]) {
      expect(() => assertAirbnbPostAllowed(p, b)).not.toThrow();
    }
  });
  it('allows host activation (empty body), and activation / calendar of the pilot listing', () => {
    expect(() => assertAirbnbPostAllowed('/airbnb-host-activation', {})).not.toThrow();
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 4, token: 1 })).not.toThrow();
    expect(() => assertAirbnbPostAllowed('airbnb-calendar', { channelId: 3, propertyId: PILOT, operations: [] })).not.toThrow();
  });
  it('refuses the same calls for any other listing, or with no listing', () => {
    for (const b of [{ channelId: 3, propertyId: '1017407411799040876' }, { channelId: '3', propertyId: '123' }, { channelId: 3 }]) {
      expect(() => assertAirbnbPostAllowed('/property-activation', b)).toThrow(ForbiddenException);
      expect(() => assertAirbnbPostAllowed('/airbnb-calendar', b)).toThrow(ForbiddenException);
    }
  });
  it('refuses re-activating the pilot without the host token or with another price model (bind-mapping, admin)', () => {
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 1 })).toThrow(ForbiddenException);
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 4 })).toThrow(ForbiddenException);
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 4, token: ' ' })).toThrow(ForbiddenException);
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: 1, token: 5 })).toThrow(ForbiddenException);
    expect(() => assertAirbnbPostAllowed('/property-activation', { channelId: 3, propertyId: PILOT, priceModelId: '4', token: '98' })).not.toThrow();
  });
  it('refuses every other Airbnb write, even for the pilot: cancellation, host cancellation, availability, rates, test booking, listing create/delete', () => {
    for (const p of ['/property-cancellation', '/availability', '/availability-multiple', '/rates', '/reservations-createtest', '/property-check', '/rooms-activation']) {
      expect(() => assertAirbnbPostAllowed(p, { channelId: 3, propertyId: PILOT })).toThrow(ForbiddenException);
    }
    for (const p of ['/airbnb-host-cancellation', '/airbnb-listings', '/airbnb-listings-delete', '/airbnb-pricing-settings']) {
      expect(() => assertAirbnbPostAllowed(p, { token: 1, propertyId: PILOT })).toThrow(ForbiddenException);
    }
  });
});

describe('airbnbWebhookListingId — a 64-bit id parsed as a JSON number', () => {
it('every pilot listing, rounded by JSON.parse, is matched back to itself (the rounded values do not collide)', () => {    for (const id of AIRBNB_PILOT_LISTING_IDS) expect(airbnbWebhookListingId(JSON.parse(id) as number)).toBe(id);  });
  it('maps the rounded pilot id back to the exact one', () => {
    const rounded = JSON.parse(`{"propertyId":${PILOT}}`).propertyId as number;
    expect(String(rounded)).not.toBe(PILOT);
    expect(airbnbWebhookListingId(rounded)).toBe(PILOT);
  });
  it('keeps strings and safe numbers as sent; an unknown rounded number stays as it is', () => {
    expect(airbnbWebhookListingId(` ${PILOT} `)).toBe(PILOT);
    expect(airbnbWebhookListingId(51224597)).toBe('51224597');
    expect(airbnbWebhookListingId(2 ** 60)).toBe(String(2 ** 60));
    expect(airbnbWebhookListingId(undefined)).toBe('');
  });
});

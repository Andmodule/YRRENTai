import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { airbnbFromBooking } from './airbnb-from-booking';

const basic = (pct: number, state = 'on') => ({ promotionType: 'basic', state, discountPct: pct });

describe('airbnbFromBooking', () => {
  it('Park Mokotow 16.11: 240 − Basic 20 % = 192', () => {
    assert.equal(airbnbFromBooking(240, [basic(20)], 160), 192);
  });
  it('no deal → the Booking price', () => {
    assert.equal(airbnbFromBooking(280, [], null), 280);
  });
  it('several Basic deals: only the biggest counts', () => {
    assert.equal(airbnbFromBooking(300, [basic(10), basic(20), basic(15)], null), 240);
  });
  it('a deal that is not on Booking, or not Basic, does not count', () => {
    assert.equal(airbnbFromBooking(300, [basic(20, 'error'), basic(20, 'pending')], null), 300);
    assert.equal(airbnbFromBooking(300, [{ promotionType: 'last_minute', state: 'on', discountPct: 10 }], null), 300);
    assert.equal(airbnbFromBooking(300, [{ promotionType: 'mobile', state: 'on', discountPct: 10 }], null), 300);
  });
  it('never below the minimum (rounded up)', () => {
    assert.equal(airbnbFromBooking(200, [basic(30)], 160.4), 161);
  });
  it('whole złoty', () => {
    assert.equal(airbnbFromBooking(265, [basic(17)], null), 220);
  });
  it('no Booking price → nothing to show', () => {
    assert.equal(airbnbFromBooking(null, [basic(20)], null), null);
    assert.equal(airbnbFromBooking(0, [], null), null);
  });
  it('a Basic deal for members / the app only does not count (the server skips it)', () => {
    assert.equal(airbnbFromBooking(300, [{ ...basic(25), publicDeal: false }, basic(10)], null), 270);
    // older servers say nothing: taken as public
    assert.equal(airbnbFromBooking(300, [{ ...basic(20), publicDeal: undefined }], null), 240);
  });
  it('a 100 % or broken deal is ignored', () => {
    assert.equal(airbnbFromBooking(300, [basic(100), basic(Number.NaN)], null), 300);
  });
});

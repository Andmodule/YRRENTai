import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Reservation } from './types';
import { bookingSuggestions } from './calendarSearch';

const TODAY = '2026-10-26';

function res(over: Partial<Reservation> & { uuid: string }): Reservation {
  return {
    externalId: `ext-${over.uuid}`,
    propertyId: 'p1',
    guestName: 'Guest',
    channel: 'booking',
    status: 'confirmed',
    totalPrice: 0,
    currency: 'PLN',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    chatThreadId: null,
    ...over,
  };
}

const ids = (rs: Reservation[]) => rs.map((r) => r.uuid);

describe('bookingSuggestions', () => {
  const pool = [
    res({ uuid: 'a', guestName: 'Anna Kowalska', checkIn: '2026-11-05', checkOut: '2026-11-07' }),
    res({ uuid: 'b', guestName: 'Anna Nowak', checkIn: '2026-10-28', checkOut: '2026-10-30' }),
    res({ uuid: 'c', guestName: 'Annabel', checkIn: '2026-09-01', checkOut: '2026-09-03' }),
    res({ uuid: 'd', guestName: 'Annette', checkIn: '2026-10-01', checkOut: '2026-10-04' }),
    res({ uuid: 'e', guestName: 'Ewa', guestEmail: 'ewa@mail.pl', guestPhone: '+48 600 111 222' }),
  ];

  it('returns nothing for an empty, blank or one-letter query', () => {
    assert.deepEqual(bookingSuggestions(pool, '', TODAY, 5), []);
    assert.deepEqual(bookingSuggestions(pool, '   ', TODAY, 5), []);
    assert.deepEqual(bookingSuggestions(pool, 'a', TODAY, 5), []);
    assert.deepEqual(bookingSuggestions(pool, ' a ', TODAY, 5), []);
  });

  it('matches two letters, ignoring case and spaces around', () => {
    assert.deepEqual(ids(bookingSuggestions(pool, 'ew', TODAY, 5)), ['e']);
    assert.deepEqual(ids(bookingSuggestions(pool, '  EWA ', TODAY, 5)), ['e']);
  });

  it('matches by email, phone and booking number', () => {
    assert.deepEqual(ids(bookingSuggestions(pool, 'mail.pl', TODAY, 5)), ['e']);
    assert.deepEqual(ids(bookingSuggestions(pool, '600 111', TODAY, 5)), ['e']);
    assert.deepEqual(ids(bookingSuggestions(pool, 'ext-c', TODAY, 5)), ['c']);
  });

  it('returns nothing when no booking matches', () => {
    assert.deepEqual(bookingSuggestions(pool, 'zzz', TODAY, 5), []);
  });

  it('puts stays not over yet first (nearest check-in first), then past ones (latest first)', () => {
    assert.deepEqual(ids(bookingSuggestions(pool, 'ann', TODAY, 5)), ['b', 'a', 'd', 'c']);
  });

  it('keeps a stay that checks out today among the current ones', () => {
    const rs = [
      res({ uuid: 'out-today', guestName: 'Olga', checkIn: '2026-10-24', checkOut: TODAY }),
      res({ uuid: 'out-yesterday', guestName: 'Olga', checkIn: '2026-10-23', checkOut: '2026-10-25' }),
      res({ uuid: 'next', guestName: 'Olga', checkIn: '2026-11-10', checkOut: '2026-11-12' }),
    ];
    assert.deepEqual(ids(bookingSuggestions(rs, 'olga', TODAY, 5)), ['out-today', 'next', 'out-yesterday']);
  });

  it('reads dates with a time part by the day', () => {
    const rs = [
      res({ uuid: 'iso', guestName: 'Iga', checkIn: '2026-10-25T14:00:00.000Z', checkOut: `${TODAY}T10:00:00.000Z` }),
      res({ uuid: 'later', guestName: 'Iga', checkIn: '2026-11-20', checkOut: '2026-11-22' }),
      res({ uuid: 'earlier', guestName: 'Iga', checkIn: '2026-08-01', checkOut: '2026-08-03' }),
    ];
    // checks out today → a current stay, before the later one
    assert.deepEqual(ids(bookingSuggestions(rs, 'iga', TODAY, 5)), ['iso', 'later', 'earlier']);
    // a day later it is past, and more recent than the August one
    assert.deepEqual(ids(bookingSuggestions(rs, 'iga', '2026-10-27', 5)), ['later', 'iso', 'earlier']);
  });

  it('looks into the RentAI booking id only from four characters', () => {
    const rs = [res({ uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6', guestName: 'Olek', externalId: 'BK-1' })];
    assert.deepEqual(bookingSuggestions(rs, '3f', TODAY, 5), []);
    assert.deepEqual(bookingSuggestions(rs, '3fa', TODAY, 5), []);
    assert.equal(bookingSuggestions(rs, '3fa8', TODAY, 5).length, 1);
    assert.equal(bookingSuggestions(rs, '5f64-5717', TODAY, 5).length, 1);
    assert.equal(bookingSuggestions(rs, '5f645717', TODAY, 5).length, 1);
  });

  it('does not suggest a booking only because its notes match', () => {
    const rs = [res({ uuid: 'n', guestName: 'Piotr', notes: 'late arrival anna', internalNotes: 'call anna' })];
    assert.deepEqual(bookingSuggestions(rs, 'anna', TODAY, 5), []);
  });

  it('finds a booking with an empty guest name by its number', () => {
    const rs = [res({ uuid: 'x', guestName: '', externalId: '5501234' })];
    assert.deepEqual(ids(bookingSuggestions(rs, '55012', TODAY, 5)), ['x']);
  });

  it('keeps the given order for stays with the same check-in', () => {
    const rs = [
      res({ uuid: 's1', guestName: 'Sam', checkIn: '2026-11-01', checkOut: '2026-11-02' }),
      res({ uuid: 's2', guestName: 'Sam', checkIn: '2026-11-01', checkOut: '2026-11-04' }),
    ];
    assert.deepEqual(ids(bookingSuggestions(rs, 'sam', TODAY, 5)), ['s1', 's2']);
  });

  it('drops past stays first when current ones fill the limit', () => {
    const rs = [
      res({ uuid: 'p', guestName: 'Lena', checkIn: '2026-10-01', checkOut: '2026-10-03' }),
      res({ uuid: 'c1', guestName: 'Lena', checkIn: '2026-11-01', checkOut: '2026-11-03' }),
      res({ uuid: 'c2', guestName: 'Lena', checkIn: '2026-11-05', checkOut: '2026-11-07' }),
    ];
    assert.deepEqual(ids(bookingSuggestions(rs, 'lena', TODAY, 2)), ['c1', 'c2']);
  });

  it('leaves out technical blocks and RentAI blocks, keeps cancelled bookings', () => {
    const rs = [
      res({ uuid: 'ota', guestName: 'Mark', otaInventoryBlock: true }),
      res({ uuid: 'blk', guestName: 'Mark', status: 'blocked' }),
      res({ uuid: 'cnl', guestName: 'Mark', status: 'cancelled' }),
      res({ uuid: 'ok', guestName: 'Mark', checkIn: '2026-11-02', checkOut: '2026-11-04' }),
    ];
    assert.deepEqual(ids(bookingSuggestions(rs, 'mark', TODAY, 5)), ['cnl', 'ok']);
  });

  it('cuts the list to the limit after ordering', () => {
    assert.deepEqual(ids(bookingSuggestions(pool, 'ann', TODAY, 2)), ['b', 'a']);
    assert.deepEqual(ids(bookingSuggestions(pool, 'ann', TODAY, 0)), []);
  });

  it('does not change the list it was given', () => {
    const copy = ids(pool);
    bookingSuggestions(pool, 'ann', TODAY, 5);
    assert.deepEqual(ids(pool), copy);
  });
});

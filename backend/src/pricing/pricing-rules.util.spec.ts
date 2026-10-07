import {
  addMonthsYmd,
  isBookTimeNow,
  parseBookTime,
  parseLastMinute,
  parseRuleStepMeta,
  ruleStayTo,
  ruleStepName,
  worstTargetState,
} from './pricing-rules.util';
import {
  buildLastMinutePromotionPayload,
  parsePromotionsResponse,
} from '../integrations/zodomus/zodomus-promotions.util';

describe('last-minute / book-time parameters', () => {
  it('accepts Booking ranges only: unit day|hour, 1–1000', () => {
    expect(parseLastMinute({ unit: 'day', value: 3 })).toEqual({ unit: 'day', value: 3 });
    expect(parseLastMinute({ unit: 'hour', value: '12' })).toEqual({ unit: 'hour', value: 12 });
    expect(parseLastMinute({ unit: 'week', value: 3 })).toBeNull();
    expect(parseLastMinute({ unit: 'day', value: 0 })).toBeNull();
    expect(parseLastMinute({ unit: 'day', value: 1001 })).toBeNull();
    expect(parseLastMinute({ unit: 'day', value: 1.5 })).toBeNull();
    expect(parseLastMinute(null)).toBeNull();
  });

  it('book time: integer hours 0–24, start before end', () => {
    expect(parseBookTime({ start: 6, end: 12 })).toEqual({ start: 6, end: 12 });
    expect(parseBookTime({ start: 18, end: 24 })).toEqual({ start: 18, end: 24 });
    expect(parseBookTime({ start: 12, end: 12 })).toBeNull();
    expect(parseBookTime({ start: 20, end: 6 })).toBeNull();
    expect(parseBookTime({ start: -1, end: 5 })).toBeNull();
    expect(parseBookTime({ start: 0, end: 25 })).toBeNull();
    expect(parseBookTime(undefined)).toBeNull();
  });

  it('rule metadata is read only from a complete externalMeta', () => {
    const meta = {
      rule: { groupId: 'g1', name: 'Горящие', stepIndex: 1, horizonMonths: 6 },
      lastMinute: { unit: 'day', value: 1 },
      bookTime: null,
    };
    expect(parseRuleStepMeta(meta)).toEqual({
      rule: { groupId: 'g1', name: 'Горящие', stepIndex: 1, horizonMonths: 6 },
      lastMinute: { unit: 'day', value: 1 },
      bookTime: null,
    });
    // An extranet last-minute deal has lastMinute but no rule block → not a RentAI rule step.
    expect(parseRuleStepMeta({ lastMinute: { unit: 'day', value: 2 } })).toBeNull();
    expect(parseRuleStepMeta({ ...meta, lastMinute: { unit: 'day', value: 0 } })).toBeNull();
    expect(parseRuleStepMeta(null)).toBeNull();
  });
});

describe('dates', () => {
  it('adds whole months and clamps to the end of a shorter month', () => {
    expect(addMonthsYmd('2026-10-05', 6)).toBe('2027-04-05');
    expect(addMonthsYmd('2026-10-31', 4)).toBe('2027-02-28');
    expect(addMonthsYmd('2027-12-15', 2)).toBe('2028-02-15');
    expect(addMonthsYmd('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('a rule runs through the day before the same date N months later', () => {
    expect(ruleStayTo('2026-10-05', 6)).toBe('2027-04-04');
    expect(ruleStayTo('2026-10-05', 12)).toBe('2027-10-04');
  });
});

describe('isBookTimeNow', () => {
  const at = (iso: string) => new Date(iso);

  it('no window = always', () => {
    expect(isBookTimeNow(null, 'Europe/Warsaw')).toBe(true);
  });

  it('counts hours in the property time zone (start inclusive, end exclusive)', () => {
    // 2026-10-05 07:30 UTC = 09:30 in Warsaw (CEST, UTC+2)
    const t = at('2026-10-05T07:30:00Z');
    expect(isBookTimeNow({ start: 9, end: 12 }, 'Europe/Warsaw', t)).toBe(true);
    expect(isBookTimeNow({ start: 9, end: 12 }, 'UTC', t)).toBe(false);
    expect(isBookTimeNow({ start: 6, end: 9 }, 'Europe/Warsaw', t)).toBe(false);
    expect(isBookTimeNow({ start: 0, end: 24 }, 'Europe/Warsaw', t)).toBe(true);
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(isBookTimeNow({ start: 7, end: 8 }, 'Mars/Base', at('2026-10-05T07:30:00Z'))).toBe(true);
  });
});

describe('names and states', () => {
  it('describes a step in Russian', () => {
    expect(ruleStepName({ unit: 'day', value: 3 }, null)).toBe('За 3 дня до заезда');
    expect(ruleStepName({ unit: 'day', value: 1 }, null)).toBe('За 1 день до заезда');
    expect(ruleStepName({ unit: 'day', value: 5 }, null)).toBe('За 5 дней до заезда');
    expect(ruleStepName({ unit: 'hour', value: 12 }, { start: 6, end: 12 })).toBe(
      'За 12 часов до заезда, бронь 6:00–12:00',
    );
    expect(ruleStepName({ unit: 'hour', value: 2 }, null)).toBe('За 2 часа до заезда');
  });

  it('the worst state of a property is what a person should look at first', () => {
    expect(worstTargetState(['on', 'error', 'pending'])).toBe('error');
    expect(worstTargetState(['on', 'pending'])).toBe('pending');
    expect(worstTargetState(['on', 'dry_run'])).toBe('dry_run');
    expect(worstTargetState(['off', 'off'])).toBe('off');
    expect(worstTargetState([])).toBeNull();
  });
});

describe('Zodomus payload / response', () => {
  const base = {
    channelId: 1,
    externalPropertyId: '123',
    marker: 'RentAI 1a2b3c4d-1',
    discountPct: 8,
    stayFrom: '2026-10-05',
    stayTo: '2027-04-04',
    weekdays: null,
    roomIds: ['r1'],
    rateIds: ['p1'],
  };

  it('last_minute payload: type, window, optional book time, no book_date', () => {
    const withTime = buildLastMinutePromotionPayload({
      ...base,
      lastMinute: { unit: 'hour', value: 12 },
      bookTime: { start: 18, end: 24 },
    });
    expect(withTime).toMatchObject({
      type: 'last_minute',
      name: 'RentAI 1a2b3c4d-1',
      discount: '8',
      lastMinute: { unit: 'hour', value: '12' },
      bookTime: { start: '18', end: '24' },
      stayDate: { start: '2026-10-05', end: '2027-04-04' },
    });
    expect(withTime).not.toHaveProperty('bookDate');

    const noTime = buildLastMinutePromotionPayload({
      ...base,
      lastMinute: { unit: 'day', value: 3 },
      bookTime: null,
    });
    expect(noTime).toMatchObject({ type: 'last_minute', lastMinute: { unit: 'day', value: '3' } });
    expect(noTime).not.toHaveProperty('bookTime');
  });

  it('reads book_time from the XML-as-JSON answer', () => {
    const [p] = parsePromotionsResponse({
      promotions: [
        {
          '@attributes': { id: 'VR9', name: 'RentAI 1a2b3c4d-1', type: 'last_minute' },
          last_minute: { '@attributes': { unit: 'hour', value: '12' } },
          book_time: { '@attributes': { start: '6', end: '12' } },
        },
      ],
    });
    expect(p!.lastMinute).toEqual({ unit: 'hour', value: 12 });
    expect(p!.bookTime).toEqual({ start: 6, end: 12 });
  });

  it('no book_time (or a format we do not know) → null, never a guess', () => {
    const list = parsePromotionsResponse({
      promotions: [
        { '@attributes': { id: 'A' } },
        { '@attributes': { id: 'B' }, book_time: { '@attributes': { start: '08:00:00', end: '12:00:00' } } },
      ],
    });
    expect(list.map((p) => p.bookTime)).toEqual([null, null]);
  });
});

import {
  buildRateNameMapFromRoomRates,
  isLongStayOrDerivedRateName,
  pickPrimaryRateId,
  extractRoomsFromRoomRatesBody,
} from './zodomus-room-rates.util';

describe('zodomus-room-rates.util', () => {
  const body = {
    rooms: [
      {
        id: 'room-1',
        name: 'Apt',
        quantity: 1,
        rates: [
          { id: 'nr', name: 'Non-refundable', isChildRate: false },
          { id: 'std', name: 'Standard Rate', isChildRate: false },
          { id: 'child', name: 'Child', isChildRate: true },
          { id: 'mon', name: 'Monthly rate', isChildRate: true },
        ],
      },
    ],
  };

  it('prefers Standard rate id', () => {
    expect(pickPrimaryRateId(body, 'room-1')).toBe('std');
  });

  it('filters by preferRoomId', () => {
    const multi = {
      rooms: [
        { id: 'other', name: 'X', rates: [{ id: 'r-other', name: 'Standard' }] },
        body.rooms[0],
      ],
    };
    const rooms = extractRoomsFromRoomRatesBody(multi, 'room-1');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomId).toBe('room-1');
  });

  it('builds rate name map and detects long-stay names', () => {
    expect(buildRateNameMapFromRoomRates(body)).toEqual({
      nr: 'Non-refundable',
      std: 'Standard Rate',
      child: 'Child',
      mon: 'Monthly rate',
    });
    expect(isLongStayOrDerivedRateName('Monthly rate')).toBe(true);
    expect(isLongStayOrDerivedRateName('Weekly Rate')).toBe(true);
    expect(isLongStayOrDerivedRateName('Standard Rate')).toBe(false);
    expect(isLongStayOrDerivedRateName('Non-refundable')).toBe(false);
  });
});

import { pickPrimaryRateId, extractRoomsFromRoomRatesBody } from './zodomus-room-rates.util';

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
});

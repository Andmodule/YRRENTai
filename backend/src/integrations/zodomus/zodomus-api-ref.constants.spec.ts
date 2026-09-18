import {
  findZodomusApiRefEntry,
  injectZodomusApiRefRoomId,
} from './zodomus-api-ref.constants';

describe('injectZodomusApiRefRoomId', () => {
  it('injects into query when blank', () => {
    const entry = findZodomusApiRefEntry('GET', '/room');
    expect(entry?.requiresRoomId).toBe(true);
    const query: Record<string, string> = {};
    injectZodomusApiRefRoomId(entry!, 'R1', { query });
    expect(query.roomId).toBe('R1');
  });

  it('does not overwrite non-empty query roomId', () => {
    const entry = findZodomusApiRefEntry('GET', '/rate');
    const query = { roomId: 'KEEP' };
    injectZodomusApiRefRoomId(entry!, 'R1', { query });
    expect(query.roomId).toBe('KEEP');
  });

  it('injects into body.roomId', () => {
    const entry = findZodomusApiRefEntry('POST', '/availability');
    const body: Record<string, unknown> = { dateFrom: '2026-01-01' };
    injectZodomusApiRefRoomId(entry!, 'R2', { body });
    expect(body.roomId).toBe('R2');
  });

  it('injects into bodyRoomIds rows', () => {
    const entry = findZodomusApiRefEntry('POST', '/availability-multiple');
    const body: Record<string, unknown> = {
      roomIds: [{ roomId: '', dateFrom: '2026-01-01' }, { dateFrom: '2026-02-01' }],
    };
    injectZodomusApiRefRoomId(entry!, 'R3', { body });
    const rows = body.roomIds as Array<{ roomId: string }>;
    expect(rows[0].roomId).toBe('R3');
    expect(rows[1].roomId).toBe('R3');
  });

  it('injects into bodyRooms rows', () => {
    const entry = findZodomusApiRefEntry('POST', '/rooms-activation');
    const body: Record<string, unknown> = {};
    injectZodomusApiRefRoomId(entry!, 'R4', { body });
    const rooms = body.rooms as Array<{ roomId: string }>;
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomId).toBe('R4');
  });
});

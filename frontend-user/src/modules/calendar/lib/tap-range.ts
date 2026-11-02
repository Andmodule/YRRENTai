/** A cell of the general calendar: property row and day column. */
export type TapCell = { row: number; day: number };
export type TapRect = { r1: number; r2: number; d1: number; d2: number };

/**
 * Phone, mode «Цены»: a range is picked with two taps instead of a drag. The first tap picks one night and
 * waits; a second tap in the same row closes the range from it; a tap in another row starts over there.
 * After a closed range the next tap starts a new one.
 */
export function nextTapRange(anchor: TapCell | null, cell: TapCell): { rect: TapRect; anchor: TapCell | null } {
  if (!anchor || anchor.row !== cell.row) {
    return { rect: { r1: cell.row, r2: cell.row, d1: cell.day, d2: cell.day }, anchor: cell };
  }
  return {
    rect: { r1: cell.row, r2: cell.row, d1: Math.min(anchor.day, cell.day), d2: Math.max(anchor.day, cell.day) },
    anchor: null,
  };
}

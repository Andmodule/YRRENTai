/** A cell of the general calendar: property row and day column. */
export type TapCell = { row: number; day: number };
export type TapRect = { r1: number; r2: number; d1: number; d2: number };

/**
 * Phone: a range is picked with two taps instead of a drag (mode «Цены», or after a long press in «Брони»).
 * The first tap picks one night and waits; the second closes the rectangle between the two cells — in the same
 * row it is a range of nights, in another row it takes every property between them, like a drag on a computer.
 * After a closed range the next tap starts a new one.
 */
export function nextTapRange(anchor: TapCell | null, cell: TapCell): { rect: TapRect; anchor: TapCell | null } {
  if (!anchor) {
    return { rect: { r1: cell.row, r2: cell.row, d1: cell.day, d2: cell.day }, anchor: cell };
  }
  return {
    rect: {
      r1: Math.min(anchor.row, cell.row),
      r2: Math.max(anchor.row, cell.row),
      d1: Math.min(anchor.day, cell.day),
      d2: Math.max(anchor.day, cell.day),
    },
    anchor: null,
  };
}

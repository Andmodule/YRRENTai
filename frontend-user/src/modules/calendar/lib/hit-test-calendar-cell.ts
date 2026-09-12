/**
 * Hit-test for empty Planby grid cells (new booking from click).
 *
 * Coordinates must be relative to the Planby `content` pane via getBoundingClientRect
 * (do NOT add scrollLeft/scrollTop — that double-counts scroll and shifts day/row).
 * The timeline header is a sibling above content, so headerHeightPx is usually 0.
 */

export type CalendarCellHit =
  | { kind: 'header' }
  | { kind: 'outOfBounds' }
  | { kind: 'cell'; rowIndex: number; dayIndex: number };

export type HitTestCalendarCellInput = {
  /** Y relative to content top (clientY - contentRect.top). */
  yInContent: number;
  /** X relative to content left (clientX - contentRect.left). */
  xInContent: number;
  /** Reserved for layouts where the header is inside content; Planby custom header is a sibling → 0. */
  headerHeightPx: number;
  itemHeightPx: number;
  dayColWidthPx: number;
  numDays: number;
  numRows: number;
};

export function hitTestCalendarCell(input: HitTestCalendarCellInput): CalendarCellHit {
  const {
    yInContent,
    xInContent,
    headerHeightPx,
    itemHeightPx,
    dayColWidthPx,
    numDays,
    numRows,
  } = input;

  if (numDays <= 0 || numRows <= 0 || dayColWidthPx <= 0 || itemHeightPx <= 0) {
    return { kind: 'outOfBounds' };
  }

  if (yInContent < headerHeightPx) {
    return { kind: 'header' };
  }

  const yInRows = yInContent - headerHeightPx;
  if (yInRows < 0) {
    return { kind: 'header' };
  }

  const rowIndex = Math.floor(yInRows / itemHeightPx);
  if (rowIndex < 0 || rowIndex >= numRows) {
    return { kind: 'outOfBounds' };
  }

  if (xInContent < 0) {
    return { kind: 'outOfBounds' };
  }

  const dayIndex = Math.floor(xInContent / dayColWidthPx);
  if (dayIndex < 0 || dayIndex >= numDays) {
    return { kind: 'outOfBounds' };
  }

  return { kind: 'cell', rowIndex, dayIndex };
}

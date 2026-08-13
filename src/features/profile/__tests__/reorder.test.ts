import { describe, expect, it } from 'vitest';
import { dropIndex, moveTarget } from '../reorder.ts';

/* Four rows 40px tall, stacked from y=100 with no gaps: midpoints at 120, 160,
   200 and 240. */
const ROWS = [0, 1, 2, 3].map((i) => ({ top: 100 + i * 40, height: 40 }));

describe('dropIndex', () => {
  it('lands before a row while the pointer is above its middle', () => {
    expect(dropIndex(ROWS, 100)).toBe(0);
    expect(dropIndex(ROWS, 119)).toBe(0);
  });

  /* The midpoint itself belongs to the row below, so the gap opens as the
     cursor passes the centre rather than a pixel later. */
  it('moves on at the midpoint, not at the edge', () => {
    expect(dropIndex(ROWS, 120)).toBe(1);
    expect(dropIndex(ROWS, 159)).toBe(1);
    expect(dropIndex(ROWS, 160)).toBe(2);
  });

  it('appends when the pointer is past every row', () => {
    expect(dropIndex(ROWS, 240)).toBe(4);
    expect(dropIndex(ROWS, 9999)).toBe(4);
  });

  it('says 0 for an empty list rather than -1', () => {
    expect(dropIndex([], 500)).toBe(0);
  });

  /* Dragging above the list is common — the pointer leaves the top edge long
     before the drop fires. */
  it('clamps to the first slot above the list', () => {
    expect(dropIndex(ROWS, -50)).toBe(0);
  });
});

describe('moveTarget', () => {
  it('reports null while the pointer is still over the row being dragged', () => {
    expect(moveTarget(ROWS, 0, 100)).toBe(null);
    expect(moveTarget(ROWS, 2, 200)).toBe(null);
  });

  /* The bug this adjustment exists for: without dropping an index when moving
     down, row 0 dragged over row 1 computes back to 0 and never moves. */
  it('moves a row down by one', () => {
    expect(moveTarget(ROWS, 0, 160)).toBe(1);
  });

  it('moves a row up by one', () => {
    expect(moveTarget(ROWS, 2, 119)).toBe(0);
    expect(moveTarget(ROWS, 1, 119)).toBe(0);
  });

  it('takes the first row to the end and the last row to the front', () => {
    expect(moveTarget(ROWS, 0, 9999)).toBe(3);
    expect(moveTarget(ROWS, 3, 0)).toBe(0);
  });

  /* Rows give way before the pointer reaches their middle, so the list
     rearranges while the cursor is still short of the row it is taking over. At
     the plain midpoint neither of these would have moved yet. */
  it('swaps before the pointer reaches the middle of the next row', () => {
    expect(moveTarget(ROWS, 0, 155)).toBe(1); // down: row 1's middle is 160
    expect(moveTarget(ROWS, 2, 165)).toBe(1); // up: row 1's middle is 160
  });

  /* The early crossing has to be the same distance either way. A single low
     threshold would pull both lines up the screen, making downward drags eager
     and upward drags sluggish. Row 1's centre is 160, so these are the same
     35px travelled in each direction. */
  it('is as eager going up as going down', () => {
    expect(moveTarget(ROWS, 1, 160 + 35)).toBe(2);
    expect(moveTarget(ROWS, 1, 160 - 35)).toBe(0);
    /* And neither has given way yet a little short of that. */
    expect(moveTarget(ROWS, 1, 160 + 30)).toBe(null);
    expect(moveTarget(ROWS, 1, 160 - 30)).toBe(null);
  });

  /* Round trip: every position a row can be dragged to is reachable, and none
     of them reports an index outside the list. */
  it('never targets a slot outside the list', () => {
    for (let from = 0; from < ROWS.length; from++) {
      for (let y = 80; y < 300; y += 7) {
        const to = moveTarget(ROWS, from, y);
        if (to !== null) {
          expect(to).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThan(ROWS.length);
        }
      }
    }
  });
});

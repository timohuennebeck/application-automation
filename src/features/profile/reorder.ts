/* Dragging a fact to a new place in the profile list.

   Deliberately not the board's dnd.ts: that one is built around columns — it
   looks rows up by `[data-col]`, indexes by column and refuses to run while the
   board is sorted. None of that applies to one short vertical list, so this is
   the small version instead of a parameterised version of that. */

/* How far into a row the pointer must reach before that row gives way. At 0.5
   it is the row's midpoint; lower means the list rearranges sooner, while the
   cursor is still in the row's leading third. */
const CROSSING = 0.35;

/* The index the dragged row would land on, given where the pointer is.

   Each row votes with a line across itself: the pointer is past a row once it
   is below that line. Which line depends on where the row sits relative to the
   one being dragged (`from`) — rows ahead of it give way early, rows behind it
   hold on for the mirror image of the same distance. Without that asymmetry a
   single low threshold would make dragging down trigger sooner and dragging up
   trigger later, which feels like the list resisting one direction.

   Returns the length of the list when the pointer is below every row, i.e.
   "append". With `from` omitted every row uses its own midpoint. */
export function dropIndex(rows: { top: number; height: number }[], pointerY: number, from?: number): number {
  for (let i = 0; i < rows.length; i++) {
    let fraction = 0.5;
    if (from !== undefined && i > from) fraction = CROSSING;
    else if (from !== undefined && i < from) fraction = 1 - CROSSING;
    if (pointerY < rows[i].top + rows[i].height * fraction) return i;
  }
  return rows.length;
}

/* Index the dragged row should move to, or null when it is already there.

   `from` is where the row sits now. Removing it before inserting shifts every
   later slot up by one, so dropping below its old place has to lose one index —
   without that, dragging a row down by one does nothing at all. */
export function moveTarget(
  rows: { top: number; height: number }[],
  from: number,
  pointerY: number,
): number | null {
  const raw = dropIndex(rows, pointerY, from);
  const to = raw > from ? raw - 1 : raw;
  return to === from ? null : to;
}

/* Where the rows of `container` currently sit, in viewport coordinates. Read
   fresh on every dragover: the list reorders as you drag, so a cached set of
   boxes would describe the arrangement before the last move. */
function rowBoxes(container: HTMLElement): { top: number; height: number }[] {
  return Array.from(container.querySelectorAll('[data-fact]')).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });
}

/* The DOM half: everything above is pure so the index maths can be tested
   without a document. */
export function targetIndex(container: HTMLElement, from: number, pointerY: number): number | null {
  return moveTarget(rowBoxes(container), from, pointerY);
}

/* DOM predicates and measurements shared across the renderer. */

/* Keeps a surface opened at the cursor inside the window. Both callers float
   at viewport coordinates, so without this a click near the right or bottom
   edge opens a menu half off-screen. `height` is the surface's own estimate —
   it is laid out after this runs, so there is nothing to measure yet. */
const VIEWPORT_EDGE = 8;
export function clampToViewport(
  at: { x: number; y: number },
  width: number,
  height: number,
): { left: number; top: number } {
  return {
    left: Math.max(VIEWPORT_EDGE, Math.min(at.x, window.innerWidth - width - VIEWPORT_EDGE)),
    top: Math.max(VIEWPORT_EDGE, Math.min(at.y, window.innerHeight - height - VIEWPORT_EDGE)),
  };
}

/* Whether a mousedown landed in the text field that already has focus.
   The global handler flushes and closes an open editor on every mousedown, but
   the second click of a double click lands on the field itself — blurring there
   would throw away the very selection the double click just made. */
export function isInFocusedField(active: Element | null, target: Node | null): boolean {
  if (!active || !target) return false;
  if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') return false;
  return active === target || active.contains(target);
}

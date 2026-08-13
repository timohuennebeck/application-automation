/* DOM predicates shared by the store's document-level listeners. */

/* Whether a mousedown landed in the text field that already has focus.
   The global handler flushes and closes an open editor on every mousedown, but
   the second click of a double click lands on the field itself — blurring there
   would throw away the very selection the double click just made. */
export function isInFocusedField(active: Element | null, target: Node | null): boolean {
  if (!active || !target) return false;
  if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') return false;
  return active === target || active.contains(target);
}

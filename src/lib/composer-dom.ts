/* The bridge between what the composer shows and the one string it means.

   The composer paints mentions as the same chips the posted comment shows, so
   the box is a contenteditable holding real elements rather than a textarea
   holding characters. Everything above it — the draft in the store, the
   mention popover, what gets sent — still works in one plain string, and that
   is deliberate: `mentionQuery` and `applyMention` are offset arithmetic over
   text, and none of it should learn about DOM nodes. This module is the only
   place the two representations meet.

   A chip is atomic. It paints a paperclip, a name and a file size, but it
   stands for the characters "@Anschreiben" and nothing else — so what it
   paints is never read, and a caret is never placed inside it. */

/* The mention a chip stands for, e.g. "@Anschreiben". Its presence is what
   makes an element a chip; its value is the only text the chip contributes. */
export const MENTION_ATTR = 'data-mention';

/* Marks the <br> that exists only so a trailing newline has a line box to put
   a caret in — see tail handling in composerText. */
export const TAIL_ATTR = 'data-tail';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/* One node's contribution to the string, in document order. `atomic` nodes
   stand for their text as a unit: the caret may sit on either side of one but
   never within it. */
interface Piece {
  node: Node;
  text: string;
  atomic: boolean;
}

function pieces(container: Node): Piece[] {
  const out: Piece[] = [];
  const visit = (parent: Node) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === TEXT_NODE) {
        out.push({ node, text: (node as Text).data, atomic: false });
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const el = node as Element;
      const mention = el.getAttribute(MENTION_ATTR);
      if (mention !== null) {
        out.push({ node, text: mention, atomic: true });
        continue;
      }
      if (el.tagName === 'BR') {
        /* Scaffolding, not a character — counting it would append a newline
           the draft never had, and every keystroke would add another. */
        if (el.hasAttribute(TAIL_ATTR)) continue;
        out.push({ node, text: '\n', atomic: true });
        continue;
      }
      /* Anything else is the browser's own wrapping — a <div> it put around a
         typed line, a <span> a paste left behind. The text inside is still
         the text. */
      visit(node);
    }
  };
  visit(container);
  return out;
}

/* What the box currently means, as the draft string the rest of the app uses. */
export function composerText(root: HTMLElement): string {
  return pieces(root)
    .map((p) => p.text)
    .join('');
}

/* Measured by cloning rather than by walking to the node: a range knows where
   a position sits among siblings, which is the one thing a forward walk has to
   reconstruct — and gets wrong for a position expressed as an offset into an
   element rather than into text, which is exactly what a caret beside a chip
   is. */
export function composerOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  return offsetOf(root, node, offset);
}

function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return pieces(range.cloneContents()).reduce((n, p) => n + p.text.length, 0);
}

/* Where the caret sits, as an offset into composerText — or null when the
   selection is not in this box at all (another field has focus, or nothing
   does). A caret somehow inside a chip reads as the offset just past it. */
export function composerCaret(root: HTMLElement): number | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const { focusNode, focusOffset } = sel;
  if (!focusNode || !root.contains(focusNode)) return null;
  return offsetOf(root, focusNode, focusOffset);
}

/* What an edit would replace, as a range over composerText. Collapsed when
   nothing is selected, so a plain keystroke and a typed-over selection are the
   same operation on the draft string. */
export interface ComposerSelection {
  start: number;
  end: number;
}

export function composerSelection(root: HTMLElement): ComposerSelection | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

/* A chip is one thing, so the offsets between its first and last character
   name no caret position at all. Rather than refuse them — a restore has to
   put the caret somewhere — they snap to whichever end of the chip is nearer,
   ties going to the front. */
function snapOutOfChip(root: HTMLElement, offset: number): number {
  let start = 0;
  for (const piece of pieces(root)) {
    const end = start + piece.text.length;
    if (piece.atomic && offset > start && offset < end) {
      return offset - start <= end - offset ? start : end;
    }
    start = end;
  }
  return offset;
}

/* Puts the caret at an offset into composerText. Offsets past the end clamp to
   the end, so a restore after an edit that shortened the text cannot throw. */
export function setComposerCaret(root: HTMLElement, offset: number): void {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();

  const at = snapOutOfChip(root, offset);
  let start = 0;
  let placed = false;
  for (const piece of pieces(root)) {
    const end = start + piece.text.length;
    if (!piece.atomic) {
      /* `<=` so a caret at the very end of a run lands in the run rather than
         beside whatever follows it — typing there has to extend the text the
         user was writing, not attach to a chip. It is also what puts the
         caret behind a chip into the run that follows, since that run's start
         is the chip's end. */
      if (at <= end) {
        range.setStart(piece.node, at - start);
        placed = true;
        break;
      }
    } else if (at === start) {
      const parent = piece.node.parentNode;
      if (parent) {
        range.setStart(parent, Array.from(parent.childNodes).indexOf(piece.node as ChildNode));
        placed = true;
        break;
      }
    }
    start = end;
  }
  if (!placed) {
    /* Past every piece, or an empty box: the end is the only position there
       is. selectNodeContents rather than a child index so it holds for a root
       with no children at all. */
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

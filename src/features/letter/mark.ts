/* Marking a passage inside the letter's own document.

   The letter is rendered as its own HTML in an iframe, so a suggestion has to
   be written back into that markup rather than into a copy of it. Searching for
   the selected string would pick the wrong place whenever a sentence appears
   twice, so the selection is wrapped in a span the moment it is made: from then
   on the passage has an identity, and previewing, replacing and giving up are
   all operations on one element. The spans are unwrapped again on the way to
   disk, which is why nothing about them ever reaches the PDF. */

/* Where the popover hangs relative to the marked passage, in the iframe's own
   coordinates — translated to the editor's box before it is rendered. */
export interface MarkAnchor {
  left: number;
  top: number;
}

/* Where one marked passage stands. `working` is the only one the popover has
   nothing to show for — the letter carries that state itself. */
export type MarkPhase = 'marked' | 'working' | 'ready' | 'done';

export const MARK_ATTR = 'data-kepler-mark';
/* The stylesheet the editor injects; stripped on save along with the spans. */
export const STYLE_ATTR = 'data-kepler-style';
/* The "Kepler erstellt Optionen…" tag that rides beside a passage while it is
   being rewritten. It is removed as soon as the answer lands, but it is
   stripped on save as well — a crash mid-call must not leave it in the file. */
export const TAG_ATTR = 'data-kepler-tag';
/* The stop square inside that tag. It rides inside [TAG_ATTR], so the strip on
   save carries it off too — but the click handler needs to name it. */
export const STOP_ATTR = 'data-kepler-stop';
/* The app's ground colour, handed to the letter's own document because the
   theme token cannot resolve in there. It is the editor's, not the letter's, so
   it comes off again on the way to disk — it would otherwise ride into the PDF
   as an inline style on <html>. */
export const GROUND_PROP = '--kepler-ground';

/* Block-level tags a replacement must never swallow. A selection reaching
   across two paragraphs or out of a table cell cannot be replaced by one run
   of text without destroying the layout the template carefully set up. */
const BLOCK = 'p,div,table,thead,tbody,tr,td,th,li,ul,ol,h1,h2,h3,h4,h5,h6,section,header,footer,br';

export const SPANS_BLOCKS = 'SPANS_BLOCKS';

/* The mark a node sits inside, if any. A Range endpoint is usually a Text node,
   which has no closest() of its own. */
function markAround(node: Node | null): Element | null {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
  return el?.closest(`[${MARK_ATTR}]`) ?? null;
}

/* Wraps `range` in a mark span and hands it back. Returns SPANS_BLOCKS when the
   selection crosses a block boundary, and null when it holds no text worth
   rewriting — in both cases the document is left exactly as it was. */
export function markRange(doc: Document, range: Range): HTMLElement | null | typeof SPANS_BLOCKS {
  const contents = range.cloneContents();
  if (contents.querySelector(BLOCK)) return SPANS_BLOCKS;
  /* A selection touching a mark at all is refused, from either side.

     Inside one: wrapping it would nest a span in a span, and the marks map is
     keyed by element — the inner one would have no entry.

     Across its edge: the clone catches what the ancestry cannot, because a
     selection starting outside a mark and ending inside it has its common
     ancestor above the mark. surroundContents then fails over to
     extractContents, which per spec hands back a *clone carrying the mark's
     attributes*. The map would still key the original, now holding half its
     text, and the next replacement would write the whole passage into that
     half — duplicating it in the saved letter. */
  if (markAround(range.startContainer) || markAround(range.endContainer)) return null;
  if (contents.querySelector(`[${MARK_ATTR}]`)) return null;

  const span = doc.createElement('span');
  span.setAttribute(MARK_ATTR, '');
  try {
    range.surroundContents(span);
  } catch {
    /* surroundContents refuses a range that starts inside one element and ends
       inside another (…<strong>bo|ld</strong> tail…). Lifting the contents out
       and putting them back inside the span does the same job; extractContents
       splits the partially covered elements for us. */
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  if (span.textContent?.trim()) return span;
  unwrapMark(span);
  return null;
}

/* Puts a mark span's children back where the span was and drops it. */
export function unwrapMark(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  /* Two text nodes left side by side would make the next selection inside them
     harder to reason about, and serialise identically anyway. */
  parent.normalize();
}

/* The letter as it should be stored: no mark spans, no injected stylesheet,
   and the doctype the template started with — the document pipeline and the PDF
   renderer both expect a whole page, not a fragment. */
export function serializeLetter(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`[${STYLE_ATTR}], [${TAG_ATTR}]`).forEach((el) => el.remove());
  clone.querySelectorAll(`[${MARK_ATTR}]`).forEach(unwrapMark);
  clone.style.removeProperty(GROUND_PROP);
  /* An empty style attribute is not what the template started with. */
  if (!clone.style.length) clone.removeAttribute('style');
  return (doc.doctype ? '<!DOCTYPE html>\n' : '') + clone.outerHTML;
}

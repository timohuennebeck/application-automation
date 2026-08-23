/* @vitest-environment jsdom */

/* The only tests in the project that need a document. mark.ts decides what a
   selection may become and what exactly lands on disk, so it is the one module
   where hand-faked nodes would not prove anything: surroundContents, its
   extractContents fallback and cloneContents are the behaviour under test.

   jsdom rather than the lighter happy-dom: happy-dom's Range is a stub for
   text-offset selections — cloneContents() comes back empty and
   surroundContents() inserts an empty span beside the text instead of around
   it, so every assertion here would pass or fail for the wrong reason. */

import { describe, expect, it } from 'vitest';
import {
  MARK_ATTR,
  STYLE_ATTR,
  TAG_ATTR,
  SPANS_BLOCKS,
  markRange,
  serializeLetter,
  unwrapMark,
} from '../mark';

/* A letter document with `body` as its markup, built the way the editor sees
   one: a whole page with a doctype. */
function letter(body: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${body}</body></html>`,
    'text/html',
  );
}

/* Selects from `start` to `end`, counted in characters of the given nodes. */
function rangeOver(
  doc: Document,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Range {
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/* The first text node under `el`, which is what a selection actually anchors in. */
function textIn(el: Element): Text {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text;
}

describe('markRange', () => {
  it('wraps a plain selection in a mark span', () => {
    const doc = letter('<p>Ich schreibe Ihnen wegen der Stelle.</p>');
    const text = textIn(doc.querySelector('p')!);
    const marked = markRange(doc, rangeOver(doc, text, 4, text, 21));

    expect(marked).not.toBeNull();
    expect(marked).not.toBe(SPANS_BLOCKS);
    const span = marked as HTMLElement;
    expect(span.getAttribute(MARK_ATTR)).toBe('');
    expect(span.textContent).toBe('schreibe Ihnen we');
    /* The passage is still in the document, in place, exactly once. */
    expect(doc.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(1);
    expect(doc.querySelector('p')!.textContent).toBe('Ich schreibe Ihnen wegen der Stelle.');
  });

  it('refuses a selection that crosses a block boundary', () => {
    const doc = letter('<p>Erster Absatz.</p><p>Zweiter Absatz.</p>');
    const [first, second] = [...doc.querySelectorAll('p')];
    const before = doc.body.innerHTML;

    const marked = markRange(doc, rangeOver(doc, textIn(first), 3, textIn(second), 6));

    expect(marked).toBe(SPANS_BLOCKS);
    /* "the document is left exactly as it was" — the comment's promise. */
    expect(doc.body.innerHTML).toBe(before);
  });

  it('refuses a whitespace-only selection and leaves no span behind', () => {
    const doc = letter('<p>Wort   Wort</p>');
    const text = textIn(doc.querySelector('p')!);
    const before = doc.body.innerHTML;

    expect(markRange(doc, rangeOver(doc, text, 4, text, 7))).toBeNull();
    expect(doc.body.innerHTML).toBe(before);
    expect(doc.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
  });

  it('splits a partially covered element rather than giving up', () => {
    /* surroundContents throws here; the extractContents fallback is the path
       under test, and it is legitimate — no existing mark is involved. */
    const doc = letter('<p>Ich kann <strong>React und Next.js</strong> gut.</p>');
    const strong = doc.querySelector('strong')!;
    const p = doc.querySelector('p')!;
    const marked = markRange(doc, rangeOver(doc, textIn(p), 4, textIn(strong), 5));

    expect(marked).not.toBeNull();
    expect(marked).not.toBe(SPANS_BLOCKS);
    expect((marked as HTMLElement).textContent).toBe('kann React');
    expect(p.textContent).toBe('Ich kann React und Next.js gut.');
  });

  describe('an existing mark', () => {
    /* Marks a passage the way the editor would, then hands back the span. */
    function withMark(doc: Document, from: number, to: number): HTMLElement {
      const text = textIn(doc.querySelector('p')!);
      const span = markRange(doc, rangeOver(doc, text, from, text, to)) as HTMLElement;
      span.setAttribute(MARK_ATTR, 'done');
      return span;
    }

    it('is not nested when the new selection sits inside it', () => {
      const doc = letter('<p>Ich schreibe Ihnen wegen der Stelle.</p>');
      const span = withMark(doc, 4, 21);
      const before = doc.body.innerHTML;

      expect(markRange(doc, rangeOver(doc, textIn(span), 2, textIn(span), 8))).toBeNull();
      expect(doc.body.innerHTML).toBe(before);
      expect(doc.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(1);
    });

    it('is not split when the new selection crosses its edge', () => {
      /* The bug this pins: the guard only looked at commonAncestorContainer, so
         a selection starting outside and ending inside passed it. The fallback
         then cloned the mark — attributes and all — leaving a second element the
         marks map knows nothing about, and a later replace wrote the full text
         into the partial one, duplicating it in the saved letter. */
      const doc = letter('<p>Ich schreibe Ihnen wegen der Stelle.</p>');
      const span = withMark(doc, 22, 35);
      const before = doc.body.innerHTML;
      const outside = doc.querySelector('p')!.firstChild!;

      expect(markRange(doc, rangeOver(doc, outside, 4, textIn(span), 5))).toBeNull();
      expect(doc.body.innerHTML).toBe(before);
      expect(doc.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(1);
      expect(doc.querySelector(`[${MARK_ATTR}]`)!.textContent).toBe(span.textContent);
    });
  });
});

describe('unwrapMark', () => {
  it('puts the children back and joins the text around them', () => {
    const doc = letter('<p>Ich schreibe Ihnen.</p>');
    const text = textIn(doc.querySelector('p')!);
    const span = markRange(doc, rangeOver(doc, text, 4, text, 12)) as HTMLElement;

    unwrapMark(span);

    const p = doc.querySelector('p')!;
    expect(p.innerHTML).toBe('Ich schreibe Ihnen.');
    /* normalize() ran: one text node, so the next selection is reasonable. */
    expect(p.childNodes).toHaveLength(1);
  });
});

describe('serializeLetter', () => {
  it('keeps the document but carries none of the editor into the file', () => {
    const doc = letter('<p>Ich schreibe Ihnen wegen der Stelle.</p>');
    const text = textIn(doc.querySelector('p')!);
    const span = markRange(doc, rangeOver(doc, text, 4, text, 21)) as HTMLElement;
    span.setAttribute(MARK_ATTR, 'done');

    /* Everything the editor puts into the live document. */
    const style = doc.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    style.textContent = '[data-kepler-mark]{background:red}';
    doc.head.appendChild(style);
    const tag = doc.createElement('span');
    tag.setAttribute(TAG_ATTR, '');
    tag.textContent = 'Kepler erstellt Optionen…';
    span.after(tag);
    doc.documentElement.style.setProperty('--kepler-ground', '#fbfaf7');

    const html = serializeLetter(doc);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Ich schreibe Ihnen wegen der Stelle.');
    expect(html).not.toContain(MARK_ATTR);
    expect(html).not.toContain(STYLE_ATTR);
    expect(html).not.toContain(TAG_ATTR);
    expect(html).not.toContain('Kepler erstellt Optionen');
    /* The ground is the app's colour handed to the iframe so the page around
       the sheet matches the breadcrumb. It belongs to the editor, not to the
       user's document — and it would otherwise ride into the PDF. */
    expect(html).not.toContain('--kepler-ground');
  });

  it('takes the editing off the document on the way to disk', () => {
    /* The editor makes the letter typeable by turning the whole body
       contenteditable. That is the editor being open, not something the letter
       says — saved into the file it would ride into the PDF and reopen the
       next document already editable for the wrong reason. */
    const doc = letter('<p contenteditable="true">Text</p><script>el.contentEditable</script>');
    doc.body.setAttribute('contenteditable', 'true');

    const saved = new DOMParser().parseFromString(serializeLetter(doc), 'text/html');

    expect(saved.querySelectorAll('[contenteditable]')).toHaveLength(0);
    expect(saved.querySelector('p')?.outerHTML).toBe('<p>Text</p>');
    /* The attribute, not the word: a Fassung's own script talks about
       contentEditable, and that is the document's text — it stays. */
    expect(saved.querySelector('script')?.textContent).toContain('contentEditable');
  });

  it('leaves the live document untouched', () => {
    const doc = letter('<p>Ich schreibe Ihnen wegen der Stelle.</p>');
    const text = textIn(doc.querySelector('p')!);
    markRange(doc, rangeOver(doc, text, 4, text, 21));
    const before = doc.body.innerHTML;

    serializeLetter(doc);

    /* Saving happens while the user is still working in the letter: the marks
       they can see must survive being written to disk. */
    expect(doc.body.innerHTML).toBe(before);
    expect(doc.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(1);
  });
});

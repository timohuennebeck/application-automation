/* @vitest-environment jsdom */

/* jsdom rather than hand-faked nodes: the module's whole job is Range and
   Selection arithmetic over a tree the browser owns, and a fake would prove
   nothing about the one thing that can go wrong — a caret landing a character
   off once a chip sits in the line. Same reason letter/__tests__/mark.test.ts
   gives for not using happy-dom, and the same Range APIs are under test. */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MENTION_ATTR,
  TAIL_ATTR,
  composerCaret,
  composerSelection,
  composerText,
  setComposerCaret,
} from '../composer-dom';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  root.setAttribute('contenteditable', 'true');
  document.body.appendChild(root);
});

/* The shape Composer renders: text nodes for plain runs, a chip element per
   mention carrying the text it stands for, and nothing else. */
function chip(mention: string): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute(MENTION_ATTR, mention);
  el.setAttribute('contenteditable', 'false');
  /* What the chip paints is unrelated to what it means — a paperclip glyph, a
     name, a size. The mention text must come from the attribute alone. */
  el.textContent = '📎 ' + mention.slice(1) + ' 207 KB';
  return el;
}

function build(...nodes: (string | HTMLElement)[]): void {
  root.innerHTML = '';
  for (const n of nodes) root.append(typeof n === 'string' ? document.createTextNode(n) : n);
}

describe('composerText', () => {
  it('reads a chip as the mention it stands for, not as what it paints', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    expect(composerText(root)).toBe('Hallo @Kepler bitte');
  });

  it('is empty for an empty box', () => {
    expect(composerText(root)).toBe('');
  });

  it('reads a line break as a newline', () => {
    build('erste', document.createElement('br'), 'zweite');
    expect(composerText(root)).toBe('erste\nzweite');
  });

  /* A trailing newline needs a <br> after it or the empty last line has no
     line box to put a caret in — but that <br> is scaffolding, not text. */
  it('ignores the sentinel break that gives a trailing newline its line', () => {
    const tail = document.createElement('br');
    tail.setAttribute(TAIL_ATTR, '1');
    build('Zeile\n', tail);
    expect(composerText(root)).toBe('Zeile\n');
  });

  it('reads two adjacent chips without inventing a separator', () => {
    build(chip('@Kepler'), chip('@Anschreiben'));
    expect(composerText(root)).toBe('@Kepler@Anschreiben');
  });

  /* The browser wraps typed text in its own elements given half a chance;
     whatever nesting it produces, the text is still the text. */
  it('reads text the browser nested inside an element of its own', () => {
    const div = document.createElement('div');
    div.textContent = 'getippt';
    build('davor ', div);
    expect(composerText(root)).toBe('davor getippt');
  });
});

describe('composerCaret', () => {
  const place = (node: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  it('is null when nothing is selected in the box', () => {
    document.getSelection()!.removeAllRanges();
    expect(composerCaret(root)).toBeNull();
  });

  it('counts a chip at its full mention length', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    /* Three characters into the run that follows the chip. */
    place(root.childNodes[2], 3);
    expect(composerCaret(root)).toBe('Hallo @Kepler bi'.length);
  });

  it('reads a position inside a plain run as that offset', () => {
    build('Hallo Welt');
    place(root.childNodes[0], 5);
    expect(composerCaret(root)).toBe(5);
  });

  it('reads a position between two chips', () => {
    build(chip('@Kepler'), chip('@Anschreiben'));
    place(root, 1);
    expect(composerCaret(root)).toBe('@Kepler'.length);
  });

  it('is null for a caret outside the box', () => {
    build('drin');
    const outside = document.createElement('div');
    outside.textContent = 'draußen';
    document.body.appendChild(outside);
    place(outside.childNodes[0], 2);
    expect(composerCaret(root)).toBeNull();
  });
});

describe('composerSelection', () => {
  it('reads a selection that spans a chip as the offsets around it', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    const range = document.createRange();
    range.setStart(root.childNodes[0], 2);
    range.setEnd(root.childNodes[2], 3);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(composerSelection(root)).toEqual({ start: 2, end: 'Hallo @Kepler bi'.length });
  });

  it('is collapsed when nothing is selected', () => {
    build('Hallo');
    setComposerCaret(root, 3);
    expect(composerSelection(root)).toEqual({ start: 3, end: 3 });
  });
});

describe('setComposerCaret', () => {
  const read = () => {
    const sel = document.getSelection()!;
    return { node: sel.focusNode, offset: sel.focusOffset };
  };

  it('round-trips every offset a caret can actually occupy', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    const text = composerText(root);
    const chipStart = 'Hallo '.length;
    const chipEnd = 'Hallo @Kepler'.length;
    for (let i = 0; i <= text.length; i++) {
      /* Inside the chip is not a position — covered by its own test below. */
      if (i > chipStart && i < chipEnd) continue;
      setComposerCaret(root, i);
      expect(composerCaret(root)).toBe(i);
    }
  });

  /* A chip is one thing on screen and one thing to delete, so there is no
     caret position between its characters. An offset that names one has to
     resolve somewhere, and the nearer edge is the least surprising — what
     must never happen is a caret left inside, where typing would split the
     mention into text the popover no longer recognises. */
  it('snaps an offset inside a chip to the nearer edge', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    const chipStart = 'Hallo '.length;
    const chipEnd = 'Hallo @Kepler'.length;

    for (let i = chipStart + 1; i < chipEnd; i++) {
      setComposerCaret(root, i);
      const landed = composerCaret(root);
      expect([chipStart, chipEnd]).toContain(landed);
      expect(landed).toBe(i - chipStart <= chipEnd - i ? chipStart : chipEnd);
    }
  });

  it('round-trips across a newline', () => {
    build('erste', document.createElement('br'), 'zweite');
    const text = composerText(root);
    for (let i = 0; i <= text.length; i++) {
      setComposerCaret(root, i);
      expect(composerCaret(root)).toBe(i);
    }
  });

  it('lands in the text node rather than beside the chip where both are possible', () => {
    build('Hallo ', chip('@Kepler'), ' bitte');
    /* The offset just past the chip is both "after the chip element" and
       "at index 0 of the run behind it". Typing there must extend the run,
       not attach text to the chip. */
    setComposerCaret(root, 'Hallo @Kepler'.length);
    expect(read().node).toBe(root.childNodes[2]);
    expect(read().offset).toBe(0);
  });

  it('clamps an offset past the end to the end', () => {
    build('kurz');
    setComposerCaret(root, 99);
    expect(composerCaret(root)).toBe(4);
  });

  it('places the caret in an empty box without throwing', () => {
    setComposerCaret(root, 0);
    expect(composerCaret(root)).toBe(0);
  });
});

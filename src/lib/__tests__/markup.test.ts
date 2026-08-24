import { describe, expect, it } from 'vitest';
import { stripMarkup } from '../markup';

describe('stripMarkup entities', () => {
  it('spells out the German characters a hand-written Fassung escapes', () => {
    /* These reach the comment thread through editText — an edit line is what
       the user reads to decide whether to take a change back, so a swallowed
       umlaut reads as the document's own wording. */
    expect(stripMarkup('<p>Zust&auml;ndig f&uuml;r Gr&ouml;&szlig;e</p>')).toBe('Zuständig für Größe');
  });

  it('keeps a named entity that is not in the table instead of eating it', () => {
    expect(stripMarkup('<p>a &notanentity; b</p>')).toBe('a &notanentity; b');
  });

  it('resolves numeric entities, decimal and hex', () => {
    expect(stripMarkup('<p>Berlin&#8211;Mitte &#x2013; ja</p>')).toBe('Berlin–Mitte – ja');
  });

  it('leaves a numeric entity that names no character', () => {
    expect(stripMarkup('<p>&#1114112;</p>')).toBe('&#1114112;');
  });

  it('tells &Auml; from &auml;', () => {
    expect(stripMarkup('<p>&Auml;nderung und &auml;hnliches</p>')).toBe('Änderung und ähnliches');
  });

  it('still folds the entities it always handled', () => {
    expect(stripMarkup('<p>Ruhe&nbsp;&amp;&nbsp;Ordnung &ndash; gut</p>')).toBe('Ruhe & Ordnung – gut');
  });
});

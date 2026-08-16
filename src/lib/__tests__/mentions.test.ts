import { describe, expect, it } from 'vitest';
import { applyMention, mentionQuery, mentionsKepler, splitMentions } from '../mentions';

describe('mentionsKepler', () => {
  it('finds the assistant as a whole word anywhere in the text', () => {
    expect(mentionsKepler('@Kepler fass zusammen')).toBe(true);
    expect(mentionsKepler('Was meinst du, @Kepler?')).toBe(true);
    expect(mentionsKepler('Frag @Kepler\nmorgen')).toBe(true);
  });

  it('ignores prefixes, addresses and other names', () => {
    expect(mentionsKepler('@Keplers Meinung')).toBe(false);
    expect(mentionsKepler('post@Kepler.de')).toBe(false);
    expect(mentionsKepler('Kepler ohne Klammeraffe')).toBe(false);
    expect(mentionsKepler('@Timo bitte prüfen')).toBe(false);
  });
});

describe('splitMentions', () => {
  it('turns known names into mention parts and leaves the rest', () => {
    expect(splitMentions('Hi @Kepler, frag @Anna Berg!', ['Kepler', 'Anna Berg'])).toEqual([
      { t: 'Hi ', mention: false },
      { t: '@Kepler', mention: true },
      { t: ', frag ', mention: false },
      { t: '@Anna Berg', mention: true },
      { t: '!', mention: false },
    ]);
  });

  it('keeps unknown handles, bare @ and addresses as text — the same rule mentionsKepler uses', () => {
    expect(splitMentions('mail@x.de @Wer', ['Kepler'])).toEqual([{ t: 'mail@x.de @Wer', mention: false }]);
    expect(splitMentions('post@Kepler.de', ['Kepler'])).toEqual([{ t: 'post@Kepler.de', mention: false }]);
  });
});

describe('mentionQuery / applyMention', () => {
  it('reads the query being typed and inserts the pick with a trailing space', () => {
    const value = 'Frag @Ke bitte';
    const caret = 8;
    const q = mentionQuery(value, caret);
    expect(q).toEqual({ q: 'ke', start: 5 });
    expect(applyMention(value, q!, caret, 'Kepler')).toEqual({ text: 'Frag @Kepler  bitte', caret: 13 });
  });

  it('gives up on line breaks and on an @ glued to a word', () => {
    expect(mentionQuery('a@b', 3)).toBeNull();
    expect(mentionQuery('@Ke\nx', 5)).toBeNull();
  });
});

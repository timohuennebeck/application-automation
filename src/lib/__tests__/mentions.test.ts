import { describe, expect, it } from 'vitest';
import { applyMention, mentionQuery, mentionsKepler, selectMentionMatches, splitMentions } from '../mentions';
import type { Mentionable } from '../mentions';

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

describe('document mentions', () => {
  it('splits a document mention out of the text like a person’s', () => {
    const parts = splitMentions('trag sie ins @Anschreiben ein', ['Kepler', 'Anschreiben']);

    expect(parts.map((p) => p.t)).toEqual(['trag sie ins ', '@Anschreiben', ' ein']);
    expect(parts[1].mention).toBe(true);
  });

  it('does not take @Anschreibens for the document', () => {
    /* Same word rule the assistant's own mention uses. */
    const parts = splitMentions('mein @Anschreibens', ['Anschreiben']);

    expect(parts.every((p) => !p.mention)).toBe(true);
  });
});

describe('selectMentionMatches', () => {
  const person = (name: string): Mentionable => ({
    key: name,
    name,
    role: 'Kontakt',
    bg: 'var(--c-3f6ea8)',
    initials: name[0],
    kind: 'person',
  });
  const doc = (name: string): Mentionable => ({
    key: name,
    name,
    role: 'Dokument',
    bg: 'var(--c-3f6ea8)',
    initials: name[0],
    kind: 'document',
  });

  it('reserves rows for both documents even when five or more people match a bare @', () => {
    const candidates = [
      person('Anna Berg'),
      person('Marek Hübner'),
      person('Timo'),
      person('Kepler'),
      person('Sara Voss'),
      doc('Anschreiben'),
      doc('Lebenslauf'),
    ];

    const { people, docs } = selectMentionMatches(candidates, '');

    expect(docs.map((m) => m.name)).toEqual(['Anschreiben', 'Lebenslauf']);
    expect(people).toHaveLength(3);
  });

  it('gives people the full budget when no document matches', () => {
    const candidates = [person('Anna Berg'), person('Timo'), doc('Anschreiben')];

    const { people, docs } = selectMentionMatches(candidates, 'ti');

    expect(docs).toEqual([]);
    expect(people.map((m) => m.name)).toEqual(['Timo']);
  });

  it('narrows both groups by the typed query', () => {
    const candidates = [person('Anna Berg'), person('Timo'), doc('Anschreiben'), doc('Lebenslauf')];

    const { people, docs } = selectMentionMatches(candidates, 'ans');

    expect(people).toEqual([]);
    expect(docs.map((m) => m.name)).toEqual(['Anschreiben']);
  });
});

/* @-mentions in comments: detecting the query being typed, inserting a pick,
   and splitting stored text back into plain runs and mention chips. */

export const KEPLER = 'Kepler';

export interface Mentionable {
  key: string;
  name: string;
  role: string;
  bg: string;
  initials: string;
}

/* The assistant is mentionable in every thread, alongside the card's people. */
export const KEPLER_ENTRY: Mentionable = {
  key: KEPLER, name: KEPLER, role: 'KI-Assistent', bg: 'var(--c-1b1a17)', initials: 'K',
};

export interface TextPart {
  t: string;
  mention: boolean;
}

/* Longest names first so "@Marek Hübner" wins over a shorter prefix. */
function byLengthDesc(names: string[]): string[] {
  return [...names].sort((a, b) => b.length - a.length);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Splits comment text into plain runs and @-mention runs, so the renderer can
   style mentions as chips. Only names it knows become chips — a stray "@" or an
   unknown handle stays plain text. */
export function splitMentions(text: string, names: string[]): TextPart[] {
  const known = byLengthDesc(names).filter(Boolean);
  if (!known.length) return [{ t: text, mention: false }];
  const re = new RegExp('@(?:' + known.map(escapeRe).join('|') + ')(?![\\p{L}\\d])', 'gu');

  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ t: text.slice(last, i), mention: false });
    parts.push({ t: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), mention: false });
  return parts.length ? parts : [{ t: text, mention: false }];
}

export interface MentionQuery {
  /* Text typed after the "@", lower-cased for matching. */
  q: string;
  /* Index of the "@" that opened the query. */
  start: number;
}

/* Finds the mention being typed immediately before the caret, if any.
   A query runs from an "@" at a word boundary up to the caret, and is
   abandoned as soon as it contains a line break or grows past a name's length. */
export function mentionQuery(value: string, caret: number): MentionQuery | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && /[\p{L}\d@]/u.test(upto[at - 1])) return null;
  const q = upto.slice(at + 1);
  if (/[\n\r]/.test(q) || q.length > 32) return null;
  return { q: q.toLowerCase(), start: at };
}

/* Replaces the in-progress query with the chosen name, leaving a trailing space
   and reporting where the caret should land. */
export function applyMention(value: string, query: MentionQuery, caret: number, name: string): {
  text: string;
  caret: number;
} {
  const inserted = '@' + name + ' ';
  const text = value.slice(0, query.start) + inserted + value.slice(caret);
  return { text, caret: query.start + inserted.length };
}

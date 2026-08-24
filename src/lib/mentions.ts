/* @-mentions in comments: whether one addressed Kepler, detecting the query
   being typed, inserting a pick, and splitting stored text back into plain runs
   and mention chips. */
import { Author, AUTHOR_LABEL } from '../shared/enums';
import type { DocumentKind } from '../shared/enums';

/* The name Kepler is mentioned by — the same one its comments are signed with. */
export const KEPLER_NAME = AUTHOR_LABEL[Author.KEPLER];

/* "@Kepler" as a whole word: "@Keplers" and "mail@Kepler.de" are not the
   assistant. Same boundary rule as splitMentions below, so what renders as a
   chip is what Kepler answers. */
const KEPLER_MENTION = new RegExp('(?<![\\p{L}\\d@])@' + KEPLER_NAME + '(?![\\p{L}\\d])', 'u');

export function mentionsKepler(text: string): boolean {
  return KEPLER_MENTION.test(text);
}

/* What a mention stands for. A person gets a round avatar, which in this app
   means "human" everywhere — so a document may not have one, and the picker
   and the comment text both branch on this. */
export type MentionKind = 'person' | 'document';

export interface Mentionable {
  key: string;
  name: string;
  role: string;
  bg: string;
  initials: string;
  kind: MentionKind;
  /* Set for a document mention; the chip needs it to open the file. */
  document?: DocumentKind;
}

/* The assistant is mentionable in every thread, alongside the card's people. */
export const KEPLER_ENTRY: Mentionable = {
  key: KEPLER_NAME,
  name: KEPLER_NAME,
  role: 'KI-Assistent',
  bg: 'var(--c-1b1a17)',
  initials: 'K',
  kind: 'person',
};

/* The app's user — who Kepler addresses in its reports ("@Timo …"), and the
   same name the agent panel's mention chip carries. */
export const USER_ENTRY: Mentionable = {
  key: 'Timo',
  name: 'Timo',
  role: 'Du',
  bg: 'var(--c-3f6ea8)',
  initials: 'T',
  kind: 'person',
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
   unknown handle stays plain text, and so does an address like mail@Kepler.de:
   the same word rule mentionsKepler applies. */
export function splitMentions(text: string, names: string[]): TextPart[] {
  const known = byLengthDesc(names).filter(Boolean);
  if (!known.length) return [{ t: text, mention: false }];
  const re = new RegExp('(?<![\\p{L}\\d@])@(?:' + known.map(escapeRe).join('|') + ')(?![\\p{L}\\d])', 'gu');

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

/* At most this many rows fit the popover comfortably before it grows past a
   dropdown. Documents get first claim on up to two of them — Anschreiben and
   Lebenslauf are the only ones that will ever exist — so a card with three or
   more linked people (the common case once Kepler has added a recruiter)
   still leaves the Dokumente group room to show up under a bare "@". */
const MENTION_ROW_BUDGET = 5;
const DOCUMENT_ROW_RESERVE = 2;

/* Splits the mentionables matching a query into the two rendered groups,
   applying the row budget per group rather than to the combined list — see
   MENTION_ROW_BUDGET above for why. */
export function selectMentionMatches(
  candidates: Mentionable[],
  q: string,
  budget = MENTION_ROW_BUDGET,
): { people: Mentionable[]; docs: Mentionable[] } {
  const matches = candidates.filter((m) => m.name.toLowerCase().startsWith(q));
  const docs = matches.filter((m) => m.kind === 'document').slice(0, DOCUMENT_ROW_RESERVE);
  const people = matches.filter((m) => m.kind === 'person').slice(0, budget - docs.length);
  return { people, docs };
}

/* Replaces the in-progress query with the chosen name, leaving a trailing space
   and reporting where the caret should land. */
export function applyMention(
  value: string,
  query: MentionQuery,
  caret: number,
  name: string,
): {
  text: string;
  caret: number;
} {
  const inserted = '@' + name + ' ';
  const text = value.slice(0, query.start) + inserted + value.slice(caret);
  return { text, caret: query.start + inserted.length };
}

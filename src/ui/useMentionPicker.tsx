import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { applyMention, mentionQuery, selectMentionMatches } from '../lib/mentions';
import type { Mentionable } from '../lib/mentions';
import type { MentionBoxHandle } from './MentionBox';
import { MenuItem } from './MenuItem';
import { Avatar, DocFormat, DocGlyph } from './icons';

/* Small caps, no rule line: the heading names a group, it does not draw a
   border between two lists. */
const GROUP_LABEL: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--c-b3b0a8)',
  fontWeight: 600,
  padding: '7px 7px 3px',
};

/* Everything a box needs to run @-mention autocomplete over itself: three
   handlers to hand the MentionBox, and the list to render above it. */
export interface MentionPicker {
  onChange: (v: string, caret: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onCaretChange: (caret: number) => void;
  /* Absolutely positioned — render it inside an ancestor of the box that is
     itself positioned, or it will anchor to the page. */
  popover: ReactNode;
}

/* The @-mention popover as state and markup a caller can hang on any
   MentionBox.

   It lives here rather than inside the composer because a comment is *edited*
   in a bare box with no send button or paperclip around it, and typing "@"
   there has to offer the same list, in the same order, that it offered while
   the comment was being written. Two copies of this would agree until one of
   them was changed. */
export function useMentionPicker({
  value,
  onChange,
  onKeyDown,
  mentionables,
  boxRef,
  popoverWidth = 290,
}: {
  value: string;
  onChange: (v: string) => void;
  /* Runs for every key the popover did not consume. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /* Everyone and everything mentionable in this thread. */
  mentionables: Mentionable[];
  boxRef: RefObject<MentionBoxHandle | null>;
  popoverWidth?: number;
}): MentionPicker {
  const [at, setAt] = useState<number | null>(null);
  const [ix, setIx] = useState(0);
  /* Where the box says the caret is. Kept here rather than read off the node
     during render: the box refuses the browser's edits and places the caret
     itself, so between a keystroke and the commit that follows it the DOM
     still points at the position before the key. */
  const [caret, setCaret] = useState(0);

  /* The popover is open while the caret sits in an "@query". */
  const query = at !== null ? mentionQuery(value, caret) : null;
  const { people, docs } = query
    ? selectMentionMatches(mentionables, query.q)
    : { people: [] as Mentionable[], docs: [] as Mentionable[] };
  const open = !!query && (people.length > 0 || docs.length > 0);

  /* The arrow keys walk what is rendered, so the flat order has to be the
     rendered order — and a heading must never be a stop on the way. */
  const ordered = [...people, ...docs];
  /* Headings only earn their place when there are two groups to tell apart.
     By the second keystroke the query is usually down to one, and a heading
     over a single row is decoration. */
  const grouped = people.length > 0 && docs.length > 0;

  const sync = (next: string, nextCaret: number) => {
    const q = mentionQuery(next, nextCaret);
    onChange(next);
    setCaret(nextCaret);
    setAt(q ? q.start : null);
    setIx(0);
  };

  const pick = (name: string) => {
    const box = boxRef.current;
    if (!box || !query) return;
    const next = applyMention(value, query, caret, name);
    /* Told before the change, not after: the box applies a caret it was handed
       once React has committed the value it belongs to. */
    box.setCaret(next.caret);
    onChange(next.text);
    setCaret(next.caret);
    setAt(null);
    setIx(0);
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(ordered[ix % ordered.length].name);
        return;
      }
      if (e.key === 'Escape') {
        /* Closes the list, not the editor behind it. */
        e.stopPropagation();
        setAt(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const popStyle: CSSProperties = {
    position: 'absolute',
    left: 10,
    bottom: '100%',
    marginBottom: 6,
    zIndex: 40,
    width: popoverWidth,
    background: 'var(--c-fff)',
    border: '1px solid var(--c-e6e3dc)',
    borderRadius: 9,
    boxShadow: '0 14px 34px var(--s-1)',
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  };

  const row = (m: Mentionable) => (
    <MenuItem
      key={m.key}
      selected={ordered.indexOf(m) === ix % ordered.length}
      hideCheck
      // mousedown, not click: the box must not blur first.
      onMouseDown={() => pick(m.name)}
    >
      {m.kind === 'document' ? (
        /* A round avatar means "human" everywhere in this app, so a document
           takes the same page glyph its card carries. */
        <span style={{ display: 'flex', width: 20, justifyContent: 'center', flexShrink: 0 }}>
          <DocGlyph format={DocFormat.HTML} width={17} height={21} />
        </span>
      ) : (
        <Avatar bg={m.bg} size={20} fontSize={8.5}>
          {m.initials}
        </Avatar>
      )}
      <span style={{ whiteSpace: 'nowrap' }}>{m.name}</span>
      <span
        style={{
          fontSize: 11.5,
          color: 'var(--c-a5a29a)',
          marginLeft: 'auto',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '50%',
        }}
      >
        {m.role}
      </span>
    </MenuItem>
  );

  return {
    onChange: sync,
    onKeyDown: handleKey,
    onCaretChange: setCaret,
    popover: open && (
      <div data-dd="1" style={popStyle}>
        {grouped && <div style={GROUP_LABEL}>Personen</div>}
        {people.map((m) => row(m))}
        {grouped && <div style={GROUP_LABEL}>Dokumente</div>}
        {docs.map((m) => row(m))}
      </div>
    ),
  };
}

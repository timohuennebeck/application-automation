import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { applyMention, mentionQuery } from '../lib/mentions';
import type { Mentionable } from '../lib/mentions';
import { Composer } from './Composer';
import type { PendingAttachment } from './Composer';
import { MenuItem } from './MenuItem';
import { Avatar } from './icons';

/* A Composer with @-mention autocomplete. The query state is local, so every
   thread on the page (the card comments and each interview's notes) runs its
   own popover without them fighting over one shared key. */
export function MentionComposer({
  value,
  onChange,
  onSend,
  people,
  placeholder,
  onKeyDown,
  popoverWidth = 290,
  onAttach,
  attachments,
  onRemoveAttachment,
  onOpenAttachment,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /* Everyone mentionable in this thread, already including the assistant. */
  people: Mentionable[];
  placeholder?: string;
  /* Runs for every key the mention popover did not consume. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  popoverWidth?: number;
  /* Passed straight through to Composer; the paperclip only shows with onAttach. */
  onAttach?: () => void;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (index: number) => void;
  onOpenAttachment?: (index: number) => void;
}) {
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const [ix, setIx] = useState(0);

  /* The popover is open while the caret sits in an "@query". */
  const query =
    at !== null && boxRef.current ? mentionQuery(value, boxRef.current.selectionStart ?? value.length) : null;
  const matches = query ? people.filter((p) => p.name.toLowerCase().startsWith(query.q)).slice(0, 5) : [];
  const open = !!query && matches.length > 0;

  const sync = (next: string) => {
    const q = mentionQuery(next, boxRef.current?.selectionStart ?? next.length);
    onChange(next);
    setAt(q ? q.start : null);
    setIx(0);
  };

  const pick = (name: string) => {
    const box = boxRef.current;
    if (!box || !query) return;
    const caret = box.selectionStart ?? value.length;
    const next = applyMention(value, query, caret, name);
    onChange(next.text);
    setAt(null);
    setIx(0);
    // Restore the caret after React re-renders the controlled textarea.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[ix % matches.length].name);
        return;
      }
      if (e.key === 'Escape') {
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

  return (
    <Composer
      ref={boxRef}
      value={value}
      placeholder={placeholder}
      onChange={sync}
      onKeyDown={handleKey}
      onSend={onSend}
      onAttach={onAttach}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      onOpenAttachment={onOpenAttachment}
    >
      {open && (
        <div data-dd="1" style={popStyle}>
          {matches.map((m, i) => (
            <MenuItem
              key={m.key}
              selected={i === ix % matches.length}
              hideCheck
              // mousedown, not click: the textarea must not blur first.
              onMouseDown={() => pick(m.name)}
            >
              <Avatar bg={m.bg} size={20} fontSize={8.5}>
                {m.initials}
              </Avatar>
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
          ))}
        </div>
      )}
    </Composer>
  );
}

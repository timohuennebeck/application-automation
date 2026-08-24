import { useState } from 'react';
import { KEPLER_ENTRY } from '../../lib/mentions';
import type { Mentionable } from '../../lib/mentions';
import { Author, AUTHOR_LABEL } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { MentionComposer } from '../../ui/MentionComposer';
import { MentionText } from '../../ui/MentionText';
import { Avatar } from '../../ui/icons';

interface RoundNote {
  author: Author;
  text: string;
  time: string;
}

/* The note thread under one interview round, and the composer that appends to
   it. Notes take the same mentions as the card comments — the assistant plus
   everyone attached to this application, not only this round's participants.

   The draft is local state: a global editing key would be cleared by the
   document mousedown handler the moment the user clicks the send button. */
export function RoundNoteThread({
  cardId,
  ri,
  notes,
  people,
}: {
  cardId: string;
  ri: number;
  notes: RoundNote[];
  /* peopleForCard doesn't tag its rows with a mention kind — this thread only
     ever mentions people, so it is filled in here rather than upstream. */
  people: Omit<Mentionable, 'kind'>[];
}) {
  const { addRoundNote } = useApp();
  const [note, setNote] = useState('');

  const mentionable: Mentionable[] = [
    KEPLER_ENTRY,
    ...people.map((p) => ({ ...p, kind: 'person' as const })),
  ];

  const send = () => {
    if (!note.trim()) return;
    // Notes append to their own table; addRoundNote also writes the activity.
    addRoundNote(cardId, ri, note);
    setNote('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginTop: 5,
        maxWidth: 430,
        width: '100%',
      }}
    >
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 9 }}>
              <Avatar
                bg={n.author === Author.KEPLER ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'}
                size={20}
                fontSize={8.5}
                style={{ marginTop: 1 }}
              >
                {n.author === Author.KEPLER ? 'K' : AUTHOR_LABEL[n.author]}
              </Avatar>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>
                    {AUTHOR_LABEL[n.author]}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-a5a29a)' }}>{n.time}</div>
                </div>
                <MentionText
                  text={n.text}
                  mentionables={mentionable}
                  style={{ lineHeight: 1.6, whiteSpace: 'pre-line' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <MentionComposer
        value={note}
        onChange={setNote}
        onSend={send}
        people={mentionable}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setNote('');
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
    </div>
  );
}

import { useRef } from 'react';
import type { ProfileFactRow } from '../../shared/db-types';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { GripGlyph } from '../../ui/icons';
import { targetIndex } from './reorder';

/* The profile dialog's "Kontext" list — what the agent knows about you beyond
   the CV: drag to reorder, click to correct, ✕ to remove.

   The rows live in the store rather than in local state because a drag rewrites
   the whole order and an edit has to survive the dialog closing mid-write. */
export function FactList() {
  const {
    st,
    set,
    addProfileFact,
    updateProfileFact,
    deleteProfileFact,
    moveProfileFact,
    commitProfileOrder,
    cancelEditRef,
  } = useApp();
  const listRef = useRef<HTMLDivElement | null>(null);
  const facts = st.profileFacts;

  /* Reordering happens on dragover, so the list rearranges under the cursor and
     the drop itself has nothing left to do. */
  const onDragOver = (e: React.DragEvent) => {
    if (st.profileDragId === null) return;
    e.preventDefault();
    const from = facts.findIndex((f) => f.id === st.profileDragId);
    if (from < 0 || !listRef.current) return;
    const to = targetIndex(listRef.current, from, e.clientY);
    if (to !== null) moveProfileFact(st.profileDragId, to);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div ref={listRef} onDragOver={onDragOver} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {facts.map((f) => (
          <Fact
            key={f.id}
            fact={f}
            dragging={st.profileDragId === f.id}
            editing={st.editing === editKey(f.id)}
            draft={st.editDraft}
            onDragStart={() => set({ profileDragId: f.id, editing: null })}
            /* The list has already rearranged in memory by now; this is the one
               write, whether the drag ended in a drop or was abandoned. */
            onDragEnd={() => {
              set({ profileDragId: null });
              commitProfileOrder();
            }}
            onEdit={() => set({ editing: editKey(f.id), editDraft: f.text, dropdown: null })}
            onDraft={(text) => set({ editDraft: text })}
            onCancel={() => {
              cancelEditRef.current = true;
            }}
            onCommit={() => {
              if (cancelEditRef.current) {
                cancelEditRef.current = false;
                set({ editing: null });
                return;
              }
              updateProfileFact(f.id, st.editDraft);
            }}
            onDelete={() => deleteProfileFact(f.id)}
          />
        ))}
      </div>

      {/* Both states are held in a box the height of a fact row, so opening the
          composer swaps one for the other without the list below jumping. */}
      <div style={{ display: 'flex', alignItems: 'center', minHeight: ROW_HEIGHT }}>
        {st.profileFactDraft === null ? (
          <AddRow
            label="Fakt hinzufügen"
            /* Lines the + up with the grips above it rather than with the
               dialog's own left edge. */
            style={{ marginLeft: 2 }}
            onClick={() => set({ profileFactDraft: '' })}
          />
        ) : (
          <input
            value={st.profileFactDraft}
            autoFocus
            placeholder="Ich habe mal in Kolumbien gelebt..."
            onChange={(e) => set({ profileFactDraft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                /* Or the dialog itself would close on the same keystroke. */
                e.stopPropagation();
                cancelEditRef.current = true;
                e.currentTarget.blur();
              }
            }}
            /* Blur is the one save path, so Enter, Escape and clicking away all
               end up here — the same arrangement the sidebar fields use. */
            onBlur={() => {
              if (cancelEditRef.current) {
                cancelEditRef.current = false;
                set({ profileFactDraft: null });
                return;
              }
              addProfileFact(st.profileFactDraft ?? '');
              set({ profileFactDraft: null });
            }}
            style={INPUT}
          />
        )}
      </div>
    </div>
  );
}

/* Namespaced because st.editing is a single global slot, shared with the
   sidebar fields, the card title and the summary. */
const editKey = (id: number) => 'profile-fact:' + id;

/* One height for a fact however it is being shown — read, being edited, or
   being typed for the first time. Anything else and the list jumps as you
   click between those states. `.fact-row` in app.css is pinned to the same
   number; they have to move together. */
const ROW_HEIGHT = 32;

const INPUT: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--c-28261f)',
  border: '1px solid var(--c-cfccc3)',
  borderRadius: 6,
  /* Matches .fact-row's 8px, minus the 1px border this has and it does not. */
  padding: '0 7px',
  background: 'var(--c-fff)',
  outline: 'none',
  width: '100%',
  height: ROW_HEIGHT,
  boxSizing: 'border-box',
};

/* The same input, but sitting in the cell the fact's text occupies: no frame of
   its own, because the row it is inside is the frame. */
const INLINE_INPUT: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12.5,
  color: 'var(--c-28261f)',
  border: 'none',
  padding: 0,
  background: 'transparent',
  outline: 'none',
};

function Fact({
  fact,
  dragging,
  editing,
  draft,
  onDragStart,
  onDragEnd,
  onEdit,
  onDraft,
  onCancel,
  onCommit,
  onDelete,
}: {
  fact: ProfileFactRow;
  dragging: boolean;
  editing: boolean;
  draft: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onCancel: () => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  /* Edited inside the row rather than in place of it: the grip stays put and
     the input takes exactly the cell the text had, so the words do not move
     when you click them. */
  if (editing) {
    return (
      <div data-fact={fact.id} className="fact-row" style={{ cursor: 'default' }}>
        <GripGlyph />
        <input
          value={draft}
          autoFocus
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
              e.currentTarget.blur();
            }
          }}
          onBlur={onCommit}
          style={INLINE_INPUT}
        />
      </div>
    );
  }

  return (
    <div
      data-fact={fact.id}
      className="fact-row"
      /* The whole row is the handle: the grip is what says so, but a list this
         short is easier to grab anywhere. */
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        /* Firefox refuses to start a drag without payload; the id travels in
           the store, so the value itself does not matter. */
        e.dataTransfer.setData('text/plain', String(fact.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onEdit}
      title="Bearbeiten"
      style={{ opacity: dragging ? 0.4 : 1 }}
    >
      <GripGlyph />
      {/* Ellipsis rather than wrapping: the row has a fixed height, and clicking
          it opens the whole text in an input anyway. */}
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          fontSize: 12.5,
          color: 'var(--c-28261f)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {fact.text}
      </div>
      <div
        className="fact-x"
        title="Entfernen"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ✕
      </div>
    </div>
  );
}

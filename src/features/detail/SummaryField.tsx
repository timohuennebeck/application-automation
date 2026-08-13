import { useApp } from '../../state/store-context';

const PLACEHOLDER = 'Beschreibung hinzufügen…';

/* One box for both states, so clicking into the editor cannot shift the page:
   the reading view carries the editor's padding and a transparent border, and
   only the frame and the ground change. */
const BOX = {
  display: 'block',
  fontFamily: 'inherit',
  fontSize: 12.5,
  lineHeight: 1.6,
  borderRadius: 6,
  padding: '8px 10px',
  width: '100%',
  boxSizing: 'border-box',
} as const;

/* Click-to-edit role summary. Locked while Kepler owns the record. */
export function SummaryField({
  cardId,
  summary,
  locked,
}: {
  cardId: string;
  summary: string;
  locked: boolean;
}) {
  const { st, set, saveSummary, cancelEditRef } = useApp();

  if (st.editing === 'summary') {
    return (
      <textarea
        value={st.editDraft}
        autoFocus
        placeholder={PLACEHOLDER}
        onChange={(e) => set({ editDraft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelEditRef.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
        onBlur={() => {
          if (cancelEditRef.current) {
            cancelEditRef.current = false;
            set({ editing: null });
            return;
          }
          // An emptied description stays empty — the placeholder takes over.
          saveSummary(cardId, st.editDraft.trim() || null);
          set({ editing: null });
        }}
        style={
          {
            ...BOX,
            color: 'var(--c-5f5c56)',
            background: 'var(--c-fff)',
            border: '1px solid var(--c-cfccc3)',
            outline: 'none',
            resize: 'none',
            fieldSizing: 'content',
            minHeight: 0,
          } as React.CSSProperties
        }
      />
    );
  }

  return (
    <div
      className="summary-view"
      onClick={() => {
        if (!locked) set({ editing: 'summary', editDraft: summary, dropdown: null });
      }}
      style={{
        ...BOX,
        color: summary ? 'var(--c-5f5c56)' : 'var(--c-a8a49b)',
        border: '1px solid transparent',
        textWrap: 'pretty',
        cursor: locked ? 'not-allowed' : 'text',
      }}
    >
      {summary || PLACEHOLDER}
    </div>
  );
}

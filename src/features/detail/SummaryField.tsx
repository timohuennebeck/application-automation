import { useApp } from '../../state/store-context';

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
          saveSummary(cardId, st.editDraft.trim() || summary);
          set({ editing: null });
        }}
        style={
          {
            display: 'block',
            fontSize: 12.5,
            color: 'var(--c-3d3a34)',
            lineHeight: 1.6,
            background: 'var(--c-fff)',
            border: 'none',
            boxShadow: 'inset 0 0 0 1px var(--c-cfccc3)',
            borderRadius: 6,
            padding: '8px 10px',
            outline: 'none',
            resize: 'none',
            fieldSizing: 'content',
            minHeight: 0,
            width: '100%',
            boxSizing: 'border-box',
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
        fontSize: 12.5,
        color: 'var(--c-5f5c56)',
        lineHeight: 1.6,
        textWrap: 'pretty',
        padding: '8px 10px',
        cursor: locked ? 'not-allowed' : 'text',
      }}
    >
      {summary}
    </div>
  );
}

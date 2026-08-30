import type { ColumnDef } from '../../data/config';
import { visibleCards } from '../../state/selectors';
import { writeColumnOpen } from '../../state/column-prefs';
import { useApp } from '../../state/store-context';
import { CollapseGlyph, ColumnIcon } from '../../ui/icons';
import { ApplicationCard } from './ApplicationCard';
import { dragOverCol, endDrag } from './dnd';
import { ELLIPSIS } from '../../ui/styles';

/* One pipeline stage. Collapses to a 40px rail with a vertical label. */
export function BoardColumn({ col, ci }: { col: ColumnDef; ci: number }) {
  const store = useApp();
  const { st, set } = store;

  const isOpen = st.colOpen[ci];
  const cards = visibleCards(st, ci);
  const ring =
    st.dragId && st.overCol === ci
      ? 'inset 0 0 0 1.6px color-mix(in srgb, ' + col.accent + ' 55%, transparent)'
      : 'none';

  const toggle = () =>
    set((s) => {
      const next = s.colOpen.slice();
      next[ci] = !next[ci];
      writeColumnOpen(next);
      return { colOpen: next };
    });

  const dropProps = {
    'data-col': ci,
    onDragOver: (e: React.DragEvent) => dragOverCol(store, ci, e),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      endDrag(store);
    },
  };

  return (
    <div
      style={{
        flex: isOpen ? '0 0 260px' : '0 0 40px',
        minWidth: isOpen ? 260 : 40,
        maxWidth: isOpen ? 260 : 40,
        display: 'flex',
        flexDirection: 'column',
        /* Without this the column takes the height of its cards and the board
           grows past the window instead of the card list scrolling. */
        minHeight: 0,
      }}
    >
      {isOpen ? (
        <div
          {...dropProps}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: col.colTint,
            borderRadius: 10,
            padding: '9px 7px',
            boxShadow: ring,
          }}
        >
          <div
            onClick={toggle}
            title="Spalte einklappen"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 3px',
              minWidth: 0,
              cursor: 'pointer',
            }}
          >
            <ColumnIcon col={col} style={{ marginTop: 1 }} />
            <div
              style={{
                ...ELLIPSIS,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--c-28261f)',
                lineHeight: 1.3,
              }}
            >
              {col.name}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--c-8b8880)',
                flexShrink: 0,
                marginLeft: 'auto',
                marginTop: 1,
              }}
            >
              {cards.length}
            </div>
            <div
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.55,
              }}
            >
              <CollapseGlyph />
            </div>
          </div>
          {/* minHeight 0 lets the list shrink below its content so a column
              with many cards scrolls instead of growing past the board. */}
          <div
            className="no-scrollbar"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {cards.map((id) => (
              <ApplicationCard key={id} id={id} col={col} ci={ci} />
            ))}
          </div>
        </div>
      ) : (
        <div
          {...dropProps}
          onClick={toggle}
          title="Spalte ausklappen"
          style={{
            flex: '1 1 auto',
            width: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            background: col.colTint,
            borderRadius: 10,
            padding: '9px 0',
            boxShadow: ring,
            cursor: 'pointer',
          }}
        >
          <ColumnIcon col={col} />
          <div style={{ fontSize: 11, color: 'var(--c-8b8880)', fontWeight: 600 }}>{cards.length}</div>
          <div
            style={{
              writingMode: 'vertical-rl',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--c-4d4a44)',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {col.name}
          </div>
        </div>
      )}
    </div>
  );
}

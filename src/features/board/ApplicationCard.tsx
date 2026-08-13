import { AGENT_RUNS } from '../../data/sample-data';
import { INTEREST } from '../../data/config';
import type { ColumnDef } from '../../data/config';
import { Urgency } from '../../data/config';
import { Interest } from '../../shared/enums';
import { clock } from '../../lib/date';
import { initials } from '../../lib/text';
import { cardSubtitle, cardView, interviewChip } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { Avatar, PriorityBars, Spinner } from '../../ui/icons';
import { dragOverCol, endDrag, makeGhost } from './dnd';

/* A single application on the board. */
export function ApplicationCard({ id, col, ci }: { id: string; col: ColumnDef; ci: number }) {
  const store = useApp();
  const { st, set, openCard, contactsFor } = store;

  const card = cardView(st, id);
  if (!card) return null;
  const role = card.role;
  const company = card.companyLine;

  const interest = card.interest || Interest.NONE;
  const run = AGENT_RUNS[id];
  const interview = interviewChip(st, id);
  const subtitle = cardSubtitle(st, id);
  const contacts = contactsFor(id).filter((c) => c.name && c.name !== '—');

  const dueColor =
    subtitle.tone === Urgency.DUE
      ? 'var(--c-c2564c)'
      : subtitle.tone === Urgency.SOON
        ? 'var(--c-9a7218)'
        : 'var(--c-9a978f)';

  return (
    <div
      data-cardid={id}
      className="kb-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        makeGhost(store, e);
        store.dragPosRef.current = null;
        // Deferred so the browser snapshots the card before it dims.
        setTimeout(() => set({ dragId: id }), 0);
      }}
      onDragEnd={() => endDrag(store)}
      onDragOver={(e) => {
        e.stopPropagation();
        dragOverCol(store, ci, e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        endDrag(store);
      }}
      onClick={() => openCard(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        set({ cardMenu: { id, x: e.clientX, y: e.clientY } });
      }}
      style={{
        opacity: st.dragId === id ? 0.35 : run ? 0.78 : 1,
        background: run
          ? 'linear-gradient(var(--c-fff),var(--c-fff)) padding-box, conic-gradient(from var(--oa),var(--run) 0deg,color-mix(in srgb, var(--run) 22%, transparent) 34deg,transparent 50deg,transparent 322deg,color-mix(in srgb, var(--run) 60%, transparent) 360deg) border-box'
          : 'var(--c-fff)',
        backgroundSize: run ? 'auto' : '300% 100%',
        animation: run ? 'om-ang 2.6s linear infinite' : 'none',
        border: '1px solid ' + (run ? 'transparent' : 'var(--c-eae7e0)'),
        borderRadius: 8,
        padding: '9px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, color: 'var(--c-9a978f)', fontWeight: 500, letterSpacing: '0.02em' }}>
          {id}
        </div>
        <PriorityBars level={INTEREST[interest][1]} />
      </div>

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.3,
          color: 'var(--c-1b1a17)',
          textWrap: 'pretty',
        }}
      >
        {role}
      </div>
      <div style={{ fontSize: 11, color: 'var(--c-77746d)', lineHeight: 1.35 }}>{company}</div>
      {card.salary && (
        <div style={{ fontSize: 10.5, color: 'var(--c-5f5c56)', fontWeight: 500 }}>{card.salary}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginTop: 1 }}>
        {contacts.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {contacts.slice(0, 3).map((c, i) => (
                <Avatar
                  key={i}
                  bg={c.bg || 'var(--c-7a5aa8)'}
                  size={16}
                  style={{ marginLeft: i ? -5 : 0, zIndex: 10 - i, boxShadow: '0 0 0 1.5px var(--c-fff)' }}
                >
                  {initials(c.name) || '?'}
                </Avatar>
              ))}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--c-5f5c56)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {contacts[0].name}
            </div>
            {contacts.length > 1 && (
              <div style={{ fontSize: 10.5, color: 'var(--c-9a978f)', flexShrink: 0 }}>
                +{contacts.length - 1}
              </div>
            )}
          </>
        )}
        {!run && !interview && (
          <div
            style={{
              marginLeft: 'auto',
              paddingLeft: 12,
              fontSize: 10.5,
              color: dueColor,
              fontWeight: subtitle.tone !== Urgency.MUTED ? 600 : 400,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {subtitle.text}
          </div>
        )}
      </div>

      {interview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1, minWidth: 0 }}>
          <div
            style={{
              width: 30,
              flexShrink: 0,
              borderRadius: 6,
              overflow: 'hidden',
              textAlign: 'center',
              border: '1px solid color-mix(in srgb, ' + col.accent + ' 26%, var(--c-fff))',
              background: 'var(--c-fff)',
            }}
          >
            <div
              style={{
                background: col.accent,
                color: 'var(--c-fff)',
                fontSize: 7.5,
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '1px 0',
              }}
            >
              {interview.month}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--c-1b1a17)',
                lineHeight: 1.25,
                padding: '1px 0 2px',
              }}
            >
              {interview.day}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--c-1b1a17)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {interview.time}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--c-8b8880)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {interview.meta}
            </div>
          </div>
        </div>
      )}

      {run && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            background: 'var(--c-fff)',
            borderRadius: 6,
            padding: '5px 7px',
          }}
        >
          <Spinner />
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              backgroundImage:
                'linear-gradient(90deg,var(--c-a5a29a) 0%,var(--c-a5a29a) 28%,var(--c-1b1a17) 46%,var(--c-a5a29a) 64%,var(--c-a5a29a) 100%)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              animation: 'om-shimmer 2.4s linear infinite',
            }}
          >
            {run.label}
          </div>
          <div
            style={{
              marginLeft: 'auto',
              fontSize: 9.5,
              color: 'var(--c-8b8880)',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 26,
              textAlign: 'right',
            }}
          >
            {clock(run.started + st.tick)}
          </div>
        </div>
      )}
    </div>
  );
}

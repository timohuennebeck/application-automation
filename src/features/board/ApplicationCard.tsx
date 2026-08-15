import { INTEREST } from '../../data/config';
import type { ColumnDef } from '../../data/config';
import { Urgency } from '../../data/config';
import { INTERRUPTED_HEADLINE } from '../../shared/agent';
import { AgentRunStatus, Assignee, Interest } from '../../shared/enums';
import { elapsed } from '../../lib/date';
import { initials } from '../../lib/text';
import { agentLocked, agentRunFor, cardSubtitle, cardView, interviewChip } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import {
  Avatar,
  BriefcaseGlyph,
  ErrorDot,
  EuroGlyph,
  GlobeGlyph,
  PinGlyph,
  KeplerAvatar,
  PriorityBars,
  RegenGlyph,
  Spinner,
} from '../../ui/icons';
import { ELLIPSIS, RUN_BORDER_BG, SHIMMER_BG } from '../../ui/styles';
import { dragOverCol, endDrag, makeGhost } from './dnd';

/* The stacked company / location / salary / platform lines, each labelled by its icon. */
const FACT_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 10.5,
  color: 'var(--c-5f5c56)',
  fontWeight: 500,
  minWidth: 0,
} as const;

/* A single application on the board. */
export function ApplicationCard({ id, col, ci }: { id: string; col: ColumnDef; ci: number }) {
  const store = useApp();
  const { st, set, openCard, contactsFor, retryAgentStep } = store;

  const card = cardView(st, id);
  if (!card) return null;
  const role = card.role;
  const company = card.company;

  const interest = card.interest || Interest.NONE;
  /* The running border and label only while Kepler owns the card; a failed
     run keeps a red status strip so the board shows where Kepler needs help. */
  const runView = agentRunFor(st, id);
  const assigned = st.applications[id]?.assignee === Assignee.KEPLER;
  const run = agentLocked(st, id) ? runView?.run : undefined;
  /* A failed run keeps its red strip (retry lives there) even after Kepler is
     taken off the card; only the "Kepler" name row follows the assignment. */
  const failedRun = !run && runView?.run.status === AgentRunStatus.FAILED ? runView.run : undefined;
  const keplerRow = !!run || (!!failedRun && assigned);
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
        opacity: st.dragId === id ? 0.35 : run || failedRun ? 0.78 : 1,
        background: run
          ? RUN_BORDER_BG
          : failedRun
            ? 'color-mix(in srgb, var(--c-c2564c) 4%, var(--c-fff))'
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
      <div style={{ ...FACT_ROW, fontSize: 11, color: 'var(--c-77746d)', fontWeight: 400 }}>
        <BriefcaseGlyph style={{ color: 'var(--c-a5a29a)' }} />
        <span style={ELLIPSIS}>{company}</span>
      </div>
      {card.city && (
        <div style={FACT_ROW}>
          <PinGlyph style={{ color: 'var(--c-a5a29a)' }} />
          <span style={ELLIPSIS}>{card.city}</span>
        </div>
      )}
      {card.salary && (
        <div style={FACT_ROW}>
          <EuroGlyph style={{ color: 'var(--c-a5a29a)' }} />
          <span style={ELLIPSIS}>{card.salary}</span>
        </div>
      )}
      {card.channel && (
        <div style={FACT_ROW}>
          <GlobeGlyph style={{ color: 'var(--c-a5a29a)' }} />
          <span style={ELLIPSIS}>{card.channel}</span>
        </div>
      )}

      {/* While a Kepler strip owns the card's foot — running or failed — the
          contact and due-date row steps aside and Kepler takes the contact's
          place: the card says who is on it, the strip says what it does. */}
      {keplerRow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginTop: 1 }}>
          <KeplerAvatar size={16} fontSize={8} />
          <div style={{ fontSize: 10.5, color: 'var(--c-5f5c56)', whiteSpace: 'nowrap' }}>Kepler</div>
        </div>
      )}
      {!keplerRow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginTop: 1 }}>
          {/* Contacts are editable straight from the board; the click must not
            also open the card. */}
          <div
            className="card-contacts"
            title="Kontaktpersonen ändern"
            onClick={(e) => {
              e.stopPropagation();
              set((s) => ({
                cardContact: s.cardContact?.id === id ? null : { id, x: e.clientX, y: e.clientY + 12 },
                contactDraft: '',
                cardMenu: null,
              }));
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, borderRadius: 6 }}
          >
            {contacts.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  {contacts.slice(0, 3).map((c, i) => (
                    <Avatar
                      key={i}
                      bg={c.bg || 'var(--c-7a5aa8)'}
                      size={16}
                      style={{
                        marginLeft: i ? -5 : 0,
                        zIndex: 10 - i,
                        boxShadow: '0 0 0 1.5px var(--c-fff)',
                      }}
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
            ) : (
              <>
                <Avatar bg="var(--c-dedbd4)" size={16} style={{ color: 'var(--c-8b8880)' }}>
                  –
                </Avatar>
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--c-9a978f)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                >
                  Kein Kontakt ausgewählt
                </div>
              </>
            )}
          </div>
          <div
            style={{
              marginLeft: 'auto',
              paddingLeft: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            {/* Kepler stays on the card after its run is done — the avatar
                says who owns it, the run strip says what it is doing. */}
            {assigned && (
              <div title="Bearbeiter: Kepler" style={{ display: 'flex' }}>
                <KeplerAvatar size={16} fontSize={8} />
              </div>
            )}
            {!interview && (
              <div
                style={{
                  fontSize: 10.5,
                  color: dueColor,
                  fontWeight: subtitle.tone !== Urgency.MUTED ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {subtitle.text}
              </div>
            )}
          </div>
        </div>
      )}

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
              backgroundImage: SHIMMER_BG,
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
            {elapsed(run.started_at)}
          </div>
        </div>
      )}

      {failedRun && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            background: 'color-mix(in srgb, var(--c-c2564c) 8%, var(--c-fff))',
            borderRadius: 6,
            padding: '5px 7px',
          }}
        >
          <ErrorDot />
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: 'var(--c-c2564c)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {INTERRUPTED_HEADLINE}
          </div>
          <div
            className="icon-btn icon-btn-fail icon-btn-fail-tinted"
            title="Schritt erneut ausführen"
            style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              marginLeft: 'auto',
              marginTop: -3,
              marginBottom: -3,
            }}
            onClick={(e) => {
              e.stopPropagation();
              retryAgentStep(id);
            }}
          >
            <RegenGlyph />
          </div>
        </div>
      )}
    </div>
  );
}

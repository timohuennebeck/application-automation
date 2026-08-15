import { CHANNEL_BG, COLUMNS } from '../../data/config';
import { isHttpUrl } from '../../lib/url';
import { AgentRunStatus } from '../../shared/enums';
import { agentLocked, agentRunFor, cardView } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { MenuItem } from '../../ui/MenuItem';
import { LinkChip } from '../../ui/MentionText';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Avatar, DotsGlyph } from '../../ui/icons';
import { FollowUpSection } from '../followup/FollowUpSection';
import { InterviewEditModal } from '../interviews/InterviewEditModal';
import { InterviewsSection } from '../interviews/InterviewsSection';
import { AgentRunPanel } from './AgentRunPanel';
import { CommentsSection } from './CommentsSection';
import { DocumentsSection } from './DocumentsSection';
import { HistorySection } from './HistorySection';
import { SummaryField } from './SummaryField';
import { PropertiesSidebar } from './properties/PropertiesSidebar';

/* Reading width of the main column. The column itself stretches to the sidebar. */
const CONTENT_MAX = 700;

/* Resolves a card's display fields from the domain state. */
function useCard(cardId: string) {
  const { st } = useApp();
  const view = cardView(st, cardId);
  if (!view) return null;

  const columnIndex = Math.max(
    0,
    st.board.findIndex((c) => c.includes(cardId)),
  );
  return {
    role: view.role,
    company: view.company,
    companyFull: view.companyLine,
    city: view.city,
    channel: view.channel,
    homepage: view.homepage,
    summary: view.summary,
    columnIndex,
  };
}

/* The role heading, editable in place. Writes go through the same routed
   field as the sidebar's Berufsbezeichnung, so both stay in step. */
function RoleHeading({ cardId, role, locked }: { cardId: string; role: string; locked: boolean }) {
  const { st, set, writeField, cancelEditRef } = useApp();
  /* One box for both states, so clicking into the editor cannot shift the
     heading: the reading view carries the editor's padding and a transparent
     border, and only the frame and the ground change. */
  const style = {
    fontSize: 21,
    fontWeight: 600,
    color: 'var(--c-1b1a17)',
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    borderRadius: 6,
    padding: '1px 5px',
    marginLeft: -6,
  } as const;

  if (st.editing === TITLE_KEY) {
    return (
      <input
        value={st.editDraft}
        autoFocus
        onChange={(e) => set({ editDraft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelEditRef.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (cancelEditRef.current) {
            cancelEditRef.current = false;
            set({ editing: null });
            return;
          }
          writeField(cardId, 'Berufsbezeichnung', st.editDraft.trim());
          set({ editing: null });
        }}
        /* Framed like the sidebar's field editors. */
        style={{
          ...style,
          fontFamily: 'inherit',
          border: '1px solid var(--c-cfccc3)',
          background: 'var(--c-fff)',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <div
      title={locked ? undefined : 'Bezeichnung ändern'}
      onClick={() => {
        if (!locked) set({ editing: TITLE_KEY, editDraft: role, dropdown: null });
      }}
      style={{
        ...style,
        border: '1px solid transparent',
        textWrap: 'pretty',
        cursor: locked ? 'not-allowed' : 'text',
      }}
    >
      {role}
    </div>
  );
}

/* Shares AppState.editing with the sidebar fields, so opening one closes the other. */
const TITLE_KEY = 'title';

export function DetailView() {
  const { st, set, deleteCard, startAgent } = useApp();
  const cardId = st.openCardId!;
  const card = useCard(cardId);
  if (!card) return null;

  const cardMenuOpen = st.dropdown === 'card';
  const col = COLUMNS[card.columnIndex];
  /* The panel stays visible for a failed run (it carries the error); once a
     run is done the Kepler comment documents what happened. */
  const runView = agentRunFor(st, cardId);
  const showRun = !!runView && runView.run.status !== AgentRunStatus.DONE;
  const locked = agentLocked(st, cardId);
  const app = st.applications[cardId];
  const summary = card.summary;
  const docCard = { id: cardId, role: card.role, company: card.companyFull };

  return (
    <div
      style={{
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-fbfaf7)',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 22px 16px', flexShrink: 0 }}
      >
        <div className="crumb" onClick={() => set({ openCardId: null })}>
          Bewerbungen
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--c-c3c0b8)' }}>›</div>
        <div style={{ fontSize: 12.5, color: 'var(--c-1b1a17)', fontWeight: 600 }}>{cardId}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c-9a978f)' }}>{col.name}</div>

        <PopoverAnchor style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <div
            className={cardMenuOpen ? 'dots-btn dots-btn-header dots-btn-open' : 'dots-btn dots-btn-header'}
            title="Mehr"
            onClick={() => set((s) => ({ dropdown: s.dropdown === 'card' ? null : 'card', editing: null }))}
          >
            <DotsGlyph />
          </div>
          {cardMenuOpen && (
            <Popover top={29} right={0} width={196}>
              {/* Re-run needs a stored posting and a free record — while a run
                  is active the second start would be refused anyway. */}
              {!locked && !!(app?.posting_url || app?.posting_text) && (
                <MenuItem
                  style={{ whiteSpace: 'nowrap' }}
                  title="Überschreibt generierte Unterlagen und aktualisiert Firmendaten aus der Anzeige."
                  onClick={() => {
                    set({ dropdown: null });
                    startAgent(cardId);
                  }}
                >
                  Kepler erneut ausführen
                </MenuItem>
              )}
              <MenuItem danger style={{ whiteSpace: 'nowrap' }} onClick={() => deleteCard(cardId)}>
                Bewerbung löschen
              </MenuItem>
            </Popover>
          )}
        </PopoverAnchor>
      </div>

      <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
        {/* The column fills the space left by the sidebar and only its content is
            capped, so the gap beside it still belongs to the scroller below. */}
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            boxSizing: 'border-box',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Pinned head of the page: identity and summary stay in view. */}
          <div
            style={{
              display: 'flex',
              gap: 13,
              flexShrink: 0,
              padding: '6px 24px 0',
              maxWidth: CONTENT_MAX,
              boxSizing: 'border-box',
            }}
          >
            <Avatar bg={CHANNEL_BG[card.channel] || 'var(--c-8b8880)'} size={36} fontSize={15}>
              {card.company[0]}
            </Avatar>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 0' }}>
              <RoleHeading cardId={cardId} role={card.role} locked={locked} />
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--c-8b8880)',
                  lineHeight: 1.4,
                  overflowWrap: 'anywhere',
                }}
              >
                {card.companyFull.replace(/,\s*/g, ' · ')}
                {isHttpUrl(card.homepage) && (
                  <>
                    {' · '}
                    <LinkChip url={card.homepage} />
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '16px 24px 12px',
              width: '100%',
              maxWidth: CONTENT_MAX,
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            <SummaryField cardId={cardId} summary={summary} locked={locked} />
          </div>

          <div
            className="no-scrollbar"
            style={{
              flex: '1 1 0',
              minHeight: 0,
              overflowY: 'scroll',
              boxSizing: 'border-box',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
              maskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
            }}
          >
            <div
              style={{
                maxWidth: CONTENT_MAX,
                padding: '26px 24px 28px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 26,
              }}
            >
              {/* The agent panel grows with every step, so it scrolls. */}
              {showRun && <AgentRunPanel view={runView} />}
              <FollowUpSection cardId={cardId} role={card.role} company={card.company} />
              <InterviewsSection cardId={cardId} company={card.company} />
              <DocumentsSection card={docCard} />
              <CommentsSection cardId={cardId} />
              <HistorySection cardId={cardId} />
            </div>
          </div>
        </div>

        <PropertiesSidebar
          cardId={cardId}
          role={card.role}
          company={card.company}
          columnIndex={card.columnIndex}
        />
      </div>

      {st.roundEdit && <InterviewEditModal company={card.company} channel={card.channel} />}
    </div>
  );
}

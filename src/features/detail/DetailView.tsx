import { AGENT_RUNS } from '../../data/sample-data';
import { CHANNEL_BG, COLUMNS } from '../../data/config';
import { cardView } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { MenuItem } from '../../ui/MenuItem';
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

  const columnIndex = Math.max(0, st.board.findIndex((c) => c.includes(cardId)));
  return {
    role: view.role,
    company: view.company,
    companyFull: view.companyLine,
    city: view.city,
    channel: view.channel,
    website: view.website,
    summary: view.summary,
    columnIndex,
  };
}

/* The role heading, editable in place. Writes go through the same routed
   field as the sidebar's Berufsbezeichnung, so both stay in step. */
function RoleHeading({ cardId, role, locked }: { cardId: string; role: string; locked: boolean }) {
  const { st, set, writeField, cancelEditRef } = useApp();
  const style = {
    fontSize: 21, fontWeight: 600, color: 'var(--c-1b1a17)', lineHeight: 1.2,
    letterSpacing: '-0.01em', width: '100%', minWidth: 0,
  } as const;

  if (st.editing === TITLE_KEY) {
    return (
      <input
        value={st.editDraft}
        autoFocus
        onChange={(e) => set({ editDraft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { e.stopPropagation(); cancelEditRef.current = true; e.currentTarget.blur(); }
        }}
        onBlur={() => {
          if (cancelEditRef.current) { cancelEditRef.current = false; set({ editing: null }); return; }
          writeField(cardId, 'Berufsbezeichnung', st.editDraft.trim());
          set({ editing: null });
        }}
        style={{
          ...style, fontFamily: 'inherit', boxSizing: 'border-box',
          border: '1px solid var(--c-cfccc3)', borderRadius: 6, padding: '1px 5px', marginLeft: -6,
          background: 'var(--c-fff)', outline: 'none',
        }}
      />
    );
  }

  return (
    <div
      title={locked ? undefined : 'Bezeichnung ändern'}
      onClick={() => { if (!locked) set({ editing: TITLE_KEY, editDraft: role, dropdown: null }); }}
      style={{ ...style, textWrap: 'pretty', cursor: locked ? 'not-allowed' : 'text' }}
    >
      {role}
    </div>
  );
}

/* Shares AppState.editing with the sidebar fields, so opening one closes the other. */
const TITLE_KEY = 'title';

export function DetailView() {
  const { st, set, deleteCard } = useApp();
  const cardId = st.openCardId!;
  const card = useCard(cardId);
  if (!card) return null;

  const cardMenuOpen = st.dropdown === 'card';
  const col = COLUMNS[card.columnIndex];
  const run = AGENT_RUNS[cardId];
  const summary = card.summary;
  const docCard = { id: cardId, role: card.role, company: card.companyFull };

  return (
    <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--c-fbfaf7)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 22px 16px', flexShrink: 0 }}>
        <div className="crumb" onClick={() => set({ openCardId: null })}>Bewerbungen</div>
        <div style={{ fontSize: 12.5, color: 'var(--c-c3c0b8)' }}>›</div>
        <div style={{ fontSize: 12.5, color: 'var(--c-1b1a17)', fontWeight: 600 }}>{cardId}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c-9a978f)' }}>{col.name}</div>

        <PopoverAnchor style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <div
            className="dots-btn"
            title="Mehr"
            onClick={() => set((s) => ({ dropdown: s.dropdown === 'card' ? null : 'card', editing: null }))}
            style={{ background: cardMenuOpen ? 'var(--c-e7e4dc)' : 'transparent', color: cardMenuOpen ? 'var(--c-1b1a17)' : 'var(--c-a5a29a)' }}
          >
            <DotsGlyph />
          </div>
          {cardMenuOpen && (
            <Popover top={29} right={0} width={196}>
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
        <div style={{ flex: '1 1 0', minWidth: 0, boxSizing: 'border-box', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Pinned head of the page: identity and summary stay in view. */}
          <div style={{ display: 'flex', gap: 13, flexShrink: 0, padding: '6px 24px 0', maxWidth: CONTENT_MAX, boxSizing: 'border-box' }}>
            <Avatar bg={CHANNEL_BG[card.channel] || 'var(--c-8b8880)'} size={36} fontSize={15}>{card.company[0]}</Avatar>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 0' }}>
              <RoleHeading cardId={cardId} role={card.role} locked={!!run} />
              <div style={{ fontSize: 12.5, color: 'var(--c-8b8880)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                {card.companyFull.replace(/,\s*/g, ' · ')} ·{' '}
                <a href="#" style={{ textDecoration: 'none' }}>
                  {card.website || 'karriere.' + card.company.toLowerCase().replace(/[^a-z]/g, '') + '.de'}
                </a>
              </div>
            </div>
          </div>

          <div style={{ padding: '16px 24px 12px', width: '100%', maxWidth: CONTENT_MAX, boxSizing: 'border-box', flexShrink: 0 }}>
            <SummaryField cardId={cardId} summary={summary} locked={!!run} />
          </div>

          <div
            className="no-scrollbar"
            style={{
              flex: '1 1 0', minHeight: 0, overflowY: 'scroll', boxSizing: 'border-box',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
              maskImage: 'linear-gradient(to bottom, transparent 0, var(--c-000) 24px)',
            }}
          >
            <div style={{
              maxWidth: CONTENT_MAX, padding: '26px 24px 28px', boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', gap: 26,
            }}>
              {/* The agent panel grows with every step, so it scrolls. */}
              {run && <AgentRunPanel run={run} card={docCard} />}
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

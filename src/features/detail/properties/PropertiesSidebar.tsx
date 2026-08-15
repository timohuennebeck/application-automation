import type { ReactNode } from 'react';
import { COLUMNS, DATE_FIELDS, FACT_OPTIONS, INTEREST, INTEREST_ORDER, SECTIONS } from '../../../data/config';
import { agentLocked, keplerHoldReason } from '../../../state/selectors';
import { Assignee, FactKind, Interest, LinkKind } from '../../../shared/enums';
import { isoToDate } from '../../../lib/date';
import { useApp } from '../../../state/store-context';
import { FieldChip } from '../../../ui/FieldChip';
import { FieldRow } from '../../../ui/FieldRow';
import { FIELD_GLYPH_SLOT, FieldGlyph } from '../../../ui/field-glyphs';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';
import { Section } from '../../../ui/Section';
import { Avatar, ColumnIcon, KeplerAvatar, PriorityBars } from '../../../ui/icons';
import { ContactPicker } from '../../people/ContactPicker';
import { FactField, type FactView } from './FactField';

/* Wide enough for the longest catalog label ("Berufsbezeichnung") plus the
   glyph in front of it; anything longer wraps instead of being clipped. */
const SIDEBAR_LABEL_WIDTH = 118 + FIELD_GLYPH_SLOT;

const GroupTitle = ({ children }: { children: string }) => (
  <div
    style={{
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      color: 'var(--c-a8a49b)',
      paddingBottom: 5,
    }}
  >
    {children}
  </div>
);

/* Every sidebar row is the same FieldRow: its label, that label's glyph, the
   sidebar's label column, and a 24px floor so the rows keep their rhythm. */
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FieldRow
      label={label}
      glyph={<FieldGlyph label={label} />}
      labelWidth={SIDEBAR_LABEL_WIDTH}
      minHeight={24}
    >
      {children}
    </FieldRow>
  );
}

/* Nobody first, then everyone who can own a card — Kepler is the only one. */
const ASSIGNEE_OPTIONS: (Assignee | null)[] = [null, Assignee.KEPLER];

/* Avatar + name for the Bearbeiter chip and its menu entries. */
function AssigneeLabel({ assignee }: { assignee: Assignee | null }) {
  return (
    <>
      {assignee === Assignee.KEPLER ? (
        <KeplerAvatar size={16} fontSize={8} />
      ) : (
        <Avatar bg="var(--c-b3b0a8)" size={16}>
          –
        </Avatar>
      )}
      <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>
        {assignee === Assignee.KEPLER ? 'Kepler' : 'Kein Bearbeiter ausgewählt'}
      </span>
    </>
  );
}

interface PropertiesSidebarProps {
  cardId: string;
  role: string;
  company: string;
  columnIndex: number;
}

/* Status, interest, contact and every recorded field of the application.
   Most labels are windows onto real DB columns (see the fact-label routing in
   the design spec); only the free-form POSITION fields live in facts rows. */
export function PropertiesSidebar({ cardId, role, company, columnIndex }: PropertiesSidebarProps) {
  const { st, set, contactsFor, setContacts, moveCard, logAct, setInterest, setAssignee } = useApp();
  const locked = agentLocked(st, cardId);
  const keplerHold = keplerHoldReason(st, cardId);

  const app = st.applications[cardId];
  const assignee = app?.assignee ?? null;
  const comp = app ? st.companies[app.company_id] : undefined;
  const facts = st.factsByApp[cardId] || [];

  /* The catalog value for each routed label; facts fill in the rest. */
  const routed: Record<string, { value: string; link?: boolean }> = {
    Berufsbezeichnung: { value: role },
    Unternehmen: { value: company },
    Plattform: { value: app?.channel || '' },
    /* The listing's URL — the link the application was (or will be) sent
       through, and the source Kepler reads from. */
    Stellenanzeige: { value: app?.posting_url || '', link: true },
    'Beworben via': { value: app?.applied_via || '' },
    'Beworben am': { value: app?.applied_at ? isoToDate(app.applied_at) : '' },
    Branche: { value: comp?.sector || '' },
    Mitarbeiterzahl: { value: comp?.headcount || '' },
    Firmenseite: { value: comp?.homepage || '', link: true },
    Email: { value: comp?.email || '' },
    Telefon: { value: comp?.phone || '' },
  };

  const view = (label: string): FactView => {
    const r = routed[label];
    const fact = facts.find((f) => f.label === label);
    const raw = r?.value ?? fact?.value ?? '';
    /* Cleared facts used to be stored as '—' (and Erfahrung as 'nicht
       angegeben'), so rows written before that changed still carry them. */
    const value = raw === '—' || raw === 'nicht angegeben' ? '' : raw;
    return {
      label,
      value,
      empty: !value,
      link: r?.link || fact?.kind === FactKind.LINK,
      isSelect: !!FACT_OPTIONS[label],
      isDate: !!DATE_FIELDS[label],
      isSalary: label === 'Gehalt',
    };
  };

  const catalog = new Set(SECTIONS.flatMap(([, labels]) => labels));
  const groups = SECTIONS.slice(1).map(([title, labels]) => ({ title, items: labels.map(view) }));
  const rest = facts.filter((f) => !catalog.has(f.label)).map((f) => view(f.label));
  if (rest.length) groups.push({ title: 'Weitere Angaben', items: rest });

  const col = COLUMNS[columnIndex];
  const interest = app?.interest || Interest.NONE;

  return (
    <div
      className="no-scrollbar"
      style={{
        width: 392,
        flexShrink: 0,
        marginLeft: 'auto',
        overflowY: 'auto',
        padding: '12px 22px 28px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <Section sectionKey="props" title="Eigenschaften" count={1 + groups.length} gap={24}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <GroupTitle>Bewerbung</GroupTitle>

          <PropertyRow label="Status">
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'status'}
                chevron
                tint={col.tint}
                onClick={() =>
                  set((s) => ({ dropdown: s.dropdown === 'status' ? null : 'status', editing: null }))
                }
              >
                <ColumnIcon col={col} size={13} />
                <span>{col.name}</span>
              </FieldChip>
              {st.dropdown === 'status' && (
                <Popover minWidth={230}>
                  {COLUMNS.map((c, ci) => (
                    <MenuItem
                      key={c.name}
                      selected={ci === columnIndex}
                      onClick={() => {
                        moveCard(cardId, ci, null);
                        logAct(cardId, 'hat den Status auf „' + c.name + '“ gesetzt');
                        set({ dropdown: null });
                      }}
                    >
                      <ColumnIcon col={c} size={13} />
                      <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </MenuItem>
                  ))}
                </Popover>
              )}
            </PopoverAnchor>
          </PropertyRow>

          <PropertyRow label="Interesse">
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'interest'}
                gap={7}
                chevron
                onClick={() =>
                  set((s) => ({ dropdown: s.dropdown === 'interest' ? null : 'interest', editing: null }))
                }
              >
                <PriorityBars level={INTEREST[interest][1]} />
                <span>{INTEREST[interest][0]}</span>
              </FieldChip>
              {st.dropdown === 'interest' && (
                <Popover minWidth={180}>
                  {INTEREST_ORDER.map((k) => (
                    <MenuItem
                      key={k}
                      selected={k === interest}
                      onClick={() => {
                        setInterest(cardId, k);
                        set({ dropdown: null });
                      }}
                    >
                      <PriorityBars level={INTEREST[k][1]} />
                      <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{INTEREST[k][0]}</span>
                    </MenuItem>
                  ))}
                </Popover>
              )}
            </PopoverAnchor>
          </PropertyRow>

          <PropertyRow label="Bearbeiter">
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'assignee'}
                gap={7}
                chevron
                onClick={() =>
                  set((s) => ({ dropdown: s.dropdown === 'assignee' ? null : 'assignee', editing: null }))
                }
              >
                <AssigneeLabel assignee={assignee} />
              </FieldChip>
              {st.dropdown === 'assignee' && (
                <Popover minWidth={180}>
                  {/* While Kepler cannot be taken off the card, the menu still
                      opens but nothing in it is pickable: every row shows the
                      forbidden cursor and the reason. */}
                  {ASSIGNEE_OPTIONS.map((a) => (
                    <MenuItem
                      key={a ?? 'none'}
                      selected={a === assignee}
                      disabled={!!keplerHold}
                      title={keplerHold ?? undefined}
                      onClick={() => {
                        if (keplerHold) return;
                        setAssignee(cardId, a);
                        set({ dropdown: null });
                      }}
                    >
                      <AssigneeLabel assignee={a} />
                    </MenuItem>
                  ))}
                </Popover>
              )}
            </PopoverAnchor>
          </PropertyRow>

          <PopoverAnchor style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 24 }}>
            <div
              style={{
                width: SIDEBAR_LABEL_WIDTH,
                flexShrink: 0,
                fontSize: 12,
                color: 'var(--c-9a978f)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <FieldGlyph label="Kontaktperson" />
              Kontaktperson
            </div>
            <div style={{ marginLeft: -6, minWidth: 0 }}>
              <ContactPicker
                popKey={'fact:' + cardId}
                cardId={cardId}
                company={company}
                list={contactsFor(cardId)}
                onSave={(l) => setContacts(cardId, l)}
                store={LinkKind.CONTACT}
                avatarSize={18}
                align="right"
              />
            </div>
          </PopoverAnchor>

          {SECTIONS[0][1].map(view).map((f) => (
            <PropertyRow key={f.label} label={f.label}>
              <FactField fact={f} cardId={cardId} locked={locked} />
            </PropertyRow>
          ))}
        </div>

        {groups.map((g) => (
          <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <GroupTitle>{g.title}</GroupTitle>
            {g.items.map((f) => (
              <PropertyRow key={f.label} label={f.label}>
                <FactField fact={f} cardId={cardId} locked={locked} />
              </PropertyRow>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}

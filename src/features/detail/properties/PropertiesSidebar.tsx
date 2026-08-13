import { AGENT_RUNS } from '../../../data/sample-data';
import { COLUMNS, DATE_FIELDS, FACT_OPTIONS, INTEREST, INTEREST_ORDER, SECTIONS } from '../../../data/config';
import { FactKind, Interest, LinkKind } from '../../../shared/enums';
import { isoToDate } from '../../../lib/date';
import { useApp } from '../../../state/store-context';
import { FieldChip } from '../../../ui/FieldChip';
import { FieldRow } from '../../../ui/FieldRow';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';
import { Chevron, ColumnIcon, PriorityBars } from '../../../ui/icons';
import { ContactPicker } from '../../people/ContactPicker';
import { FactField, type FactView } from './FactField';

/* Wide enough for the longest catalog label ("Berufsbezeichnung"); anything
   longer wraps instead of being clipped. */
const SIDEBAR_LABEL_WIDTH = 118;

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

export interface PropertiesSidebarProps {
  cardId: string;
  role: string;
  company: string;
  columnIndex: number;
}

/* Status, interest, contact and every recorded field of the application.
   Most labels are windows onto real DB columns (see the fact-label routing in
   the design spec); only the free-form POSITION fields live in facts rows. */
export function PropertiesSidebar({ cardId, role, company, columnIndex }: PropertiesSidebarProps) {
  const { st, set, contactsFor, setContacts, moveCard, logAct, setInterest } = useApp();
  const locked = !!AGENT_RUNS[cardId];

  const app = st.applications[cardId];
  const comp = app ? st.companies[app.company_id] : undefined;
  const facts = st.factsByApp[cardId] || [];

  /* The catalog value for each routed label; facts fill in the rest. */
  const routed: Record<string, { value: string; link?: boolean }> = {
    Berufsbezeichnung: { value: role },
    Firma: { value: company },
    Plattform: { value: app?.channel || '—' },
    'Beworben via': { value: app?.applied_via || '—' },
    'Beworben am': { value: app?.applied_at ? isoToDate(app.applied_at) : '—' },
    'Letzter Kontakt': { value: app?.last_contact_at ? isoToDate(app.last_contact_at) : '—' },
    Branche: { value: comp?.sector || 'nicht angegeben' },
    Mitarbeiterzahl: { value: comp?.headcount || 'nicht angegeben' },
    Karriereseite: { value: comp?.website || '—', link: true },
    'E-Mail': { value: comp?.email || '—', link: true },
    Telefon: { value: comp?.phone || '—' },
  };
  const factDefaults: Record<string, string> = { Gehalt: 'nicht angegeben', Erfahrung: 'nicht angegeben' };

  const view = (label: string): FactView => {
    const r = routed[label];
    const fact = facts.find((f) => f.label === label);
    return {
      label,
      value: r?.value ?? fact?.value ?? factDefaults[label] ?? '—',
      link: r?.link || fact?.kind === FactKind.LINK,
      isSelect: !!FACT_OPTIONS[label],
      isDate: !!DATE_FIELDS[label],
    };
  };

  const catalog = new Set(SECTIONS.flatMap(([, labels]) => labels));
  const groups = SECTIONS.slice(1).map(([title, labels]) => ({ title, items: labels.map(view) }));
  const rest = facts.filter((f) => !catalog.has(f.label)).map((f) => view(f.label));
  if (rest.length) groups.push({ title: 'Weitere Angaben', items: rest });

  const col = COLUMNS[columnIndex];
  const interest = app?.interest || Interest.NONE;
  const open = st.secOpen.props !== false;

  const toggleSection = () =>
    set((s) => {
      const m = { ...s.secOpen, props: s.secOpen.props === false };
      try {
        localStorage.setItem('kb-sections', JSON.stringify(m));
      } catch {
        /* ignore */
      }
      return { secOpen: m };
    });

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
      <div
        onClick={toggleSection}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          userSelect: 'none',
          width: 'fit-content',
        }}
      >
        <Chevron
          size={10}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms ease' }}
        />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>Eigenschaften</div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--c-a5a29a)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          ({1 + groups.length})
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          flexShrink: 0,
          overflow: open ? 'visible' : 'hidden',
          maxHeight: open ? 'none' : 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <GroupTitle>Bewerbung</GroupTitle>

          <FieldRow label="Status" labelWidth={SIDEBAR_LABEL_WIDTH} minHeight={24}>
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'status'}
                chevron
                style={{ background: col.tint }}
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
          </FieldRow>

          <FieldRow label="Interesse" labelWidth={SIDEBAR_LABEL_WIDTH} minHeight={24}>
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
          </FieldRow>

          <PopoverAnchor style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 24 }}>
            <div
              style={{ width: SIDEBAR_LABEL_WIDTH, flexShrink: 0, fontSize: 12, color: 'var(--c-9a978f)' }}
            >
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
            <FieldRow key={f.label} label={f.label} labelWidth={SIDEBAR_LABEL_WIDTH} minHeight={24}>
              <FactField fact={f} cardId={cardId} locked={locked} />
            </FieldRow>
          ))}
        </div>

        {groups.map((g) => (
          <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <GroupTitle>{g.title}</GroupTitle>
            {g.items.map((f) => (
              <FieldRow key={f.label} label={f.label} labelWidth={SIDEBAR_LABEL_WIDTH} minHeight={24}>
                <FactField fact={f} cardId={cardId} locked={locked} />
              </FieldRow>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import {
  AGENT_RUNS, COLUMNS, DATE_FIELDS, DETAILS, FACT_OPTIONS, INTEREST, INTEREST_ORDER, SECTIONS,
} from '../../../data/sample-data';
import type { Fact, InterestKey } from '../../../data/sample-data';
import { useApp } from '../../../state/store-context';
import { FieldChip } from '../../../ui/FieldChip';
import { FieldRow } from '../../../ui/FieldRow';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';
import { Chevron, ColumnIcon, PriorityBars } from '../../../ui/icons';
import { ContactPicker } from '../../people/ContactPicker';
import { FactField, type FactRow } from './FactField';

const GroupTitle = ({ children }: { children: string }) => (
  <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--c-a8a49b)', paddingBottom: 5 }}>
    {children}
  </div>
);

export interface PropertiesSidebarProps {
  cardId: string;
  role: string;
  company: string;
  city: string;
  channel: string;
  columnIndex: number;
  updated: string;
}

/* Status, interest, contact and every recorded fact about the application. */
export function PropertiesSidebar({ cardId, role, company, city, channel, columnIndex, updated }: PropertiesSidebarProps) {
  const { st, set, contactsFor, setContacts, moveCard, logAct } = useApp();
  const locked = !!AGENT_RUNS[cardId];
  const overrides = st.factOverrides[cardId] || {};

  const baseFacts: Fact[] = DETAILS[cardId]?.facts || [
    ['Standort', city || '—'], ['Gehalt', 'nicht angegeben'], ['Erfahrung', 'nicht angegeben', 's'],
    ['Plattform', channel || '—', 's'], ['Branche', 'nicht angegeben', 's'], ['Mitarbeiterzahl', 'nicht angegeben', 's'],
    ['Karriereseite', '—', 'l'], ['Telefon', '—'], ['E-Mail', '—', 'l'],
    ['Beworben am', '—'], ['Letzter Kontakt', updated],
  ];

  // Contact details live in the contact picker above, not among the facts.
  const facts: FactRow[] = ([['Berufsbezeichnung', role], ['Firma', company]] as Fact[])
    .concat(baseFacts)
    .filter(([label]) => !label.startsWith('Kontaktperson'))
    .map(([label, value, kind]) => ({
      label,
      value: overrides[label] ?? value,
      kind,
      isSelect: kind === 's' && !!FACT_OPTIONS[label],
      isDate: !!DATE_FIELDS[label],
    }));

  const byLabel = Object.fromEntries(facts.map((f) => [f.label, f]));
  const pick = (labels: string[]) => labels.map((l) => byLabel[l]).filter(Boolean);

  const groups = SECTIONS.slice(1).map(([title, labels]) => ({ title, items: pick(labels) }));
  const grouped = new Set(SECTIONS.flatMap(([, labels]) => labels));
  const rest = facts.filter((f) => !grouped.has(f.label));
  if (rest.length) groups.push({ title: 'Weitere Angaben', items: rest });

  const col = COLUMNS[columnIndex];
  const interest = (st.priority[cardId] as InterestKey) || 'none';
  const open = st.secOpen.props !== false;

  const toggleSection = () => set((s) => {
    const m = { ...s.secOpen, props: s.secOpen.props === false };
    try { localStorage.setItem('kb-sections', JSON.stringify(m)); } catch { /* ignore */ }
    return { secOpen: m };
  });

  return (
    <div className="no-scrollbar" style={{
      width: 392, flexShrink: 0, marginLeft: 'auto', overflowY: 'auto',
      padding: '12px 22px 28px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 24,
    }}>
      <div onClick={toggleSection} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}>
        <Chevron size={10} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms ease' }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>Eigenschaften</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-a5a29a)', fontVariantNumeric: 'tabular-nums' }}>({1 + groups.length})</div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 24, flexShrink: 0,
        overflow: open ? 'visible' : 'hidden', maxHeight: open ? 'none' : 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <GroupTitle>Bewerbung</GroupTitle>

          <FieldRow label="Status" labelWidth={104} minHeight={24}>
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'status'}
                chevron
                style={{ background: col.tint }}
                onClick={() => set((s) => ({ dropdown: s.dropdown === 'status' ? null : 'status', editing: null }))}
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

          <FieldRow label="Interesse" labelWidth={104} minHeight={24}>
            <PopoverAnchor style={{ marginLeft: -6 }}>
              <FieldChip
                open={st.dropdown === 'interest'}
                gap={7}
                chevron
                onClick={() => set((s) => ({ dropdown: s.dropdown === 'interest' ? null : 'interest', editing: null }))}
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
                      onClick={() => set((s) => ({ priority: { ...s.priority, [cardId]: k }, dropdown: null }))}
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
            <div style={{ width: 104, flexShrink: 0, fontSize: 12, color: 'var(--c-9a978f)' }}>Kontaktperson</div>
            <div style={{ marginLeft: -6, minWidth: 0 }}>
              <ContactPicker
                popKey={'fact:' + cardId}
                cardId={cardId}
                company={company}
                list={contactsFor(cardId)}
                onSave={(l) => setContacts(cardId, l)}
                store="card"
                avatarSize={18}
                align="right"
              />
            </div>
          </PopoverAnchor>

          {pick(SECTIONS[0][1]).map((f) => (
            <FieldRow key={f.label} label={f.label} labelWidth={104} minHeight={24}>
              <FactField fact={f} cardId={cardId} locked={locked} />
            </FieldRow>
          ))}
        </div>

        {groups.map((g) => (
          <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <GroupTitle>{g.title}</GroupTitle>
            {g.items.map((f) => (
              <FieldRow key={f.label} label={f.label} labelWidth={104} minHeight={24}>
                <FactField fact={f} cardId={cardId} locked={locked} />
              </FieldRow>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

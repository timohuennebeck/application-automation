import { FACT_OPTIONS, URL_FIELDS } from '../../../data/config';
import { dateToISO, isoToDate, shiftYM, todayISO } from '../../../lib/date';
import { isHttpUrl } from '../../../lib/url';
import { useApp } from '../../../state/store-context';
import { CalendarPopover } from '../../../ui/Calendar';
import { FieldChip } from '../../../ui/FieldChip';
import { PopoverAnchor } from '../../../ui/Popover';
import { SelectPopover } from '../../../ui/SelectPopover';
import { LinkGlyph } from '../../../ui/icons';
import { SalaryField } from './SalaryField';

/* What the sidebar renders for one property row. Routed labels are windows
   onto application/company columns; the rest come from facts rows. */
export interface FactView {
  label: string;
  value: string;
  /* No value yet — the row shows its muted placeholder instead. */
  empty: boolean;
  /* Tints the value like a link (websites, e-mail). */
  link?: boolean;
  isSelect: boolean;
  isDate: boolean;
  /* The salary range, edited by its own pair of dropdowns. */
  isSalary: boolean;
}

/* Lists long enough that scanning them is slower than typing. */
const SEARCHABLE_FACTS = new Set(['Plattform', 'Beworben via', 'Branche']);

/* Sidebar values stay on one line — a pasted job URL would otherwise wrap
   across a dozen rows. The full value shows while editing (the input scrolls)
   and in the hover tooltip. */
const ELLIPSIS = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const;

/* Where a link value opens: web addresses as they are, e-mail addresses in
   the mail client. */
function linkTarget(value: string): string {
  return isHttpUrl(value) ? value : 'mailto:' + value;
}

/* Whether a filled link row really is one. URL rows only ever store http(s)
   addresses now, but rows written before that rule may hold plain text —
   those show as text, not as a pill that opens nowhere. */
function isLink(fact: FactView): boolean {
  if (!fact.link || fact.empty) return false;
  return URL_FIELDS.has(fact.label) ? isHttpUrl(fact.value) : true;
}

/* One editable property value: salary range, select, date picker or free text.
   Writes go through store.writeField, which routes the label to its real
   column. */
export function FactField({ fact, cardId, locked }: { fact: FactView; cardId: string; locked: boolean }) {
  const { st, set, writeField, cancelEditRef } = useApp();
  const key = 'fact:' + fact.label;
  const open = st.dropdown === key;
  const today = todayISO();

  const write = (v: string) => {
    writeField(cardId, fact.label, v);
    set({ dropdown: null });
  };
  const toggle = () => {
    if (locked) return;
    set((s) => ({ dropdown: s.dropdown === key ? null : key, editing: null }));
  };
  /* Clearing routes an empty write; role and company must never be empty, so
     those two rows offer no ✕. */
  const clearable = !fact.empty && fact.label !== 'Berufsbezeichnung' && fact.label !== 'Firma';
  const clearValue = clearable ? () => write('') : undefined;

  if (fact.isSalary) {
    return <SalaryField value={fact.value} cardId={cardId} locked={locked} />;
  }

  if (fact.isSelect) {
    return (
      <PopoverAnchor style={{ marginLeft: -6, minWidth: 0 }}>
        <FieldChip
          open={open}
          empty={fact.empty}
          locked={locked}
          chevron
          gap={5}
          onClick={toggle}
          onClear={clearValue}
          clearTitle={fact.label + ' entfernen'}
        >
          <span style={ELLIPSIS}>{fact.empty ? 'Eintrag auswählen' : fact.value}</span>
        </FieldChip>
        {open && (
          <SelectPopover
            options={FACT_OPTIONS[fact.label] || []}
            value={fact.value}
            searchable={SEARCHABLE_FACTS.has(fact.label)}
            onPick={write}
            onClose={() => set({ dropdown: null })}
          />
        )}
      </PopoverAnchor>
    );
  }

  if (fact.isDate) {
    const selISO = dateToISO(fact.value);
    const min = (selISO && selISO < today ? selISO : today).slice(0, 7);
    return (
      <PopoverAnchor style={{ marginLeft: -6, minWidth: 0 }}>
        <FieldChip
          open={open}
          empty={fact.empty}
          locked={locked}
          chevron
          gap={5}
          onClick={toggle}
          onClear={clearValue}
          clearTitle={fact.label + ' entfernen'}
        >
          <span style={ELLIPSIS}>{fact.empty ? 'Eintrag auswählen' : fact.value}</span>
        </FieldChip>
        {open && (
          <CalendarPopover
            selectedISO={selISO}
            fromYM={shiftYM(min, -12)}
            toYM={shiftYM(today.slice(0, 7), 11)}
            onPick={(iso) => write(isoToDate(iso))}
          />
        )}
      </PopoverAnchor>
    );
  }

  if (st.editing === key) {
    /* A URL row only takes a full web address. While the draft is anything
       else the input turns red and Enter does nothing; leaving the field
       drops the draft instead of storing text that is not a link. */
    const urlField = URL_FIELDS.has(fact.label);
    const draft = st.editDraft.trim();
    const invalid = urlField && !!draft && !isHttpUrl(draft);
    return (
      <input
        value={st.editDraft}
        autoFocus
        placeholder={urlField ? 'https://…' : undefined}
        title={invalid ? 'Nur vollständige Links (https://…)' : undefined}
        onChange={(e) => set({ editDraft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (!invalid) e.currentTarget.blur();
          } else if (e.key === 'Escape') {
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
          if (!invalid) writeField(cardId, fact.label, draft);
          set({ editing: null });
        }}
        /* Fills the value column instead of a fixed width, which used to run
           past the sidebar for long values. */
        style={{
          fontSize: 12.5,
          color: 'var(--c-28261f)',
          lineHeight: 1.45,
          border: '1px solid ' + (invalid ? 'var(--c-c2564c)' : 'var(--c-cfccc3)'),
          borderRadius: 5,
          padding: '1px 5px',
          marginLeft: -6,
          background: 'var(--c-fff)',
          outline: 'none',
          flex: '1 1 0',
          width: '100%',
          minWidth: 0,
        }}
      />
    );
  }

  /* A filled link row is a link: the pill opens the address (like a link chip
     in a comment), the ✕ removes it. Editing = remove and add again. */
  if (isLink(fact)) {
    return (
      <FieldChip
        link
        locked={locked}
        title={fact.value}
        style={{ marginLeft: -6 }}
        onClear={clearValue}
        clearTitle={fact.label + ' entfernen'}
        onClick={() => window.desktop?.openExternal(linkTarget(fact.value))}
      >
        <LinkGlyph />
        <span style={ELLIPSIS}>{fact.value}</span>
      </FieldChip>
    );
  }

  return (
    <FieldChip
      empty={fact.empty}
      locked={locked}
      title={fact.empty ? undefined : fact.value}
      style={{ marginLeft: -6, cursor: locked ? 'not-allowed' : 'text' }}
      onClear={clearValue}
      clearTitle={fact.label + ' entfernen'}
      onClick={() => {
        if (!locked) set({ editing: key, editDraft: fact.value, dropdown: null });
      }}
    >
      <span style={ELLIPSIS}>{fact.empty ? 'Hinzufügen' : fact.value}</span>
    </FieldChip>
  );
}

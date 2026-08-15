import type { ReactNode } from 'react';
import { FACT_OPTIONS, URL_FIELDS } from '../../../data/config';
import { dateToISO, isoToDate, shiftYM, todayISO } from '../../../lib/date';
import { isHttpUrl } from '../../../lib/url';
import { useApp } from '../../../state/store-context';
import { CalendarPopover } from '../../../ui/Calendar';
import { FieldChip } from '../../../ui/FieldChip';
import { InlineFieldInput, LinkValueChip, TextValueChip } from '../../../ui/FieldValue';
import { PopoverAnchor } from '../../../ui/Popover';
import { SelectPopover } from '../../../ui/SelectPopover';
import { ELLIPSIS } from '../../../ui/styles';
import { SalaryField } from './SalaryField';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../../../shared/domain';
import { CompanyPopover } from '../../companies/CompanyPopover';
import { LocationPopover } from './LocationPopover';
import { RolePopover } from './RolePopover';

/* What the sidebar renders for one property row. Routed labels are windows
   onto application/company columns; the rest come from facts rows. */
export interface FactView {
  label: string;
  value: string;
  /* No value yet — the row shows its muted placeholder instead. */
  empty: boolean;
  /* Tints the value like a link (websites). */
  link?: boolean;
  isSelect: boolean;
  isDate: boolean;
  /* The salary range, edited by its own pair of dropdowns. */
  isSalary: boolean;
}

/* Lists long enough that scanning them is slower than typing. */
const SEARCHABLE_FACTS = new Set(['Plattform', 'Beworben via', 'Branche']);

/* Where a link value opens: web addresses as they are, anything else (an
   e-mail address in an older LINK fact) in the mail client. */
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
  const close = () => set({ dropdown: null });
  const toggle = () => {
    if (locked) return;
    set((s) => ({ dropdown: s.dropdown === key ? null : key, editing: null }));
  };
  /* Clearing routes an empty write; role and company must never be empty, so
     those two rows offer no ✕. */
  const clearable = !fact.empty && fact.label !== 'Berufsbezeichnung' && fact.label !== 'Unternehmen';
  const clearValue = clearable ? () => write('') : undefined;

  /* The shared shell of every picker row: the anchored chip showing the value
     (or placeholder), and the popover below it while open. */
  const pickerChip = (o: {
    empty: boolean;
    placeholder: string;
    onClear: (() => void) | undefined;
    popover: ReactNode;
  }) => (
    <PopoverAnchor style={{ marginLeft: -6, minWidth: 0 }}>
      <FieldChip
        open={open}
        empty={o.empty}
        locked={locked}
        chevron
        gap={5}
        onClick={toggle}
        onClear={o.onClear}
        clearTitle={fact.label + ' entfernen'}
      >
        <span style={ELLIPSIS}>{o.empty ? o.placeholder : fact.value}</span>
      </FieldChip>
      {open && o.popover}
    </PopoverAnchor>
  );

  if (fact.isSalary) {
    return <SalaryField value={fact.value} cardId={cardId} locked={locked} />;
  }

  /* Berufsbezeichnung picks from (or adds to) the role list. A card always
     has a role, so ✕ resets it to the placeholder, which the row shows as
     empty — like Unternehmen. */
  if (fact.label === 'Berufsbezeichnung') {
    const unknown = fact.value === UNKNOWN_ROLE;
    return pickerChip({
      empty: unknown,
      placeholder: 'Berufsbezeichnung auswählen',
      onClear: unknown ? undefined : () => write(UNKNOWN_ROLE),
      popover: <RolePopover value={unknown ? '' : fact.value} onPick={write} onClose={close} />,
    });
  }

  /* Standort picks from (or adds to) the location list. */
  if (fact.label === 'Standort') {
    return pickerChip({
      empty: fact.empty,
      placeholder: 'Standort auswählen',
      onClear: clearValue,
      popover: <LocationPopover value={fact.value} onPick={write} onClose={close} />,
    });
  }

  /* Unternehmen picks from (or adds to) the company list; the write re-links the
     card, creating the company when the name is new. A card always points at
     some company, so ✕ files it under the placeholder, which the row shows
     as empty. */
  if (fact.label === 'Unternehmen') {
    const unknown = fact.value === UNKNOWN_COMPANY;
    return pickerChip({
      empty: unknown,
      placeholder: 'Unternehmen auswählen',
      onClear: unknown ? undefined : () => write(UNKNOWN_COMPANY),
      popover: <CompanyPopover value={unknown ? '' : fact.value} onPick={write} onClose={close} />,
    });
  }

  if (fact.isSelect) {
    return pickerChip({
      empty: fact.empty,
      placeholder: 'Eintrag auswählen',
      onClear: clearValue,
      popover: (
        <SelectPopover
          options={FACT_OPTIONS[fact.label] || []}
          value={fact.value}
          searchable={SEARCHABLE_FACTS.has(fact.label)}
          onPick={write}
          onClose={close}
        />
      ),
    });
  }

  if (fact.isDate) {
    const selISO = dateToISO(fact.value);
    const min = (selISO && selISO < today ? selISO : today).slice(0, 7);
    return pickerChip({
      empty: fact.empty,
      placeholder: 'Eintrag auswählen',
      onClear: clearValue,
      popover: (
        <CalendarPopover
          selectedISO={selISO}
          fromYM={shiftYM(min, -12)}
          toYM={shiftYM(today.slice(0, 7), 11)}
          onPick={(iso) => write(isoToDate(iso))}
        />
      ),
    });
  }

  if (st.editing === key) {
    /* A URL row only takes a full web address — same rule as the person
       editor's link fields; leaving the field drops an invalid draft instead
       of storing text that is not a link. */
    return (
      <InlineFieldInput
        value={st.editDraft}
        url={URL_FIELDS.has(fact.label)}
        fill
        onChange={(v) => set({ editDraft: v })}
        onEscape={(e) => {
          cancelEditRef.current = true;
          e.currentTarget.blur();
        }}
        onBlur={(invalid) => {
          if (cancelEditRef.current) {
            cancelEditRef.current = false;
            set({ editing: null });
            return;
          }
          if (!invalid) writeField(cardId, fact.label, st.editDraft.trim());
          set({ editing: null });
        }}
      />
    );
  }

  /* A filled link row is a link: the pill opens the address (like a link chip
     in a comment), the ✕ removes it. Editing = remove and add again. */
  if (isLink(fact)) {
    return (
      <LinkValueChip
        value={fact.value}
        href={linkTarget(fact.value)}
        locked={locked}
        onClear={clearValue}
        clearTitle={fact.label + ' entfernen'}
      />
    );
  }

  return (
    <TextValueChip
      value={fact.value}
      empty={fact.empty}
      locked={locked}
      onClear={clearValue}
      clearTitle={fact.label + ' entfernen'}
      onClick={() => {
        if (!locked) set({ editing: key, editDraft: fact.value, dropdown: null });
      }}
    />
  );
}

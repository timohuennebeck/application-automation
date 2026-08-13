import { FACT_OPTIONS } from '../../../data/config';
import { dateToISO, isoToDate, shiftYM, todayISO } from '../../../lib/date';
import { useApp } from '../../../state/store-context';
import { CalendarPopover } from '../../../ui/Calendar';
import { FieldChip } from '../../../ui/FieldChip';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';

/* What the sidebar renders for one property row. Routed labels are windows
   onto application/company columns; the rest come from facts rows. */
export interface FactView {
  label: string;
  value: string;
  /* Tints the value like a link (websites, e-mail). */
  link?: boolean;
  isSelect: boolean;
  isDate: boolean;
}

/* One editable property value: select, date picker or free text. Writes go
   through store.writeField, which routes the label to its real column. */
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
    if (!locked) set((s) => ({ dropdown: s.dropdown === key ? null : key, editing: null }));
  };

  if (fact.isSelect) {
    return (
      <PopoverAnchor style={{ marginLeft: -6 }}>
        <FieldChip open={open} locked={locked} gap={5} onClick={toggle}>
          <span>{fact.value}</span>
        </FieldChip>
        {open && (
          <Popover minWidth={170}>
            {(FACT_OPTIONS[fact.label] || []).map((v) => (
              <MenuItem key={v} selected={v === fact.value} onClick={() => write(v)}>
                <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{v}</span>
              </MenuItem>
            ))}
          </Popover>
        )}
      </PopoverAnchor>
    );
  }

  if (fact.isDate) {
    const selISO = dateToISO(fact.value);
    const min = (selISO && selISO < today ? selISO : today).slice(0, 7);
    return (
      <PopoverAnchor style={{ marginLeft: -6 }}>
        <FieldChip open={open} locked={locked} gap={5} onClick={toggle}>
          <span>{fact.value}</span>
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
          writeField(cardId, fact.label, st.editDraft.trim());
          set({ editing: null });
        }}
        /* Fills the value column instead of a fixed width, which used to run
           past the sidebar for long values. */
        style={{
          fontSize: 12.5,
          color: 'var(--c-28261f)',
          lineHeight: 1.45,
          border: '1px solid var(--c-cfccc3)',
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

  return (
    <FieldChip
      locked={locked}
      color={fact.link ? 'var(--c-3f6ea8)' : undefined}
      style={{ marginLeft: -6, cursor: locked ? 'not-allowed' : 'text' }}
      onClick={() => {
        if (!locked) set({ editing: key, editDraft: fact.value === '—' ? '' : fact.value, dropdown: null });
      }}
    >
      <span>{fact.value}</span>
    </FieldChip>
  );
}

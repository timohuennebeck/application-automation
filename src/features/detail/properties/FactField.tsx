import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FACT_OPTIONS } from '../../../data/config';
import { dateToISO, isoToDate, shiftYM, todayISO } from '../../../lib/date';
import { useApp } from '../../../state/store-context';
import { CalendarPopover } from '../../../ui/Calendar';
import { FieldChip } from '../../../ui/FieldChip';
import { SearchGlyph } from '../../../ui/icons';
import { MenuItem } from '../../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../../ui/Popover';
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

/* Longer lists (Branche) scroll inside the popover instead of growing past
   the bottom of the window. Matches the salary picker's list height. */
const LIST_MAX_HEIGHT = 208;
/* Never squeeze the list below a few rows, even on tiny windows. */
const LIST_MIN_HEIGHT = 64;
/* The popover's padding and border around the list. */
const POPOVER_CHROME = 10;
const VIEWPORT_MARGIN = 12;

/* Lists long enough that scanning them is slower than typing. */
const SEARCHABLE_FACTS = new Set(['Plattform', 'Beworben via', 'Branche']);

/* One editable property value: salary range, select, date picker or free text.
   Writes go through store.writeField, which routes the label to its real
   column. */
export function FactField({ fact, cardId, locked }: { fact: FactView; cardId: string; locked: boolean }) {
  const { st, set, writeField, cancelEditRef } = useApp();
  const key = 'fact:' + fact.label;
  const open = st.dropdown === key;
  const today = todayISO();

  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState({ up: false, maxHeight: LIST_MAX_HEIGHT });

  const searchable = SEARCHABLE_FACTS.has(fact.label);
  const [query, setQuery] = useState('');
  /* Row the arrow keys are on; -1 means none, Enter then takes the first. */
  const [active, setActive] = useState(-1);
  const q = query.trim().toLowerCase();
  const options = FACT_OPTIONS[fact.label] || [];
  const matches = q ? options.filter((v) => v.toLowerCase().includes(q)) : options;

  /* The sidebar reaches close to the window edge, so measure what is actually
     left below the chip; shrink the list into that space, or open it upwards
     when the room above is the larger side. Runs before paint, so the list
     never flashes in the wrong place. */
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const anchor = list?.closest('[data-dd]');
    if (!list || !anchor) return;
    const a = anchor.getBoundingClientRect();
    /* The search row sits above the list inside the popover, so it eats into
       the space the list may take. */
    const chrome = POPOVER_CHROME + (searchRef.current?.offsetHeight || 0);
    const wanted = Math.min(list.scrollHeight, LIST_MAX_HEIGHT);
    const below = window.innerHeight - a.bottom - VIEWPORT_MARGIN - chrome;
    const above = a.top - VIEWPORT_MARGIN - chrome;
    const up = below < wanted && above > below;
    setDrop({ up, maxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(wanted, up ? above : below)) });
  }, [open, fact.label]);

  useLayoutEffect(() => {
    if (!open || q) return;
    const index = (FACT_OPTIONS[fact.label] || []).indexOf(fact.value);
    if (index >= 0) listRef.current?.children[index]?.scrollIntoView({ block: 'center' });
  }, [open, drop, fact.label, fact.value, q]);

  /* Without a search input the list itself takes focus, so the arrow keys,
     Enter and Escape land somewhere. */
  useLayoutEffect(() => {
    if (open && fact.isSelect && !searchable) listRef.current?.focus();
  }, [open, fact.isSelect, searchable]);

  const write = (v: string) => {
    writeField(cardId, fact.label, v);
    set({ dropdown: null });
  };
  const toggle = () => {
    if (locked) return;
    setQuery('');
    /* Arrow keys start from the current value, like a native select. */
    setActive(options.indexOf(fact.value));
    set((s) => ({ dropdown: s.dropdown === key ? null : key, editing: null }));
  };

  /* Shared by the search input and the bare list: arrows move the highlight,
     Enter picks it, Escape closes. */
  const navKeys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      set({ dropdown: null });
    }
    if (e.key === 'Enter' && matches.length) write(matches[active] ?? matches[0]);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
      e.preventDefault();
      const next =
        e.key === 'ArrowDown'
          ? (active + 1) % matches.length
          : active <= 0
            ? matches.length - 1
            : active - 1;
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    }
  };
  const clearValue = fact.empty ? undefined : () => write('');

  if (fact.isSalary) {
    return <SalaryField value={fact.value} cardId={cardId} locked={locked} />;
  }

  if (fact.isSelect) {
    return (
      <PopoverAnchor style={{ marginLeft: -6 }}>
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
          <span>{fact.empty ? 'Eintrag auswählen' : fact.value}</span>
        </FieldChip>
        {open && (
          <Popover
            minWidth={170}
            revealOnMount
            style={drop.up ? { top: 'auto', bottom: 'calc(100% + 2px)' } : undefined}
          >
            {searchable && (
              <div
                ref={searchRef}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px 7px' }}
              >
                <SearchGlyph />
                <input
                  value={query}
                  autoFocus
                  placeholder="Suchen"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(-1);
                  }}
                  onKeyDown={navKeys}
                  style={{
                    fontSize: 12.5,
                    color: 'var(--c-28261f)',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    flex: '1 1 0',
                    minWidth: 0,
                    padding: 0,
                  }}
                />
              </div>
            )}
            <div
              ref={listRef}
              className="no-scrollbar"
              tabIndex={-1}
              onKeyDown={searchable ? undefined : navKeys}
              style={{
                maxHeight: drop.maxHeight,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                outline: 'none',
              }}
            >
              {matches.map((v, i) => (
                <MenuItem key={v} selected={v === fact.value} active={i === active} onClick={() => write(v)}>
                  <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{v}</span>
                </MenuItem>
              ))}
              {!matches.length && (
                <div style={{ fontSize: 12, color: 'var(--c-a5a29a)', padding: '4px 8px 5px' }}>
                  Keine Treffer
                </div>
              )}
            </div>
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
          <span>{fact.empty ? 'Eintrag auswählen' : fact.value}</span>
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
      empty={fact.empty}
      locked={locked}
      color={fact.link && !fact.empty ? 'var(--c-3f6ea8)' : undefined}
      style={{ marginLeft: -6, cursor: locked ? 'not-allowed' : 'text' }}
      onClick={() => {
        if (!locked) set({ editing: key, editDraft: fact.value, dropdown: null });
      }}
    >
      <span>{fact.empty ? 'Hinzufügen' : fact.value}</span>
    </FieldChip>
  );
}

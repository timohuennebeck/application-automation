/* The option list behind a FieldChip: an optional search row, arrow-key
   navigation, and a list that shrinks into the space left in the window (or
   opens upwards when the room above is larger). Extracted from the sidebar's
   FactField so every select in the app behaves the same — the create dialog's
   Plattform picker included. The caller owns the open/closed state (usually
   AppState.dropdown, which the global outside-click handler clears). */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DashedPlus } from './AddRow';
import { MenuItem } from './MenuItem';
import { Popover } from './Popover';
import { SearchRow, cycleActive } from './SearchRow';
import { ELLIPSIS } from './styles';

/* Longer lists (Branche) scroll inside the popover instead of growing past
   the bottom of the window. Matches the salary picker's list height. */
const LIST_MAX_HEIGHT = 208;
/* Never squeeze the list below a few rows, even on tiny windows. */
const LIST_MIN_HEIGHT = 64;
/* The popover's padding and border around the list. */
const POPOVER_CHROME = 10;
const VIEWPORT_MARGIN = 12;
/* An intrinsically sized popover grows as wide as its longest option, and a
   long Berufsbezeichnung would push it out of the sidebar (and the window).
   Capped instead; the rows ellipsize inside it. */
const MAX_WIDTH = 'min(320px, calc(100vw - 24px))';

interface SelectPopoverProps {
  options: string[];
  /* The current selection; '' when nothing is picked yet. */
  value: string;
  /* Shows the search row — for lists long enough that scanning them is
     slower than typing. */
  searchable?: boolean;
  onPick(value: string): void;
  onClose(): void;
  minWidth?: number;
  top?: number;
  /* Forces the list above the chip instead of measuring for it — for chips in
     a dialog's bottom row, where the room below is outside the dialog. */
  openUp?: boolean;
  zIndex?: number;
  /* Row content for one option; plain text when omitted. */
  renderRow?(value: string): ReactNode;
  /* Typing something the list lacks offers a „…“ neu anlegen row (like a
     Linear label): picking it hands the typed text to onPick. Needs
     `searchable`. */
  creatable?: boolean;
}

/* The horizontal extent a popover must stay within: the closest ancestor that
   clips or scrolls its overflow, or the window when nothing does. */
function scrollBounds(el: Element): { left: number; right: number } {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }
  }
  return { left: 0, right: window.innerWidth };
}

export function SelectPopover({
  options,
  value,
  searchable,
  onPick,
  onClose,
  minWidth = 170,
  top,
  openUp,
  zIndex,
  renderRow,
  creatable,
}: SelectPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState({ up: !!openUp, maxHeight: LIST_MAX_HEIGHT, left: 0 });

  const [query, setQuery] = useState('');
  /* Row the arrow keys are on; they start from the current value, like a
     native select. -1 means none, Enter then takes the first match. */
  const [active, setActive] = useState(() => options.indexOf(value));
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((v) => v.toLowerCase().includes(q)) : options;
  /* The create row shows once the typed text is not already an option. */
  const draft = query.trim();
  const createRow = !!creatable && !!draft && !options.some((v) => v.toLowerCase() === q);
  const rows = matches.length + (createRow ? 1 : 0);
  const pickRow = (i: number) => {
    if (i < matches.length) onPick(matches[i]);
    else if (createRow) onPick(draft);
  };

  /* Measure what is actually left below the chip; shrink the list into that
     space, or open it upwards when the room above is the larger side. Runs
     before paint, so the list never flashes in the wrong place. */
  useLayoutEffect(() => {
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
    const up = openUp ?? (below < wanted && above > below);
    /* The list is wider than its chip and hangs off the chip's left edge, so
       a chip near the right of its surface would push it out. The boundary is
       the nearest scrolling ancestor, not the window: the sidebar clips at
       its own edge (and would scroll sideways to the overhang rather than
       show it). Slide the list left by exactly the overhang, never past the
       boundary's left edge. */
    const bounds = scrollBounds(anchor);
    const p = popRef.current?.getBoundingClientRect();
    const overhang = p ? p.right - (bounds.right - VIEWPORT_MARGIN) : 0;
    const left = p ? -Math.max(0, Math.min(overhang, p.left - bounds.left - VIEWPORT_MARGIN)) : 0;
    setDrop({ up, maxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(wanted, up ? above : below)), left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Bring the current value into view once the list has its final height —
     and only then. Re-running on later renders (a parent re-rendering while
     the user scrolls) would yank the list back to the selection. */
  useLayoutEffect(() => {
    const index = options.indexOf(value);
    if (index >= 0) listRef.current?.children[index]?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  /* Without a search input the list itself takes focus, so the arrow keys,
     Enter and Escape land somewhere. */
  useLayoutEffect(() => {
    if (!searchable) listRef.current?.focus();
  }, [searchable]);

  /* Shared by the search input and the bare list: arrows move the highlight,
     Enter picks it, Escape closes. */
  const navKeys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'Enter' && rows) pickRow(active >= 0 && active < rows ? active : 0);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows) {
      e.preventDefault();
      const next = cycleActive(active, rows, e.key);
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <Popover
      ref={popRef}
      minWidth={minWidth}
      top={top}
      left={drop.left}
      up={drop.up}
      zIndex={zIndex}
      revealOnMount
      style={{ maxWidth: MAX_WIDTH }}
    >
      {searchable && (
        <SearchRow
          containerRef={searchRef}
          value={query}
          placeholder="Suchen"
          onChange={(v) => {
            setQuery(v);
            setActive(-1);
          }}
          onKeyDown={navKeys}
        />
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
          <MenuItem key={v} selected={v === value} active={i === active} onClick={() => onPick(v)}>
            {renderRow ? renderRow(v) : <span style={{ flex: '1 1 auto', ...ELLIPSIS }}>{v}</span>}
          </MenuItem>
        ))}
        {createRow && (
          <MenuItem
            active={active === matches.length}
            onClick={() => onPick(draft)}
            style={{ color: 'var(--c-8b8880)' }}
          >
            <DashedPlus size={20} />
            <span>„{draft}“ neu anlegen</span>
          </MenuItem>
        )}
        {!rows && (
          <div style={{ fontSize: 12, color: 'var(--c-a5a29a)', padding: '4px 8px 5px' }}>Keine Treffer</div>
        )}
      </div>
    </Popover>
  );
}

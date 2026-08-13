import { INTEREST, INTEREST_ORDER, SortDir, SortKey, SORT_OPTIONS } from '../../data/config';
import { activeFilterCount, isSorted } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import type { BoardFilter } from '../../state/store-context';
import { EMPTY_FILTER } from '../../state/store';
import { ChipToggle } from '../../ui/ChipToggle';
import { MenuItem, MenuLabel } from '../../ui/MenuItem';
import { Popover, PopoverAnchor, PopoverVariant } from '../../ui/Popover';
import { Chevron, FilterGlyph } from '../../ui/icons';

const DROPDOWN_KEY = 'boardfilter';

/* Sort and filter for the whole board, in the top right of the shell. Both are
   a view over the stored order — nothing here is written to the database. */
export function BoardFilterBar() {
  const { st, set } = useApp();
  const filter = st.boardFilter;
  const open = st.dropdown === DROPDOWN_KEY;
  const count = activeFilterCount(st);

  const patch = (p: Partial<BoardFilter>) => set((s) => ({ boardFilter: { ...s.boardFilter, ...p } }));

  /* Picking a key adopts the direction that reads as "best first"; picking the
     same key again flips it. */
  const pickSort = (key: SortKey, preferred: SortDir) =>
    patch(
      key === filter.sort && key !== SortKey.NONE
        ? { dir: filter.dir === SortDir.ASC ? SortDir.DESC : SortDir.ASC }
        : { sort: key, dir: preferred },
    );

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const label = isSorted(st)
    ? (SORT_OPTIONS.find(([key]) => key === filter.sort)?.[1] ?? 'Sortiert')
    : 'Filtern';

  return (
    <PopoverAnchor style={{ marginLeft: 'auto', flexShrink: 0 }}>
      <div
        className="top-btn no-drag"
        title="Filtern und sortieren"
        onClick={() =>
          set((s) => ({ dropdown: s.dropdown === DROPDOWN_KEY ? null : DROPDOWN_KEY, editing: null }))
        }
        style={{
          background: open ? 'var(--s-14)' : undefined,
          color: open || count || isSorted(st) ? 'var(--c-1b1a17)' : undefined,
        }}
      >
        <FilterGlyph />
        <div>{label}</div>
        {count > 0 && (
          <div
            style={{
              background: 'var(--c-1b1a17)',
              color: 'var(--c-fff)',
              borderRadius: 999,
              fontSize: 9.5,
              fontWeight: 600,
              padding: '0 5px',
              lineHeight: 1.5,
            }}
          >
            {count}
          </div>
        )}
        <Chevron size={9} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </div>

      {open && (
        <Popover
          variant={PopoverVariant.PANEL}
          top={30}
          right={0}
          width={276}
          zIndex={50}
          style={{ maxWidth: 'calc(100vw - 32px)' }}
        >
          <MenuLabel>Sortieren</MenuLabel>
          {SORT_OPTIONS.map(([key, text, preferred]) => (
            <MenuItem key={key} selected={key === filter.sort} onClick={() => pickSort(key, preferred)}>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>{text}</span>
              {key === filter.sort && key !== SortKey.NONE && (
                <span style={{ fontSize: 11, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>
                  {filter.dir === SortDir.ASC ? 'aufsteigend' : 'absteigend'}
                </span>
              )}
            </MenuItem>
          ))}

          <MenuLabel style={{ paddingTop: 8 }}>Interesse</MenuLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '2px 8px 4px' }}>
            {INTEREST_ORDER.map((key) => (
              <ChipToggle
                key={key}
                size="sm"
                label={INTEREST[key][0]}
                selected={filter.interests.includes(key)}
                onClick={() => patch({ interests: toggle(filter.interests, key) })}
              />
            ))}
          </div>

          {/* fit-content so the hover tint hugs the label instead of the panel. */}
          {(count > 0 || isSorted(st)) && (
            <MenuItem
              style={{ marginTop: 6, width: 'fit-content', color: 'var(--c-8b8880)' }}
              onClick={() => patch(EMPTY_FILTER)}
            >
              Filter zurücksetzen
            </MenuItem>
          )}
        </Popover>
      )}
    </PopoverAnchor>
  );
}

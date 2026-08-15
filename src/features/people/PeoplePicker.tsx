import { useRef, useState } from 'react';
import { DashedPlus } from '../../ui/AddRow';
import { MenuItem, MenuLabel } from '../../ui/MenuItem';
import { Avatar, PencilGlyph, SearchGlyph } from '../../ui/icons';
import type { PersonView } from '../../state/db-view';

export type Suggestion = PersonView & { key: string; initials: string };

/* Search field + "known at <company>" suggestions + a create row.
   Shared by the interview participant picker and both contact pickers. */
export function PeoplePicker({
  draft,
  onDraftChange,
  company,
  people,
  isSelected,
  onToggle,
  onEdit,
  onCreate,
  onClose,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  company: string;
  people: Suggestion[];
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
  /* Opens the person's editor. Omitted where a picker only picks. */
  onEdit?: (key: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const q = draft.trim().toLowerCase();
  const matches = people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 8);

  const listRef = useRef<HTMLDivElement>(null);
  /* Row the arrow keys are on; -1 means none, Enter then takes the first.
     The create row sits one past the last match. */
  const [active, setActive] = useState(-1);
  const rows = matches.length + 1;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px 7px' }}>
        <SearchGlyph />
        <input
          value={draft}
          autoFocus
          placeholder="Person suchen"
          onChange={(e) => {
            onDraftChange(e.target.value);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
            if (e.key === 'Enter') {
              if (active >= 0 && active < matches.length) onToggle(matches[active].key);
              else if (active === matches.length) onCreate(draft.trim());
              else if (matches.length) onToggle(matches[0].key);
              else if (q) onCreate(draft.trim());
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const next = e.key === 'ArrowDown' ? (active + 1) % rows : active <= 0 ? rows - 1 : active - 1;
              setActive(next);
              listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
            }
          }}
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
      <MenuLabel>Bei {company} bekannt</MenuLabel>
      <div
        ref={listRef}
        className="no-scrollbar"
        style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {matches.map((p, i) => {
          const sel = isSelected(p.key);
          return (
            <MenuItem key={p.key} selected={sel} active={i === active} onClick={() => onToggle(p.key)}>
              <Avatar bg={p.bg} size={20} fontSize={8.5}>
                {p.initials}
              </Avatar>
              <div
                style={{
                  fontWeight: sel ? 600 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--c-a5a29a)',
                  marginLeft: 'auto',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '44%',
                }}
              >
                {p.role}
              </div>
              {/* stopPropagation, or editing would also toggle the row. */}
              {onEdit && (
                <span
                  className="row-edit"
                  role="button"
                  tabIndex={0}
                  title="Person bearbeiten"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(p.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(p.key);
                  }}
                >
                  <PencilGlyph />
                </span>
              )}
            </MenuItem>
          );
        })}
        <MenuItem
          active={active === matches.length}
          onClick={() => onCreate(draft.trim())}
          style={{ color: 'var(--c-8b8880)' }}
        >
          <DashedPlus size={20} />
          <span>{q ? '„' + draft.trim() + '“ neu anlegen' : 'Person hinzufügen'}</span>
        </MenuItem>
      </div>
    </>
  );
}

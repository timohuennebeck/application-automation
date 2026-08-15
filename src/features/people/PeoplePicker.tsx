import { Fragment, useRef, useState } from 'react';
import { DashedPlus } from '../../ui/AddRow';
import { MenuItem, MenuLabel } from '../../ui/MenuItem';
import { SearchRow, cycleActive } from '../../ui/SearchRow';
import { Avatar, PencilGlyph } from '../../ui/icons';
import { UNKNOWN_COMPANY } from '../../shared/domain';
import type { PersonSuggestion } from '../../state/store-context';

/* Search field, the people known at the card's company, everyone else under
   "Weitere Personen", and a create row. Shared by the interview participant
   picker and both contact pickers. */
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
  people: PersonSuggestion[];
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
  /* Opens the person's editor. Omitted where a picker only picks. */
  onEdit?: (key: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const q = draft.trim().toLowerCase();
  const matches = people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 12);
  /* peopleForCard already sorts the known ones first, so the section break is
     the first row that is not. */
  const firstOther = matches.findIndex((p) => !p.known);
  /* A card at the placeholder company has no name to head the section with. */
  const knownLabel = company && company !== UNKNOWN_COMPANY ? `Bei ${company}` : 'Bei dieser Bewerbung';

  const listRef = useRef<HTMLDivElement>(null);
  /* Row the arrow keys are on; -1 means none, Enter then takes the first.
     The create row sits one past the last match. */
  const [active, setActive] = useState(-1);
  const rows = matches.length + 1;

  return (
    <>
      <SearchRow
        value={draft}
        placeholder="Person suchen"
        onChange={(v) => {
          onDraftChange(v);
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
            const next = cycleActive(active, rows, e.key);
            setActive(next);
            /* Rows by class, not by child index — the section labels sit
               between them. */
            listRef.current?.querySelectorAll('.menu-item')[next]?.scrollIntoView({ block: 'nearest' });
          }
        }}
      />
      <div
        ref={listRef}
        className="no-scrollbar"
        style={{ maxHeight: 208, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {matches.map((p, i) => {
          const sel = isSelected(p.key);
          const label = i === 0 && p.known ? knownLabel : i === firstOther ? 'Weitere Personen' : null;
          return (
            <Fragment key={p.key}>
              {label && <MenuLabel>{label}</MenuLabel>}
              <MenuItem selected={sel} active={i === active} onClick={() => onToggle(p.key)}>
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
                {/* Known people show their position; the rest, where they work. */}
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
                  {p.known ? p.role : p.company || p.role}
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
            </Fragment>
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

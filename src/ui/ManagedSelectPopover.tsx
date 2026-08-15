import type { MouseEvent, KeyboardEvent } from 'react';
import { SelectPopover } from './SelectPopover';
import { TrashGlyph } from './icons';
import { ELLIPSIS } from './styles';

/* A select over a list the user curates in place — companies, locations:
   searchable, a „…“ neu anlegen row for a name the list lacks (the caller
   creates it on pick), and a trash on the entries nothing uses any more. */
export function ManagedSelectPopover({
  options,
  value,
  removable,
  removeTitle,
  onRemove,
  onPick,
  onClose,
  minWidth,
}: {
  options: string[];
  value: string;
  /* Which entries may be removed — the ones no record points at. */
  removable: (name: string) => boolean;
  removeTitle: string;
  onRemove: (name: string) => void;
  onPick: (name: string) => void;
  onClose: () => void;
  minWidth?: number;
}) {
  const remove = (e: MouseEvent | KeyboardEvent, name: string) => {
    /* stopPropagation, or removing would also pick the row. */
    e.stopPropagation();
    onRemove(name);
  };
  return (
    <SelectPopover
      options={options}
      value={value}
      searchable
      creatable
      minWidth={minWidth}
      onPick={onPick}
      onClose={onClose}
      renderRow={(name) => (
        <>
          <span style={{ flex: '1 1 auto', ...ELLIPSIS }}>{name}</span>
          {removable(name) && (
            <span
              className="row-edit"
              role="button"
              tabIndex={0}
              title={removeTitle}
              onClick={(e) => remove(e, name)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                remove(e, name);
              }}
            >
              <TrashGlyph />
            </span>
          )}
        </>
      )}
    />
  );
}

import { useMemo } from 'react';
import { usedLocations } from '../../../state/selectors';
import { useApp } from '../../../state/store-context';
import { ManagedSelectPopover } from '../../../ui/ManagedSelectPopover';

/* The Standort dropdown: every location any card was filed under; a new name
   joins the list on write; the ones no card uses any more can be removed. */
export function LocationPopover({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const { st, deleteLocation } = useApp();
  const options = useMemo(() => [...st.locations].sort((a, b) => a.localeCompare(b, 'de')), [st.locations]);
  const used = useMemo(() => usedLocations(st), [st.factsByApp]);
  return (
    <ManagedSelectPopover
      options={options}
      value={value}
      removable={(name) => !used.has(name)}
      removeTitle="Standort löschen – keine Bewerbung verwendet ihn"
      onRemove={deleteLocation}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

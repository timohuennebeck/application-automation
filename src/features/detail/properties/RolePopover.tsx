import { useMemo } from 'react';
import { UNKNOWN_ROLE } from '../../../shared/domain';
import { usedRoles } from '../../../state/selectors';
import { useApp } from '../../../state/store-context';
import { ManagedSelectPopover } from '../../../ui/ManagedSelectPopover';

/* The Berufsbezeichnung dropdown, for a card's role and a person's alike:
   every role either was ever given; a new name joins the list on write; the
   ones nothing carries any more can be removed. */
export function RolePopover({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const { st, deleteRole } = useApp();
  /* The placeholder of a card without a role is not one anyone picks. */
  const options = useMemo(
    () => st.roles.filter((r) => r !== UNKNOWN_ROLE).sort((a, b) => a.localeCompare(b, 'de')),
    [st.roles],
  );
  const used = useMemo(() => usedRoles(st), [st.applications, st.people]);
  return (
    <ManagedSelectPopover
      options={options}
      value={value}
      removable={(name) => !used.has(name)}
      removeTitle="Berufsbezeichnung löschen – wird nirgends verwendet"
      onRemove={deleteRole}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

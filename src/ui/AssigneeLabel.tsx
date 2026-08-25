import { Assignee } from '../shared/enums';
import { Avatar, KeplerAvatar } from './icons';

/* Avatar + name for every Bearbeiter control: the sidebar's chip and menu, and
   the create dialog's bottom row. The empty wording differs between the two —
   a labelled sidebar row can spell the field out, a bare chip cannot — so the
   caller names the empty state. */
export function AssigneeLabel({
  assignee,
  emptyLabel = 'Kein Bearbeiter ausgewählt',
}: {
  assignee: Assignee | null;
  emptyLabel?: string;
}) {
  return (
    <>
      {assignee === Assignee.KEPLER ? (
        <KeplerAvatar size={16} fontSize={8} />
      ) : (
        <Avatar bg="var(--c-b3b0a8)" size={16}>
          –
        </Avatar>
      )}
      <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>
        {assignee === Assignee.KEPLER ? 'Kepler' : emptyLabel}
      </span>
    </>
  );
}

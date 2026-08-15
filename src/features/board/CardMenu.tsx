import { Assignee } from '../../shared/enums';
import { keplerHoldReason } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { KeplerAvatar } from '../../ui/icons';
import { MenuItem, MenuLabel } from '../../ui/MenuItem';
import { Popover } from '../../ui/Popover';

/* The menu sizes to its longest row ("Kepler als Bearbeiter entfernen" is
   the widest); MIN_WIDTH keeps the short variant from looking cramped and
   MAX_WIDTH is the budget used to keep it inside the window on the right. */
const MIN_WIDTH = 196;
const MAX_WIDTH = 260;
/* Height of the menu box, used to keep it inside the window near the bottom. */
const HEIGHT = 92;
const EDGE = 8;

/* Right-click menu for a board card. Positioned at the cursor in viewport
   coordinates, so it is rendered at the shell level rather than in the column. */
export function CardMenu() {
  const { st, set, deleteCard, setAssignee } = useApp();
  const menu = st.cardMenu;
  if (!menu) return null;

  const app = st.applications[menu.id];
  const role = app?.role;
  const assigned = app?.assignee === Assignee.KEPLER;
  const hold = keplerHoldReason(st, menu.id);
  const left = Math.max(EDGE, Math.min(menu.x, window.innerWidth - MAX_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(menu.y, window.innerHeight - HEIGHT - EDGE));

  return (
    <div data-dd="1">
      <Popover
        top={top}
        left={left}
        width="max-content"
        zIndex={60}
        style={{ position: 'fixed', minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
      >
        <MenuLabel>{role || menu.id}</MenuLabel>
        <MenuItem
          style={{ whiteSpace: 'nowrap' }}
          disabled={!!hold}
          title={hold ?? undefined}
          onClick={() => {
            if (hold) return;
            setAssignee(menu.id, assigned ? null : Assignee.KEPLER);
            set({ cardMenu: null });
          }}
        >
          <KeplerAvatar size={16} fontSize={8} />
          <span>{assigned ? 'Kepler als Bearbeiter entfernen' : 'Kepler als Bearbeiter'}</span>
        </MenuItem>
        <MenuItem danger style={{ whiteSpace: 'nowrap' }} onClick={() => deleteCard(menu.id)}>
          Bewerbung löschen
        </MenuItem>
      </Popover>
    </div>
  );
}

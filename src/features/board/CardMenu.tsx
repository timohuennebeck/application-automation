import { useApp } from '../../state/store-context';
import { MenuItem, MenuLabel } from '../../ui/MenuItem';
import { Popover } from '../../ui/Popover';

const WIDTH = 196;
/* Height of the menu box, used to keep it inside the window near the bottom. */
const HEIGHT = 62;
const EDGE = 8;

/* Right-click menu for a board card. Positioned at the cursor in viewport
   coordinates, so it is rendered at the shell level rather than in the column. */
export function CardMenu() {
  const { st, deleteCard } = useApp();
  const menu = st.cardMenu;
  if (!menu) return null;

  const role = st.applications[menu.id]?.role;
  const left = Math.max(EDGE, Math.min(menu.x, window.innerWidth - WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(menu.y, window.innerHeight - HEIGHT - EDGE));

  return (
    <div data-dd="1">
      <Popover top={top} left={left} width={WIDTH} zIndex={60} style={{ position: 'fixed' }}>
        <MenuLabel>{role || menu.id}</MenuLabel>
        <MenuItem danger style={{ whiteSpace: 'nowrap' }} onClick={() => deleteCard(menu.id)}>
          Bewerbung löschen
        </MenuItem>
      </Popover>
    </div>
  );
}

/* The "…" menu on a document card. The dots toggle one AppState.dropdown
   key (so the global outside-click handler closes it like every menu), the
   popover carries the caller's rows. The document cards of the detail view,
   the template slots and the profile documents all render this — one
   component keeps the three menus mirrored by construction.
   stopPropagation throughout, or the card's own click would fire behind
   the menu. */
import type { ReactNode } from 'react';
import { useApp } from '../state/store-context';
import { MenuItem, MenuSize } from './MenuItem';
import { Popover, PopoverAnchor } from './Popover';
import { DotsGlyph } from './icons';

export function DotsMenu({
  menuKey,
  flipUp,
  minWidth = 196,
  onOpen,
  children,
}: {
  menuKey: string;
  /* The dialog body scrolls; the last card's menu opens upwards rather than
     off the bottom edge. */
  flipUp?: boolean;
  minWidth?: number;
  /* Runs on every toggle click — the callers clear their error line here. */
  onOpen?: () => void;
  children: ReactNode;
}) {
  const { st, set } = useApp();
  return (
    <PopoverAnchor>
      <div
        className="doc-dl"
        title="Mehr"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
          set((s) => ({ dropdown: s.dropdown === menuKey ? null : menuKey }));
        }}
      >
        <DotsGlyph />
      </div>
      {st.dropdown === menuKey && (
        <div onClick={(e) => e.stopPropagation()}>
          <Popover
            top={32}
            right={0}
            minWidth={minWidth}
            style={flipUp ? { top: 'auto', bottom: 32 } : undefined}
          >
            {children}
          </Popover>
        </div>
      )}
    </PopoverAnchor>
  );
}

/* A download row: what it fetches on the left, the file's size on the right. */
export function DownloadItem({
  label,
  bytes,
  onClick,
}: {
  label: string;
  bytes?: number | null;
  onClick: () => void;
}) {
  return (
    <MenuItem onClick={onClick}>
      <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>{label}</span>
      <MenuSize bytes={bytes} />
    </MenuItem>
  );
}

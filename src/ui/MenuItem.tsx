import type { CSSProperties, ReactNode } from 'react';
import { Check } from './icons';

export interface MenuItemProps {
  onClick?: () => void;
  onMouseDown?: () => void;
  /* Shows the trailing checkmark and the selected row tint. */
  selected?: boolean;
  /* Suppresses the checkmark while keeping the selected tint. */
  hideCheck?: boolean;
  danger?: boolean;
  dim?: number;
  style?: CSSProperties;
  children: ReactNode;
}

export function MenuItem({
  onClick,
  onMouseDown,
  selected,
  hideCheck,
  danger,
  dim,
  style,
  children,
}: MenuItemProps) {
  return (
    <div
      /* The selected tint is a class, not an inline style: an inline background
         would outrank the :hover rule and swallow the hover feedback. */
      className={'menu-item' + (selected ? ' menu-item-selected' : '') + (danger ? ' menu-item-danger' : '')}
      onClick={onClick}
      onMouseDown={onMouseDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12.5,
        color: danger ? 'var(--c-c2564c)' : 'var(--c-28261f)',
        padding: '5px 8px',
        opacity: dim,
        ...style,
      }}
    >
      {children}
      {selected && !hideCheck && <Check />}
    </div>
  );
}

/* Uppercase group label inside a menu or a properties group. */
export function MenuLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--c-a8a49b)',
        padding: '3px 8px 4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

import type { CSSProperties, ReactNode } from 'react';
import { formatBytes } from '../lib/bytes';
import { Check } from './icons';

interface MenuItemProps {
  onClick?: () => void;
  onMouseDown?: () => void;
  /* Shows the trailing checkmark and the selected row tint. */
  selected?: boolean;
  /* Keyboard highlight: the row the arrow keys are on, picked by Enter. */
  active?: boolean;
  /* Suppresses the checkmark while keeping the selected tint. */
  hideCheck?: boolean;
  /* Not available right now: dimmed, no hover tint, not-allowed cursor; the
     click still fires so the caller can explain (title) or ignore it. */
  disabled?: boolean;
  danger?: boolean;
  dim?: number;
  /* Native tooltip for rows whose action needs a caveat. */
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function MenuItem({
  onClick,
  onMouseDown,
  selected,
  active,
  hideCheck,
  disabled,
  danger,
  dim,
  title,
  style,
  children,
}: MenuItemProps) {
  return (
    <div
      /* The selected tint is a class, not an inline style: an inline background
         would outrank the :hover rule and swallow the hover feedback. */
      className={
        'menu-item' +
        (selected ? ' menu-item-selected' : '') +
        (active ? ' menu-item-active' : '') +
        (danger ? ' menu-item-danger' : '') +
        (disabled ? ' menu-item-disabled' : '')
      }
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12.5,
        color: danger ? 'var(--c-c2564c)' : 'var(--c-28261f)',
        padding: '5px 8px',
        opacity: dim ?? (disabled ? 0.45 : undefined),
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

/* The file size beside a download entry, left out entirely when the file is
   not there to be measured. */
export function MenuSize({ bytes }: { bytes?: number | null }) {
  const text = formatBytes(bytes ?? null);
  if (!text) return null;
  return (
    <span
      style={{
        fontSize: 11.5,
        color: 'var(--c-a5a29a)',
        /* One piece, pushed to the trailing edge — the label gives way, not
           the number ("25,4" over "KB"). */
        flex: 'none',
        marginLeft: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

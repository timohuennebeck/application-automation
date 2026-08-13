import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Chevron } from './icons';

export interface FieldChipProps {
  /* Renders in the darker "open" tone while its popover is showing. */
  open?: boolean;
  /* Renders muted when the value is a placeholder rather than real content. */
  empty?: boolean;
  /* Greyed out and non-interactive (e.g. while the agent owns the record). */
  locked?: boolean;
  chevron?: boolean;
  onClick?: () => void;
  onClear?: () => void;
  clearTitle?: string;
  title?: string;
  color?: string;
  gap?: number;
  style?: CSSProperties;
  children: ReactNode;
}

/* The grey pill used for every inline-editable value in the detail view:
   dates, times, locations, links, status, contacts. */
export function FieldChip({
  open, empty, locked, chevron, onClick, onClear, clearTitle,
  title, color, gap = 6, style, children,
}: FieldChipProps) {
  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    onClear?.();
  };
  return (
    <div
      className={locked ? 'chip-locked' : open ? 'chip chip-open' : 'chip'}
      title={title}
      onClick={locked ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap,
        fontSize: 12.5,
        lineHeight: 1.45,
        color: color ?? (empty ? 'var(--c-a5a29a)' : 'var(--c-28261f)'),
        borderRadius: 5,
        padding: '2px 6px',
        cursor: locked ? 'not-allowed' : 'pointer',
        /* Long values (career URLs, e-mail addresses) wrap inside the pill
           rather than running past the column they sit in. */
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        /* Chromium sizes an intrinsic width against the border box, so with the
           app-wide border-box default the padding is subtracted from the pill
           instead of added to it and the last child sits flush on the edge. */
        boxSizing: 'content-box',
        width: 'fit-content',
        maxWidth: '100%',
        minWidth: 0,
        ...style,
      }}
    >
      {children}
      {onClear && (
        <span className="chip-clear" title={clearTitle} onClick={clear} style={{ flexShrink: 0 }}>
          ✕
        </span>
      )}
      {chevron && <Chevron />}
    </div>
  );
}

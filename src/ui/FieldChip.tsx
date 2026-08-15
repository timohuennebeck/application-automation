import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Chevron } from './icons';

interface FieldChipProps {
  /* Renders in the darker "open" tone while its popover is showing. */
  open?: boolean;
  /* Renders muted when the value is a placeholder rather than real content. */
  empty?: boolean;
  /* Greyed out and non-interactive (e.g. while the agent owns the record). */
  locked?: boolean;
  chevron?: boolean;
  /* Blue "this opens somewhere" pill (Slack-style link) instead of the grey
     editable one; the click is expected to open the value, not edit it. */
  link?: boolean;
  /* Background of the chip's own colour (a stage tint); hover/open shade it. */
  tint?: string;
  onClick?: () => void;
  /* Empties the field. On a dropdown (chevron) the ✕ takes the chevron's place
     while the pill is hovered; elsewhere it sits after the value. Leave it off
     when the field has nothing to clear — the chevron then stays put. */
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
  open,
  empty,
  locked,
  chevron,
  link,
  tint,
  onClick,
  onClear,
  clearTitle,
  title,
  color,
  gap = 6,
  style,
  children,
}: FieldChipProps) {
  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    onClear?.();
  };
  /* A locked chip is the agent's to change, so it offers no ✕ either. */
  const clearable = !!onClear && !locked;
  const clearGlyph = (
    <span className="chip-clear" title={clearTitle} onClick={clear} style={{ flexShrink: 0 }}>
      ✕
    </span>
  );
  return (
    <div
      className={[
        locked ? 'chip-locked' : 'chip',
        !locked && link && 'chip-link',
        !locked && tint && 'chip-tinted',
        !locked && open && 'chip-open',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
      onClick={locked ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap,
        fontSize: 12.5,
        lineHeight: 1.45,
        color: color ?? (link ? 'var(--c-3f6ea8)' : empty ? 'var(--c-a5a29a)' : 'var(--c-28261f)'),
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
        ...(tint ? ({ '--chip-tint': tint } as CSSProperties) : null),
        ...style,
      }}
    >
      {children}
      {clearable && chevron ? (
        /* Both glyphs share one trailing slot, so the pill keeps its width
           whichever of them is showing. */
        <span className="chip-swap">
          <Chevron className="chip-chevron" />
          {clearGlyph}
        </span>
      ) : (
        <>
          {clearable && clearGlyph}
          {chevron && <Chevron />}
        </>
      )}
    </div>
  );
}

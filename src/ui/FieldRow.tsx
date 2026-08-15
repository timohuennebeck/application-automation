import type { CSSProperties, ReactNode } from 'react';

interface FieldRowProps {
  label: ReactNode;
  /* A small glyph in front of the label (the properties sidebar). */
  glyph?: ReactNode;
  /* Label column width — 76px inside cards, 104px in the properties sidebar. */
  labelWidth?: number;
  align?: CSSProperties['alignItems'];
  minHeight?: number;
  /* Pulls the value's chip padding back so text lines up with the label baseline. */
  inset?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/* A label column followed by its value. Used by the interview card, the
   follow-up email card and the properties sidebar. */
export function FieldRow({
  label,
  glyph,
  labelWidth = 76,
  align = 'center',
  minHeight,
  inset,
  style,
  children,
}: FieldRowProps) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: align, minHeight, minWidth: 0, ...style }}>
      {/* Labels wrap rather than truncate: a clipped "Berufsbezeich…" hides
          which field the row belongs to, and fact labels are free text. */}
      <div
        style={{
          width: labelWidth,
          flexShrink: 0,
          fontSize: 12,
          color: 'var(--c-a5a29a)',
          lineHeight: 1.35,
          overflowWrap: 'break-word',
          ...(glyph ? { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } : null),
        }}
      >
        {glyph}
        {glyph ? <span style={{ minWidth: 0 }}>{label}</span> : label}
      </div>
      {inset ? <div style={{ marginLeft: -6, minWidth: 0 }}>{children}</div> : children}
    </div>
  );
}

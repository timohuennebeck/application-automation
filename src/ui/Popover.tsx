import type { CSSProperties, ReactNode } from 'react';

/* Floating surfaces come in two flavours in the design:
   - "menu": a compact option list (8px radius, tight padding, softer shadow)
   - "panel": a richer editor surface (10px radius, deeper shadow) */
export const PopoverVariant = {
  MENU: 'MENU',
  PANEL: 'PANEL',
} as const;
export type PopoverVariant = (typeof PopoverVariant)[keyof typeof PopoverVariant];

const VARIANT: Record<PopoverVariant, CSSProperties> = {
  [PopoverVariant.MENU]: { borderRadius: 8, padding: 4, boxShadow: '0 10px 28px var(--s-0)' },
  [PopoverVariant.PANEL]: { borderRadius: 10, padding: 5, boxShadow: '0 14px 34px var(--s-1)' },
};

export interface PopoverProps {
  variant?: PopoverVariant;
  top?: number;
  left?: number;
  right?: number;
  width?: number | string;
  minWidth?: number;
  zIndex?: number;
  /* Stack children in a column with the 1px gutter menus use. */
  stack?: boolean;
  padding?: number | string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Popover({
  variant = PopoverVariant.MENU,
  top = 26,
  left,
  right,
  width,
  minWidth,
  zIndex = 40,
  stack = true,
  padding,
  style,
  children,
}: PopoverProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top,
        ...(right !== undefined ? { right } : { left: left ?? 0 }),
        zIndex,
        background: 'var(--c-fff)',
        border: '1px solid var(--c-e6e3dc)',
        boxSizing: 'border-box',
        width,
        minWidth,
        ...VARIANT[variant],
        ...(padding !== undefined ? { padding } : null),
        ...(stack ? { display: 'flex', flexDirection: 'column', gap: 1 } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* Positioning context for a popover. The `data-dd` marker tells the global
   mousedown handler in the store that a click landed inside a dropdown, so it
   should not close it. */
export function PopoverAnchor({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div data-dd="1" style={{ position: 'relative', ...style }}>
      {children}
    </div>
  );
}

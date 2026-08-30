import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';

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

interface PopoverProps {
  variant?: PopoverVariant;
  top?: number;
  /* Opens above the anchor instead of below it — for chips near the bottom of
     a dialog, where the room under them is outside the dialog's card. */
  up?: boolean;
  left?: number;
  right?: number;
  width?: number | string;
  minWidth?: number;
  zIndex?: number;
  /* Stack children in a column with the 1px gutter menus use. */
  stack?: boolean;
  /* Scroll the popover into view on open — for anchors inside a scrolling
     surface (the modal body) that would otherwise clip it at the bottom. */
  revealOnMount?: boolean;
  padding?: number | string;
  style?: CSSProperties;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function Popover({
  variant = PopoverVariant.MENU,
  top = 26,
  up,
  left,
  right,
  width,
  minWidth,
  zIndex = 40,
  stack = true,
  revealOnMount,
  padding,
  style,
  children,
  ref: outerRef,
}: PopoverProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = outerRef ?? ownRef;
  useEffect(() => {
    if (typeof ref === 'object' && ref?.current && revealOnMount)
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ref, revealOnMount]);
  return (
    <div
      ref={ref}
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
        ...(up ? { top: 'auto', bottom: 'calc(100% + 2px)' } : null),
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
export function PopoverAnchor({
  style,
  children,
  ref,
}: {
  style?: CSSProperties;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div data-dd="1" ref={ref} style={{ position: 'relative', ...style }}>
      {children}
    </div>
  );
}

/* The 222px shell the date and time pickers drop into. Both are the same
   surface at the same offsets under whichever chip opened them, so the size,
   padding and reveal live here rather than being spelled out twice. */
export function PickerPopover({
  top = 26,
  left = 0,
  zIndex = 40,
  children,
}: {
  top?: number;
  left?: number;
  zIndex?: number;
  children: ReactNode;
}) {
  return (
    <Popover top={top} left={left} zIndex={zIndex} width={222} padding={10} stack={false} revealOnMount>
      {children}
    </Popover>
  );
}

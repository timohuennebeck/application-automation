/* Inline-style fragments shared across the renderer, so the same look is the
   same bytes everywhere. */
import type { CSSProperties } from 'react';

/* Values stay on one line — a pasted job URL would otherwise wrap across a
   dozen rows. The full value shows in the hover tooltip (and in an input
   while editing, which scrolls). */
export const ELLIPSIS = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const satisfies CSSProperties;

/* The animated running border around whatever Kepler is working on — the
   board card and the run panel share it, so the two always spin alike.
   Pair with `animation: 'om-ang 2.6s linear infinite'`. */
export const RUN_BORDER_BG =
  'linear-gradient(var(--c-fff),var(--c-fff)) padding-box, conic-gradient(from var(--oa),var(--run) 0deg,color-mix(in srgb, var(--run) 22%, transparent) 34deg,transparent 50deg,transparent 322deg,color-mix(in srgb, var(--run) 60%, transparent) 360deg) border-box';

/* The text shimmer on a running label. Pair with backgroundClip: 'text',
   backgroundSize: '200% 100%' and `animation: 'om-shimmer 2.4s linear
   infinite'`. */
export const SHIMMER_BG =
  'linear-gradient(90deg,var(--c-a5a29a) 0%,var(--c-a5a29a) 28%,var(--c-1b1a17) 46%,var(--c-a5a29a) 64%,var(--c-a5a29a) 100%)';

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

/* The breadcrumb row a screen opens with. The height is pinned because the
   detail view carries a 24px button in this row and the letter editor carries
   only type — without a floor, walking from one to the other moved the crumbs
   up by five pixels. One definition, so the two cannot drift apart again. */
export const CRUMB_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '14px 22px 16px',
  minHeight: 54,
  flexShrink: 0,
} as const satisfies CSSProperties;

/* The › between two crumbs, and the type a crumb wears when it cannot be
   followed — the same muted grey, since a dead crumb reads as a separator. */
export const CRUMB_MUTED = {
  fontSize: 12.5,
  color: 'var(--c-c3c0b8)',
} as const satisfies CSSProperties;

/* Where you are: the last crumb, a label rather than a link. */
export const CRUMB_LEAF = {
  fontSize: 12.5,
  color: 'var(--c-1b1a17)',
  fontWeight: 600,
} as const satisfies CSSProperties;

/* A dialog's own text input: the frame is the dialog, so the field brings no
   border, no ground and no padding of its own — just the type. Shared by the
   create dialog and the interview editor. */
export const DIALOG_INPUT = {
  fontSize: 15,
  color: 'var(--c-1b1a17)',
  lineHeight: 1.5,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  width: '100%',
  padding: 0,
} as const satisfies CSSProperties;

/* The round send button at the foot of a composer — its box only. The ground,
   the cursor and the hover live in .send-circle in app.css, since a hover
   cannot be written inline; the comment thread adds .send-circle-off to grey an
   empty draft out, which the letter's never does — an empty instruction there
   means "try again". */
export const SEND_CIRCLE = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  color: 'var(--c-fbfaf7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  flexShrink: 0,
} as const satisfies CSSProperties;

/* What went wrong, under the control that tried it. */
export const ERROR_TEXT = {
  fontSize: 11.5,
  color: 'var(--c-c2564c)',
  lineHeight: 1.45,
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

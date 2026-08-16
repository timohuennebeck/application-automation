import type { CSSProperties, ReactNode } from 'react';
import { DotKind } from '../data/config';
import type { ColumnDef } from '../data/config';

/* Pie-slice path for a progress ring at `frac` completion. */
function piePath(frac: number): string {
  const r = 5.5;
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  const x = 7 + r * Math.cos(a);
  const y = 7 + r * Math.sin(a);
  return (
    'M7 7 L7 ' +
    (7 - r) +
    ' A' +
    r +
    ' ' +
    r +
    ' 0 ' +
    (frac > 0.5 ? 1 : 0) +
    ' 1 ' +
    x.toFixed(2) +
    ' ' +
    y.toFixed(2) +
    ' Z'
  );
}

/* The status ring used for columns, statuses, follow-ups and interview rounds. */
export function StatusDot({
  kind,
  accent,
  frac = 0.5,
  size = 14,
  style,
}: {
  kind: DotKind;
  accent: string;
  frac?: number;
  size?: number;
  style?: CSSProperties;
}) {
  const s: CSSProperties = { flexShrink: 0, ...style };
  const ring = (extra?: ReactNode, fill = 'none', dash?: string) => (
    <svg width={size} height={size} viewBox="0 0 14 14" style={s}>
      <circle cx="7" cy="7" r="5.5" fill={fill} stroke={accent} strokeWidth="1.6" strokeDasharray={dash} />
      {extra}
    </svg>
  );
  switch (kind) {
    case DotKind.PIE:
      return ring(<path d={piePath(frac)} fill={accent} />);
    case DotKind.CANCEL:
      return ring(
        <path
          d="M4.7 4.7 L9.3 9.3 M9.3 4.7 L4.7 9.3"
          fill="none"
          stroke="var(--c-fbfaf7)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />,
        accent,
      );
    case DotKind.MUTED:
      return ring(
        <path d="M4.3 7 L9.7 7" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />,
      );
    case DotKind.DONE:
      return ring(
        <path
          d="M4.4 7.1 L6.3 9 L9.6 5.2"
          fill="none"
          stroke="var(--c-fbfaf7)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
        accent,
      );
    default:
      return ring(null, 'none', '2.2 2.2');
  }
}

export function ColumnIcon({
  col,
  size = 14,
  style,
}: {
  col: ColumnDef;
  size?: number;
  style?: CSSProperties;
}) {
  return <StatusDot kind={col.kind} accent={col.accent} frac={col.frac} size={size} style={style} />;
}

export function Chevron({
  size = 9,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className}
      style={{ flexShrink: 0, opacity: 0.5, ...style }}
    >
      <path
        d="M2 3.6 L5 6.6 L8 3.6"
        fill="none"
        stroke="var(--c-5f5c56)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Larger chevron used for the collapsible email body. */
export function Caret({ open, style }: { open: boolean; style?: CSSProperties }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" style={{ flexShrink: 0, ...style }}>
      <path
        d={open ? 'M2.6 4.4 L6 7.8 L9.4 4.4' : 'M4.4 2.6 L7.8 6 L4.4 9.4'}
        fill="none"
        stroke="var(--c-9a978f)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Check({
  size = 11,
  stroke = 'var(--c-1b1a17)',
  strokeWidth = 1.7,
}: {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
      <path
        d="M2.4 6.4 L4.8 8.8 L9.6 3.4"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--c-a8a49b)" strokeWidth="1.5" />
      <path d="M9.2 9.2 L12.5 12.5" stroke="var(--c-a8a49b)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* Pencil: opens the editor for a row that is otherwise only selectable. */
export function PencilGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <path
        d="M9.4 1.9 L12.1 4.6 L4.8 11.9 L1.7 12.3 L2.1 9.2 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.1 3.2 L10.8 5.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* What a document glyph stands for. FILE is anything else — a scan, an image,
   a Word file — drawn in plain ink. EMPTY is a slot with nothing in it yet —
   the same sheet of paper, drained of colour. */
export const DocFormat = {
  HTML: 'HTML',
  PDF: 'PDF',
  FILE: 'FILE',
  EMPTY: 'EMPTY',
} as const;
export type DocFormat = (typeof DocFormat)[keyof typeof DocFormat];

/* Every format is the same lines of a written page; only their colour differs.
   Orange for HTML, red for PDF, ink for any other file, grey for a slot with
   nothing in it. The paper
   itself stays neutral — tinting the whole sheet blue is what made this read as
   a Word icon. */
const DOC_LINES = 'M7 15 h12 M7 19 h12 M7 23 h8';
const DOC_INK: Record<DocFormat, string> = {
  [DocFormat.HTML]: 'var(--c-d1782f)',
  [DocFormat.PDF]: 'var(--c-c2564c)',
  [DocFormat.FILE]: 'var(--c-8b8880)',
  [DocFormat.EMPTY]: 'var(--c-c9c5bb)',
};

export function DocGlyph({ format = DocFormat.PDF }: { format?: DocFormat }) {
  const empty = format === DocFormat.EMPTY;
  const paper = empty ? 'var(--c-e0ded8)' : 'var(--c-d5d1c7)';
  return (
    <svg width={26} height={32} viewBox="0 0 26 32" style={{ flexShrink: 0, opacity: empty ? 0.6 : 1 }}>
      <path
        d="M3 4 a2 2 0 0 1 2-2 h11 l7 7 v19 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 Z"
        fill="var(--c-f6f5f1)"
        stroke={paper}
        strokeWidth={1.2}
      />
      <path d="M16 2 v5 a2 2 0 0 0 2 2 h5" fill="none" stroke={paper} strokeWidth={1.2} />
      <path d={DOC_LINES} fill="none" stroke={DOC_INK[format]} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ flexShrink: 0, animation: 'om-spin 2.4s linear infinite' }}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        stroke="var(--c-1b1a17)"
        strokeWidth="1.6"
        strokeDasharray="2.2 2"
      />
    </svg>
  );
}

const BAR_HEIGHTS = [4, 6, 7, 9];

/* Four ascending bars, `level` of them filled — the interest indicator. */
export function PriorityBars({ level }: { level: number }) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 9, flexShrink: 0 }}>
      {BAR_HEIGHTS.map((h, i) => (
        <div
          key={i}
          style={{
            width: 2.5,
            height: h,
            borderRadius: 1,
            background: i < level ? 'var(--c-5f5c56)' : 'var(--c-e4e1da)',
          }}
        />
      ))}
    </div>
  );
}

export function Avatar({
  bg,
  children,
  size = 18,
  fontSize = 8,
  style,
}: {
  bg: string;
  children: ReactNode;
  size?: number;
  fontSize?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: 'var(--c-fff)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* Kepler's avatar — the agent is always rendered in the ink tone. Avatar
   spreads `style` last, so the paler ink wins over its default white. */
export function KeplerAvatar({ size = 18, fontSize = 9 }: { size?: number; fontSize?: number }) {
  return (
    <Avatar bg="var(--c-1b1a17)" size={size} fontSize={fontSize} style={{ color: 'var(--c-fbfaf7)' }}>
      K
    </Avatar>
  );
}

export function ThemeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5" fill="none" stroke="var(--c-8b8880)" strokeWidth="1.5" />
      <path d="M7 2 A5 5 0 0 1 7 12 Z" fill="var(--c-8b8880)" />
    </svg>
  );
}

/* A clipboard: the board, plus the clip that sits over its top edge. */
export function ClipboardGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path
        d="M6.1 3.2 H4.4 A1.6 1.6 0 0 0 2.8 4.8 V12.6 A1.6 1.6 0 0 0 4.4 14.2 H11.6 A1.6 1.6 0 0 0 13.2 12.6 V4.8 A1.6 1.6 0 0 0 11.6 3.2 H9.9"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <rect
        x="5.9"
        y="1.8"
        width="4.2"
        height="2.8"
        rx="1"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/* The stop square on Kepler's running step. */
export function StopGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/* The X that dismisses a floating surface. Same box and stroke as RegenGlyph,
   which sits beside it in the letter popover's label row — the pair has to read
   as one set of controls rather than two borrowed ones. */
export function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path
        d="M4.8 4.8 L11.2 11.2 M11.2 4.8 L4.8 11.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Counter-clockwise arrow: the way back for one passage. Drawn at its own
   weight rather than through Outline — it sits inside a menu row next to type,
   where the thinner stroke reads as a smudge. */
export function UndoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M3 8h11a5 5 0 0 1 0 10H8" />
      <path d="m7 4-4 4 4 4" />
    </svg>
  );
}

export function RegenGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path
        d="M13.2 6.6 A5.2 5.2 0 1 0 13 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M13.4 2.9 L13.4 6.7 L9.7 6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* The classic two-segment chain, drawn diagonally. */
export function LinkGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        fill="none"
        stroke="var(--c-a5a29a)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6 M10 11v6 M14 11v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PaperclipGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path
        d="M10.6 4.1 L5.6 9.1 a1.7 1.7 0 0 0 2.4 2.4 l5.2-5.2 a3 3 0 0 0-4.2-4.2 L3.5 7.6 a4.3 4.3 0 0 0 6.1 6.1 l4.2-4.2"
        fill="none"
        stroke="var(--c-a5a29a)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Two columns of dots — the conventional "drag me" grip. Drawn in currentColor
   so the row can fade it in on hover. */
export function GripGlyph() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0 }}>
      {[2, 7, 12].map((cy) => (
        <g key={cy} fill="currentColor">
          <circle cx="2" cy={cy} r="1.1" />
          <circle cx="8" cy={cy} r="1.1" />
        </g>
      ))}
    </svg>
  );
}

export function DotsGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14">
      <circle cx="3" cy="7" r="1.1" fill="currentColor" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" />
      <circle cx="11" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}

/* Sliders, for the board's filter and sort control. */
export function FilterGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M2 4.2 H12 M2 9.8 H12" />
        <circle cx="5.4" cy="4.2" r="1.5" fill="var(--c-fff)" />
        <circle cx="9" cy="9.8" r="1.5" fill="var(--c-fff)" />
      </g>
    </svg>
  );
}

/* Heroicons (24/outline) briefcase and currency-euro, drawn small enough for
   a board card. They label the company and salary lines so the two are
   telling apart at a glance. */
/* One 24-grid outline envelope. The board card's four glyphs and every glyph in
   field-glyphs.tsx are the same SVG with a different path, so the stroke, the
   caps and the grid live here — five copies of this drifting apart is exactly
   how a set of icons stops looking like a set. */
export function Outline({ d, size = 11, style }: { d: string; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      <path d={d} />
    </svg>
  );
}

const BRIEFCASEGLYPH_PATH =
  'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z';
const PINGLYPH_PATH =
  'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z';
const GLOBEGLYPH_PATH =
  'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418';
const EUROGLYPH_PATH =
  'M14.25 7.756a4.5 4.5 0 1 0 0 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z';

export function BriefcaseGlyph({ size = 11, style }: { size?: number; style?: CSSProperties }) {
  return <Outline d={BRIEFCASEGLYPH_PATH} size={size} style={style} />;
}

export function PinGlyph({ size = 11, style }: { size?: number; style?: CSSProperties }) {
  return <Outline d={PINGLYPH_PATH} size={size} style={style} />;
}

export function GlobeGlyph({ size = 11, style }: { size?: number; style?: CSSProperties }) {
  return <Outline d={GLOBEGLYPH_PATH} size={size} style={style} />;
}

export function EuroGlyph({ size = 11, style }: { size?: number; style?: CSSProperties }) {
  return <Outline d={EUROGLYPH_PATH} size={size} style={style} />;
}

/* Collapse arrow on board column headers. */
export function CollapseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12">
      <path
        d="M7.6 2.6 L4.2 6 L7.6 9.4"
        fill="none"
        stroke="var(--c-5f5c56)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* The red error dot of a failed Kepler run — circle plus exclamation mark,
   as the run panel's step rows draw it. */
export function ErrorDot({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--c-c2564c)" strokeWidth="1.6" />
      <path
        d="M7 4.2 L7 7.8 M7 9.9 L7 10.1"
        fill="none"
        stroke="var(--c-c2564c)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

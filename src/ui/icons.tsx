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
    case DotKind.FILLED:
      return ring(null, accent);
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
  dir = 'down',
  size = 9,
  style,
}: {
  dir?: 'down' | 'right';
  size?: number;
  style?: CSSProperties;
}) {
  const d = dir === 'down' ? 'M2 3.6 L5 6.6 L8 3.6' : 'M3.6 2 L6.6 5 L3.6 8';
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, opacity: 0.5, ...style }}>
      <path
        d={d}
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
  style,
}: {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ flexShrink: 0, ...style }}>
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

export function SearchGlyph({ size = 12, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0, ...style }}>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--c-a8a49b)" strokeWidth="1.5" />
      <path d="M9.2 9.2 L12.5 12.5" stroke="var(--c-a8a49b)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DocGlyph({
  width = 26,
  height = 32,
  strokeWidth = 1.2,
  lineWidth = 1.5,
  style,
}: {
  width?: number;
  height?: number;
  strokeWidth?: number;
  lineWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 26 32" style={{ flexShrink: 0, ...style }}>
      <path
        d="M3 4 a2 2 0 0 1 2-2 h11 l7 7 v19 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 Z"
        fill="var(--c-f4f7fb)"
        stroke="var(--c-b9cbe2)"
        strokeWidth={strokeWidth}
      />
      <path d="M16 2 v5 a2 2 0 0 0 2 2 h5" fill="none" stroke="var(--c-b9cbe2)" strokeWidth={strokeWidth} />
      <path
        d="M7 15 h12 M7 19 h12 M7 23 h8"
        stroke="var(--c-3f6ea8)"
        strokeWidth={lineWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Spinner({
  size = 12,
  stroke = 'var(--c-1b1a17)',
  style,
}: {
  size?: number;
  stroke?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ flexShrink: 0, animation: 'om-spin 2.4s linear infinite', ...style }}
    >
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.6" strokeDasharray="2.2 2" />
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

/* Kepler's avatar — the agent is always rendered in the ink tone. */
export function KeplerAvatar({ size = 18, fontSize = 9 }: { size?: number; fontSize?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--c-1b1a17)',
        color: 'var(--c-fbfaf7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      K
    </div>
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

export function CopyGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <rect
        x="5.4"
        y="5.4"
        width="8.2"
        height="8.2"
        rx="1.8"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
      />
      <path
        d="M10.6 3.6 A1.8 1.8 0 0 0 8.8 2.4 H4.2 A1.8 1.8 0 0 0 2.4 4.2 V8.8 A1.8 1.8 0 0 0 3.6 10.6"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RegenGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path
        d="M13.2 6.6 A5.2 5.2 0 1 0 13 9.6"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M13.4 2.9 L13.4 6.7 L9.7 6.7"
        fill="none"
        stroke="var(--c-77746d)"
        strokeWidth="1.3"
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

export function DownloadGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path d="M8 2.6 V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M5.1 7.3 L8 10.2 L10.9 7.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3.6 13.2 h8.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

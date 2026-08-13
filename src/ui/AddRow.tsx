import type { CSSProperties } from 'react';

/* The dashed "+" circle on its own, for rows that do their own layout. Both
   parts are drawn rather than typeset: a text "+" is centred by its font
   metrics, which leave it sitting high and a hair left of the ring's middle. */
export function DashedPlus({ size = 18, active }: { size?: number; active?: boolean }) {
  const c = size / 2;
  const r = c - 0.5;
  /* A whole number of dashes around the ring, so it closes without a stub. */
  const seg = (2 * Math.PI * r) / Math.round((2 * Math.PI * r) / 3);
  const arm = size * 0.2;
  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={active ? 'var(--c-a8a49b)' : 'var(--c-c9c5bb)'}
        strokeWidth="1"
        strokeDasharray={seg * 0.55 + ' ' + seg * 0.45}
      />
      <path
        d={'M' + (c - arm) + ' ' + c + 'H' + (c + arm) + 'M' + c + ' ' + (c - arm) + 'V' + (c + arm)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Dashed "+" affordance used for adding people and contacts. */
export function AddRow({
  label,
  size = 18,
  active,
  onClick,
  style,
}: {
  label: string;
  size?: number;
  /* Renders in the darker committed tone while its picker is open. */
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div
      className={active ? undefined : 'add-row'}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        /* content-box: see FieldChip — an intrinsic width otherwise eats the padding. */
        padding: '2px 6px',
        marginLeft: -6,
        width: 'fit-content',
        boxSizing: 'content-box',
        borderRadius: 5,
        ...(active ? { color: 'var(--c-5f5c56)', background: 'var(--c-e7e4dc)' } : null),
        ...style,
      }}
    >
      <DashedPlus size={size} active={active} />
      <div style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

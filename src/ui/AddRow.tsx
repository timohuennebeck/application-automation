import type { CSSProperties } from 'react';

/* Dashed "+" affordance used for adding people and contacts. */
export function AddRow({
  label, size = 18, active, onClick, style,
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
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '2px 6px', marginLeft: -6, width: 'fit-content',
        borderRadius: 5,
        ...(active ? { color: 'var(--c-5f5c56)', background: 'var(--c-e7e4dc)' } : null),
        ...style,
      }}
    >
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: '1px dashed ' + (active ? 'var(--c-a8a49b)' : 'var(--c-c9c5bb)'),
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, lineHeight: '11px', paddingBottom: 1, flexShrink: 0,
        color: active ? undefined : 'var(--c-9a978f)',
      }}>
        +
      </div>
      <div style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

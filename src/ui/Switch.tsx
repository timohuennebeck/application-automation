/* Small sliding toggle switch with a trailing label. No hover surface — the
   switch itself is the whole affordance. */
export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: 'fit-content',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: 28,
          height: 16,
          borderRadius: 999,
          background: on ? 'var(--c-1b1a17)' : 'var(--c-d8d4ca)',
          position: 'relative',
          transition: 'background 140ms ease',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 14 : 2,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'var(--c-fff)',
            transition: 'left 140ms ease',
          }}
        />
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--c-28261f)' }}>{label}</span>
    </div>
  );
}

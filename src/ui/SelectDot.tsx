/* The radio-like dot that marks the Fassung Kepler uses: filled when it is
   the one, hollow otherwise. Display only — the card it sits on is the
   control. */
export function SelectDot({ on }: { on: boolean }) {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        flexShrink: 0,
        boxSizing: 'border-box',
        border: '1.5px solid ' + (on ? 'var(--c-3f6ea8)' : 'var(--c-c9c5bb)'),
        background: on ? 'radial-gradient(var(--c-3f6ea8) 45%, transparent 50%)' : 'transparent',
      }}
    />
  );
}

/* The radio-like dot that marks the Fassung Kepler uses: filled when it is
   the one, hollow otherwise. Clicking a hollow one selects it; the filled one
   is inert. Stops the click, or the card behind it would open its file. */
export function SelectDot({ on, title, onSelect }: { on: boolean; title: string; onSelect: () => void }) {
  return (
    <div
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) onSelect();
      }}
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        flexShrink: 0,
        boxSizing: 'border-box',
        border: '1.5px solid ' + (on ? 'var(--c-3f6ea8)' : 'var(--c-c9c5bb)'),
        background: on ? 'radial-gradient(var(--c-3f6ea8) 45%, transparent 50%)' : 'transparent',
        cursor: on ? 'default' : 'pointer',
      }}
    />
  );
}

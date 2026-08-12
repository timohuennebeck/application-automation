import { Check } from './icons';

/* Pill-shaped multiple-choice option (interview location, evaluated skills). */
export function ChipToggle({
  label, selected, onClick, size = 'md',
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: sm ? 5 : 6,
        fontSize: sm ? 12 : 12.5, padding: sm ? '4px 10px' : '5px 11px',
        borderRadius: 999,
        border: '1px solid ' + (selected ? 'var(--c-1b1a17)' : sm ? 'var(--c-ddd9d0)' : 'var(--c-e6e3dc)'),
        background: selected ? 'var(--c-1b1a17)' : 'var(--c-fff)',
        color: selected ? 'var(--c-fff)' : sm ? 'var(--c-28261f)' : 'var(--c-5f5c56)',
        cursor: 'pointer',
      }}
    >
      {selected && <Check size={sm ? 10 : 11} stroke="var(--c-fff)" />}
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

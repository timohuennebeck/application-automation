/* The search row atop a picker popover: glyph plus borderless input, shared
   by the select popovers and the people picker so the two boxes can never
   drift apart visually. The list below — and what Enter does to it — stays
   the caller's. */
import type { KeyboardEvent, Ref } from 'react';
import { SearchGlyph } from './icons';

/* One arrow-key step through `rows` entries, wrapping at both ends. */
export function cycleActive(active: number, rows: number, key: string): number {
  return key === 'ArrowDown' ? (active + 1) % rows : active <= 0 ? rows - 1 : active - 1;
}

export function SearchRow({
  value,
  placeholder,
  onChange,
  onKeyDown,
  containerRef,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /* The select popover measures the row's height for its drop-up math. */
  containerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px 7px' }}
    >
      <SearchGlyph />
      <input
        value={value}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          fontSize: 12.5,
          color: 'var(--c-28261f)',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          flex: '1 1 0',
          minWidth: 0,
          padding: 0,
        }}
      />
    </div>
  );
}

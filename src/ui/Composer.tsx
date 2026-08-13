import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { PaperclipGlyph } from './icons';

/* The bordered "Kommentar schreiben…" box, shared by the card comment thread
   and the per-interview note thread. `children` hosts the mention popover. */
export function Composer({
  value,
  onChange,
  onKeyDown,
  onSend,
  placeholder = 'Kommentar schreiben…',
  ref,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  placeholder?: string;
  /* Needed by the mention popover to read and restore the caret. */
  ref?: Ref<HTMLTextAreaElement>;
  children?: ReactNode;
}) {
  const ready = !!value.trim();
  return (
    <div
      className="composer"
      style={{
        padding: '12px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
      }}
    >
      {children}
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onSelect={() => onChange(value)}
        style={{
          fontSize: 12.5,
          color: 'var(--c-28261f)',
          lineHeight: 1.55,
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          minHeight: 36,
          width: '100%',
          boxSizing: 'border-box',
          padding: 0,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
        <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', marginRight: 'auto' }}>
          @Kepler erwähnen, um die KI zu fragen
        </div>
        <PaperclipGlyph />
        <div
          onClick={onSend}
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: ready ? 'var(--c-1b1a17)' : 'var(--c-d6d3cb)',
            color: 'var(--c-fbfaf7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            flexShrink: 0,
            cursor: ready ? 'pointer' : 'default',
          }}
        >
          ↑
        </div>
      </div>
    </div>
  );
}

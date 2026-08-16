import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { formatBytes } from '../lib/bytes';
import { PaperclipGlyph } from './icons';
import { SEND_CIRCLE } from './styles';

/* A file staged in the composer, shown as a removable chip until it is sent. */
export interface PendingAttachment {
  name: string;
  size: number;
}

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
  onAttach,
  attachments,
  onRemoveAttachment,
  onOpenAttachment,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  placeholder?: string;
  /* Needed by the mention popover to read and restore the caret. */
  ref?: Ref<HTMLTextAreaElement>;
  children?: ReactNode;
  /* Enables the paperclip. Threads without attachment storage (interview
     notes) leave it unset and get no button at all. */
  onAttach?: () => void;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (index: number) => void;
  /* Makes a staged chip clickable, e.g. to preview the file before sending. */
  onOpenAttachment?: (index: number) => void;
}) {
  const ready = !!value.trim() || !!attachments?.length;
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
      {!!attachments?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {attachments.map((a, i) => (
            <div
              key={i}
              title={onOpenAttachment ? 'Anhang öffnen' : undefined}
              onClick={() => onOpenAttachment?.(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid var(--c-eae7e0)',
                borderRadius: 6,
                padding: '3px 5px 3px 7px',
                fontSize: 11.5,
                color: 'var(--c-28261f)',
                maxWidth: '100%',
                boxSizing: 'border-box',
                cursor: onOpenAttachment ? 'pointer' : 'default',
              }}
            >
              <PaperclipGlyph />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 160,
                }}
              >
                {a.name}
              </span>
              <span style={{ color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>{formatBytes(a.size)}</span>
              <div
                className="fact-x"
                title="Anhang entfernen"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  // The chip opens the file; the ✕ must only remove it.
                  e.stopPropagation();
                  onRemoveAttachment?.(i);
                }}
              >
                ✕
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
        <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', marginRight: 'auto' }}>
          @Kepler erwähnen, um die KI zu fragen
        </div>
        {onAttach && (
          <div className="cmt-menu-btn" title="Datei anhängen" onClick={onAttach}>
            <PaperclipGlyph />
          </div>
        )}
        <div
          onClick={onSend}
          className={'send-circle' + (ready ? '' : ' send-circle-off')}
          style={SEND_CIRCLE}
        >
          ↑
        </div>
      </div>
    </div>
  );
}

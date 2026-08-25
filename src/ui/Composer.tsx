import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { formatBytes } from '../lib/bytes';
import type { Mentionable } from '../lib/mentions';
import type { DocumentKind } from '../shared/enums';
import { MentionBox } from './MentionBox';
import type { MentionBoxHandle } from './MentionBox';
import { PaperclipGlyph } from './icons';
import { SEND_CIRCLE } from './styles';

/* A file staged in the composer, shown as a removable chip until it is sent. */
export interface PendingAttachment {
  name: string;
  size: number;
}

/* The composer holds a MentionBox and reaches it through the box's own handle;
   the popover above talks to one thing, not two. */
export type ComposerHandle = MentionBoxHandle;

/* The bordered "Kommentar schreiben…" box, shared by the card comment thread
   and the per-interview note thread. `children` hosts the mention popover.

   Everything about typing — chips, caret, undo — belongs to MentionBox, which
   the comment editor uses too. What is left here is the chrome around it: the
   staged attachments, the hint, the paperclip and the send button. */
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
  mentionables,
  sizeOf,
  onCaretChange,
}: {
  value: string;
  onChange: (v: string, caret: number) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onSend: () => void;
  placeholder?: string;
  ref?: Ref<ComposerHandle>;
  children?: ReactNode;
  /* Enables the paperclip. Threads without attachment storage (interview
     notes) leave it unset and get no button at all. */
  onAttach?: () => void;
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (index: number) => void;
  /* Makes a staged chip clickable, e.g. to preview the file before sending. */
  onOpenAttachment?: (index: number) => void;
  mentionables?: Mentionable[];
  sizeOf?: (kind: DocumentKind) => number | null;
  onCaretChange?: (caret: number) => void;
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
      <MentionBox
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        mentionables={mentionables}
        sizeOf={sizeOf}
        onCaretChange={onCaretChange}
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

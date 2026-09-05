import type { DragEvent, ReactNode } from 'react';
import { DocFormat, DocGlyph } from './icons';
import { ELLIPSIS } from './styles';

/* The bordered card a document sits on, in the application's Bewerbungsunterlagen
   and in the profile's template slots. Everything but the control on the right
   is the same in both places, so that part comes in as children — a "…" menu
   here, an upload button there. */
export function DocumentCard({
  format,
  title,
  caption,
  hint,
  muted,
  leading,
  onClick,
  children,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  format: DocFormat;
  /* Usually the file's name; the profile swaps in an input while renaming. */
  title: ReactNode;
  caption: string;
  /* Sits left of the glyph — the profile's selection dot. */
  leading?: ReactNode;
  /* Tooltip for the card itself, which says what clicking it does. */
  hint: string;
  /* Drains the labels for a slot that has nothing in it yet. */
  muted?: boolean;
  onClick: () => void;
  children?: ReactNode;
  /* A file dragged over the card, from the section's own drop handling. */
  dragOver?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div
      className={'doc-card' + (dragOver ? ' doc-card-dragover' : '')}
      title={hint}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {leading}
      <DocGlyph format={format} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {/* File names have no spaces to wrap at, so a long one ellipsizes
            instead of pushing past the card. */}
        <div
          style={{
            ...ELLIPSIS,
            fontSize: 12.5,
            fontWeight: 600,
            color: muted ? 'var(--c-8b8880)' : 'var(--c-1b1a17)',
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 11, color: muted ? 'var(--c-a5a29a)' : 'var(--c-9a978f)' }}>{caption}</div>
      </div>
      {children && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

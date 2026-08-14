import type { CSSProperties, MouseEvent } from 'react';
import { formatBytes } from '../lib/bytes';
import { PaperclipGlyph } from './icons';

/* Pill for an attached document — paperclip, name, size. Shared between
   comment attachments and the doc steps in the agent run panel. */
export function AttachmentChip({
  name,
  size,
  title,
  style,
  onClick,
}: {
  name: string;
  size?: number | null;
  title?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <div className="attachment-chip" title={title} style={style} onClick={onClick}>
      <PaperclipGlyph />
      <span
        style={{
          fontSize: 12,
          color: 'var(--c-1b1a17)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {size != null && (
        <span style={{ fontSize: 11, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>
          {formatBytes(size)}
        </span>
      )}
    </div>
  );
}

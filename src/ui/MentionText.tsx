import type { CSSProperties } from 'react';
import { splitMentions } from '../lib/mentions';

/* Body text with its @-mentions rendered as chips. Shared by the card comment
   thread and the per-interview note thread. */
export function MentionText({
  text,
  names,
  style,
}: {
  text: string;
  /* Only these names become chips; anything else stays plain text. */
  names: string[];
  style?: CSSProperties;
}) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--c-5f5c56)', lineHeight: 1.75, textWrap: 'pretty', ...style }}>
      {splitMentions(text, names).map((p, i) =>
        p.mention ? (
          <span
            key={i}
            style={{
              color: 'var(--c-3f6ea8)',
              fontWeight: 600,
              background: 'var(--c-e9eff8)',
              padding: '1px 6px',
              borderRadius: 4,
              display: 'inline-block',
              lineHeight: 1.35,
              verticalAlign: 'baseline',
            }}
          >
            {p.t}
          </span>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </div>
  );
}

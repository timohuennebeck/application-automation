import type { CSSProperties, ReactNode } from 'react';
import { splitMentions } from '../lib/mentions';
import type { Mentionable } from '../lib/mentions';
import type { DocumentKind } from '../shared/enums';
import { formatBytes } from '../lib/bytes';
import { LinkGlyph, PaperclipGlyph } from './icons';

/* URLs in body text; trailing sentence punctuation stays text. */
const URL_RE = /(https?:\/\/[^\s]+?)([.,;:!?)]*)(?=\s|$)/g;

/* Enough of the address to recognise the target, then an ellipsis. */
const LABEL_MAX = 28;

/* A URL as a blue pill: the address without its protocol, clipped — the full
   URL is tooltip and click target. Shared by comment text and the Kepler
   panel's fetch step. */
export function LinkChip({ url, style }: { url: string; style?: CSSProperties }) {
  const plain = url.replace(/^https?:\/\/(www\.)?/, '');
  const host = plain.length > LABEL_MAX ? plain.slice(0, LABEL_MAX) + '…' : plain;
  return (
    <span
      className="attachment-chip chip-link"
      title={url}
      style={{
        display: 'inline-flex',
        verticalAlign: 'middle',
        margin: '-3px 0',
        padding: '2px 6px',
        gap: 5,
        ...style,
      }}
      onClick={(e) => {
        e.stopPropagation();
        window.desktop?.openExternal(url);
      }}
    >
      <LinkGlyph />
      <span style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{host}</span>
    </span>
  );
}

/* One plain run split into text and link chips. */
function TextWithLinks({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const [, url, tail] = m;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<LinkChip key={m.index} url={url} />);
    if (tail) parts.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/* **fett** spans, then links inside both halves. */
function BoldAndLinks({ text }: { text: string }) {
  const segments = text.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {segments.map((seg, i) =>
        i % 2 ? (
          <strong key={i} style={{ fontWeight: 600, color: 'var(--c-28261f)' }}>
            <TextWithLinks text={seg} />
          </strong>
        ) : (
          <TextWithLinks key={i} text={seg} />
        ),
      )}
    </>
  );
}

/* One line's content: mention chips, bold spans, link pills. A mention is
   looked up in `mentionables` to tell a document ("@Anschreiben") from a
   person ("@Marek Hübner") — only the former gets the attachment look. */
function Inline({
  text,
  mentionables,
  sizeOf,
  onOpenDocument,
}: {
  text: string;
  mentionables: Mentionable[];
  sizeOf?: (kind: DocumentKind) => number | null;
  onOpenDocument?: (kind: DocumentKind) => void;
}) {
  return (
    <>
      {splitMentions(
        text,
        mentionables.map((m) => m.name),
      ).map((p, i) => {
        if (!p.mention) return <BoldAndLinks key={i} text={p.t} />;
        const entry = mentionables.find((m) => '@' + m.name === p.t);
        /* splitMentions only matches names drawn from mentionables, so this
           should always resolve — but a match with no entry degrades to plain
           text rather than the person chip, which would misrepresent it. */
        if (!entry) return <BoldAndLinks key={i} text={p.t} />;
        if (entry.kind === 'document') {
          const size = entry.document != null ? sizeOf?.(entry.document) : null;
          return (
            <span
              key={i}
              className="attachment-chip"
              title={entry.name}
              style={{
                display: 'inline-flex',
                gap: 4,
                padding: '1px 5px',
                verticalAlign: -2,
                /* The attachment chip is built to stand alone in a row under the
                   composer. In running text it needs less padding, or it breaks
                   the line it sits in — same colour, same paperclip, same radius. */
              }}
              onClick={() => onOpenDocument?.(entry.document!)}
            >
              <PaperclipGlyph />
              <span style={{ fontSize: 12, color: 'var(--c-1b1a17)', whiteSpace: 'nowrap' }}>
                {entry.name}
              </span>
              {size != null && (
                <span style={{ fontSize: 11, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>
                  {formatBytes(size)}
                </span>
              )}
            </span>
          );
        }
        return (
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
        );
      })}
    </>
  );
}

/* A line that reads as a list item, whatever character it was written with. */
const BULLET_RE = /^\s*[•–-]\s+(.*)$/;

/* Body text with structure: real bullet rows with hanging indent, blank-line
   spacing, @-mentions as chips, **fett** emphasis, links as pills. Shared by
   the card comment thread and the per-interview note thread. */
export function MentionText({
  text,
  mentionables,
  sizeOf,
  onOpenDocument,
  style,
}: {
  text: string;
  /* Only these entries become chips; anything else stays plain text. Each
     entry's `kind` decides whether it renders as a person or a document. */
  mentionables: Mentionable[];
  /* A document chip's size, read at render time so it does not go stale when
     Kepler rewrites the file. Absent (e.g. the interview note thread, which
     offers no documents) simply omits the size. */
  sizeOf?: (kind: DocumentKind) => number | null;
  onOpenDocument?: (kind: DocumentKind) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 12.5,
        color: 'var(--c-5f5c56)',
        lineHeight: 1.75,
        textWrap: 'pretty',
        ...style,
      }}
    >
      {text.split('\n').map((line, i) => {
        const bullet = line.match(BULLET_RE);
        if (bullet) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ flexShrink: 0, color: 'var(--c-a5a29a)' }}>•</span>
              <span style={{ minWidth: 0 }}>
                <Inline
                  text={bullet[1]}
                  mentionables={mentionables}
                  sizeOf={sizeOf}
                  onOpenDocument={onOpenDocument}
                />
              </span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} style={{ height: 7 }} />;
        return (
          <div key={i}>
            <Inline text={line} mentionables={mentionables} sizeOf={sizeOf} onOpenDocument={onOpenDocument} />
          </div>
        );
      })}
    </div>
  );
}

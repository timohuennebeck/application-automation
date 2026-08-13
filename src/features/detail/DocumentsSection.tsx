import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import { openDocument } from '../../lib/download';
import { useApp } from '../../state/store-context';
import { DocumentCard } from '../../ui/DocumentCard';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { DocFormat, DotsGlyph } from '../../ui/icons';

export function DocumentsSection({ card }: { card: { id: string; role: string; company: string } }) {
  const { st, set, replaceDocument } = useApp();
  const [error, setError] = useState<string | null>(null);
  /* Sizes by stored path, read from disk rather than stored — a row that lost
     its file would otherwise keep quoting a size that is no longer true. */
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const docs = st.documentsByApp[card.id] || [];

  const paths = docs.flatMap((d) => [d.file_path, d.pdf_path].filter((p): p is string => !!p));
  const key = paths.join(',') + '|' + docs.map((d) => d.updated_at).join(',');
  useEffect(() => {
    if (!paths.length) return;
    let live = true;
    window.desktop?.documents
      .sizes(paths)
      .then((list) => {
        if (live) setSizes(Object.fromEntries(paths.map((p, i) => [p, list[i]])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // The key changes whenever a document is replaced, which is when a size can move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!docs.length) return null;

  const caption = (d: (typeof docs)[number]) => {
    const updated = d.updated_at > d.created_at;
    const day = isoToDate((updated ? d.updated_at : d.created_at).slice(0, 10));
    return (updated ? 'aktualisiert am ' : 'erstellt am ') + day;
  };

  const open = (d: (typeof docs)[number], filePath: string | null) => {
    set({ dropdown: null });
    openDocument(filePath, d.title, card).then(setError);
  };

  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={docs.length} gap={10}>
      {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {docs.map((d) => {
          const menuKey = 'doc:' + d.id;
          return (
            <DocumentCard
              key={d.id}
              /* Red once there is a PDF to hand over, orange otherwise: a
                 document here is an HTML one whether or not its file has been
                 generated yet. The drained glyph belongs to the profile, where
                 an empty slot is a state you are meant to act on. */
              format={d.pdf_path ? DocFormat.PDF : DocFormat.HTML}
              title={d.title}
              caption={caption(d)}
              hint="Öffnen"
              /* The PDF is the finished thing, so that is what a plain click
                 opens; the HTML behind it stays one menu entry away. */
              onClick={() => open(d, d.pdf_path ?? d.file_path)}
            >
              {/* stopPropagation throughout, or the card's own click would open
                  the document behind the menu. */}
              <PopoverAnchor>
                <div
                  className="doc-dl"
                  title="Mehr"
                  onClick={(e) => {
                    e.stopPropagation();
                    setError(null);
                    set((s) => ({ dropdown: s.dropdown === menuKey ? null : menuKey }));
                  }}
                >
                  <DotsGlyph />
                </div>
                {st.dropdown === menuKey && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Popover top={32} right={0} minWidth={196}>
                      {/* Only the renditions that exist are named. A document
                          that has no files yet keeps the plain wording, because
                          what it hands over is the placeholder export — calling
                          that "HTML" would be a promise it does not keep. */}
                      {d.file_path ? (
                        <MenuItem onClick={() => open(d, d.file_path)}>
                          <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>HTML herunterladen</span>
                          <Size bytes={sizes[d.file_path]} />
                        </MenuItem>
                      ) : (
                        !d.pdf_path && <MenuItem onClick={() => open(d, null)}>Herunterladen</MenuItem>
                      )}
                      {d.pdf_path && (
                        <MenuItem onClick={() => open(d, d.pdf_path)}>
                          <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>PDF herunterladen</span>
                          <Size bytes={sizes[d.pdf_path]} />
                        </MenuItem>
                      )}
                      <MenuItem
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => {
                          set({ dropdown: null });
                          replaceDocument(card.id, d.id, d.kind, d.title).then(setError);
                        }}
                      >
                        Ersetzen mit eigener Datei
                      </MenuItem>
                    </Popover>
                  </div>
                )}
              </PopoverAnchor>
            </DocumentCard>
          );
        })}
      </div>
    </Section>
  );
}

/* The size beside a menu entry, left out entirely when the file is not there to
   be measured. */
function Size({ bytes }: { bytes?: number | null }) {
  const text = formatBytes(bytes ?? null);
  if (!text) return null;
  return <span style={{ fontSize: 11.5, color: 'var(--c-a5a29a)' }}>{text}</span>;
}

import { useEffect, useState } from 'react';
import { openDocument } from '../../lib/download';
import { documentCaption } from './document-caption';
import { useApp } from '../../state/store-context';
import { DocumentCard } from '../../ui/DocumentCard';
import { MenuItem, MenuSize } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { DocFormat, DotsGlyph } from '../../ui/icons';

export function DocumentsSection({ card }: { card: { id: string; role: string; company: string } }) {
  const { st, set, replaceDocument } = useApp();
  const [error, setError] = useState<string | null>(null);
  /* Sizes by stored path, read from disk rather than stored — a row that lost
     its file would otherwise keep quoting a size that is no longer true. */
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  /* Every application carries an empty slot per document kind from the moment
     it is created; the section only lists the ones that have a file behind
     them, so a fresh card shows no documents until Kepler (or the user) has
     actually put one there. */
  const docs = (st.documentsByApp[card.id] || []).filter((d) => d.file_path || d.pdf_path);

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
              /* Red once there is a PDF to hand over, orange for HTML only. */
              format={d.pdf_path ? DocFormat.PDF : DocFormat.HTML}
              title={d.title}
              caption={documentCaption(d)}
              hint="Öffnen"
              /* The HTML is what a plain click opens, so the document lands in
                 the browser the way a template does in the profile. The PDF
                 stays one menu entry away, where Vorschau gets it instead. */
              onClick={() => open(d, d.file_path ?? d.pdf_path)}
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
                      {/* Only the renditions that exist are named. */}
                      {d.file_path && (
                        <MenuItem onClick={() => open(d, d.file_path)}>
                          <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>HTML herunterladen</span>
                          <MenuSize bytes={sizes[d.file_path]} />
                        </MenuItem>
                      )}
                      {d.pdf_path && (
                        <MenuItem onClick={() => open(d, d.pdf_path)}>
                          <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>PDF herunterladen</span>
                          <MenuSize bytes={sizes[d.pdf_path]} />
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

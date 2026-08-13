import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import { openDocument } from '../../lib/download';
import { useApp } from '../../state/store-context';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { DocGlyph, DotsGlyph } from '../../ui/icons';

export function DocumentsSection({ card }: { card: { id: string; role: string; company: string } }) {
  const { st, set, replaceDocument } = useApp();
  const [error, setError] = useState<string | null>(null);
  /* Sizes by document id, read from disk rather than stored — a row that lost
     its file would otherwise keep quoting a size that is no longer true. */
  const [sizes, setSizes] = useState<Record<number, number | null>>({});
  const docs = st.documentsByApp[card.id] || [];

  const stored = docs.filter((d) => d.file_path);
  const key = stored.map((d) => d.id + ':' + d.updated_at).join(',');
  useEffect(() => {
    if (!stored.length) return;
    let live = true;
    window.desktop?.documents
      .sizes(stored.map((d) => d.file_path as string))
      .then((list) => {
        if (live) setSizes(Object.fromEntries(stored.map((d, i) => [d.id, list[i]])));
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
    return d.format.toUpperCase() + ' · ' + (updated ? 'aktualisiert am ' : 'erstellt am ') + day;
  };

  const open = (d: (typeof docs)[number]) => {
    set({ dropdown: null });
    openDocument(d.file_path, d.title, card).then(setError);
  };

  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={docs.length} gap={10}>
      {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {docs.map((d) => {
          const menuKey = 'doc:' + d.id;
          const size = formatBytes(sizes[d.id] ?? null);
          return (
            <div key={d.id} className="doc-card" title="Öffnen" onClick={() => open(d)}>
              <DocGlyph />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{d.title}</div>
                <div style={{ fontSize: 11, color: 'var(--c-9a978f)' }}>{caption(d)}</div>
              </div>
              {/* stopPropagation throughout, or the card's own click would open
                  the document behind the menu. */}
              <PopoverAnchor style={{ marginLeft: 'auto', flexShrink: 0 }}>
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
                    <Popover top={32} right={0} minWidth={176}>
                      <MenuItem onClick={() => open(d)}>
                        <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>Herunterladen</span>
                        {size && <span style={{ fontSize: 11.5, color: 'var(--c-a5a29a)' }}>{size}</span>}
                      </MenuItem>
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
            </div>
          );
        })}
      </div>
    </Section>
  );
}

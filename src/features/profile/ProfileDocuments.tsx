import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { ProfileDocumentInfo } from '../../shared/domain';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { DocumentCard } from '../../ui/DocumentCard';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { DocFormat, DotsGlyph } from '../../ui/icons';

/* Which glyph a stored file gets — by extension, since that is all a listing
   knows about it. */
function formatOf(name: string): DocFormat {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pdf') return DocFormat.PDF;
  if (ext === 'html' || ext === 'htm') return DocFormat.HTML;
  return DocFormat.FILE;
}

/* The files that belong to you but are not templates — Immatrikulations-
   bescheinigung, Zeugnisse, Zertifikate. Like the templates they are read
   from disk when the dialog opens; a file's name is its id. */
export function ProfileDocuments() {
  const { st, set } = useApp();
  const [docs, setDocs] = useState<ProfileDocumentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.desktop?.profileDocuments
      .list()
      .then((d) => {
        if (live) setDocs(d);
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const add = useCallback(async () => {
    const api = window.desktop;
    if (!api) {
      setError('Ohne Desktop-Umgebung nicht möglich.');
      return;
    }
    setError(null);
    try {
      const added = await api.profileDocuments.add('Dokumente auswählen');
      if (!added) return; // cancelled
      /* Re-sort rather than append: the list is what the folder shows, and
         the folder is by name. */
      setDocs((d) => [...(d ?? []), ...added].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('[profile-documents]', err);
      setError(String(err));
    }
  }, []);

  const open = useCallback(
    async (name: string) => {
      set({ dropdown: null });
      setError(null);
      const err = await window.desktop?.profileDocuments.open(name);
      if (err) setError(err);
    },
    [set],
  );

  const remove = useCallback(
    async (name: string) => {
      set({ dropdown: null });
      setError(null);
      try {
        await window.desktop?.profileDocuments.remove(name);
        setDocs((d) => (d ?? []).filter((x) => x.name !== name));
      } catch (err) {
        console.error('[profile-documents]', err);
        setError(String(err));
      }
    },
    [set],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
      {(docs ?? []).map((doc, i, all) => {
        const menuKey = 'profile-doc:' + doc.name;
        /* The dialog body scrolls; the last card's menu opens upwards rather
           than off the bottom edge. */
        const flipUp = i === all.length - 1 && all.length > 1;
        return (
          <DocumentCard
            key={doc.name}
            format={formatOf(doc.name)}
            title={doc.name}
            caption={formatBytes(doc.size) + ' · hinzugefügt am ' + isoToDate(doc.day)}
            hint="Öffnen"
            onClick={() => open(doc.name)}
          >
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
                  <Popover
                    top={32}
                    style={flipUp ? { top: 'auto', bottom: 32 } : undefined}
                    right={0}
                    minWidth={160}
                  >
                    <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => open(doc.name)}>
                      Herunterladen
                    </MenuItem>
                    <MenuItem danger style={{ whiteSpace: 'nowrap' }} onClick={() => remove(doc.name)}>
                      Löschen
                    </MenuItem>
                  </Popover>
                </div>
              )}
            </PopoverAnchor>
          </DocumentCard>
        );
      })}
      <AddRow label="Dokument hinzufügen" onClick={add} />
    </div>
  );
}

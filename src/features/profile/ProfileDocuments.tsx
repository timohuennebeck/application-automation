import { useCallback, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { ProfileDocumentInfo } from '../../shared/domain';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { DocumentCard } from '../../ui/DocumentCard';
import { DotsMenu } from '../../ui/DotsMenu';
import { MenuItem } from '../../ui/MenuItem';
import { DocFormat } from '../../ui/icons';
import { useDesktopList } from '../../ui/useDesktopList';

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
  const { set } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useDesktopList<ProfileDocumentInfo[]>(
    () => window.desktop?.profileDocuments.list(),
    setError,
  );

  const add = useCallback(async () => {
    const api = window.desktop;
    if (!api) {
      setError('Ohne Desktop-Umgebung nicht möglich.');
      return;
    }
    setError(null);
    try {
      const added = await api.profileDocuments.add('Unterlagen auswählen');
      if (!added) return; // cancelled
      /* Re-sort rather than append: the list is what the folder shows, and
         the folder is by name. */
      setDocs((d) => [...(d ?? []), ...added].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('[profile-documents]', err);
      setError(String(err));
    }
  }, [setDocs]);

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
    [set, setDocs],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
      {(docs ?? []).map((doc, i, all) => (
        <DocumentCard
          key={doc.name}
          format={formatOf(doc.name)}
          title={doc.name}
          caption={formatBytes(doc.size) + ' · hinzugefügt am ' + isoToDate(doc.day)}
          hint="Öffnen"
          onClick={() => open(doc.name)}
        >
          <DotsMenu
            menuKey={'profile-doc:' + doc.name}
            /* The dialog body scrolls; the last card's menu opens upwards
               rather than off the bottom edge. */
            flipUp={i === all.length - 1 && all.length > 1}
            minWidth={160}
            onOpen={() => setError(null)}
          >
            <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => open(doc.name)}>
              Herunterladen
            </MenuItem>
            <MenuItem danger style={{ whiteSpace: 'nowrap' }} onClick={() => remove(doc.name)}>
              Löschen
            </MenuItem>
          </DotsMenu>
        </DocumentCard>
      ))}
      <AddRow label="Unterlage hinzufügen" onClick={add} />
    </div>
  );
}

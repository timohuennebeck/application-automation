import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { documentCaption, documentDisplayName, documentFormat } from './document-caption';
import { useApp } from '../../state/store-context';
import { agentLocked } from '../../state/selectors';
import { DocumentCard } from '../../ui/DocumentCard';
import { DotsMenu, DownloadItem } from '../../ui/DotsMenu';
import { MenuItem } from '../../ui/MenuItem';
import { Section } from '../../ui/Section';
import { DocFormat } from '../../ui/icons';
import { ERROR_TEXT } from '../../ui/styles';

const DROP_HINT = 'Dateien hierher ziehen oder auswählen';

export function DocumentsSection({ cardId }: { cardId: string }) {
  const { st, set, addDocumentFiles, pickDocuments, deleteDocument } = useApp();
  /* PROOFS can still rewrite a generated Anschreiben while the run is in
     flight — the editor opening it would race that rewrite's write-back and
     the two PDF renders. Gate on the same lock the card's own fields already
     respect instead of teaching the editor to re-read a file out from under
     itself.

     An ask is the same race stretched over a minute and a half: ask() checks
     for an open editor once, before the model call, and the write lands when
     it returns. Opening the letter in between and typing one word would have
     use-document-save flush the pre-edit document over Kepler's write 700 ms
     later — with the thread already showing the green "aktualisiert" line
     over a file that no longer carries the change. So the card stays shut for
     as long as the answer is owed. */
  const locked = agentLocked(st, cardId) || !!st.keplerAsk[cardId]?.pending;
  const [error, setError] = useState<string | null>(null);
  /* Whether a dragged file is over the dropzone, for the highlight — purely
     local, redrawn on every dragenter/dragleave. */
  const [dragOver, setDragOver] = useState(false);
  /* Sizes by stored path, read from disk rather than stored — a row that lost
     its file would otherwise keep quoting a size that is no longer true. */
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  /* Every upload is a row with a file. The rows without one are the empty
     slots applications used to be created with; nothing fills them any more,
     so they are not shown. */
  const docs = (st.documentsByApp[cardId] || []).filter((d) => d.file_path || d.pdf_path);

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
    // The key changes whenever a document is added or saved, which is when a size can move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const open = (filePath: string | null) => {
    set({ dropdown: null });
    if (!filePath) return;
    window.desktop?.documents
      .open(filePath)
      .then((err) => setError(err || null))
      .catch((err) => setError(String(err)));
  };

  /* Everything dropped goes in — no native dialog, no picking a kind: a file
     is what its name says it is. */
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    set({ dropdown: null });
    const api = window.desktop;
    if (!api) return;
    const sourcePaths = Array.from(e.dataTransfer.files, (f) => api.documents.pathForFile(f)).filter(Boolean);
    addDocumentFiles(cardId, sourcePaths).then(setError);
  };

  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={docs.length} gap={10}>
      {error && <div style={ERROR_TEXT}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {docs.map((d) => {
          /* A generated document opens in the app and can be typed in — but
             only if the HTML the editor works on is actually there. An
             uploaded file has no such source, so it lands with the OS. */
          const editable = !!d.file_path && d.file_path.toLowerCase().endsWith('.html') && !locked;
          const name = documentDisplayName(d);
          return (
            <DocumentCard
              key={d.id}
              format={documentFormat(d)}
              title={name}
              caption={documentCaption(d)}
              hint={editable ? 'Überarbeiten' : 'Öffnen'}
              onClick={() =>
                editable ? set({ editorCardId: cardId, editorKind: d.kind }) : open(d.file_path ?? d.pdf_path)
              }
            >
              <DotsMenu menuKey={'doc:' + d.id} onOpen={() => setError(null)}>
                {/* Only the renditions that exist are named. A generated
                    document has its HTML and the PDF rendered from it; an
                    upload is one file. */}
                {d.file_path && (
                  <DownloadItem
                    label={d.pdf_path ? 'HTML herunterladen' : 'Herunterladen'}
                    bytes={sizes[d.file_path]}
                    onClick={() => open(d.file_path)}
                  />
                )}
                {d.pdf_path && (
                  <DownloadItem
                    label="PDF herunterladen"
                    bytes={sizes[d.pdf_path]}
                    onClick={() => open(d.pdf_path)}
                  />
                )}
                <MenuItem
                  danger
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => {
                    set({ dropdown: null });
                    deleteDocument(cardId, d.id);
                  }}
                >
                  Löschen
                </MenuItem>
              </DotsMenu>
            </DocumentCard>
          );
        })}
        <DocumentCard
          format={DocFormat.EMPTY}
          title="Unterlage hinzufügen"
          caption={DROP_HINT}
          hint={DROP_HINT}
          muted
          dragOver={dragOver}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
          onClick={() => {
            set({ dropdown: null });
            pickDocuments(cardId).then(setError);
          }}
        />
      </div>
    </Section>
  );
}

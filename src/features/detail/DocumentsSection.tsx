import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { documentCaption, documentDisplayName } from './document-caption';
import { useApp } from '../../state/store-context';
import { agentLocked } from '../../state/selectors';
import { DocumentCard } from '../../ui/DocumentCard';
import { DotsMenu, DownloadItem } from '../../ui/DotsMenu';
import { MenuItem } from '../../ui/MenuItem';
import { Section } from '../../ui/Section';
import type { DocumentKind } from '../../shared/enums';
import { DocFormat } from '../../ui/icons';
import { ERROR_TEXT } from '../../ui/styles';

export function DocumentsSection({ cardId }: { cardId: string }) {
  const { st, set, replaceDocument, uploadDocumentFile } = useApp();
  /* PROOFS can still rewrite the Anschreiben while the run is in flight — the
     editor opening it would race that rewrite's write-back and the two PDF
     renders. Gate on the same lock the card's own fields already respect
     instead of teaching the editor to re-read a file out from under itself.

     An ask is the same race stretched over a minute and a half: ask() checks
     for an open editor once, before the model call, and the write lands when
     it returns. Opening the letter in between and typing one word would have
     use-document-save flush the pre-edit document over Kepler's write 700 ms
     later — with the thread already showing the green "aktualisiert" line
     over a file that no longer carries the change. So the card stays shut for
     as long as the answer is owed. */
  const locked = agentLocked(st, cardId) || !!st.keplerAsk[cardId]?.pending;
  const [error, setError] = useState<string | null>(null);
  /* Which slot a dragged file is currently hovering over, for the highlight —
     purely local, redrawn on every dragenter/dragleave. */
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  /* Sizes by stored path, read from disk rather than stored — a row that lost
     its file would otherwise keep quoting a size that is no longer true. */
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  /* Every application carries an empty slot per document kind from the moment
     it is created — the CV and the cover letter are written and uploaded by
     hand now, so the section shows both slots from the start rather than
     waiting for a file to exist before it has anything to say. */
  const docs = st.documentsByApp[cardId] || [];

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

  const open = (filePath: string | null) => {
    set({ dropdown: null });
    if (!filePath) return;
    window.desktop?.documents
      .open(filePath)
      .then((err) => setError(err || null))
      .catch((err) => setError(String(err)));
  };

  /* One file dropped onto a slot goes straight into it — no native dialog, no
     picking a kind: the card it landed on says which document it is. Only the
     first file counts; a multi-file drop is not something a single slot can
     hold. */
  const drop = (documentId: number, kind: DocumentKind, title: string) => (e: DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    set({ dropdown: null });
    const file = e.dataTransfer.files[0];
    if (!file || !window.desktop) return;
    const sourcePath = window.desktop.documents.pathForFile(file);
    if (!sourcePath) return;
    uploadDocumentFile(cardId, documentId, kind, title, sourcePath).then(setError);
  };

  return (
    <Section sectionKey="docs" title="Bewerbungsunterlagen" count={docs.length} gap={10}>
      {error && <div style={ERROR_TEXT}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {docs.map((d) => {
          const hasFile = !!(d.file_path || d.pdf_path);
          /* Both generated documents open in the app and can be typed in — but
             only if the HTML the editor works on is actually there. A document
             replaced by a PDF of the user's own has none, so it lands in the
             browser the way a template does in the profile; the PDF stays one
             menu entry away, where Vorschau gets it instead. */
          const editable = !!d.file_path && !locked;
          const onDragOver = (e: DragEvent) => {
            e.preventDefault();
            setDragOverId(d.id);
          };
          const onDragLeave = () => setDragOverId((id) => (id === d.id ? null : id));
          const onDrop = drop(d.id, d.kind, d.title);

          if (!hasFile) {
            return (
              <DocumentCard
                key={d.id}
                format={DocFormat.EMPTY}
                title={d.title}
                caption="Datei hierher ziehen oder auswählen"
                hint="Datei hierher ziehen oder auswählen"
                muted
                dragOver={dragOverId === d.id}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => {
                  set({ dropdown: null });
                  replaceDocument(cardId, d.id, d.kind, d.title).then(setError);
                }}
              />
            );
          }

          return (
            <DocumentCard
              key={d.id}
              /* Red once there is a PDF to hand over, orange for HTML only. */
              format={d.pdf_path ? DocFormat.PDF : DocFormat.HTML}
              title={documentDisplayName(d)}
              caption={documentCaption(d)}
              hint={editable ? 'Überarbeiten' : 'Öffnen'}
              dragOver={dragOverId === d.id}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() =>
                editable ? set({ editorCardId: cardId, editorKind: d.kind }) : open(d.file_path ?? d.pdf_path)
              }
            >
              <DotsMenu menuKey={'doc:' + d.id} onOpen={() => setError(null)}>
                {/* Only the renditions that exist are named. */}
                {d.file_path && (
                  <DownloadItem
                    label="HTML herunterladen"
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
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => {
                    set({ dropdown: null });
                    replaceDocument(cardId, d.id, d.kind, d.title).then(setError);
                  }}
                >
                  Ersetzen mit eigener Datei
                </MenuItem>
              </DotsMenu>
            </DocumentCard>
          );
        })}
      </div>
    </Section>
  );
}

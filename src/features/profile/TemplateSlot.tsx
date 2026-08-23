import { useRef, useState, type CSSProperties } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { TemplateVersion } from '../../shared/domain';
import type { DocumentLanguage, TemplateKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { DocumentCard } from '../../ui/DocumentCard';
import { DotsMenu, DownloadItem } from '../../ui/DotsMenu';
import { MenuItem } from '../../ui/MenuItem';
import { SelectDot } from '../../ui/SelectDot';
import { DocFormat } from '../../ui/icons';

const byLabel = (a: TemplateVersion, b: TemplateVersion) => a.label.localeCompare(b.label, 'de');

/* The rename input takes exactly the cell the label had, so the words do not
   move when the menu entry is picked. */
const RENAME_INPUT: CSSProperties = {
  width: '100%',
  minWidth: 0,
  font: 'inherit',
  fontWeight: 600,
  color: 'var(--c-1b1a17)',
  border: 'none',
  padding: 0,
  background: 'transparent',
  outline: 'none',
};

/* One language side of a template slot: every Fassung as a card, the dot on
   the left marking the one Kepler uses for applications in that language, and
   a row to add another. All writes go through the desktop bridge and the
   parent's list is patched with what came back, so the cards always show what
   is on disk. */
export function TemplateSlot({
  kind,
  language,
  title,
  versions,
  loaded,
  onChange,
  onError,
}: {
  kind: TemplateKind;
  language: DocumentLanguage;
  title: string;
  versions: TemplateVersion[];
  /* False until the first listing landed — nothing is claimed about the slot. */
  loaded: boolean;
  /* Updater form, applied to the list as it stands when the bridge answers —
     a slow call (openPdf renders in a hidden window) must not clobber a
     selection made while it was in flight. */
  onChange: (update: (prev: TemplateVersion[]) => TemplateVersion[]) => void;
  onError: (msg: string | null) => void;
}) {
  const { set } = useApp();
  /* The label whose file is being written; '' while a new Fassung is copied. */
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ label: string; draft: string } | null>(null);
  /* Enter blurs the input and blur commits; a second blur while the rename is
     in flight must not commit again. */
  const committing = useRef(false);

  const desktop = () => {
    const api = window.desktop;
    if (!api) onError('Ohne Desktop-Umgebung nicht möglich.');
    return api;
  };

  /* The shared frame of every bridge write: menu closed, error line cleared,
     failures shown on the dialog's error line. */
  const act = async (fn: (api: NonNullable<typeof window.desktop>) => Promise<void>) => {
    const api = desktop();
    set({ dropdown: null });
    if (!api) return;
    onError(null);
    try {
      await fn(api);
    } catch (err) {
      onError(String(err));
    }
  };

  /* Replaces (or adds) the one Fassung the bridge reported back. */
  const patch = (v: TemplateVersion, replacing = v.label) =>
    onChange((prev) => [...prev.filter((x) => x.label !== replacing), v].sort(byLabel));

  /* Native picker → copy; the caller decides whether that adds a Fassung or
     swaps the file of an existing one. */
  const pickAndWrite = (
    label: string,
    write: (api: NonNullable<typeof window.desktop>, source: string) => Promise<TemplateVersion>,
  ) =>
    act(async (api) => {
      /* Same native picker the document cards use — only the title and the
         offered file type differ. */
      const source = await api.documents.pick('Vorlage auswählen', 'html');
      if (!source) return; // cancelled
      setBusy(label);
      try {
        patch(await write(api, source));
      } finally {
        setBusy(null);
      }
    });

  const add = () => pickAndWrite('', (api, source) => api.templates.add(kind, language, source));
  const replace = (label: string) =>
    pickAndWrite(label, (api, source) => api.templates.replace(kind, language, label, source));

  const select = (label: string) =>
    act(async (api) => {
      await api.templates.select(kind, language, label);
      onChange((prev) => prev.map((v) => ({ ...v, selected: v.label === label })));
    });

  const open = (label: string) =>
    act(async (api) => {
      const err = await api.templates.open(kind, language, label);
      if (err) onError(err);
    });

  const openPdf = (label: string) =>
    act(async (api) => patch(await api.templates.openPdf(kind, language, label)));

  const remove = (label: string) =>
    act(async (api) => {
      await api.templates.remove(kind, language, label);
      onChange((prev) => prev.filter((v) => v.label !== label));
    });

  /* The input stays until the bridge has answered: leaving it on Enter would
     show the old label for the round trip and then flip — a flash. */
  const commitRename = async () => {
    const r = renaming;
    if (!r || committing.current) return;
    if (r.draft.trim() === r.label) {
      setRenaming(null);
      return;
    }
    committing.current = true;
    await act(async (api) => patch(await api.templates.rename(kind, language, r.label, r.draft), r.label));
    committing.current = false;
    setRenaming(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-5f5c56)' }}>{title}</div>

      {versions.length === 0 && (
        /* Nothing uploaded yet: the drained glyph is what says so — the card
           itself stays the card, and clicking it goes straight to the picker. */
        <DocumentCard
          format={DocFormat.EMPTY}
          title={title}
          caption={busy === '' ? 'wird übernommen …' : loaded ? 'HTML-Datei auswählen' : ' '}
          hint="HTML-Datei auswählen"
          muted
          onClick={add}
        />
      )}

      {versions.map((v, i) => {
        const working = busy === v.label;
        const isRenaming = renaming?.label === v.label;
        return (
          <DocumentCard
            key={v.label}
            format={DocFormat.HTML}
            title={
              isRenaming ? (
                <input
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ label: v.label, draft: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') {
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                  style={RENAME_INPUT}
                />
              ) : (
                v.label
              )
            }
            caption={
              working
                ? 'wird übernommen …'
                : v.name + ' · ' + formatBytes(v.size) + ' · aktualisiert am ' + isoToDate(v.day)
            }
            hint={v.selected ? 'Diese Fassung nutzt Kepler' : 'Diese Fassung verwenden'}
            muted={!v.selected}
            leading={<SelectDot on={v.selected} />}
            /* The whole card is the choice, the dot just shows it; opening the
               file is one menu entry away. */
            onClick={() => {
              if (!v.selected) select(v.label);
            }}
          >
            <DotsMenu
              menuKey={`template:${kind}:${language}:${v.label}`}
              /* The dialog body scrolls; the last card's menu opens upwards
                 rather than off the bottom edge. */
              flipUp={i === versions.length - 1 && versions.length > 1}
              onOpen={() => onError(null)}
            >
              <DownloadItem label="HTML herunterladen" bytes={v.size} onClick={() => open(v.label)} />
              <DownloadItem label="PDF herunterladen" bytes={v.pdfSize} onClick={() => openPdf(v.label)} />
              <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => replace(v.label)}>
                Ersetzen mit eigener Datei
              </MenuItem>
              <MenuItem
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  set({ dropdown: null });
                  setRenaming({ label: v.label, draft: v.label });
                }}
              >
                Umbenennen
              </MenuItem>
              {/* The selected Fassung stays: a slot with files always has one
                  Kepler can use. */}
              <MenuItem
                danger
                disabled={v.selected}
                title={v.selected ? 'Wird gerade verwendet' : undefined}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  if (!v.selected) remove(v.label);
                }}
              >
                Löschen
              </MenuItem>
            </DotsMenu>
          </DocumentCard>
        );
      })}

      {versions.length > 0 && <AddRow label="Fassung hinzufügen" onClick={add} />}
    </div>
  );
}

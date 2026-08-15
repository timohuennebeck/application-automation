import { useRef, useState, type CSSProperties } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { TemplateVersion } from '../../shared/domain';
import type { TemplateKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { DocumentCard } from '../../ui/DocumentCard';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { SelectDot } from '../../ui/SelectDot';
import { DocFormat, DotsGlyph } from '../../ui/icons';

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

/* One template slot of the profile: every Fassung as a card, the dot on the
   left marking the one Kepler uses, and a row to add another. All writes go
   through the desktop bridge and the parent's list is patched with what came
   back, so the cards always show what is on disk. */
export function TemplateSlot({
  kind,
  title,
  versions,
  loaded,
  onChange,
  onError,
}: {
  kind: TemplateKind;
  title: string;
  versions: TemplateVersion[];
  /* False until the first listing landed — nothing is claimed about the slot. */
  loaded: boolean;
  onChange: (next: TemplateVersion[]) => void;
  onError: (msg: string | null) => void;
}) {
  const { st, set } = useApp();
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

  /* Replaces (or adds) the one Fassung the bridge reported back. */
  const patch = (v: TemplateVersion) =>
    onChange([...versions.filter((x) => x.label !== v.label), v].sort(byLabel));

  /* Native picker → copy; the caller decides whether that adds a Fassung or
     swaps the file of an existing one. */
  const pickAndWrite = async (
    label: string,
    write: (api: NonNullable<typeof window.desktop>, source: string) => Promise<TemplateVersion>,
  ) => {
    const api = desktop();
    set({ dropdown: null });
    if (!api) return;
    onError(null);
    try {
      /* Same native picker the document cards use — only the title and the
         offered file type differ. */
      const source = await api.documents.pick('Vorlage auswählen', 'html');
      if (!source) return; // cancelled
      setBusy(label);
      patch(await write(api, source));
    } catch (err) {
      console.error('[templates]', err);
      onError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const add = () => pickAndWrite('', (api, source) => api.templates.add(kind, source));
  const replace = (label: string) =>
    pickAndWrite(label, (api, source) => api.templates.replace(kind, label, source));

  const select = async (label: string) => {
    const api = desktop();
    if (!api) return;
    onError(null);
    try {
      await api.templates.select(kind, label);
      onChange(versions.map((v) => ({ ...v, selected: v.label === label })));
    } catch (err) {
      onError(String(err));
    }
  };

  const open = async (label: string) => {
    set({ dropdown: null });
    onError(null);
    const err = await window.desktop?.templates.open(kind, label);
    if (err) onError(err);
  };

  const openPdf = async (label: string) => {
    set({ dropdown: null });
    onError(null);
    const err = await window.desktop?.templates.openPdf(kind, label);
    if (err) onError(err);
  };

  const remove = async (label: string) => {
    const api = desktop();
    set({ dropdown: null });
    if (!api) return;
    onError(null);
    try {
      await api.templates.remove(kind, label);
      onChange(versions.filter((v) => v.label !== label));
    } catch (err) {
      onError(String(err));
    }
  };

  /* The input stays until the bridge has answered: leaving it on Enter would
     show the old label for the round trip and then flip — a flash. */
  const commitRename = async () => {
    const r = renaming;
    if (!r || committing.current) return;
    const api = desktop();
    if (!api || r.draft.trim() === r.label) {
      setRenaming(null);
      return;
    }
    committing.current = true;
    onError(null);
    try {
      const v = await api.templates.rename(kind, r.label, r.draft);
      onChange([...versions.filter((x) => x.label !== r.label), v].sort(byLabel));
    } catch (err) {
      onError(String(err));
    } finally {
      committing.current = false;
      setRenaming(null);
    }
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
        const menuKey = `template:${kind}:${v.label}`;
        const working = busy === v.label;
        /* The dialog body scrolls; the last card's menu opens upwards rather
           than off the bottom edge. */
        const flipUp = i === versions.length - 1 && versions.length > 1;
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
            {/* stopPropagation throughout, or the card's own click would fire
                behind the menu. */}
            <PopoverAnchor>
              <div
                className="doc-dl"
                title="Mehr"
                onClick={(e) => {
                  e.stopPropagation();
                  onError(null);
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
                    minWidth={196}
                  >
                    <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => open(v.label)}>
                      Im Browser öffnen
                    </MenuItem>
                    <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => openPdf(v.label)}>
                      PDF herunterladen
                    </MenuItem>
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
                    {/* The selected Fassung stays: a slot with files always has
                        one Kepler can use. */}
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
                  </Popover>
                </div>
              )}
            </PopoverAnchor>
          </DocumentCard>
        );
      })}

      {versions.length > 0 && <AddRow label="Fassung hinzufügen" onClick={add} />}
    </div>
  );
}

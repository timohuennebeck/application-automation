import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../../lib/bytes';
import { isoToDate } from '../../lib/date';
import type { TemplateInfo } from '../../shared/domain';
import { TemplateKind } from '../../shared/enums';
import { CLOSED_PROFILE, useApp } from '../../state/store-context';
import { DocumentCard } from '../../ui/DocumentCard';
import { FieldGroup, ModalShell } from '../../ui/ModalShell';
import { FactList } from './FactList';
import { ProfileDocuments } from './ProfileDocuments';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { DocFormat, DotsGlyph } from '../../ui/icons';

type Slots = Record<TemplateKind, TemplateInfo | null>;

const EMPTY_SLOTS: Slots = { [TemplateKind.LEBENSLAUF]: null, [TemplateKind.ANSCHREIBEN]: null };

const SLOTS: { kind: TemplateKind; title: string }[] = [
  { kind: TemplateKind.LEBENSLAUF, title: 'Lebenslauf' },
  /* Named as the application's own document is, so the template and what it
     produces read as the same thing. The stored value stays ANSCHREIBEN. */
  { kind: TemplateKind.ANSCHREIBEN, title: 'Cover Letter' },
];

/* The two documents that belong to you rather than to a single application.
   There is no table behind them: the dialog reads the two files from disk when
   it opens, so it always shows what is really there. */
export function ProfileModal() {
  const { st, set } = useApp();
  const [slots, setSlots] = useState<Slots | null>(null);
  const [busy, setBusy] = useState<TemplateKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.desktop?.templates
      .list()
      .then((s) => {
        if (live) setSlots(s);
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const upload = useCallback(
    async (kind: TemplateKind) => {
      const api = window.desktop;
      set({ dropdown: null });
      if (!api) {
        setError('Ohne Desktop-Umgebung nicht möglich.');
        return;
      }
      setError(null);
      try {
        /* Same native picker the document cards use — only the title and the
         offered file type differ. */
        const source = await api.documents.pick('Vorlage auswählen', 'html');
        if (!source) return; // cancelled
        setBusy(kind);
        const info = await api.templates.save(kind, source);
        /* Falls back to a blank pair rather than dropping the upload: the initial
         listing may still be in flight, or may have failed outright. */
        setSlots((s) => ({ ...(s ?? EMPTY_SLOTS), [kind]: info }));
      } catch (err) {
        console.error('[templates]', err);
        setError(String(err));
      } finally {
        setBusy(null);
      }
    },
    [set],
  );

  const open = useCallback(
    async (kind: TemplateKind) => {
      set({ dropdown: null });
      setError(null);
      const err = await window.desktop?.templates.open(kind);
      if (err) setError(err);
    },
    [set],
  );

  return (
    <ModalShell
      onClose={() => set(CLOSED_PROFILE)}
      header={<div style={{ fontSize: 15, fontWeight: 600 }}>Profil</div>}
    >
      <FieldGroup
        label="Templates"
        hint="Deine beiden HTML-Templates. Für jede Bewerbung wird eine Kopie davon ausgefüllt und als PDF exportiert — die Originale hier bleiben unberührt."
      >
        {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SLOTS.map(({ kind, title }, i) => {
            const info = slots?.[kind] ?? null;
            const working = busy === kind;
            const filled = !!info && !working;
            const menuKey = 'template:' + kind;
            const flipUp = i === SLOTS.length - 1;
            const caption = working
              ? 'wird übernommen …'
              : info
                ? info.name + ' · ' + formatBytes(info.size) + ' · aktualisiert am ' + isoToDate(info.day)
                : /* Nothing is claimed about the slot until the listing lands;
                   the blank keeps the card's height. */
                  slots
                  ? 'HTML-Datei auswählen'
                  : ' ';
            return (
              <DocumentCard
                key={kind}
                /* The drained glyph is what says "nothing here yet" — the card
                 itself stays the card. */
                format={filled ? DocFormat.HTML : DocFormat.EMPTY}
                title={title}
                caption={caption}
                hint={filled ? 'Öffnen' : 'HTML-Datei auswählen'}
                muted={!filled}
                /* A filled slot opens on click, an empty one has nothing to open
                 and goes straight to the picker. */
                onClick={() => (filled ? open(kind) : upload(kind))}
              >
                {/* stopPropagation throughout, or the card's own click would fire
                  behind the menu. */}
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
                      {/* The dialog body scrolls, so the lower slot's menu opens
                        upwards rather than off the bottom edge of the card. */}
                      <Popover
                        top={32}
                        style={flipUp ? { top: 'auto', bottom: 32 } : undefined}
                        right={0}
                        minWidth={196}
                      >
                        {filled ? (
                          <>
                            <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => open(kind)}>
                              Herunterladen
                            </MenuItem>
                            <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => upload(kind)}>
                              Ersetzen mit eigener Datei
                            </MenuItem>
                          </>
                        ) : (
                          <MenuItem style={{ whiteSpace: 'nowrap' }} onClick={() => upload(kind)}>
                            {title} hochladen
                          </MenuItem>
                        )}
                      </Popover>
                    </div>
                  )}
                </PopoverAnchor>
              </DocumentCard>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup
        label="Dokumente"
        hint="Weitere Unterlagen, die du griffbereit haben willst — Immatrikulationsbescheinigung, etc. Beliebiges Format."
      >
        <ProfileDocuments />
      </FieldGroup>

      <FieldGroup
        label="Kontext"
        hint="Füge alles hinzu, was dich persönlicher macht — Sprachen, ein Umzug, etc."
      >
        <FactList />
      </FieldGroup>
    </ModalShell>
  );
}

import { useEffect, useState } from 'react';
import type { TemplateVersion } from '../../shared/domain';
import { TemplateKind } from '../../shared/enums';
import { CLOSED_PROFILE, useApp } from '../../state/store-context';
import { FieldGroup, ModalShell } from '../../ui/ModalShell';
import { FactList } from './FactList';
import { ProfileDocuments } from './ProfileDocuments';
import { TemplateSlot } from './TemplateSlot';

type Slots = Record<TemplateKind, TemplateVersion[]>;

const EMPTY_SLOTS: Slots = { [TemplateKind.LEBENSLAUF]: [], [TemplateKind.ANSCHREIBEN]: [] };

const SLOTS: { kind: TemplateKind; title: string }[] = [
  { kind: TemplateKind.LEBENSLAUF, title: 'Lebenslauf' },
  { kind: TemplateKind.ANSCHREIBEN, title: 'Anschreiben' },
];

/* The documents that belong to you rather than to a single application. There
   is no table behind them: the dialog reads the Fassungen from disk when it
   opens, so it always shows what is really there. */
export function ProfileModal() {
  const { set } = useApp();
  const [slots, setSlots] = useState<Slots | null>(null);
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

  return (
    <ModalShell
      onClose={() => set(CLOSED_PROFILE)}
      header={<div style={{ fontSize: 15, fontWeight: 600 }}>Profil</div>}
    >
      <FieldGroup
        label="Templates"
        hint="Deine HTML-Templates. Du kannst je mehrere Fassungen halten — der Punkt markiert die, die Kepler für neue Bewerbungen nutzt. Die Originale bleiben unberührt."
      >
        {error && <div style={{ fontSize: 11.5, color: 'var(--c-c2564c)', lineHeight: 1.45 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {SLOTS.map(({ kind, title }) => (
            <TemplateSlot
              key={kind}
              kind={kind}
              title={title}
              versions={slots?.[kind] ?? []}
              loaded={slots !== null}
              /* Falls back to a blank pair rather than dropping the change: the
                 initial listing may still be in flight, or may have failed. */
              onChange={(next) => setSlots((s) => ({ ...(s ?? EMPTY_SLOTS), [kind]: next }))}
              onError={setError}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup
        label="Unterlagen"
        hint="Alles, was du griffbereit haben willst — Immatrikulationsbescheinigung, Zeugnisse, etc. Beliebiges Format."
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

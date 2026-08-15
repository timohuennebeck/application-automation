import type { TemplateSlots } from '../../shared/domain';
import { TEMPLATE_TITLES, TemplateKind } from '../../shared/enums';
import { CLOSED_PROFILE, useApp } from '../../state/store-context';
import { useState } from 'react';
import { FieldGroup, ModalShell } from '../../ui/ModalShell';
import { useDesktopList } from '../../ui/useDesktopList';
import { FactList } from './FactList';
import { ProfileDocuments } from './ProfileDocuments';
import { TemplateSlot } from './TemplateSlot';

const EMPTY_SLOTS: TemplateSlots = { [TemplateKind.LEBENSLAUF]: [], [TemplateKind.ANSCHREIBEN]: [] };

/* The documents that belong to you rather than to a single application. There
   is no table behind them: the dialog reads the Fassungen from disk when it
   opens, so it always shows what is really there. */
export function ProfileModal() {
  const { set } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useDesktopList(() => window.desktop?.templates.list(), setError);

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
          {Object.values(TemplateKind).map((kind) => (
            <TemplateSlot
              key={kind}
              kind={kind}
              title={TEMPLATE_TITLES[kind]}
              versions={slots?.[kind] ?? []}
              loaded={slots !== null}
              /* Applied to the list as it stands — falling back to a blank
                 pair rather than dropping the change: the initial listing may
                 still be in flight, or may have failed. */
              onChange={(update) =>
                setSlots((s) => {
                  const prev = s ?? EMPTY_SLOTS;
                  return { ...prev, [kind]: update(prev[kind]) };
                })
              }
              onError={setError}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup
        label="Unterlagen"
        hint="Unterlagen welche du griffbereit haben willst — Immatrikulationsbescheinigung, etc. Beliebiges Format."
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

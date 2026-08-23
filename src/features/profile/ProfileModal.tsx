import type { TemplateSlots } from '../../shared/domain';
import { DocumentLanguage, LANGUAGE_TITLES, TEMPLATE_TITLES, TemplateKind } from '../../shared/enums';
import { CLOSED_PROFILE, useApp } from '../../state/store-context';
import { useState } from 'react';
import { FieldGroup, ModalShell } from '../../ui/ModalShell';
import { useDesktopList } from '../../ui/useDesktopList';
import { FactList } from './FactList';
import { ProfileDocuments } from './ProfileDocuments';
import { TemplateSlot } from './TemplateSlot';
import { ERROR_TEXT } from '../../ui/styles';

const EMPTY_SIDES = { [DocumentLanguage.DE]: [], [DocumentLanguage.EN]: [] };
const EMPTY_SLOTS: TemplateSlots = {
  [TemplateKind.LEBENSLAUF]: EMPTY_SIDES,
  [TemplateKind.ANSCHREIBEN]: EMPTY_SIDES,
};

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
        hint="Deine HTML-Templates, je auf Deutsch und auf Englisch. Du kannst je mehrere Fassungen halten — der Punkt markiert die, die Kepler für Bewerbungen in dieser Sprache nutzt. Die Originale bleiben unberührt."
      >
        {error && <div style={ERROR_TEXT}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {Object.values(TemplateKind).map((kind) => (
            <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-1b1a17)' }}>
                {TEMPLATE_TITLES[kind]}
              </div>
              {/* The two sides of a slot sit under one heading: the card's
                  language decides which of them a run reads, so they are
                  the same document twice rather than two documents. */}
              {Object.values(DocumentLanguage).map((language) => (
                <TemplateSlot
                  key={language}
                  kind={kind}
                  language={language}
                  title={LANGUAGE_TITLES[language]}
                  versions={slots?.[kind][language] ?? []}
                  loaded={slots !== null}
                  /* Applied to the list as it stands — falling back to blank
                     slots rather than dropping the change: the initial
                     listing may still be in flight, or may have failed. */
                  onChange={(update) =>
                    setSlots((s) => {
                      const prev = s ?? EMPTY_SLOTS;
                      return { ...prev, [kind]: { ...prev[kind], [language]: update(prev[kind][language]) } };
                    })
                  }
                  onError={setError}
                />
              ))}
            </div>
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

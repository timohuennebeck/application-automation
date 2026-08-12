import { SKILLS } from '../../data/sample-data';
import { useApp } from '../../state/store-context';
import { ChipToggle } from '../../ui/ChipToggle';
import { FieldHint, FieldLabel, ModalShell, SubmitButton } from '../../ui/ModalShell';
import { KeplerAvatar } from '../../ui/icons';

/* ⌘B dialog: paste a posting URL and pick the skills Kepler should evaluate. */
export function NewApplicationModal() {
  const { st, set, createCard } = useApp();
  const close = () => set({ modalOpen: false });

  return (
    <ModalShell
      onClose={close}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: 'var(--c-5f5c56)' }}>
          <span>Erfasst von</span>
          <KeplerAvatar size={22} fontSize={11} />
          <span style={{ color: 'var(--c-1b1a17)', fontWeight: 600 }}>Kepler</span>
        </div>
      }
      footer={
        <>
          <div onClick={() => set((s) => ({ multiple: !s.multiple }))} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div style={{
              width: 30, height: 17, borderRadius: 999, display: 'flex', alignItems: 'center', padding: 2,
              boxSizing: 'border-box', background: st.multiple ? 'var(--c-1b1a17)' : 'var(--c-dedbd4)',
              justifyContent: st.multiple ? 'flex-end' : 'flex-start',
            }}>
              <div style={{ width: 13, height: 13, borderRadius: '50%', background: 'var(--c-fff)', boxShadow: '0 1px 2px var(--s-15)' }} />
            </div>
            <span style={{ fontSize: 13.5, color: 'var(--c-5f5c56)' }}>Erstelle mehrere</span>
          </div>
          <SubmitButton label="Erstellen" onClick={createCard} />
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={st.jobUrl}
          autoFocus
          placeholder="https://…"
          onChange={(e) => set({ jobUrl: e.target.value })}
          style={{ fontSize: 15, color: 'var(--c-1b1a17)', lineHeight: 1.5, border: 'none', outline: 'none', background: 'transparent', width: '100%', padding: 0 }}
        />
        <FieldHint>Link zur Stellenanzeige einfügen. Kepler liest Titel, Unternehmen und Anforderungen automatisch aus.</FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Fähigkeiten auswählen, die ausgewertet werden</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SKILLS.map(([name], i) => (
            <ChipToggle
              key={name}
              label={name}
              selected={st.selected[i]}
              onClick={() => set((s) => {
                const next = s.selected.slice();
                next[i] = !next[i];
                return { selected: next };
              })}
            />
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

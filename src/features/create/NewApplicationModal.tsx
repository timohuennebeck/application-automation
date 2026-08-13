import { useApp } from '../../state/store-context';
import { FieldHint, FieldLabel, ModalShell, SubmitButton } from '../../ui/ModalShell';
import { Avatar, Check, KeplerAvatar } from '../../ui/icons';

/* ⌘C dialog: paste a posting URL, describe the role and pick the people the
   card should carry as contacts. */
export function NewApplicationModal() {
  const { st, set, createCard, person } = useApp();
  const close = () => set({ modalOpen: false });

  const directory = Object.keys(st.people).map(person);

  const togglePerson = (key: string) =>
    set((s) => ({
      jobPeople: s.jobPeople.includes(key) ? s.jobPeople.filter((k) => k !== key) : [...s.jobPeople, key],
    }));

  return (
    <ModalShell
      onClose={close}
      header={
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: 'var(--c-5f5c56)' }}
        >
          <span>Erfasst von</span>
          <KeplerAvatar size={22} fontSize={11} />
          <span style={{ color: 'var(--c-1b1a17)', fontWeight: 600 }}>Kepler</span>
        </div>
      }
      footer={
        <>
          <div
            onClick={() => set((s) => ({ multiple: !s.multiple }))}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <div
              style={{
                width: 30,
                height: 17,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                padding: 2,
                boxSizing: 'border-box',
                background: st.multiple ? 'var(--c-1b1a17)' : 'var(--c-dedbd4)',
                justifyContent: st.multiple ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  background: 'var(--c-fff)',
                  boxShadow: '0 1px 2px var(--s-15)',
                }}
              />
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
          style={{
            fontSize: 15,
            color: 'var(--c-1b1a17)',
            lineHeight: 1.5,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            width: '100%',
            minWidth: 0,
            padding: 0,
          }}
        />
        <FieldHint>
          Link zur Stellenanzeige einfügen. Kepler liest Titel, Unternehmen und Anforderungen automatisch aus.
        </FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Beschreibung</FieldLabel>
        <textarea
          value={st.jobDescription}
          rows={3}
          placeholder="Worum geht es in der Rolle?"
          onChange={(e) => set({ jobDescription: e.target.value })}
          style={{
            fontSize: 13.5,
            color: 'var(--c-1b1a17)',
            lineHeight: 1.55,
            fontFamily: 'inherit',
            border: 'none',
            boxShadow: 'inset 0 0 0 1px var(--c-cfccc3)',
            borderRadius: 6,
            padding: '8px 10px',
            outline: 'none',
            resize: 'vertical',
            background: 'var(--c-fff)',
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        />
        <FieldHint>Kurze Notiz zur Stelle. Sie steht später als Zusammenfassung an der Karte.</FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Kontaktpersonen</FieldLabel>
        {directory.length === 0 ? (
          <FieldHint>Noch keine Personen angelegt. Kontakte lassen sich an der Karte hinzufügen.</FieldHint>
        ) : (
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 3 }}
          >
            {directory.map((p) => {
              const sel = st.jobPeople.includes(p.key);
              return (
                <div
                  key={p.key}
                  className="menu-item"
                  onClick={() => togglePerson(p.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '5px 8px',
                    borderRadius: 7,
                    minWidth: 0,
                    background: sel ? 'var(--c-f1efe9)' : 'transparent',
                  }}
                >
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 4,
                      boxSizing: 'border-box',
                      border: '1px solid ' + (sel ? 'var(--c-1b1a17)' : 'var(--c-cfccc3)'),
                      background: sel ? 'var(--c-1b1a17)' : 'var(--c-fff)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {sel && <Check size={9} stroke="var(--c-fff)" strokeWidth={1.9} />}
                  </div>
                  <Avatar bg={p.bg} size={20} fontSize={8.5}>
                    {p.initials}
                  </Avatar>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: 'var(--c-28261f)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--c-a5a29a)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.role || 'Position fehlt'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

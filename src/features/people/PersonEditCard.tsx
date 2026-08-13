import { isoToDate, todayISO } from '../../lib/date';
import { initials } from '../../lib/text';
import { useApp } from '../../state/store-context';
import { Avatar } from '../../ui/icons';

interface FieldDef {
  label: string;
  prop: 'name' | 'role' | 'email' | 'phone' | 'linkedin';
  placeholder: string;
  link?: boolean;
}

const FIELDS: FieldDef[] = [
  { label: 'Name', prop: 'name', placeholder: '—' },
  { label: 'Position', prop: 'role', placeholder: '—' },
  { label: 'E-Mail', prop: 'email', placeholder: '—', link: true },
  { label: 'Telefon', prop: 'phone', placeholder: '—' },
  { label: 'LinkedIn', prop: 'linkedin', placeholder: '—', link: true },
];

/* Inline person editor shown inside a popover, from a participant chip or a
   contact picker. Field edits land in `personFieldDraft` and are folded into
   `personDraft` on blur (or by savePerson when the popover is dismissed). */
export function PersonEditCard({
  personKey,
  subExtra,
  canDelete,
  onDelete,
  onDone,
}: {
  personKey: string;
  /* e.g. " · in 3 Runden" appended after the name. */
  subExtra?: string;
  canDelete: boolean;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { st, set, person } = useApp();
  const draft = st.personDraft || {};
  const p = person(personKey);
  const liveName = ((st.personField === 'name' ? st.personFieldDraft : draft.name) || '').trim();
  const stored = st.people[personKey];

  return (
    <div style={{ padding: '8px 9px 9px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Avatar bg={p.bg} size={26} fontSize={10}>
          {initials(liveName || '?') || '?'}
        </Avatar>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 0', minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--c-a5a29a)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {liveName ? liveName + (subExtra || '') : 'Person hinzufügen'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--c-c3c0b8)', whiteSpace: 'nowrap' }}>
            {stored?.updatedAt
              ? 'Bearbeitet am ' + stored.updatedAt
              : 'Erstellt am ' + (stored?.createdAt || isoToDate(todayISO()))}
          </div>
        </div>
        <div className="pop-x" onClick={onDone}>
          ✕
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FIELDS.map((f) => {
          const v = draft[f.prop] || '';
          const editing = st.personField === f.prop;
          return (
            <div key={f.prop} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 64, flexShrink: 0, fontSize: 11.5, color: 'var(--c-9a978f)' }}>
                {f.label}
              </div>
              {editing ? (
                <input
                  value={st.personFieldDraft}
                  autoFocus
                  onChange={(e) => set({ personField: f.prop, personFieldDraft: e.target.value })}
                  onBlur={() =>
                    set((s) =>
                      s.personField !== f.prop
                        ? {}
                        : {
                            personDraft: { ...s.personDraft, [f.prop]: (s.personFieldDraft || '').trim() },
                            personField: null,
                            personFieldDraft: '',
                          },
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      set({ personField: null, personFieldDraft: '' });
                    }
                  }}
                  style={{
                    fontSize: 12,
                    color: 'var(--c-28261f)',
                    lineHeight: 1.45,
                    border: 'none',
                    borderRadius: 5,
                    padding: '2px 6px',
                    marginLeft: -6,
                    background: 'var(--c-fff)',
                    boxShadow: 'inset 0 0 0 1px var(--c-cfccc3)',
                    outline: 'none',
                    flex: '1 1 0',
                    minWidth: 0,
                  }}
                />
              ) : (
                <div
                  className="pfield"
                  onClick={() => set({ personField: f.prop, personFieldDraft: v })}
                  style={{ color: v ? (f.link ? 'var(--c-3f6ea8)' : 'var(--c-28261f)') : 'var(--c-c3c0b8)' }}
                >
                  {v || f.placeholder}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Only an existing person can be deleted. A new one that is closed
          without a name is undone by savePerson anyway. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {canDelete && (
          <div className="btn-ghost" onClick={onDelete} title="Aus allen Bewerbungen entfernen">
            Person löschen
          </div>
        )}
        <div className="btn-dark" onClick={onDone}>
          Fertig
        </div>
      </div>
    </div>
  );
}

import { initials } from '../../lib/text';
import type { LinkKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import type { ContactEntry } from '../../state/store-context';
import { FieldChip } from '../../ui/FieldChip';
import { Popover, PopoverVariant } from '../../ui/Popover';
import { Avatar } from '../../ui/icons';
import { PeoplePicker } from './PeoplePicker';
import { PersonEditCard } from './PersonEditCard';

/* Contact chip plus its picker popover. `popKey` keeps the sidebar copy and the
   follow-up copy independent, since both can be on screen at once. */
export function ContactPicker({
  popKey, cardId, company, list, onSave, store, avatarRing = 'var(--c-f6f5f1)', avatarSize = 17, align = 'left',
}: {
  popKey: string;
  cardId: string;
  company: string;
  list: ContactEntry[];
  onSave: (list: ContactEntry[]) => void;
  /* Which link list this picker writes. */
  store: LinkKind;
  avatarRing?: string;
  avatarSize?: number;
  align?: 'left' | 'right';
}) {
  const { st, set, peopleForCard, savePerson, deletePerson } = useApp();
  const open = st.contactEdit === popKey;
  const editing = st.personEdit?.forContact === popKey && st.personEdit.id === cardId ? st.personEdit : null;

  const toggle = (key: string) => {
    const p = peopleForCard(cardId).find((s) => s.key === key);
    if (!p) return;
    const pid = Number(key);
    const sel = list.some((c) => c.personId === pid);
    onSave(sel
      ? list.filter((c) => c.personId !== pid)
      : list.concat([{ personId: pid, name: p.name, role: p.role || '', email: p.email || '', phone: p.phone || '', linkedin: p.linkedin || '', bg: p.bg }]));
  };

  /* The person row is only written to the DB once the editor is saved with a
     name (savePerson); until then the draft lives under the 'pending' key. */
  const startCreate = (name: string) => set({
    personEdit: { id: cardId, ri: -1, key: 'pending', isNew: true, forContact: popKey, contactStore: store },
    personDraft: { name, role: '', email: '', phone: '', linkedin: '' },
    personField: 'name', personFieldDraft: name, editing: null, dropdown: null,
  });

  const stack = (list.length ? list : [{ name: '?', bg: 'var(--c-b3b0a8)' }]).slice(0, 3);
  const label = list.length === 0
    ? 'Kein Kontakt ausgewählt'
    : list.length === 1 ? list[0].name : list[0].name + ' +' + (list.length - 1);

  return (
    <>
      <FieldChip
        open={open}
        gap={6}
        style={{ padding: '2px 6px 2px 3px' }}
        onClick={() => set((s) => ({ contactEdit: s.contactEdit === popKey ? null : popKey, contactDraft: '', dropdown: null, editing: null }))}
        onClear={list.length ? () => { onSave([]); set({ contactEdit: null }); } : undefined}
        clearTitle="Kontaktperson entfernen"
      >
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {stack.map((c, i) => (
            <Avatar key={i} bg={c.bg || 'var(--c-7a5aa8)'} size={avatarSize} style={{ boxShadow: '0 0 0 1.5px ' + avatarRing, marginLeft: i ? -6 : 0 }}>
              {list.length ? initials(c.name) || '?' : '–'}
            </Avatar>
          ))}
        </div>
        <span style={{ fontSize: 12 }}>{label}</span>
      </FieldChip>

      {open && (
        <Popover variant={PopoverVariant.PANEL} top={27} {...(align === 'right' ? { right: 0 } : { left: -6 })} width={288} style={{ maxWidth: 'calc(100vw - 48px)' }}>
          {editing ? (
            <PersonEditCard
              personKey={editing.key}
              canDelete={false}
              onDelete={() => deletePerson(cardId, editing.key, true)}
              onDone={savePerson}
            />
          ) : (
            <PeoplePicker
              draft={st.contactDraft}
              onDraftChange={(v) => set({ contactDraft: v })}
              company={company}
              people={peopleForCard(cardId)}
              isSelected={(key) => list.some((c) => c.personId === Number(key))}
              onToggle={toggle}
              onCreate={startCreate}
              onClose={() => set({ contactEdit: null, contactDraft: '' })}
            />
          )}
        </Popover>
      )}
    </>
  );
}

import type { LinkKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import type { ContactEntry } from '../../state/store-context';
import { PeoplePicker } from './PeoplePicker';
import { PersonEditCard } from './PersonEditCard';

interface ContactPickerBodyProps {
  /* Names this picker, so two open at once cannot edit each other's draft. */
  popKey: string;
  cardId: string;
  company: string;
  list: ContactEntry[];
  onSave: (list: ContactEntry[]) => void;
  /* Which link list this picker writes. */
  store: LinkKind;
  onClose: () => void;
}

/* The contents of every contact popover: the people picker, or the editor for
   a person being created from it. Shared by the sidebar and follow-up chips
   (ContactPicker) and the board card's picker, which floats at the cursor. */
export function ContactPickerBody({
  popKey,
  cardId,
  company,
  list,
  onSave,
  store,
  onClose,
}: ContactPickerBodyProps) {
  const { st, set, person, peopleForCard, companyOfCard, savePerson, deletePerson } = useApp();
  const editing = st.personEdit?.forContact === popKey && st.personEdit.id === cardId ? st.personEdit : null;

  const toggle = (key: string) => {
    const p = peopleForCard(cardId).find((s) => s.key === key);
    if (!p) return;
    const pid = Number(key);
    const sel = list.some((c) => c.personId === pid);
    onSave(
      sel
        ? list.filter((c) => c.personId !== pid)
        : list.concat([
            {
              personId: pid,
              name: p.name,
              role: p.role || '',
              email: p.email || '',
              phone: p.phone || '',
              linkedin: p.linkedin || '',
              bg: p.bg,
            },
          ]),
    );
  };

  /* The person row is only written to the DB once the editor is saved with a
     name (savePerson); until then the draft lives under the 'pending' key. */
  const startCreate = (name: string) =>
    set({
      personEdit: {
        id: cardId,
        ri: -1,
        key: 'pending',
        isNew: true,
        forContact: popKey,
        contactStore: store,
      },
      /* A person added from this card is filed under its company by default
         (never under the placeholder a cleared card sits at). */
      personDraft: { name, role: '', email: '', phone: '', linkedin: '', company: companyOfCard(cardId) },
      personField: 'name',
      personFieldDraft: name,
      editing: null,
      dropdown: null,
    });

  /* An existing person opens the same editor, only already named — which is
     what turns "Löschen" on inside it. */
  const startEdit = (key: string) =>
    set(() => {
      const p = person(key);
      return {
        personEdit: { id: cardId, ri: -1, key, isNew: false, forContact: popKey, contactStore: store },
        personDraft: {
          name: p.name,
          role: p.role,
          email: p.email || '',
          phone: p.phone || '',
          linkedin: p.linkedin || '',
          company: p.company,
        },
        personField: null,
        personFieldDraft: '',
        editing: null,
        dropdown: null,
      };
    });

  if (editing) {
    return (
      <PersonEditCard
        personKey={editing.key}
        canDelete={!editing.isNew}
        onDelete={() => deletePerson(cardId, editing.key, editing.isNew)}
        onDone={savePerson}
      />
    );
  }

  return (
    <PeoplePicker
      draft={st.contactDraft}
      onDraftChange={(v) => set({ contactDraft: v })}
      company={company}
      people={peopleForCard(cardId)}
      isSelected={(key) => list.some((c) => c.personId === Number(key))}
      onToggle={toggle}
      onEdit={startEdit}
      onCreate={startCreate}
      onClose={onClose}
    />
  );
}

import { initials } from '../../lib/text';
import type { LinkKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import type { ContactEntry } from '../../state/store-context';
import { AvatarStack, stackLabel } from '../../ui/AvatarStack';
import { FieldChip } from '../../ui/FieldChip';
import { Popover, PopoverVariant } from '../../ui/Popover';
import { ContactPickerBody } from './ContactPickerBody';

/* Contact chip plus its picker popover. `popKey` keeps the sidebar copy and the
   follow-up copy independent, since both can be on screen at once. */
export function ContactPicker({
  popKey,
  cardId,
  company,
  list,
  onSave,
  store,
  avatarSize = 17,
  align = 'left',
}: {
  popKey: string;
  cardId: string;
  company: string;
  list: ContactEntry[];
  onSave: (list: ContactEntry[]) => void;
  /* Which link list this picker writes. */
  store: LinkKind;
  avatarSize?: number;
  align?: 'left' | 'right';
}) {
  const { st, set } = useApp();
  const open = st.contactEdit === popKey;

  const stack = list.map((c) => ({
    initials: initials(c.name) || '?',
    bg: c.bg || 'var(--c-7a5aa8)',
  }));
  const label = stackLabel(list.map((c) => c.name));

  return (
    /* Names this picker's chip and popover, so the outside-click handler can
       tell a click on another popover's surface from one on this picker. */
    <span data-contact-pop={popKey} style={{ display: 'contents' }}>
      <FieldChip
        open={open}
        chevron
        gap={6}
        style={{ padding: '2px 6px 2px 3px' }}
        onClick={() =>
          set((s) => ({
            contactEdit: s.contactEdit === popKey ? null : popKey,
            contactDraft: '',
            dropdown: null,
            editing: null,
          }))
        }
        onClear={
          list.length
            ? () => {
                onSave([]);
                set({ contactEdit: null });
              }
            : undefined
        }
        clearTitle="Kontaktperson entfernen"
      >
        <AvatarStack people={stack} ring="var(--c-f6f5f1)" size={avatarSize} />
        <span style={{ fontSize: 12 }}>{label}</span>
      </FieldChip>

      {open && (
        <Popover
          variant={PopoverVariant.PANEL}
          top={27}
          {...(align === 'right' ? { right: 0 } : { left: -6 })}
          width={288}
          style={{ maxWidth: 'calc(100vw - 48px)' }}
        >
          <ContactPickerBody
            popKey={popKey}
            cardId={cardId}
            company={company}
            list={list}
            onSave={onSave}
            store={store}
            onClose={() => set({ contactEdit: null, contactDraft: '' })}
          />
        </Popover>
      )}
    </span>
  );
}

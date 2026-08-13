import { LinkKind } from '../../shared/enums';
import { cardView } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { Popover, PopoverVariant } from '../../ui/Popover';
import { ContactPickerBody } from '../people/ContactPickerBody';

const WIDTH = 288;
/* Roughly the tallest the picker gets (search, suggestions, create row), used
   to keep it inside the window when a card sits near the bottom. */
const HEIGHT = 300;
const EDGE = 8;

export const CARD_CONTACT_KEY = 'card-contact';

/* Contact picker for a board card. The board scroller clips its columns, so
   this floats at the cursor in viewport coordinates and is rendered at the
   shell level — the same treatment the card context menu gets. */
export function CardContactPicker() {
  const { st, set, contactsFor, setContacts } = useApp();
  const at = st.cardContact;
  if (!at) return null;

  const card = cardView(st, at.id);
  if (!card) return null;

  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - HEIGHT - EDGE));

  return (
    <div data-dd="1">
      <Popover
        variant={PopoverVariant.PANEL}
        top={top}
        left={left}
        width={WIDTH}
        zIndex={60}
        style={{ position: 'fixed', maxWidth: 'calc(100vw - 16px)' }}
      >
        <ContactPickerBody
          popKey={CARD_CONTACT_KEY}
          cardId={at.id}
          company={card.company}
          list={contactsFor(at.id)}
          onSave={(list) => setContacts(at.id, list)}
          store={LinkKind.CONTACT}
          onClose={() => set({ cardContact: null, contactDraft: '' })}
        />
      </Popover>
    </div>
  );
}

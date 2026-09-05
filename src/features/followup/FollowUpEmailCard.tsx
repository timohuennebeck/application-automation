import { useEffect, useRef, useState } from 'react';
import { isoToDate, shiftISO, shiftYM, todayISO } from '../../lib/date';
import { LinkKind } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { CalendarPopover } from '../../ui/Calendar';
import { FieldChip } from '../../ui/FieldChip';
import { PopoverAnchor } from '../../ui/Popover';
import { Caret, Check, ClipboardGlyph, KeplerAvatar } from '../../ui/icons';
import { ContactPicker } from '../people/ContactPicker';
import { draftEmail, dueColor, dueLabel, type FollowUpSlot } from './schedule';
import { ELLIPSIS } from '../../ui/styles';

const COPIED_MS = 1400;

/* Wide enough for "Kontaktperson", the longest label in this card. */
const LABEL = {
  fontSize: 11.5,
  color: 'var(--c-9a978f)',
  width: 88,
  flexShrink: 0,
  lineHeight: 1.35,
} as const;

/* Kepler's drafted follow-up: due date, addressee, subject and collapsible body.
   An unsent draft is rendered live from the card, so it follows every change
   of role, company or addressee — however that change was made. Ticking a
   follow-up off freezes the text on its row: from then on the card shows what
   actually went out. */
export function FollowUpEmailCard({
  cardId,
  role,
  company,
  slots,
  sel,
}: {
  cardId: string;
  role: string;
  company: string;
  slots: FollowUpSlot[];
  sel: number;
}) {
  const {
    st,
    set,
    emailContactsFor,
    setEmailContacts,
    setFollowupDue,
    setFollowupCompleted,
    saveEmailDraft,
  } = useApp();

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  const slot = slots[sel];
  const dueKey = 'due:' + cardId + ':' + sel;
  const dueOpen = st.dropdown === dueKey;
  const today = todayISO();

  // A follow-up may not move earlier than the one before it. It may move past
  // the ones after it, though — setFollowupDue then carries them forward by
  // the same number of days, so the whole cadence stays in order instead of
  // being blocked at the next slot's date.
  const min = sel > 0 ? shiftISO(slots[sel - 1].iso, 1) : today;
  const outOfRange = (iso: string) => iso < min;

  // The calendar spans a year from the due date (or today, whichever is
  // earlier) and always stretches far enough to show the due date itself.
  const fromYM = (slot.iso < today ? slot.iso : today).slice(0, 7);
  const dueYM = slot.iso.slice(0, 7);
  const toYM = shiftYM(fromYM, 11);

  const contacts = emailContactsFor(cardId);
  /* A follow-up ticked off before drafts were frozen has no text of its own
     and falls back to the live one. */
  const frozen = slot.done && slot.emailText != null;
  const { subject, body } = frozen
    ? { subject: slot.emailSubject || '', body: slot.emailText || '' }
    : draftEmail(slots, sel, role, company, contacts[0]?.name || '');

  const preview = body.split('\n').filter(Boolean)[1] || body;
  const words = body.trim().split(/\s+/).length + ' Wörter';

  /* A sent draft is struck through: subject, preview and body, the parts that
     were the message. The word count and the labels stay legible. */
  const sent = slot.done ? ({ textDecoration: 'line-through' } as const) : null;

  /* The tick is cleared on a timer, which has to be dropped if the card goes
     away first — otherwise it fires into an unmounted component. */
  const copy = () => {
    navigator.clipboard?.writeText(subject + '\n\n' + body);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  return (
    <div
      style={{
        width: '100%',
        background: 'var(--c-fff)',
        border: '1px solid var(--c-eae7e0)',
        borderRadius: 10,
        overflow: dueOpen || st.contactEdit ? 'visible' : 'hidden',
        boxShadow: '0 1px 2px var(--s-7)',
      }}
    >
      <div style={{ padding: '13px 14px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeplerAvatar />
          <div style={{ fontSize: 12, color: 'var(--c-8b8880)' }}>Entwurf von Kepler</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <PopoverAnchor style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={LABEL}>Fällig am</div>
            <FieldChip
              open={dueOpen}
              chevron
              gap={5}
              onClick={() => set((s) => ({ dropdown: s.dropdown === dueKey ? null : dueKey, editing: null }))}
            >
              <span style={{ fontSize: 12 }}>{isoToDate(slot.iso)}</span>
              <span style={{ fontSize: 12, color: dueColor(slot) }}>{'· ' + dueLabel(slot)}</span>
            </FieldChip>
            {dueOpen && (
              <CalendarPopover
                /* Lines the calendar up under the chip, past the label column. */
                left={97}
                selectedISO={slot.iso}
                fromYM={fromYM}
                toYM={dueYM > toYM ? dueYM : toYM}
                isDisabled={outOfRange}
                onPick={(iso) => {
                  if (outOfRange(iso)) return;
                  setFollowupDue(cardId, slot.id, iso);
                  set({ dropdown: null });
                }}
              />
            )}
          </PopoverAnchor>

          <PopoverAnchor style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={LABEL}>Kontaktperson</div>
            <div style={{ width: 'fit-content', maxWidth: '100%', minWidth: 0 }}>
              <ContactPicker
                popKey={cardId}
                cardId={cardId}
                company={company}
                list={contacts}
                onSave={(l) => setEmailContacts(cardId, l)}
                store={LinkKind.EMAIL}
              />
            </div>
          </PopoverAnchor>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <div style={LABEL}>Betreff</div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--c-1b1a17)',
                lineHeight: 1.4,
                ...sent,
              }}
            >
              {subject}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div
            className="email-collapse"
            onClick={() => set((s) => ({ emailExpanded: !s.emailExpanded }))}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              cursor: 'pointer',
              padding: '5px 7px',
              margin: '0 -7px',
            }}
          >
            <Caret open={st.emailExpanded} style={{ marginTop: 4 }} />
            {st.emailExpanded ? (
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--c-9a978f)',
                  lineHeight: 1.5,
                  flex: '1 1 0',
                  minWidth: 0,
                }}
              >
                Textnachricht
              </div>
            ) : (
              <>
                <div
                  style={{
                    ...ELLIPSIS,
                    fontSize: 12.5,
                    color: 'var(--c-77746d)',
                    lineHeight: 1.5,
                    flex: '1 1 0',
                    ...sent,
                  }}
                >
                  {preview}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--c-a5a29a)',
                    flexShrink: 0,
                    marginTop: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {words}
                </div>
              </>
            )}
          </div>
          {st.emailExpanded && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--c-3d3a34)',
                lineHeight: 1.65,
                whiteSpace: 'pre-line',
                textWrap: 'pretty',
                paddingLeft: 19,
                ...sent,
              }}
            >
              {body}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* The glyph turns into a tick for a moment — the only sign that a
              copy to an invisible clipboard actually happened. */}
          <div className="icon-btn" title="Kopieren" onClick={copy}>
            {copied ? <Check size={13} /> : <ClipboardGlyph />}
          </div>
          {/* A switch, not a one-way door: the same button opens it again.
              Ticking off freezes the text as sent; opening again lets the
              live draft take over, the frozen text is simply no longer read. */}
          <div
            className="icon-btn"
            onClick={() => {
              if (!slot.done) saveEmailDraft(cardId, slot.id, subject, body);
              setFollowupCompleted(cardId, slot.id, !slot.done);
            }}
          >
            <Check size={13} stroke={slot.done ? 'var(--c-1b1a17)' : 'var(--c-77746d)'} />
          </div>
        </div>
      </div>
    </div>
  );
}

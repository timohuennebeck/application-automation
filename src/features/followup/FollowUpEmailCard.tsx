import { useEffect } from 'react';
import { isoToDate, shiftISO, shiftYM, todayISO } from '../../lib/date';
import { useApp } from '../../state/store-context';
import { CalendarPopover } from '../../ui/Calendar';
import { FieldChip } from '../../ui/FieldChip';
import { PopoverAnchor } from '../../ui/Popover';
import { Caret, CopyGlyph, KeplerAvatar, RegenGlyph } from '../../ui/icons';
import { ContactPicker } from '../people/ContactPicker';
import { draftEmail, type FollowUpSlot } from './schedule';

const LABEL = { fontSize: 11.5, color: 'var(--c-9a978f)', width: 76, flexShrink: 0 } as const;

function LoadingSkeleton() {
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeplerAvatar />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)', animation: 'om-pulse 1.4s ease-in-out infinite' }}>
          Kepler erstellt einen Follow up…
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[38, 88, 76, 54].map((w) => (
          <div key={w} style={{
            height: 9, width: w + '%', borderRadius: 4,
            background: 'linear-gradient(90deg,var(--c-f1efe9) 25%,var(--c-e4e1da) 50%,var(--c-f1efe9) 75%)',
            backgroundSize: '200% 100%', animation: 'om-shimmer 1.3s linear infinite',
          }} />
        ))}
      </div>
    </div>
  );
}

/* Kepler's drafted follow-up: due date, addressee, subject and collapsible body.
   The draft is generated exactly once, stored on the followups row, and read
   from there on every later open; only the regenerate button replaces it. */
export function FollowUpEmailCard({ cardId, role, company, slots, sel }: {
  cardId: string;
  role: string;
  company: string;
  slots: FollowUpSlot[];
  sel: number;
}) {
  const { st, set, emailContactsFor, setEmailContacts, setFollowupDue, saveEmailDraft, regenerateEmail } = useApp();

  const slot = slots[sel];
  const dueKey = 'due:' + cardId + ':' + sel;
  const dueOpen = st.dropdown === dueKey;
  const today = todayISO();

  // A follow-up may not overtake its neighbours in the sequence.
  const min = sel > 0 ? shiftISO(slots[sel - 1].iso, 1) : today;
  const max = sel < slots.length - 1 ? shiftISO(slots[sel + 1].iso, -1) : null;
  const outOfRange = (iso: string) => !(iso >= min && (!max || iso <= max));

  const contacts = emailContactsFor(cardId);
  const stored = slot.emailText != null;
  const { subject, body } = stored
    ? { subject: slot.emailSubject || '', body: slot.emailText || '' }
    : draftEmail(slots, sel, role, company, contacts[0]?.name || '');

  // First open of this follow-up: persist the generated draft silently.
  useEffect(() => {
    if (!stored) saveEmailDraft(cardId, slot.id, subject, body);
  }, [stored, cardId, slot.id, subject, body, saveEmailDraft]);

  const rel = slot.diff === 0 ? '· heute'
    : slot.diff === 1 ? '· morgen'
      : slot.diff > 0 ? '· in ' + slot.diff + ' Tagen'
        : '· seit ' + -slot.diff + ' Tagen überfällig';
  const relColor = slot.diff <= 0 ? 'var(--c-c2564c)' : slot.diff <= 2 ? 'var(--c-9a7218)' : 'var(--c-9a978f)';

  const preview = body.split('\n').filter(Boolean)[1] || body;
  const words = body.trim().split(/\s+/).length + ' Wörter';

  return (
    <div style={{
      width: '100%', background: 'var(--c-fff)', border: '1px solid var(--c-eae7e0)', borderRadius: 10,
      overflow: dueOpen || st.contactEdit ? 'visible' : 'hidden', boxShadow: '0 1px 2px var(--s-7)',
    }}>
      {st.emailLoading ? <LoadingSkeleton /> : (
        <div style={{ padding: '13px 14px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeplerAvatar />
            <div style={{ fontSize: 12, color: 'var(--c-8b8880)' }}>Entwurf von Kepler</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <PopoverAnchor style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={LABEL}>Fällig am</div>
              <FieldChip open={dueOpen} gap={5} onClick={() => set((s) => ({ dropdown: s.dropdown === dueKey ? null : dueKey, editing: null }))}>
                <span style={{ fontSize: 12 }}>{isoToDate(slot.iso)}</span>
                <span style={{ fontSize: 12, color: relColor }}>{rel}</span>
              </FieldChip>
              {dueOpen && (
                <CalendarPopover
                  left={70}
                  selectedISO={slot.iso}
                  fromYM={(slot.iso < today ? slot.iso : today).slice(0, 7)}
                  toYM={(() => {
                    const from = (slot.iso < today ? slot.iso : today).slice(0, 7);
                    const to = shiftYM(from, 11);
                    return slot.iso.slice(0, 7) > to ? slot.iso.slice(0, 7) : to;
                  })()}
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
                  store="email"
                />
              </div>
            </PopoverAnchor>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <div style={LABEL}>Betreff</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-1b1a17)', lineHeight: 1.4 }}>{subject}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div
              className="email-collapse"
              onClick={() => set((s) => ({ emailExpanded: !s.emailExpanded }))}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '5px 7px', margin: '0 -7px' }}
            >
              <Caret open={st.emailExpanded} style={{ marginTop: 4 }} />
              {st.emailExpanded ? (
                <div style={{ fontSize: 11.5, color: 'var(--c-9a978f)', lineHeight: 1.5, flex: '1 1 0', minWidth: 0 }}>Textnachricht</div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--c-77746d)', lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '1 1 0' }}>
                    {preview}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', flexShrink: 0, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{words}</div>
                </>
              )}
            </div>
            {st.emailExpanded && (
              <div style={{ fontSize: 12.5, color: 'var(--c-3d3a34)', lineHeight: 1.65, whiteSpace: 'pre-line', textWrap: 'pretty', paddingLeft: 19 }}>
                {body}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div className="icon-btn" title="Kopieren" onClick={() => navigator.clipboard?.writeText(subject + '\n\n' + body)}>
              <CopyGlyph />
            </div>
            <div
              className="icon-btn"
              title="Neu erstellen"
              onClick={() => {
                const d = draftEmail(slots, sel, role, company, contacts[0]?.name || '');
                regenerateEmail(cardId, slot.id, d.subject, d.body);
              }}
            >
              <RegenGlyph />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

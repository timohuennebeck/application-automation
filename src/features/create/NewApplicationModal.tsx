import type { CSSProperties } from 'react';
import { CHANNEL_BG, CHANNEL_OPTIONS } from '../../data/config';
import { Assignee, DocumentLanguage, LANGUAGE_TITLES } from '../../shared/enums';
import { CLOSED_MODAL } from '../../state/initial-state';
import { useApp } from '../../state/store-context';
import { AssigneeLabel } from '../../ui/AssigneeLabel';
import { FieldChip } from '../../ui/FieldChip';
import { FieldHint, ModalShell, SubmitButton } from '../../ui/ModalShell';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { SelectPopover } from '../../ui/SelectPopover';
import { Switch } from '../../ui/Switch';
import { Avatar, KeplerAvatar } from '../../ui/icons';
import { isHttpUrl } from '../../lib/url';
import { APPLICANT_FIRST_NAME } from '../../shared/applicant';
import { DIALOG_INPUT } from '../../ui/styles';

/* The bare text boxes of the dialog: no border, no padding — the placeholder
   is the whole instruction, the box only the space to type in. */
const PLAIN_TEXTAREA: CSSProperties = {
  fontSize: 13.5,
  color: 'var(--c-1b1a17)',
  lineHeight: 1.55,
  fontFamily: 'inherit',
  border: 'none',
  outline: 'none',
  resize: 'vertical',
  background: 'transparent',
  padding: 0,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
};

/* The dialog's dropdowns share AppState.dropdown with every other select, so
   the global outside-click handler closes them like the rest. */
const CHANNEL_DD = 'jobChannel';
const LANGUAGE_DD = 'jobLanguage';
const ASSIGNEE_DD = 'jobAssignee';

/* Nobody first, then everyone who can own a card — Kepler is the only one. */
const ASSIGNEE_OPTIONS: (Assignee | null)[] = [null, Assignee.KEPLER];

const CHANNEL_HINT = 'Auf welcher Plattform die Stelle gefunden wurde. Ohne Auswahl ergänzt Kepler sie.';
const LANGUAGE_HINT =
  'Die Sprache von Lebenslauf und Anschreiben. Ohne Auswahl nimmt Kepler die Sprache der Stellenanzeige.';

/* ⌘C dialog: paste a posting URL — or, without one, the listing text itself.
   Everything else about the card is optional and sits in one row of chips
   above the footer, the way the board's own property rows read. */
export function NewApplicationModal() {
  const { st, set, createCard } = useApp();
  const close = () => set(CLOSED_MODAL);
  /* A posting link has to be a full web address; anything else is text. */
  const valid = st.jobHasUrl ? isHttpUrl(st.jobUrl) : !!st.jobText.trim();
  const channelOpen = st.dropdown === CHANNEL_DD;
  const languageOpen = st.dropdown === LANGUAGE_DD;
  const assigneeOpen = st.dropdown === ASSIGNEE_DD;
  const toKepler = st.jobAssignee === Assignee.KEPLER;
  /* One dropdown key toggles like the next; spelled out once. */
  const toggle = (key: string) => () => set((s) => ({ dropdown: s.dropdown === key ? null : key }));

  return (
    <ModalShell
      onClose={close}
      overflowVisible={channelOpen || languageOpen || assigneeOpen}
      footerGap={6}
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
          <SubmitButton label="Erstellen" enabled={valid} onClick={createCard} />
        </>
      }
    >
      <Switch
        on={st.jobHasUrl}
        label="Link zur Stellenanzeige vorhanden"
        onClick={() => set((s) => ({ jobHasUrl: !s.jobHasUrl }))}
      />

      {st.jobHasUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            value={st.jobUrl}
            autoFocus
            placeholder="https://…"
            onChange={(e) => set({ jobUrl: e.target.value })}
            style={{ ...DIALOG_INPUT, minWidth: 0 }}
          />
          <FieldHint>
            Link zur Stellenanzeige einfügen. Kepler liest Titel, Unternehmen und Kernanforderungen
            automatisch aus.
          </FieldHint>
        </div>
      ) : (
        /* The empty box plus its one-line placeholder is the whole instruction;
           what Kepler reads out of the text is explained at the chips below. */
        <textarea
          value={st.jobText}
          autoFocus
          rows={6}
          placeholder="Stellenanzeige hier einfügen…"
          onChange={(e) => set({ jobText: e.target.value })}
          style={PLAIN_TEXTAREA}
        />
      )}

      {/* Why this position in particular — Kepler works the motive into the
          Anschreiben's opening instead of guessing one from the posting. Bare
          like the posting box above; the hint says what the text is for. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
        <textarea
          value={st.jobInterestReason}
          rows={2}
          placeholder={`${APPLICANT_FIRST_NAME}, was spricht dich bei dieser Stelle an – Product, Team? (optional)`}
          onChange={(e) => set({ jobInterestReason: e.target.value })}
          style={PLAIN_TEXTAREA}
        />
        <FieldHint>Kepler nutzt das, um deine Bewerbung zu personalisieren.</FieldHint>
      </div>

      {/* What Kepler will do with the card, and the three optional properties
          it would otherwise fill in itself. The notice states the consequence
          of the Bearbeiter chip right next to it, so picking Kepler needs no
          second explanation. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeplerAvatar size={20} fontSize={10} />
          <FieldHint>
            {toKepler
              ? 'Kepler übernimmt die Bewerbung sofort und beginnt mit der Stellenanzeige.'
              : 'Kepler übernimmt, sobald die Bewerbung ihm zugewiesen wird.'}
          </FieldHint>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PopoverAnchor>
            <FieldChip
              open={assigneeOpen}
              empty={!toKepler}
              chevron
              gap={7}
              style={{ padding: '3px 7px' }}
              onClick={toggle(ASSIGNEE_DD)}
              onClear={toKepler ? () => set({ jobAssignee: null, dropdown: null }) : undefined}
              clearTitle="Bearbeiter entfernen"
            >
              <AssigneeLabel assignee={st.jobAssignee} emptyLabel="Bearbeiter" />
            </FieldChip>
            {assigneeOpen && (
              <Popover up minWidth={190} zIndex={70}>
                {ASSIGNEE_OPTIONS.map((a) => (
                  <MenuItem
                    key={a ?? 'none'}
                    selected={a === st.jobAssignee}
                    onClick={() => set({ jobAssignee: a, dropdown: null })}
                  >
                    <AssigneeLabel assignee={a} />
                  </MenuItem>
                ))}
              </Popover>
            )}
          </PopoverAnchor>

          <PopoverAnchor>
            <FieldChip
              open={channelOpen}
              empty={!st.jobChannel}
              chevron
              gap={7}
              title={CHANNEL_HINT}
              style={{ padding: '3px 7px' }}
              onClick={toggle(CHANNEL_DD)}
              onClear={st.jobChannel ? () => set({ jobChannel: '', dropdown: null }) : undefined}
              clearTitle="Plattform entfernen"
            >
              {st.jobChannel ? (
                <>
                  <Avatar bg={CHANNEL_BG[st.jobChannel]} size={16} fontSize={8}>
                    {st.jobChannel.charAt(0)}
                  </Avatar>
                  <span>{st.jobChannel}</span>
                </>
              ) : (
                <span>Plattform</span>
              )}
            </FieldChip>
            {channelOpen && (
              <SelectPopover
                options={CHANNEL_OPTIONS}
                value={st.jobChannel}
                searchable
                openUp
                minWidth={200}
                zIndex={70}
                onPick={(c) => set({ jobChannel: c, dropdown: null })}
                onClose={() => set({ dropdown: null })}
                renderRow={(c) => (
                  <>
                    <Avatar bg={CHANNEL_BG[c]} size={16} fontSize={8}>
                      {c.charAt(0)}
                    </Avatar>
                    <span style={{ whiteSpace: 'nowrap' }}>{c}</span>
                    <span style={{ flex: '1 1 auto' }} />
                  </>
                )}
              />
            )}
          </PopoverAnchor>

          <PopoverAnchor>
            <FieldChip
              open={languageOpen}
              empty={!st.jobLanguage}
              chevron
              gap={7}
              title={LANGUAGE_HINT}
              style={{ padding: '3px 7px' }}
              onClick={toggle(LANGUAGE_DD)}
              onClear={st.jobLanguage ? () => set({ jobLanguage: null, dropdown: null }) : undefined}
              clearTitle="Kepler entscheiden lassen"
            >
              <span>{st.jobLanguage ? LANGUAGE_TITLES[st.jobLanguage] : 'Sprache'}</span>
            </FieldChip>
            {languageOpen && (
              <Popover up minWidth={160} zIndex={70}>
                {Object.values(DocumentLanguage).map((l) => (
                  <MenuItem
                    key={l}
                    selected={l === st.jobLanguage}
                    onClick={() => set({ jobLanguage: l, dropdown: null })}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>{LANGUAGE_TITLES[l]}</span>
                  </MenuItem>
                ))}
              </Popover>
            )}
          </PopoverAnchor>
        </div>
      </div>
    </ModalShell>
  );
}

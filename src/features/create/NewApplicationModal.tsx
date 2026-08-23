import { CHANNEL_BG, CHANNEL_OPTIONS } from '../../data/config';
import { DocumentLanguage, LANGUAGE_TITLES } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { FieldChip } from '../../ui/FieldChip';
import { FieldHint, FieldLabel, ModalShell, SubmitButton } from '../../ui/ModalShell';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { SelectPopover } from '../../ui/SelectPopover';
import { Switch } from '../../ui/Switch';
import { Avatar, KeplerAvatar } from '../../ui/icons';
import { isHttpUrl } from '../../lib/url';
import { DIALOG_INPUT } from '../../ui/styles';

/* The dialog's channel dropdown shares AppState.dropdown with every other
   select, so the global outside-click handler closes it like the rest. */
const CHANNEL_DD = 'jobChannel';
const LANGUAGE_DD = 'jobLanguage';

/* ⌘C dialog: paste a posting URL — or, without one, the listing text itself —
   and pick the channel the posting was found on. */
export function NewApplicationModal() {
  const { st, set, createCard } = useApp();
  const close = () => set({ modalOpen: false });
  /* A posting link has to be a full web address; anything else is text. */
  const valid = st.jobHasUrl ? isHttpUrl(st.jobUrl) : !!st.jobText.trim();
  const channelOpen = st.dropdown === CHANNEL_DD;
  const languageOpen = st.dropdown === LANGUAGE_DD;

  return (
    <ModalShell
      onClose={close}
      overflowVisible={channelOpen || languageOpen}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Switch
          on={st.jobHasUrl}
          label="Link zur Stellenanzeige vorhanden"
          onClick={() => set((s) => ({ jobHasUrl: !s.jobHasUrl }))}
        />
      </div>

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={st.jobText}
            autoFocus
            rows={6}
            placeholder="Stellenanzeige hier einfügen…"
            onChange={(e) => set({ jobText: e.target.value })}
            style={{
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
            }}
          />
          <FieldHint>
            Text der Stellenanzeigenbeschreibung einfügen. Kepler liest Titel, Unternehmen und
            Kernanforderungen daraus aus.
          </FieldHint>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Plattform</FieldLabel>
        <PopoverAnchor style={{ width: 'fit-content' }}>
          <FieldChip
            open={channelOpen}
            empty={!st.jobChannel}
            chevron
            gap={7}
            style={{ padding: '3px 7px' }}
            onClick={() => set((s) => ({ dropdown: s.dropdown === CHANNEL_DD ? null : CHANNEL_DD }))}
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
              <span style={{ color: 'var(--c-a5a29a)' }}>Eintrag auswählen</span>
            )}
          </FieldChip>
          {channelOpen && (
            <SelectPopover
              options={CHANNEL_OPTIONS}
              value={st.jobChannel}
              searchable
              top={28}
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
        <FieldHint>Falls du hier nichts auswählst, ergänzt Kepler die Plattform automatisch.</FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Sprache</FieldLabel>
        <PopoverAnchor style={{ width: 'fit-content' }}>
          <FieldChip
            open={languageOpen}
            empty={!st.jobLanguage}
            chevron
            gap={7}
            style={{ padding: '3px 7px' }}
            onClick={() => set((s) => ({ dropdown: s.dropdown === LANGUAGE_DD ? null : LANGUAGE_DD }))}
            onClear={st.jobLanguage ? () => set({ jobLanguage: null, dropdown: null }) : undefined}
            clearTitle="Kepler entscheiden lassen"
          >
            <span>{st.jobLanguage ? LANGUAGE_TITLES[st.jobLanguage] : 'Kepler entscheidet'}</span>
          </FieldChip>
          {languageOpen && (
            <Popover minWidth={160} zIndex={70}>
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
        <FieldHint>
          Die Sprache von Lebenslauf und Anschreiben. Falls du hier nichts auswählst, nimmt Kepler die Sprache
          der Stellenanzeige.
        </FieldHint>
      </div>
    </ModalShell>
  );
}

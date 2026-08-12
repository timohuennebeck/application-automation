import { CHANNEL_BG, WHERE_OPTIONS } from '../../data/config';
import { dateToISO, isoToDate, shiftYM, todayISO } from '../../lib/date';
import { useApp } from '../../state/store-context';
import { CalendarPopover } from '../../ui/Calendar';
import { ChipToggle } from '../../ui/ChipToggle';
import { FieldHint, FieldLabel, ModalShell, SubmitButton } from '../../ui/ModalShell';
import { PopoverAnchor } from '../../ui/Popover';
import { TimeRangePopover } from '../../ui/TimeRangePicker';
import { Avatar, Check } from '../../ui/icons';

/* Dialog for creating or editing an interview round. */
export function InterviewEditModal({ company, channel }: { company: string; channel: string }) {
  const { st, set, peopleForCard, saveRound, resetRound } = useApp();
  const edit = st.roundEdit;
  const draft = st.roundDraft;
  if (!edit || !draft) return null;

  const setDraft = (patch: Partial<typeof draft>) => set((s) => ({ roundDraft: { ...s.roundDraft!, ...patch } }));
  const today = todayISO();
  const selISO = dateToISO(draft.date);
  const isNew = !!edit.isNew;
  const valid = !isNew || !!(draft.date && draft.time && draft.where && draft.title.trim());
  const showLink = draft.where === 'Google Meet' || draft.where === 'Microsoft Teams';
  const close = () => set({ roundEdit: null, roundDraft: null, roundPop: null });

  const people = peopleForCard(edit.id);
  const known = new Set(people.map((p) => p.key));
  const roster = [...people, ...draft.people.filter((k) => !known.has(k)).map((k) => ({ key: k, name: k, role: '', bg: 'var(--c-b3b0a8)', initials: k }))];

  const popChip = (which: 'date' | 'time', text: string, filled: boolean) => (
    <div
      onClick={() => set((s) => ({
        roundPop: s.roundPop === which ? null : which,
        ...(which === 'time' ? { roundTimeStep: 'start' as const, roundTimeStart: null } : null),
      }))}
      style={{
        fontSize: 12.5, color: filled ? 'var(--c-1b1a17)' : 'var(--c-a5a29a)', lineHeight: 1.45,
        background: st.roundPop === which ? 'var(--c-e7e4dc)' : 'var(--c-f6f5f1)',
        borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
      }}
    >
      {text}
    </div>
  );

  return (
    <ModalShell
      onClose={close}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: 'var(--c-5f5c56)' }}>
          <span>Interview bei</span>
          <Avatar bg={CHANNEL_BG[channel] || 'var(--c-8b8880)'} size={22} fontSize={11}>{(company || '?').charAt(0)}</Avatar>
          <span style={{ color: 'var(--c-1b1a17)', fontWeight: 600 }}>{company}</span>
        </div>
      }
      footer={
        <>
          {isNew ? <div /> : (
            <div style={{ fontSize: 13.5, color: 'var(--c-a8463d)', cursor: 'pointer', padding: '4px 0' }} onClick={() => resetRound(edit.id, edit.ri)}>
              Interview löschen
            </div>
          )}
          <SubmitButton label={isNew ? 'Termin anlegen' : 'Speichern'} enabled={valid} onClick={saveRound} />
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={draft.title}
          autoFocus
          placeholder="Titel des Interviews"
          onChange={(e) => setDraft({ title: e.target.value })}
          style={{ fontSize: 15, color: 'var(--c-1b1a17)', lineHeight: 1.5, border: 'none', outline: 'none', background: 'transparent', width: '100%', padding: 0 }}
        />
        <FieldHint>Titel des Gesprächs, zum Beispiel „Interview“, „Fachgespräch“ oder „Kennenlernen mit dem Team“.</FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Termin</FieldLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PopoverAnchor>
            {popChip('date', draft.date || 'Kein Datum ausgewählt', !!draft.date)}
            {st.roundPop === 'date' && (
              <CalendarPopover
                top={30} zIndex={70}
                selectedISO={selISO}
                fromYM={(selISO && selISO < today ? selISO : today).slice(0, 7)}
                toYM={shiftYM((selISO && selISO < today ? selISO : today).slice(0, 7), 11)}
                isDisabled={(iso) => iso < today}
                onPick={(iso) => {
                  setDraft({ date: isoToDate(iso) });
                  set({ roundPop: 'time', roundTimeStep: 'start', roundTimeStart: null });
                }}
              />
            )}
          </PopoverAnchor>
          <PopoverAnchor>
            {popChip('time', draft.time || 'Keine Uhrzeit ausgewählt', !!draft.time)}
            {st.roundPop === 'time' && (
              <TimeRangePopover
                top={30} zIndex={70}
                value={draft.time}
                step={st.roundTimeStep}
                startOverride={st.roundTimeStart}
                hidePastForToday={selISO === today}
                onSetStep={(step, start) => set({ roundTimeStep: step, roundTimeStart: start })}
                onChange={(v, done) => {
                  setDraft({ time: v });
                  if (done) set({ roundPop: null });
                }}
              />
            )}
          </PopoverAnchor>
        </div>
        <FieldHint>
          {isNew
            ? 'Titel, Datum, Uhrzeit und Standort sind nötig, um den Termin anzulegen.'
            : 'Datum und Uhrzeit des Gesprächs. Leer lassen, wenn der Termin noch nicht steht — die Runde bleibt dann als offen stehen.'}
        </FieldHint>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Standort</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {WHERE_OPTIONS.map((w) => (
            <ChipToggle key={w} label={w} selected={draft.where === w} onClick={() => setDraft({ where: draft.where === w ? '' : w })} />
          ))}
        </div>
      </div>

      {showLink && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          <input
            value={draft.link}
            placeholder={draft.where === 'Microsoft Teams' ? 'https://teams.microsoft.com/l/meetup-join/…' : 'https://meet.google.com/…'}
            onChange={(e) => setDraft({ link: e.target.value })}
            style={{ fontSize: 15, color: 'var(--c-1b1a17)', lineHeight: 1.5, border: 'none', outline: 'none', background: 'transparent', width: '100%', padding: 0 }}
          />
          <FieldHint>Link zum Meeting einfügen. Er wird beim Termin hinterlegt und ist aus der Bewerbung heraus aufrufbar.</FieldHint>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <FieldLabel>Teilnehmer</FieldLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          {roster.map((p) => {
            const sel = draft.people.includes(p.key);
            return (
              <div
                key={p.key}
                className="menu-item"
                onClick={() => setDraft({ people: sel ? draft.people.filter((k) => k !== p.key) : [...draft.people, p.key] })}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', borderRadius: 7, background: sel ? 'var(--c-f1efe9)' : 'transparent' }}
              >
                <div style={{
                  width: 15, height: 15, borderRadius: 4, boxSizing: 'border-box',
                  border: '1px solid ' + (sel ? 'var(--c-1b1a17)' : 'var(--c-cfccc3)'),
                  background: sel ? 'var(--c-1b1a17)' : 'var(--c-fff)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {sel && <Check size={9} stroke="var(--c-fff)" strokeWidth={1.9} />}
                </div>
                <Avatar bg={p.bg} size={20} fontSize={8.5}>{p.initials}</Avatar>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--c-28261f)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.role || 'Position fehlt'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

import { useState } from 'react';
import { ROUND_STATE, WHERE_OPTIONS } from '../../data/sample-data';
import type { Round } from '../../data/sample-data';
import { dateToISO, dayDiff, isoToDate, relLabel, shiftYM, todayISO } from '../../lib/date';
import { initials } from '../../lib/text';
import { useApp } from '../../state/store-context';
import { AddRow } from '../../ui/AddRow';
import { CalendarPopover } from '../../ui/Calendar';
import { ChipToggle } from '../../ui/ChipToggle';
import { Composer } from '../../ui/Composer';
import { FieldChip } from '../../ui/FieldChip';
import { FieldRow } from '../../ui/FieldRow';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { TimeRangePopover } from '../../ui/TimeRangePicker';
import { Avatar, DotsGlyph } from '../../ui/icons';
import { PeoplePicker } from '../people/PeoplePicker';
import { PersonEditCard } from '../people/PersonEditCard';

/* One interview round: schedule, location, participants and its note thread. */
export function InterviewCard({ cardId, ri, round, company }: {
  cardId: string;
  ri: number;
  round: Round;
  company: string;
}) {
  const {
    st, set, mutateRounds, resetRound, logAct, person, peopleForCard,
    savePerson, deletePerson, createPersonForRound,
  } = useApp();

  // The note draft is local: a global editing key would be cleared by the
  // document mousedown handler the moment the user clicks the send button.
  const [note, setNote] = useState('');

  const sy = ROUND_STATE[round.state];
  const rISO = dateToISO(round.date || '');
  const today = todayISO();
  const diff = rISO ? dayDiff(rISO) : null;
  const done = round.state === 'done';

  const key = (name: string) => name + ':' + ri;
  const isOpen = (name: string) => st.dropdown === key(name);
  const toggle = (name: string, extra?: Record<string, unknown>) =>
    set((s) => ({ dropdown: s.dropdown === key(name) ? null : key(name), ...extra }));

  const setDate = (date: string) => {
    mutateRounds(cardId, (rs) => {
      const r = rs[ri];
      if (!r) return;
      r.date = date;
      if (!date) r.time = '';
      r.when = date ? date + (r.time ? ', ' + r.time : '') : 'Termin offen';
      if (r.state !== 'done') r.state = date ? 'next' : 'open';
    });
    logAct(cardId, date
      ? 'hat den Termin für „' + round.title + '“ auf ' + date + ' gelegt'
      : 'hat den Termin für „' + round.title + '“ entfernt');
    set({ dropdown: null });
  };

  const setTime = (time: string, close: boolean) => {
    mutateRounds(cardId, (rs) => {
      const r = rs[ri];
      if (!r) return;
      r.time = time;
      r.when = r.date ? r.date + (time ? ', ' + time : '') : 'Termin offen';
    });
    if (close) set({ dropdown: null });
  };

  const setWhere = (where: string) => {
    mutateRounds(cardId, (rs) => {
      const r = rs[ri];
      if (!r) return;
      r.where = where;
      if (where !== 'Google Meet' && where !== 'Microsoft Teams') r.link = '';
    });
    logAct(cardId, where
      ? 'hat den Ort für „' + round.title + '“ auf ' + where + ' gesetzt'
      : 'hat den Ort für „' + round.title + '“ entfernt');
  };

  const togglePerson = (pk: string) => {
    const has = round.people.includes(pk);
    mutateRounds(cardId, (rs) => {
      if (!rs[ri]) return;
      rs[ri].people = has ? rs[ri].people.filter((k) => k !== pk) : [...rs[ri].people, pk];
    });
    logAct(cardId, 'hat ' + person(pk).name + (has ? ' aus „' : ' zu „') + round.title + (has ? '“ entfernt' : '“ hinzugefügt'));
  };

  const sendNote = () => {
    const v = note.trim();
    if (!v) return;
    mutateRounds(cardId, (rs) => {
      if (rs[ri]) rs[ri].notes = [...(rs[ri].notes || []), { author: 'Du', text: v, time: 'gerade eben' }];
    });
    logAct(cardId, 'hat „' + round.title + '“ kommentiert');
    setNote('');
  };

  const people = round.people.map(person);
  const expanded = !!st.roundExpanded[cardId + ':' + ri];
  const asStack = people.length > 3 && !expanded;
  const meetLink = round.where === 'Google Meet' || round.where === 'Microsoft Teams';
  const addingPerson = st.editing === key('person');
  const menuOpen = isOpen('menu');

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid var(--c-e6e3dc)', background: 'var(--c-fff)', borderRadius: 10, padding: '15px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, flex: '1 1 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: sy.titleColor, lineHeight: 1.3 }}>{round.title}</div>
          {diff !== null && <div style={{ fontSize: 12, color: 'var(--c-a5a29a)' }}>{relLabel(diff)}</div>}
        </div>

        <FieldRow label="Termin" align="baseline">
          <PopoverAnchor>
            <FieldChip
              open={isOpen('date')}
              empty={!rISO}
              color={rISO && done ? 'var(--c-77746d)' : undefined}
              style={{ padding: '2px 7px', marginLeft: -7 }}
              onClick={() => toggle('date')}
              onClear={rISO ? () => setDate('') : undefined}
              clearTitle="Datum entfernen"
            >
              <span>{rISO ? isoToDate(rISO) : 'Kein Datum ausgewählt'}</span>
              {diff !== null && <span style={{ color: 'var(--c-a5a29a)' }}>· {relLabel(diff)}</span>}
            </FieldChip>
            {isOpen('date') && (
              <CalendarPopover
                top={26} left={-7} zIndex={60}
                selectedISO={rISO}
                fromYM={(rISO && rISO < today ? rISO : today).slice(0, 7)}
                toYM={shiftYM((rISO && rISO < today ? rISO : today).slice(0, 7), 11)}
                isDisabled={(iso) => iso < today}
                onPick={(iso) => setDate(isoToDate(iso))}
              />
            )}
          </PopoverAnchor>
        </FieldRow>

        <FieldRow label="Uhrzeit" align="baseline">
          <PopoverAnchor>
            <FieldChip
              open={isOpen('time')}
              empty={!round.time}
              color={round.time && done ? 'var(--c-77746d)' : undefined}
              style={{ padding: '2px 7px', marginLeft: -7 }}
              onClick={() => toggle('time', { cardTimeStep: 'start', cardTimeStart: null })}
              onClear={round.time ? () => setTime('', false) : undefined}
              clearTitle="Uhrzeit entfernen"
            >
              <span>{round.time || 'Keine Uhrzeit ausgewählt'}</span>
            </FieldChip>
            {isOpen('time') && (
              <TimeRangePopover
                top={26} left={-7} zIndex={60}
                value={round.time}
                step={st.cardTimeStep}
                startOverride={st.cardTimeStart}
                hidePastForToday={rISO === today}
                onSetStep={(step, start) => set({ cardTimeStep: step, cardTimeStart: start })}
                onChange={setTime}
              />
            )}
          </PopoverAnchor>
        </FieldRow>

        <FieldRow label="Ort" align="baseline">
          <PopoverAnchor>
            <FieldChip
              open={isOpen('where')}
              empty={!round.where}
              color={round.where && done ? 'var(--c-77746d)' : undefined}
              style={{ padding: '2px 7px', marginLeft: -7 }}
              onClick={() => toggle('where')}
              onClear={round.where ? () => setWhere('') : undefined}
              clearTitle="Ort entfernen"
            >
              <span>{round.where || 'Kein Ort ausgewählt'}</span>
            </FieldChip>
            {isOpen('where') && (
              <Popover top={26} left={-7} zIndex={60} width={246} padding={8} stack={false} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {WHERE_OPTIONS.map((w) => (
                  <ChipToggle key={w} label={w} size="sm" selected={round.where === w} onClick={() => setWhere(round.where === w ? '' : w)} />
                ))}
              </Popover>
            )}
          </PopoverAnchor>
        </FieldRow>

        {meetLink && (
          <FieldRow label="Link" align="baseline">
            <PopoverAnchor style={{ minWidth: 0 }}>
              <FieldChip
                open={isOpen('link')}
                empty={!round.link}
                title={round.link}
                style={{ padding: '2px 7px', marginLeft: -7 }}
                onClick={() => toggle('link')}
                onClear={round.link ? () => mutateRounds(cardId, (rs) => { if (rs[ri]) rs[ri].link = ''; }) : undefined}
                clearTitle="Link entfernen"
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {round.link ? (round.link.length > 34 ? round.link.slice(0, 34) + '…' : round.link) : 'Kein Link hinterlegt'}
                </span>
              </FieldChip>
              {isOpen('link') && (
                <Popover top={26} left={-7} zIndex={60} width={300} padding={8} stack={false}>
                  <input
                    value={round.link || ''}
                    autoFocus
                    placeholder={round.where === 'Microsoft Teams' ? 'https://teams.microsoft.com/l/meetup-join/…' : 'https://meet.google.com/…'}
                    onChange={(e) => mutateRounds(cardId, (rs) => { if (rs[ri]) rs[ri].link = e.target.value; })}
                    style={{
                      fontSize: 12, color: 'var(--c-1b1a17)', lineHeight: 1.5, border: 'none', borderRadius: 5,
                      padding: '6px 8px', background: 'var(--c-f6f5f1)', boxShadow: 'inset 0 0 0 1px var(--c-e6e3dc)',
                      outline: 'none', width: '100%', boxSizing: 'border-box',
                    }}
                  />
                </Popover>
              )}
            </PopoverAnchor>
          </FieldRow>
        )}

        <FieldRow label="Teilnehmer" align="flex-start">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 0' }}>
            {asStack ? (
              <div
                className="add-row"
                title="Alle anzeigen"
                onClick={() => set((s) => ({ roundExpanded: { ...s.roundExpanded, [cardId + ':' + ri]: true } }))}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 6px', marginLeft: -6, width: 'fit-content', boxSizing: 'content-box' }}
              >
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  {people.slice(0, 3).map((p, i) => (
                    <Avatar key={p.key} bg={p.bg} style={{ boxShadow: '0 0 0 1.5px var(--c-fbfaf7)', marginLeft: i ? -6 : 0 }}>{p.initials}</Avatar>
                  ))}
                  <Avatar bg="var(--c-f0eee8)" style={{ color: 'var(--c-5f5c56)', boxShadow: '0 0 0 1.5px var(--c-fbfaf7)', marginLeft: -6 }}>
                    +{people.length - 3}
                  </Avatar>
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-8b8880)' }}>
                  {people.map((p) => (p.role || '').split(',')[0]).filter(Boolean).join(', ')}
                </div>
              </div>
            ) : (
              people.map((p) => {
                const pe = st.personEdit;
                const editing = pe?.id === cardId && pe.ri === ri && pe.key === p.key;
                const inRounds = st.roundsState[cardId]?.filter((r) => r.people.includes(p.key)).length ?? 1;
                return (
                  <PopoverAnchor key={p.key} style={{ width: 'fit-content' }}>
                    <FieldChip
                      open={editing}
                      style={{ padding: '2px 6px', marginLeft: -6 }}
                      onClick={() => set({
                        personEdit: { id: cardId, ri, key: p.key, isNew: false },
                        personDraft: { name: p.name, role: p.role, email: p.email || '', phone: p.phone || '', linkedin: p.linkedin || '' },
                        dropdown: null, editing: null,
                      })}
                      onClear={() => {
                        mutateRounds(cardId, (rs) => { if (rs[ri]) rs[ri].people = rs[ri].people.filter((k) => k !== p.key); });
                        logAct(cardId, 'hat ' + p.name + ' aus „' + round.title + '“ entfernt');
                        set({ personEdit: null, personDraft: null });
                      }}
                      clearTitle="Aus dieser Runde entfernen"
                    >
                      <Avatar bg={sy.muted ? 'var(--c-c9c5bb)' : p.bg}>{p.initials}</Avatar>
                      <span style={{ color: sy.muted ? 'var(--c-8b8880)' : 'var(--c-28261f)' }}>{p.name}</span>
                      <span style={{ color: p.role ? 'var(--c-a5a29a)' : 'var(--c-c3c0b8)' }}>{p.role || 'Position fehlt'}</span>
                    </FieldChip>
                    {editing && (
                      <Popover variant="panel" top={29} left={-6} width={312} padding={0}>
                        <PersonEditCard
                          personKey={p.key}
                          subExtra={inRounds > 1 ? ' · in ' + inRounds + ' Runden' : ''}
                          canDelete
                          onDelete={() => deletePerson(cardId, p.key, false)}
                          onDone={savePerson}
                        />
                      </Popover>
                    )}
                  </PopoverAnchor>
                );
              })
            )}

            {addingPerson ? (
              /* The row keeps its own -6 gutter, so the anchor must not add one. */
              <PopoverAnchor style={{ width: 'fit-content' }}>
                <AddRow label="Person hinzufügen" active />
                <Popover top={27} left={0} zIndex={20} width={290}>
                  <PeoplePicker
                    draft={st.editDraft}
                    onDraftChange={(v) => set({ editDraft: v })}
                    company={company}
                    people={peopleForCard(cardId)}
                    isSelected={(k) => round.people.includes(k)}
                    onToggle={togglePerson}
                    onCreate={(name) => createPersonForRound(cardId, ri, name)}
                    onClose={() => set({ editing: null, editDraft: '' })}
                  />
                </Popover>
              </PopoverAnchor>
            ) : (
              !done && <AddRow label="Person hinzufügen" onClick={() => set({ editing: key('person'), editDraft: '', dropdown: null })} />
            )}
          </div>
        </FieldRow>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 5, maxWidth: 430, width: '100%' }}>
          {(round.notes || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(round.notes || []).map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 9 }}>
                  <Avatar bg={n.author === 'Kepler' ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'} size={20} fontSize={8.5} style={{ marginTop: 1 }}>
                    {n.author === 'Du' ? 'Du' : initials(n.author)}
                  </Avatar>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>{n.author}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-a5a29a)' }}>{n.time}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--c-5f5c56)', lineHeight: 1.6, whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Composer
            value={note}
            onChange={setNote}
            onSend={sendNote}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setNote(''); }
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendNote(); }
            }}
          />
        </div>
      </div>

      <PopoverAnchor style={{ flexShrink: 0 }}>
        <div
          className="dots-btn"
          title="Mehr"
          onClick={() => toggle('menu')}
          style={{ background: menuOpen ? 'var(--c-e7e4dc)' : 'transparent', color: menuOpen ? 'var(--c-1b1a17)' : 'var(--c-c3c0b8)' }}
        >
          <DotsGlyph />
        </div>
        {menuOpen && (
          <Popover top={29} right={0} zIndex={30} width={216}>
            <MenuItem
              style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}
              onClick={() => set({
                roundEdit: { id: cardId, ri },
                roundDraft: { title: round.title, date: round.date, time: round.time, where: round.where, link: round.link || '', people: round.people.slice() },
                dropdown: null, editing: null, roundPop: null,
              })}
            >
              Interview bearbeiten
            </MenuItem>
            <MenuItem danger style={{ padding: '6px 9px', whiteSpace: 'nowrap' }} onClick={() => resetRound(cardId, ri)}>
              Interview löschen
            </MenuItem>
          </Popover>
        )}
      </PopoverAnchor>
    </div>
  );
}

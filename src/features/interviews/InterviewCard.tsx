import { useState } from 'react';
import { ROUND_STATE, WHERE_OPTIONS } from '../../data/config';
import type { Round } from '../../state/store-context';
import { dateToISO, dayDiff, isoToDate, relLabel, shiftYM, todayISO } from '../../lib/date';
import { KEPLER_ENTRY } from '../../lib/mentions';
import { Author, AUTHOR_LABEL, RoundState } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { CalendarPopover } from '../../ui/Calendar';
import { ChipToggle } from '../../ui/ChipToggle';
import { FieldChip } from '../../ui/FieldChip';
import { FieldRow } from '../../ui/FieldRow';
import { MentionComposer } from '../../ui/MentionComposer';
import { MentionText } from '../../ui/MentionText';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { TimeRangePopover } from '../../ui/TimeRangePicker';
import { Avatar, DotsGlyph } from '../../ui/icons';
import { PeoplePicker } from '../people/PeoplePicker';
import { PersonEditCard } from '../people/PersonEditCard';
import { RoundDot } from './RoundDot';
import { ELLIPSIS } from '../../ui/styles';

/* One interview round: schedule, location, participants and its note thread. */
export function InterviewCard({
  cardId,
  ri,
  rounds,
  round,
  company,
}: {
  cardId: string;
  ri: number;
  /* How many rounds the application has — the dot's stage is this round's
     position within them, exactly as in the selector above the card. */
  rounds: number;
  round: Round;
  company: string;
}) {
  const {
    st,
    set,
    mutateRounds,
    resetRound,
    addRoundNote,
    logAct,
    person,
    peopleForCard,
    savePerson,
    deletePerson,
    createPersonForRound,
  } = useApp();

  // The note draft is local: a global editing key would be cleared by the
  // document mousedown handler the moment the user clicks the send button.
  const [note, setNote] = useState('');
  // The link draft too — committing on every keystroke would persist the
  // whole round list once per character.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  const sy = ROUND_STATE[round.state];
  const rISO = dateToISO(round.date || '');
  const today = todayISO();
  const diff = rISO ? dayDiff(rISO) : null;
  const done = round.state === RoundState.DONE;

  const key = (name: string) => name + ':' + ri;
  const isOpen = (name: string) => st.dropdown === key(name);
  const toggle = (name: string, extra?: Record<string, unknown>) =>
    set((s) => ({ dropdown: s.dropdown === key(name) ? null : key(name), ...extra }));

  /* Every edit on this card touches its own round; the row can be gone if the
     list changed underneath, so each write goes through the same guard. */
  const editRound = (fn: (r: Round) => void) =>
    mutateRounds(cardId, (rs) => {
      if (rs[ri]) fn(rs[ri]);
    });

  const setDate = (date: string) => {
    editRound((r) => {
      r.date = date;
      if (!date) r.time = '';
      if (r.state !== RoundState.DONE) r.state = date ? RoundState.NEXT : RoundState.OPEN;
    });
    logAct(
      cardId,
      date
        ? 'hat den Termin für „' + round.title + '“ auf ' + date + ' gelegt'
        : 'hat den Termin für „' + round.title + '“ entfernt',
    );
    set({ dropdown: null });
  };

  const setTime = (time: string, close: boolean) => {
    editRound((r) => {
      r.time = time;
    });
    if (close) set({ dropdown: null });
  };

  const setWhere = (where: string) => {
    editRound((r) => {
      r.where = where;
      if (where !== 'Google Meet' && where !== 'Microsoft Teams') r.link = '';
    });
    logAct(
      cardId,
      where
        ? 'hat den Ort für „' + round.title + '“ auf ' + where + ' gesetzt'
        : 'hat den Ort für „' + round.title + '“ entfernt',
    );
  };

  const togglePerson = (pk: string) => {
    const has = round.people.includes(pk);
    editRound((r) => {
      r.people = has ? r.people.filter((k) => k !== pk) : [...r.people, pk];
    });
    logAct(
      cardId,
      'hat ' +
        person(pk).name +
        (has ? ' aus „' : ' zu „') +
        round.title +
        (has ? '“ entfernt' : '“ hinzugefügt'),
    );
  };

  const sendNote = () => {
    if (!note.trim()) return;
    // Notes append to their own table; addRoundNote also writes the activity.
    addRoundNote(cardId, ri, note);
    setNote('');
  };

  const people = round.people.map(person);
  // Notes take the same mentions as the card comments: the assistant plus
  // everyone attached to this application, not only this round's participants.
  const mentionable = [KEPLER_ENTRY, ...peopleForCard(cardId)];
  const mentionNames = mentionable.map((p) => p.name);
  const meetLink = round.where === 'Google Meet' || round.where === 'Microsoft Teams';
  const addingPerson = st.editing === key('person');
  const menuOpen = isOpen('menu');

  const togglePicker = () =>
    set((s) => ({
      editing: s.editing === key('person') ? null : key('person'),
      editDraft: '',
      dropdown: null,
    }));

  const noPeople = people.length === 0;
  /* The chip states who is on the round the way the sidebar's contact chip
     does: one name, or the first plus a count. */
  const peopleLabel = noPeople
    ? 'Kein Kontakt ausgewählt'
    : people.length === 1
      ? people[0].name
      : people[0].name + ' +' + (people.length - 1);

  const clearPeople = () => {
    editRound((r) => {
      r.people = [];
    });
    logAct(cardId, 'hat alle Teilnehmer aus „' + round.title + '“ entfernt');
    set({ editing: null, personEdit: null, personDraft: null });
  };

  /* The picker's pencil opens the same editor the participant chips use, only
     inside the picker: the person need not be in this round to be corrected. */
  const pe = st.personEdit;
  const pickerEdit = addingPerson && pe?.forPicker && pe.id === cardId && pe.ri === ri ? pe : null;
  const editPersonFromPicker = (pk: string) => {
    const p = person(pk);
    set({
      personEdit: { id: cardId, ri, key: pk, isNew: false, forPicker: true },
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
      dropdown: null,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        border: '1px solid var(--c-e6e3dc)',
        background: 'var(--c-fff)',
        borderRadius: 10,
        padding: '15px 16px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, flex: '1 1 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          {/* The ring sits on the text's centre, not on its baseline. */}
          <RoundDot
            index={ri}
            total={rounds}
            stage={round.stage}
            style={{ alignSelf: 'center', opacity: done ? 0.6 : 1 }}
          />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: sy.titleColor, lineHeight: 1.3 }}>
            {round.title}
          </div>
          {diff !== null && <div style={{ fontSize: 12, color: 'var(--c-a5a29a)' }}>{relLabel(diff)}</div>}
        </div>

        <FieldRow label="Termin" align="baseline">
          <PopoverAnchor>
            <FieldChip
              open={isOpen('date')}
              empty={!rISO}
              chevron
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
                top={26}
                left={-7}
                zIndex={60}
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
              chevron
              color={round.time && done ? 'var(--c-77746d)' : undefined}
              style={{ padding: '2px 7px', marginLeft: -7 }}
              onClick={() => toggle('time', { cardTimeStep: 'start', cardTimeStart: null })}
              onClear={round.time ? () => setTime('', true) : undefined}
              clearTitle="Uhrzeit entfernen"
            >
              <span>{round.time || 'Keine Uhrzeit ausgewählt'}</span>
            </FieldChip>
            {isOpen('time') && (
              <TimeRangePopover
                top={26}
                left={-7}
                zIndex={60}
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
              chevron
              color={round.where && done ? 'var(--c-77746d)' : undefined}
              style={{ padding: '2px 7px', marginLeft: -7 }}
              onClick={() => toggle('where')}
              onClear={
                round.where
                  ? () => {
                      setWhere('');
                      set({ dropdown: null });
                    }
                  : undefined
              }
              clearTitle="Ort entfernen"
            >
              <span>{round.where || 'Kein Ort ausgewählt'}</span>
            </FieldChip>
            {isOpen('where') && (
              <Popover
                top={26}
                left={-7}
                zIndex={60}
                width={246}
                padding={8}
                stack={false}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}
              >
                {WHERE_OPTIONS.map((w) => (
                  <ChipToggle
                    key={w}
                    label={w}
                    size="sm"
                    selected={round.where === w}
                    onClick={() => setWhere(round.where === w ? '' : w)}
                  />
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
              >
                <span style={{ ...ELLIPSIS }}>
                  {round.link
                    ? round.link.length > 34
                      ? round.link.slice(0, 34) + '…'
                      : round.link
                    : 'Kein Link hinterlegt'}
                </span>
              </FieldChip>
              {isOpen('link') && (
                <Popover top={26} left={-7} zIndex={60} width={300} padding={8} stack={false}>
                  <input
                    value={linkDraft ?? round.link ?? ''}
                    autoFocus
                    placeholder={
                      round.where === 'Microsoft Teams'
                        ? 'https://teams.microsoft.com/l/meetup-join/…'
                        : 'https://meet.google.com/…'
                    }
                    onChange={(e) => setLinkDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={() => {
                      if (linkDraft != null && linkDraft !== (round.link || '')) {
                        editRound((r) => {
                          r.link = linkDraft;
                        });
                      }
                      setLinkDraft(null);
                    }}
                    style={{
                      fontSize: 12,
                      color: 'var(--c-1b1a17)',
                      lineHeight: 1.5,
                      border: 'none',
                      borderRadius: 5,
                      padding: '6px 8px',
                      background: 'var(--c-f6f5f1)',
                      boxShadow: 'inset 0 0 0 1px var(--c-e6e3dc)',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                </Popover>
              )}
            </PopoverAnchor>
          </FieldRow>
        )}

        <FieldRow label="Teilnehmer">
          {/* One chip opens the picker, like the sidebar's contact field: the
              participants read as a value of the round rather than as a list
              with an add row under it. */}
          <PopoverAnchor style={{ width: 'fit-content' }}>
            <FieldChip
              open={addingPerson}
              empty={noPeople}
              chevron={!done}
              gap={6}
              style={{ padding: '2px 6px 2px 3px', marginLeft: -6 }}
              onClick={done ? undefined : togglePicker}
              onClear={!done && !noPeople ? clearPeople : undefined}
              clearTitle="Alle Teilnehmer entfernen"
            >
              <div style={{ display: 'flex', flexShrink: 0 }}>
                {(noPeople ? [null] : people.slice(0, 3)).map((p, i) => (
                  <Avatar
                    key={p ? p.key : 'none'}
                    bg={p ? (sy.muted ? 'var(--c-c9c5bb)' : p.bg) : 'var(--c-b3b0a8)'}
                    style={{ boxShadow: '0 0 0 1.5px var(--c-fff)', marginLeft: i ? -6 : 0 }}
                  >
                    {p ? p.initials : '–'}
                  </Avatar>
                ))}
              </div>
              <span style={{ fontSize: 12 }}>{peopleLabel}</span>
              {people.length === 1 && (
                <span style={{ fontSize: 12, color: people[0].role ? 'var(--c-a5a29a)' : 'var(--c-c3c0b8)' }}>
                  {people[0].role || 'Position fehlt'}
                </span>
              )}
            </FieldChip>
            {addingPerson && (
              <Popover top={29} left={-6} zIndex={20} width={290}>
                {pickerEdit ? (
                  <PersonEditCard
                    personKey={pickerEdit.key}
                    canDelete
                    onDelete={() => deletePerson(cardId, pickerEdit.key, false)}
                    onDone={savePerson}
                  />
                ) : (
                  <PeoplePicker
                    draft={st.editDraft}
                    onDraftChange={(v) => set({ editDraft: v })}
                    company={company}
                    people={peopleForCard(cardId)}
                    isSelected={(k) => round.people.includes(k)}
                    onToggle={togglePerson}
                    onEdit={editPersonFromPicker}
                    onCreate={(name) => createPersonForRound(cardId, ri, name)}
                    onClose={() => set({ editing: null, editDraft: '' })}
                  />
                )}
              </Popover>
            )}
          </PopoverAnchor>
        </FieldRow>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginTop: 5,
            maxWidth: 430,
            width: '100%',
          }}
        >
          {(round.notes || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(round.notes || []).map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 9 }}>
                  <Avatar
                    bg={n.author === Author.KEPLER ? 'var(--c-1b1a17)' : 'var(--c-5b7a5e)'}
                    size={20}
                    fontSize={8.5}
                    style={{ marginTop: 1 }}
                  >
                    {n.author === Author.KEPLER ? 'K' : AUTHOR_LABEL[n.author]}
                  </Avatar>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-1b1a17)' }}>
                        {AUTHOR_LABEL[n.author]}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-a5a29a)' }}>{n.time}</div>
                    </div>
                    <MentionText
                      text={n.text}
                      names={mentionNames}
                      style={{ lineHeight: 1.6, whiteSpace: 'pre-line' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <MentionComposer
            value={note}
            onChange={setNote}
            onSend={sendNote}
            people={mentionable}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNote('');
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendNote();
              }
            }}
          />
        </div>
      </div>

      <PopoverAnchor style={{ flexShrink: 0 }}>
        <div
          className={menuOpen ? 'dots-btn dots-btn-open' : 'dots-btn'}
          title="Mehr"
          onClick={() => toggle('menu')}
        >
          <DotsGlyph />
        </div>
        {menuOpen && (
          <Popover top={29} right={0} zIndex={30} width={216}>
            <MenuItem
              style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}
              onClick={() =>
                set({
                  roundEdit: { id: cardId, ri },
                  roundDraft: {
                    title: round.title,
                    stage: round.stage,
                    date: round.date,
                    time: round.time,
                    where: round.where,
                    link: round.link || '',
                    people: round.people.slice(),
                  },
                  dropdown: null,
                  editing: null,
                  roundPop: null,
                })
              }
            >
              Interview bearbeiten
            </MenuItem>
            <MenuItem
              danger
              style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}
              onClick={() => resetRound(cardId, ri)}
            >
              Interview löschen
            </MenuItem>
          </Popover>
        )}
      </PopoverAnchor>
    </div>
  );
}

import { dateToISO, dayDiff, relLabel, shortDate } from '../../lib/date';
import { RoundState } from '../../shared/enums';
import { useApp } from '../../state/store-context';
import { AddRow, DashedPlus } from '../../ui/AddRow';
import { FieldChip } from '../../ui/FieldChip';
import { MenuItem } from '../../ui/MenuItem';
import { Popover, PopoverAnchor } from '../../ui/Popover';
import { Section } from '../../ui/Section';
import { InterviewCard } from './InterviewCard';
import { RoundDot } from './RoundDot';

/* Round selector plus the selected round's card. */
export function InterviewsSection({ cardId, company }: { cardId: string; company: string }) {
  const { st, set, roundsFor } = useApp();
  const rounds = roundsFor(cardId);

  const addRound = () =>
    set({
      roundEdit: { id: cardId, ri: rounds.length, isNew: true },
      roundDraft: { title: '', stage: '', date: '', time: '', where: 'In Person', link: '', people: [] },
      dropdown: null,
      editing: null,
      roundPop: null,
    });

  if (!rounds.length)
    return (
      <Section sectionKey="rounds" title="Interviews" count={0} gap={14}>
        <AddRow label="Interview hinzufügen" onClick={addRound} />
      </Section>
    );

  // Default to the upcoming round, else the first still open.
  const fallback = (() => {
    const next = rounds.findIndex((r) => r.state === RoundState.NEXT);
    if (next >= 0) return next;
    const open = rounds.findIndex((r) => r.state !== RoundState.DONE);
    return open >= 0 ? open : 0;
  })();
  const idx = Math.min(st.roundSel[cardId] ?? fallback, rounds.length - 1);
  const round = rounds[idx];
  const selISO = dateToISO(round.date || '');
  const open = st.dropdown === 'roundsel';

  return (
    <Section sectionKey="rounds" title="Interviews" count={rounds.length} gap={14}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginLeft: -7 }}>
        <PopoverAnchor style={{ width: 'fit-content' }}>
          <FieldChip
            open={open}
            gap={7}
            chevron
            style={{ padding: '3px 7px', opacity: round.state === RoundState.DONE ? 0.6 : 1 }}
            onClick={() => set((s) => ({ dropdown: s.dropdown === 'roundsel' ? null : 'roundsel' }))}
          >
            <RoundDot index={idx} total={rounds.length} stage={round.stage} />
            <span style={{ fontWeight: 600 }}>{round.title}</span>
            {selISO && <span style={{ color: 'var(--c-8d8a83)' }}>{shortDate(selISO)}</span>}
            {selISO && <span style={{ color: 'var(--c-a5a29a)' }}>· {relLabel(dayDiff(selISO))}</span>}
          </FieldChip>
          {open && (
            <Popover top={28} minWidth={272}>
              {rounds.map((r, i) => {
                const iso = dateToISO(r.date || '');
                return (
                  <MenuItem
                    key={r.title + i}
                    selected={i === idx}
                    dim={r.state === RoundState.DONE ? 0.6 : undefined}
                    onClick={() => set((s) => ({ roundSel: { ...s.roundSel, [cardId]: i }, dropdown: null }))}
                  >
                    <RoundDot index={i} total={rounds.length} stage={r.stage} />
                    <span style={{ whiteSpace: 'nowrap' }}>{r.title}</span>
                    <span style={{ color: 'var(--c-8d8a83)', whiteSpace: 'nowrap' }}>{shortDate(iso)}</span>
                    <span style={{ flex: '1 1 auto' }} />
                    {iso && (
                      <span style={{ fontSize: 11.5, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>
                        {relLabel(dayDiff(iso))}
                      </span>
                    )}
                  </MenuItem>
                );
              })}
              <MenuItem style={{ color: 'var(--c-5f5c56)' }} onClick={addRound}>
                <DashedPlus size={13} />
                <span style={{ whiteSpace: 'nowrap' }}>Interview hinzufügen</span>
              </MenuItem>
            </Popover>
          )}
        </PopoverAnchor>
      </div>
      <InterviewCard cardId={cardId} ri={idx} rounds={rounds.length} round={round} company={company} />
    </Section>
  );
}

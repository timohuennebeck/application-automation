import { describe, expect, it } from 'vitest';
import { SortDir, SortKey, Urgency } from '../../data/config.ts';
import { Interest, LinkKind } from '../../shared/enums.ts';
import { shiftISO, todayISO } from '../../lib/date.ts';
import type { ApplicationRow, CompanyRow, FactRow } from '../../shared/db-types.ts';
import { activeFilterCount, cardSubtitle, isSorted, visibleCards } from '../selectors.ts';
import type { AppState, BoardFilter } from '../store-context.ts';

const application = (
  id: string,
  role: string,
  companyId: number,
  interest: Interest,
  channel: string,
): ApplicationRow => ({
  id,
  role,
  company_id: companyId,
  interest,
  channel,
  stage_id: 'interessiert',
  stage_position: 0,
  summary: null,
  applied_at: null,
  applied_via: null,
  created_at: 't',
  updated_at: 't',
});

const salary = (id: string, value: string): FactRow => ({
  id: 1,
  application_id: id,
  label: 'Gehalt',
  value,
  kind: null,
  position: 0,
});

const company = (id: number, name: string): CompanyRow => ({
  id,
  name,
  sector: null,
  headcount: null,
  website: null,
  email: null,
  phone: null,
  notes: null,
  created_at: 't',
  updated_at: 't',
});

/* Three cards in one column: the board's own order is A, B, C. */
function state(filter: Partial<BoardFilter> = {}): AppState {
  return {
    applications: {
      A: application('A', 'UX Researcher', 1, Interest.LOW, 'LinkedIn'),
      B: application('B', 'Design Lead', 2, Interest.URGENT, 'Recruiter'),
      C: application('C', 'Produktdesigner', 3, Interest.MEDIUM, 'LinkedIn'),
    },
    companies: { 1: company(1, 'Zeta'), 2: company(2, 'Alpha'), 3: company(3, 'Mitte') },
    factsByApp: { A: [salary('A', '58–70k €')], B: [salary('B', '120–135k')] },
    people: { 7: { name: 'Ines', role: '', bg: 'c' } },
    linksByApp: {
      A: [{ application_id: 'A', person_id: 7, kind: LinkKind.CONTACT, position: 0 }],
      B: [{ application_id: 'B', person_id: 9, kind: LinkKind.CONTACT, position: 0 }],
    },
    board: [['A', 'B', 'C']],
    boardFilter: { sort: SortKey.NONE, dir: SortDir.ASC, interests: [], ...filter },
  } as unknown as AppState;
}

describe('visibleCards', () => {
  it('keeps the stored order until a sort is picked', () => {
    const st = state();
    expect(isSorted(st)).toBe(false);
    expect(visibleCards(st, 0)).toEqual(['A', 'B', 'C']);
  });

  it('sorts by salary and sinks cards without one, either direction', () => {
    expect(visibleCards(state({ sort: SortKey.SALARY, dir: SortDir.DESC }), 0)).toEqual(['B', 'A', 'C']);
    expect(visibleCards(state({ sort: SortKey.SALARY, dir: SortDir.ASC }), 0)).toEqual(['A', 'B', 'C']);
  });

  it('sorts by interest, company and role', () => {
    expect(visibleCards(state({ sort: SortKey.INTEREST, dir: SortDir.DESC }), 0)).toEqual(['B', 'C', 'A']);
    expect(visibleCards(state({ sort: SortKey.COMPANY, dir: SortDir.ASC }), 0)).toEqual(['B', 'C', 'A']);
    expect(visibleCards(state({ sort: SortKey.ROLE, dir: SortDir.ASC }), 0)).toEqual(['B', 'C', 'A']);
  });

  it('filters by interest, and counts the picked levels for the toolbar', () => {
    const st = state({ interests: [Interest.URGENT, Interest.MEDIUM] });
    expect(visibleCards(st, 0)).toEqual(['B', 'C']);
    expect(activeFilterCount(st)).toBe(2);
  });

  it('sorts what the filter left over', () => {
    const st = state({ interests: [Interest.URGENT, Interest.MEDIUM], sort: SortKey.ROLE });
    expect(visibleCards(st, 0)).toEqual(['B', 'C']);
  });
});

/* A card with one follow-up, `dueDays` from today, optionally ticked off. */
function cardWithFollowup(dueDays: number, completed: boolean): AppState {
  return {
    applications: { A: application('A', 'UX Researcher', 1, Interest.LOW, 'LinkedIn') },
    roundsState: {},
    followupsByApp: {
      A: [
        {
          id: 1,
          application_id: 'A',
          label: 'Follow up',
          due_at: shiftISO(todayISO(), dueDays),
          position: 0,
          email_subject: null,
          email_text: null,
          generated_at: null,
          completed_at: completed ? todayISO() : null,
        },
      ],
    },
  } as unknown as AppState;
}

describe('cardSubtitle', () => {
  it('calls out a follow-up that has come and gone', () => {
    expect(cardSubtitle(cardWithFollowup(-4, false), 'A')).toEqual({
      text: '4 Tage überfällig',
      tone: Urgency.DUE,
    });
  });

  it('stops calling it overdue once it has been sent', () => {
    expect(cardSubtitle(cardWithFollowup(-4, true), 'A').tone).toBe(Urgency.MUTED);
  });
});

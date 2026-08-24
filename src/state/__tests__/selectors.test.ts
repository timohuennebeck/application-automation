import { describe, expect, it } from 'vitest';
import { SortDir, SortKey, Urgency } from '../../data/config.ts';
import {
  AgentRunStatus,
  Assignee,
  DocumentKind,
  DocumentLanguage,
  EditKind,
  Interest,
  LinkKind,
  RoundState,
} from '../../shared/enums.ts';
import { isoToDate, shiftISO, todayISO } from '../../lib/date.ts';
import type {
  ApplicationRow,
  CommentEditRow,
  CompanyRow,
  DocumentRow,
  FactRow,
} from '../../shared/db-types.ts';
import {
  activeFilterCount,
  cardSubtitle,
  editStatus,
  editText,
  interviewChip,
  isSorted,
  keplerHoldReason,
  documentLanguageOf,
  keplerStartBlocked,
  languageOf,
  peopleKeysForCard,
  visibleCards,
} from '../selectors.ts';
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
  posting_url: null,
  posting_text: null,
  assignee: null,
  language: null,
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
  homepage: null,
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

describe('kepler assignment guards', () => {
  /* One card owned by Kepler, its latest run in the given state. */
  function keplerState(status: AgentRunStatus | null, posting = true): AppState {
    const app = application('A', 'UX Researcher', 1, Interest.LOW, 'LinkedIn');
    app.assignee = Assignee.KEPLER;
    if (posting) app.posting_url = 'https://example.com/jobs/1';
    return {
      applications: { A: app },
      agentRuns: status ? { A: { run: { id: 1, application_id: 'A', status }, steps: [] } } : {},
    } as unknown as AppState;
  }

  it('holds the name only while a run is queued or underway', () => {
    expect(keplerHoldReason(keplerState(AgentRunStatus.QUEUED), 'A')).toContain('stoppen');
    expect(keplerHoldReason(keplerState(AgentRunStatus.RUNNING), 'A')).toContain('stoppen');
    expect(keplerHoldReason(keplerState(null), 'A')).toBeNull();
    /* A failed run is inert — Kepler can be taken off; the retry would put
       the name back on the card anyway. */
    expect(keplerHoldReason(keplerState(AgentRunStatus.FAILED), 'A')).toBeNull();
    expect(keplerHoldReason(keplerState(AgentRunStatus.DONE), 'A')).toBeNull();
  });

  it('blocks assigning Kepler only while there is no posting to work from', () => {
    expect(keplerStartBlocked(keplerState(null, false), 'A')).toContain('Stellenanzeige');
    expect(keplerStartBlocked(keplerState(null, true), 'A')).toBeNull();
    const pasted = keplerState(null, false);
    pasted.applications.A.posting_text = 'Wir suchen …';
    expect(keplerStartBlocked(pasted, 'A')).toBeNull();
  });
});

describe('languageOf', () => {
  /* What the card's files are named and which template side they come from:
     the card's choice, else German — the side every card started on. */
  it('falls back to German until the card says otherwise', () => {
    const st = state();
    expect(languageOf(st, 'A')).toBe(DocumentLanguage.DE);
    st.applications.A.language = DocumentLanguage.EN;
    expect(languageOf(st, 'A')).toBe(DocumentLanguage.EN);
    expect(languageOf(st, 'gibts-nicht')).toBe(DocumentLanguage.DE);
  });
});

describe('documentLanguageOf', () => {
  /* Switching a card to English does not rewrite the documents it already
     has — those follow on the next Kepler run. Until then the letter editor
     has to save over the file the row actually names, or an edit would land
     under the English name and orphan the German letter it was made from. */
  function withLetter(fileName: string | null, cardLanguage: DocumentLanguage | null): AppState {
    const st = state();
    st.applications.A.language = cardLanguage;
    st.documentsByApp = {
      A: [
        {
          id: 1,
          application_id: 'A',
          kind: DocumentKind.COVER_LETTER,
          file_path: fileName && 'documents/A/' + fileName,
        } as DocumentRow,
      ],
    };
    return st;
  }

  it('takes the language from the file the row names, not from the card', () => {
    expect(
      documentLanguageOf(
        withLetter('Timo_Huennebeck_Anschreiben.html', DocumentLanguage.EN),
        'A',
        DocumentKind.COVER_LETTER,
      ),
    ).toBe(DocumentLanguage.DE);
    expect(
      documentLanguageOf(
        withLetter('Timo_Huennebeck_Cover_Letter.html', DocumentLanguage.DE),
        'A',
        DocumentKind.COVER_LETTER,
      ),
    ).toBe(DocumentLanguage.EN);
  });

  it('falls back to the card while the row has no file yet', () => {
    expect(documentLanguageOf(withLetter(null, DocumentLanguage.EN), 'A', DocumentKind.COVER_LETTER)).toBe(
      DocumentLanguage.EN,
    );
    expect(documentLanguageOf(withLetter(null, null), 'A', DocumentKind.COVER_LETTER)).toBe(
      DocumentLanguage.DE,
    );
    /* A name from neither side (hand-uploaded before the stems settled). */
    expect(
      documentLanguageOf(withLetter('irgendwas.html', DocumentLanguage.EN), 'A', DocumentKind.COVER_LETTER),
    ).toBe(DocumentLanguage.EN);
  });
});

describe('peopleKeysForCard', () => {
  /* Cards A and B belong to company 1, card C to company 2. Person 7 is filed
     under company 1, 8 under company 2 but sits on one of A's rounds, 9 is
     C's contact and filed under company 2, 5 has no company at all. */
  function peopleState(): AppState {
    return {
      applications: {
        A: application('A', 'UX Researcher', 1, Interest.LOW, 'LinkedIn'),
        B: application('B', 'Design Lead', 1, Interest.URGENT, 'Recruiter'),
        C: application('C', 'Produktdesigner', 2, Interest.MEDIUM, 'LinkedIn'),
      },
      people: {
        5: { name: 'Loner', role: '', bg: 'c', companyId: null },
        7: { name: 'Ines', role: '', bg: 'c', companyId: 1 },
        8: { name: 'Jonas', role: '', bg: 'c', companyId: 2 },
        9: { name: 'Kai', role: '', bg: 'c', companyId: 2 },
      },
      linksByApp: {
        C: [{ application_id: 'C', person_id: 9, kind: LinkKind.CONTACT, position: 0 }],
      },
      roundsState: { A: [{ people: ['8'] }] },
    } as unknown as AppState;
  }

  it('lists everyone, the card’s company and its own people first', () => {
    expect(peopleKeysForCard(peopleState(), 'A')).toEqual([
      { key: '8', known: true },
      { key: '7', known: true },
      { key: '5', known: false },
      { key: '9', known: false },
    ]);
    expect(peopleKeysForCard(peopleState(), 'B')).toEqual([
      { key: '7', known: true },
      { key: '5', known: false },
      { key: '8', known: false },
      { key: '9', known: false },
    ]);
    expect(
      peopleKeysForCard(peopleState(), 'C')
        .filter((p) => p.known)
        .map((p) => p.key),
    ).toEqual(['9', '8']);
  });

  it('knows nobody on a card at a company without people, but still offers everyone', () => {
    const st = peopleState();
    st.applications.D = application('D', 'Neu', 3, Interest.NONE, 'LinkedIn');
    const keys = peopleKeysForCard(st, 'D');
    expect(keys.some((p) => p.known)).toBe(false);
    expect(keys.map((p) => p.key)).toEqual(['5', '7', '8', '9']);
  });

  it('puts the card’s own pool first and drops deleted people', () => {
    const st = peopleState();
    st.linksByApp.A = [
      { application_id: 'A', person_id: 9, kind: LinkKind.POOL, position: 0 },
      { application_id: 'A', person_id: 42, kind: LinkKind.CONTACT, position: 1 },
    ];
    expect(peopleKeysForCard(st, 'A').map((p) => p.key)).toEqual(['9', '8', '7', '5']);
  });
});

/* One card whose only round is scheduled for tomorrow, in the given stage. */
function cardWithRound(stage: string, extraRounds = 0): AppState {
  const round = (s: string, days: number) => ({
    stage: s,
    state: RoundState.OPEN,
    title: s,
    date: isoToDate(shiftISO(todayISO(), days)),
    time: '10:00',
    where: 'Google Meet',
    people: [],
  });
  const rounds = [round(stage, 1)];
  for (let i = 0; i < extraRounds; i++) rounds.push(round('Interview', 10 + i));
  return {
    applications: { A: application('A', 'UX Researcher', 1, Interest.LOW, 'LinkedIn') },
    roundsState: { A: rounds },
  } as unknown as AppState;
}

describe('interviewChip', () => {
  /* The stage is its own column since migration 10. Deriving it from the
     round's index instead calls a lone Screening the final conversation,
     because index 0 is also the last index. */
  it('names the stage the round actually carries, not the one its position implies', () => {
    expect(interviewChip(cardWithRound('Screening'), 'A')?.meta).toBe('Screening · Google Meet');
    expect(interviewChip(cardWithRound('Interview'), 'A')?.meta).toBe('Interview · Google Meet');
    expect(interviewChip(cardWithRound('2. Interview'), 'A')?.meta).toBe('2. Interview · Google Meet');
  });

  it('falls back to the position for a round saved before rounds carried a stage', () => {
    expect(interviewChip(cardWithRound(''), 'A')?.meta).toBe('Finales Gespräch · Google Meet');
    expect(interviewChip(cardWithRound('', 1), 'A')?.meta).toBe('Screening · Google Meet');
  });
});

const edit = (over: Partial<CommentEditRow> = {}): CommentEditRow => ({
  id: 1,
  comment_id: 42,
  document: DocumentKind.COVER_LETTER,
  kind: EditKind.REPLACE,
  find_text: 'alt',
  replace_text: 'neu',
  after_text: null,
  position: 0,
  undone_at: null,
  ...over,
});

describe('editStatus', () => {
  it('is null for a reply that carries no edit set — an ordinary comment', () => {
    const st = { commentEdits: {} } as unknown as AppState;
    expect(editStatus(st, 42)).toBeNull();
  });

  it('reads as applied while every row of the set still stands', () => {
    const st = { commentEdits: { '42': [edit()] } } as unknown as AppState;
    expect(editStatus(st, 42)).toEqual({ applied: true, title: 'Anschreiben' });
  });

  it('reads as unapplied once the whole set has been undone', () => {
    const st = {
      commentEdits: { '42': [edit({ undone_at: '2026-01-01T00:00:00.000Z' })] },
    } as unknown as AppState;
    expect(editStatus(st, 42)?.applied).toBe(false);
  });

  it('names every document the all-or-nothing write touched, once each', () => {
    const st = {
      commentEdits: {
        '42': [
          edit(),
          edit({ id: 2, kind: EditKind.DELETE }),
          edit({ id: 3, document: DocumentKind.LEBENSLAUF }),
        ],
      },
    } as unknown as AppState;
    expect(editStatus(st, 42)?.title).toBe('Anschreiben und Lebenslauf');
  });
});

describe('editText', () => {
  it('shows a stored pair as the document SAYS it, tags gone', () => {
    /* The pair is kept with its markup for applyEdits to match against — see
       documentMarkup in electron/agent/prompts.ts — but the thread reads it
       as prose, same as a whole document does. */
    expect(editText('<p class="recipient">Engineering Hiring Team</p>')).toBe('Engineering Hiring Team');
  });

  it('keeps the words a tag wraps rather than dropping them with the tag', () => {
    expect(editText('Wir bauen <strong>phase6</strong> gemeinsam.')).toBe('Wir bauen phase6 gemeinsam.');
  });

  it('falls back to a placeholder for a pair that is markup with no words', () => {
    /* An edit line for this would otherwise render blank, which reads as a
       rendering bug rather than the "nothing to show" it actually is. */
    expect(editText('<img src="x.png">')).toBe('(kein Text)');
  });
});

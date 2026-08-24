/* Central app state. Domain data is loaded from SQLite at boot (db:load) and
   every mutation is written through window.desktop.db; this provider keeps the
   in-memory view in sync and owns all transient UI state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { STAGE_IDS, URL_FIELDS } from '../data/config';
import { isHttpUrl } from '../lib/url';
import {
  Assignee,
  Author,
  DocumentKind,
  FactKind,
  Interest,
  LANGUAGE_TITLES,
  LinkKind,
  RoundState,
} from '../shared/enums';
import type { DocumentLanguage } from '../shared/enums';
import type { ActivityRow, DocumentRow, FollowupRow, PersonWithCompany } from '../shared/db-types';
import { indexSnapshot, roundInput, personView } from './db-view';
import type { PersonView } from './db-view';
import {
  documentFor,
  documentLanguageOf,
  DOCUMENT_TITLE,
  keplerHoldReason,
  keplerStartBlocked,
  peopleKeysForCard,
  usedCompanyIds,
  usedLocations,
  usedRoles,
} from './selectors';
import type { AgentStartResult } from '../shared/agent';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../shared/domain';
import { dateToISO } from '../lib/date';
import { isInFocusedField } from '../lib/dom';
import { mentionsKepler } from '../lib/mentions';
import { initials } from '../lib/text';
import { parsePosting } from '../features/create/parse-posting';
import { CLOSED_PROFILE, Ctx, StateCtx } from './store-context';
import { CLOSED_EDITORS, EMPTY_DRAFT, EMPTY_FILTER, emptyRound, initialState } from './initial-state';
import { db, useResync } from './store-deps';

/* The board filter bar reaches for this through the store, which is where it
   lived before the initial state moved out. */
export { EMPTY_FILTER };
import type {
  AppActions,
  AppState,
  ContactEntry,
  Patch,
  PersonEntry,
  PersonSuggestion,
  Round,
} from './store-context';

/* Fire-and-forget bridge call to Kepler: progress arrives as agent:event
   pushes, so the promise only carries a refusal — which lands in the console
   (the menus are gated on the same checks the main process makes). */
const agentCall = (p?: Promise<AgentStartResult>) =>
  p
    ?.then((r) => {
      if (!r.ok) console.warn('[agent]', r.error);
    })
    .catch((err) => console.error('[agent]', err));

/* Sidebar labels that live on the applications row. */
const APP_FIELD: Record<string, 'channel' | 'applied_via' | 'applied_at' | 'posting_url'> = {
  Plattform: 'channel',
  Stellenanzeige: 'posting_url',
  'Beworben via': 'applied_via',
  'Beworben am': 'applied_at',
};
/* Sidebar labels that live on the shared companies row. */
const COMPANY_FIELD: Record<string, 'sector' | 'headcount' | 'homepage' | 'email' | 'phone'> = {
  Branche: 'sector',
  Mitarbeiterzahl: 'headcount',
  Firmenseite: 'homepage',
  Email: 'email',
  Telefon: 'phone',
};
const DATE_COLUMNS = new Set(['Beworben am']);
/* Cleared facts that should default to the select kind. */
const SELECT_FACTS = new Set(['Gehalt', 'Erfahrung']);

/* How each document is spoken about when it is saved. German gives the two a
   different article, so the sentences are written out rather than assembled
   from a noun — "hat der Lebenslauf überarbeitet" is what assembling gets you.
   OTHER never reaches the editor, but the record is total so a new kind cannot
   be added without deciding what it is called. */
const DOCUMENT_PHRASES: Record<DocumentKind, { revised: string; saved: string }> = {
  [DocumentKind.COVER_LETTER]: {
    revised: 'hat das Anschreiben überarbeitet',
    saved: 'Das Anschreiben wurde gespeichert',
  },
  [DocumentKind.LEBENSLAUF]: {
    revised: 'hat den Lebenslauf überarbeitet',
    saved: 'Der Lebenslauf wurde gespeichert',
  },
  [DocumentKind.OTHER]: {
    revised: 'hat das Dokument überarbeitet',
    saved: 'Das Dokument wurde gespeichert',
  },
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<AppState>(initialState);
  const stRef = useRef(st);
  stRef.current = st;

  const cancelEditRef = useRef(false);
  const dragPosRef = useRef<{ col: number; y: number } | null>(null);
  const swapLockRef = useRef<{ col: number; dir: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  /* Serializes db:rounds.set per card so a second edit never races the first
     response (which carries the db ids of freshly created rounds). */
  const roundsChainRef = useRef<Record<string, Promise<void>>>({});

  const set = useCallback((patch: Patch) => {
    setSt((s) => {
      const p = typeof patch === 'function' ? patch(s) : patch;
      return p ? { ...s, ...p } : s;
    });
  }, []);

  /* Database writes are optimistic. On failure the optimistic state is wrong,
     so reload the snapshot and let the view converge back on the truth. */
  const resync = useResync(set, stRef);

  const persist = useCallback(
    (p: Promise<unknown> | undefined) => {
      p?.catch((err) => {
        console.error('[db]', err);
        resync();
      });
    },
    [resync],
  );

  /* Boot: one snapshot load, then the board renders. */
  useEffect(() => {
    const api = db();
    if (!api) {
      console.warn('[db] window.desktop.db missing — running without persistence');
      set({ loaded: true });
      return;
    }
    api
      .load()
      .then((snap) => set({ ...indexSnapshot(snap), loaded: true }))
      .catch((err) => {
        console.error('[db] load failed', err);
        set({ loadError: String(err) });
      });
  }, [set]);

  /* Kepler's progress arrives as pushes. Run and step rows are merged
     directly; when a step also wrote domain data the event says so and the
     snapshot is re-pulled — debounced, since several steps can land at once. */
  useEffect(() => {
    const agent = window.desktop?.agent;
    if (!agent) return;
    const unsub = agent.onEvent((e) => {
      // Malformed events must never take down the React tree.
      if (!e?.run) return;
      // An update for a run whose creation event we never saw carries no step
      // list — the snapshot has it, so pull instead of rendering an empty panel.
      const prev = stRef.current.agentRuns[e.run.application_id];
      const sameRun = prev && prev.run.id === e.run.id;
      if (!sameRun && !e.steps) {
        resync();
        return;
      }
      set((s) => {
        const known = s.agentRuns[e.run.application_id];
        const steps =
          e.steps ??
          (e.step
            ? (known?.steps ?? []).map((row) => (row.id === e.step!.id ? e.step! : row))
            : (known?.steps ?? []));
        return { agentRuns: { ...s.agentRuns, [e.run.application_id]: { run: e.run, steps } } };
      });
      if (e.refresh) resync();
    });
    return unsub;
  }, [set, resync]);

  const applyTheme = (dark: boolean) => {
    const el = document.documentElement;
    if (dark) el.setAttribute('data-theme', 'dark');
    else el.removeAttribute('data-theme');
    window.desktop?.setTheme(dark ? 'dark' : 'light');
  };

  const toggleTheme = useCallback(() => {
    setSt((s) => {
      const dark = !s.dark;
      applyTheme(dark);
      try {
        localStorage.setItem('kb-theme', dark ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return { ...s, dark };
    });
  }, []);

  const roundsFor = useCallback((id: string): Round[] => {
    return stRef.current.roundsState[id] ?? [];
  }, []);

  /* Mutates a copy of the card's rounds, shows it immediately and persists the
     full list; new rounds get their db ids from the response. Writes are
     chained per card: each send reads the latest state, so a queued edit
     carries the ids the previous response just merged in — otherwise a rapid
     second edit would look like "delete and recreate" to the repo. */
  const mutateRounds = useCallback(
    (id: string, fn: (rounds: Round[]) => void) => {
      const cur = roundsFor(id).map((r) => ({
        ...r,
        people: r.people.slice(),
        notes: (r.notes || []).slice(),
      }));
      fn(cur);
      set((s) => ({ roundsState: { ...s.roundsState, [id]: cur } }));
      const prev = roundsChainRef.current[id] ?? Promise.resolve();
      const next = prev.then(async () => {
        const api = db();
        if (!api) return;
        const latest = stRef.current.roundsState[id] ?? [];
        const res = await api.rounds.set(id, latest.map(roundInput));
        set((s) => {
          const list = s.roundsState[id] ?? [];
          /* Superseded; the queued send re-syncs. null, not {} — an empty patch
             is still a patch and would spread into a fresh state object. */
          if (list.length !== res.rounds.length) return null;
          return {
            roundsState: {
              ...s.roundsState,
              [id]: list.map((v, i) => (res.rounds[i] ? { ...v, dbId: res.rounds[i].id } : v)),
            },
          };
        });
      });
      // Keep the chain alive after a failure; persist handles the error itself.
      roundsChainRef.current[id] = next.catch(() => {});
      persist(next);
    },
    [persist, roundsFor, set],
  );

  const logAct = useCallback(
    (id: string, text: string) => {
      const append = (row: ActivityRow) =>
        set((s) => ({
          activitiesByApp: { ...s.activitiesByApp, [id]: [...(s.activitiesByApp[id] || []), row] },
        }));
      const p = db()?.activities.add(id, Author.DU, text);
      if (p) persist(p.then(append));
      else
        append({
          id: -Date.now(),
          application_id: id,
          author: Author.DU,
          text,
          created_at: new Date().toISOString(),
        });
    },
    [set],
  );

  /* Deleting an interview removes it outright — rounds only exist once the
     user added one, so there is nothing canonical left to preserve. */
  const resetRound = useCallback(
    (id: string, ri: number) => {
      const r = roundsFor(id)[ri];
      if (!r) return;
      mutateRounds(id, (rs) => {
        rs.splice(ri, 1);
      });
      logAct(id, 'hat das Interview „' + r.title + '“ gelöscht');
      set((s) => ({
        dropdown: null,
        roundEdit: null,
        roundDraft: null,
        roundSel: { ...s.roundSel, [id]: Math.max(0, ri - 1) },
      }));
    },
    [logAct, mutateRounds, roundsFor, set],
  );

  const addRoundNote = useCallback(
    (id: string, ri: number, text: string) => {
      const body = text.trim();
      if (!body) return;
      const round = roundsFor(id)[ri];
      set((s) => ({
        roundsState: {
          ...s.roundsState,
          [id]: (s.roundsState[id] ?? []).map((r, i) =>
            i === ri
              ? { ...r, notes: [...(r.notes || []), { author: Author.DU, text: body, time: 'gerade eben' }] }
              : r,
          ),
        },
      }));
      // A just-created round has no dbId until db:rounds.set responds — queue
      // the note behind that write instead of silently dropping it.
      const send = () => {
        const dbId = stRef.current.roundsState[id]?.[ri]?.dbId;
        if (dbId != null) persist(db()?.roundNotes.add(dbId, Author.DU, body));
      };
      if (round?.dbId != null) send();
      else (roundsChainRef.current[id] ?? Promise.resolve()).then(send);
      logAct(id, 'hat „' + (round?.title ?? 'Interview') + '“ kommentiert');
    },
    [logAct, persist, roundsFor, set],
  );

  const linksOf = useCallback(
    (id: string, kind: LinkKind) => (stRef.current.linksByApp[id] || []).filter((l) => l.kind === kind),
    [],
  );

  const entryFor = useCallback((personId: number): ContactEntry => {
    const p = stRef.current.people[String(personId)];
    return {
      personId,
      name: p?.name || 'Unbekannt',
      role: p?.role || '',
      email: p?.email || '',
      phone: p?.phone || '',
      linkedin: p?.linkedin || '',
      bg: p?.bg,
    };
  }, []);

  const contactsFor = useCallback(
    (id: string): ContactEntry[] => linksOf(id, LinkKind.CONTACT).map((l) => entryFor(l.person_id)),
    [entryFor, linksOf],
  );

  const saveLinks = useCallback(
    (id: string, kind: LinkKind, personIds: number[]) => {
      set((s) => ({
        linksByApp: {
          ...s.linksByApp,
          [id]: [
            ...(s.linksByApp[id] || []).filter((l) => l.kind !== kind),
            ...personIds.map((pid, i) => ({ application_id: id, person_id: pid, kind, position: i })),
          ],
        },
      }));
      persist(db()?.applicationPeople.set(id, kind, personIds));
    },
    [set],
  );

  /* Every ContactEntry producer sets personId; matching by name would guess
     wrong for the two seeded people who share one. */
  const idsOf = useCallback(
    (list: ContactEntry[]): number[] =>
      list.map((c) => c.personId).filter((n): n is number => Number.isFinite(n)),
    [],
  );

  const setContacts = useCallback(
    (id: string, list: ContactEntry[]) => {
      saveLinks(id, LinkKind.CONTACT, idsOf(list));
    },
    [idsOf, saveLinks],
  );

  /* The follow-up email keeps its own recipient list. It is always explicit
     (the seed mirrors the card contacts into it) — a fallback to the card
     contacts would make an intentionally emptied list impossible. */
  const emailContactsFor = useCallback(
    (id: string): ContactEntry[] => linksOf(id, LinkKind.EMAIL).map((l) => entryFor(l.person_id)),
    [entryFor, linksOf],
  );

  const setEmailContacts = useCallback(
    (id: string, list: ContactEntry[]) => {
      saveLinks(id, LinkKind.EMAIL, idsOf(list));
    },
    [idsOf, saveLinks],
  );

  const person = useCallback((key: string): PersonEntry => {
    const s = stRef.current;
    const p: PersonView = s.people[key] || {
      name: 'Unbekannt',
      role: '',
      bg: 'var(--c-b3b0a8)',
      companyId: null,
    };
    const company = p.companyId === null ? '' : s.companies[p.companyId]?.name || '';
    return { key, ...p, company, initials: p.initials || initials(p.name) || '?' };
  }, []);

  /* The name of the company a card belongs to — what a person created from
     the card is filed under. */
  const companyOfCard = useCallback((id: string): string => {
    const s = stRef.current;
    const app = s.applications[id];
    const name = (app && s.companies[app.company_id]?.name) || '';
    /* The placeholder is not a company to file anyone under. */
    return name === UNKNOWN_COMPANY ? '' : name;
  }, []);

  const peopleForCard = useCallback(
    (id: string): PersonSuggestion[] =>
      peopleKeysForCard(stRef.current, id).map(({ key, known }) => ({ ...person(key), known })),
    [person],
  );

  /* Reads from stRef and fires the IPC outside the setState updater —
     StrictMode double-invokes updaters in dev, which would double the write. */
  const moveCard = useCallback(
    (id: string, toCol: number, toIdx: number | null, live = false) => {
      if (!id) return;
      const s = stRef.current;
      const board = s.board.map((c) => c.slice());
      let fromCol = -1;
      let fromIdx = -1;
      board.forEach((c, ci) => {
        const i = c.indexOf(id);
        if (i >= 0) {
          fromCol = ci;
          fromIdx = i;
        }
      });
      if (fromCol < 0) return;
      board[fromCol].splice(fromIdx, 1);
      let idx = toIdx == null ? board[toCol].length : toIdx;
      if (fromCol === toCol && fromIdx < idx) idx--;
      idx = Math.max(0, Math.min(idx, board[toCol].length));
      if (fromCol === toCol && idx === fromIdx && !live) return;
      if (fromCol === toCol && idx === fromIdx) {
        if (s.overCol !== toCol) set({ overCol: toCol });
        return;
      }
      board[toCol].splice(idx, 0, id);
      if (!live) {
        persist(db()?.applications.move(id, STAGE_IDS[toCol], idx));
        const app = s.applications[id];
        const applications = app
          ? { ...s.applications, [id]: { ...app, stage_id: STAGE_IDS[toCol] } }
          : s.applications;
        set({ board, applications, dragId: null, overCol: null });
        return;
      }
      set({ board, overCol: toCol });
    },
    [persist, set],
  );

  const openCard = useCallback(
    (id: string) => {
      set({
        ...CLOSED_EDITORS,
        openCardId: id,
        cardMenu: null,
        cardContact: null,
        emailExpanded: false,
        followupSel: 0,
        commentDraft: '',
        commentAttachments: [],
        contactDraft: '',
      });
    },
    [set],
  );

  /* Hands a card to Kepler. */
  const startAgent = useCallback((id: string) => agentCall(window.desktop?.agent.start(id)), []);

  /* Picks a failed run back up. Kepler is the one doing the work again, so
     the retry puts Kepler back on the card if it had been taken off. */
  const retryAgentStep = useCallback(
    (id: string) => {
      const s = stRef.current;
      if (s.applications[id] && s.applications[id].assignee !== Assignee.KEPLER) {
        set((s2) => ({
          applications: { ...s2.applications, [id]: { ...s2.applications[id], assignee: Assignee.KEPLER } },
        }));
        persist(db()?.applications.update(id, { assignee: Assignee.KEPLER }));
        logAct(id, 'hat Kepler als Bearbeiter eingesetzt');
      }
      agentCall(window.desktop?.agent.retry(id));
    },
    [logAct, persist, set],
  );

  /* Halts Kepler at the current step; the panel then offers the retry. */
  const stopAgent = useCallback((id: string) => agentCall(window.desktop?.agent.stop(id)), []);

  /* Which ask a card is currently waiting on: the main process answers a
     card's questions in order, so only the newest one's outcome may end the
     wait — an earlier answer arriving first still lands in the thread, but
     must not clear the row while a later one is due. */
  const askSeq = useRef<Record<string, number>>({});

  /* A comment addressed Kepler. The main process reads the thread itself and
     writes the reply as a Kepler comment; here only the wait and its outcome
     are tracked, and the reply is appended when it comes back. Not persisted:
     an answer that was still owed when the app closed is simply owed no more. */
  const askKepler = useCallback(
    (id: string, commentId: number) => {
      const desktop = window.desktop;
      if (!desktop) return;
      const seq = (askSeq.current[id] ?? 0) + 1;
      askSeq.current[id] = seq;
      const settle = (error: string | null) =>
        set((s) => {
          /* The card may be gone by now — deleteCard dropped its entry, and a
             reply for it has nowhere to go; a stale outcome leaves the newer
             wait alone. */
          if (!s.applications[id] || askSeq.current[id] !== seq) return {};
          return { keplerAsk: { ...s.keplerAsk, [id]: { pending: false, error } } };
        });
      set((s) => ({ keplerAsk: { ...s.keplerAsk, [id]: { pending: true, error: null } } }));
      desktop.agent
        /* Kepler must not rewrite a document the user is looking at — the
           main process has no view of renderer state, so the store hands it
           over. Only true on this card: the editor being open on a different
           application says nothing about this one. */
        .ask({
          applicationId: id,
          commentId,
          openDocument: stRef.current.editorCardId === id ? stRef.current.editorKind : null,
        })
        .then((res) => {
          if (res.ok) {
            set((s) => {
              if (!s.applications[id]) return {};
              /* A resync during the wait may already have pulled the reply
                 from the database — same row, not a second copy. */
              const others = (s.commentsByApp[id] || []).filter((c) => c.id !== res.comment.id);
              return {
                commentsByApp: { ...s.commentsByApp, [id]: [...others, res.comment] },
                /* Only an entry when there is a set to show — a reply that
                   answered a question or was refused carries none, and must
                   read exactly like an ordinary comment (see editStatus). */
                commentEdits: res.edits.length
                  ? { ...s.commentEdits, [String(res.comment.id)]: res.edits }
                  : s.commentEdits,
              };
            });
            /* An answer that carried edits rewrote files and rows on the main
               side, and the merge above only touches the thread: without this
               `documentsByApp` keeps the pre-edit row, so a PDF that the failed
               re-render just deleted still shows as a row that opens nothing,
               and the mention chip's size never moves. Same re-pull undoEdits
               does, for the same reason. */
            resync();
          }
          settle(res.ok ? null : res.error);
        })
        .catch((err: unknown) => {
          /* A broken bridge call, not a reason Kepler gave — the thread gets
             the German line, the console the cause. */
          console.error('[agent] ask failed', err);
          settle('Kepler konnte nicht antworten.');
        });
    },
    [set, resync],
  );

  /* A role a card or person is given joins the vocabulary (the repo does the
     same on its side). Defined ahead of its callers so they can list it as a
     dependency — a const cannot be named by a deps array declared above it. */
  const rememberRole = useCallback(
    (role: string) => {
      const name = role.trim();
      if (!name || name === UNKNOWN_ROLE) return;
      if (!stRef.current.roles.includes(name)) set((s) => ({ roles: [...s.roles, name] }));
    },
    [set],
  );

  const createCard = useCallback(() => {
    const s = stRef.current;
    const url = s.jobHasUrl ? s.jobUrl.trim() : '';
    const text = s.jobHasUrl ? '' : s.jobText.trim();
    // Without a posting source there is nothing for Kepler to work with —
    // the dialog's button is disabled, and ⌘Enter lands here directly.
    if (!url && !text) return;
    // With pasted text there is no URL to guess from, so the card starts on
    // the generic placeholders and Kepler names it from the text later.
    const { role, company } = parsePosting(url);
    // Keep the dialog open for the next card, but always start it empty.
    set((s2) => ({ modalOpen: s2.multiple, ...EMPTY_DRAFT }));
    persist(
      db()
        ?.applications.create({
          role,
          company,
          channel: s.jobChannel || null,
          postingUrl: url || null,
          postingText: text || null,
          language: s.jobLanguage,
        })
        .then((res) => {
          set((s2) => ({
            applications: {
              ...s2.applications,
              ...Object.fromEntries(res.applications.map((a) => [a.id, a])),
              [res.application.id]: res.application,
            },
            companies: { ...s2.companies, [res.company.id]: res.company },
            board: s2.board.map((c, i) => (i === 0 ? [res.application.id, ...c] : c)),
            linksByApp: { ...s2.linksByApp, [res.application.id]: res.people },
            roundsState: {
              ...s2.roundsState,
              [res.application.id]: res.rounds.map((r) => ({
                dbId: r.id,
                state: r.state,
                title: r.title,
                stage: r.stage || '',
                date: '',
                time: '',
                where: '',
                link: '',
                people: [],
                notes: [],
              })),
            },
            followupsByApp: { ...s2.followupsByApp, [res.application.id]: res.followups },
            documentsByApp: { ...s2.documentsByApp, [res.application.id]: res.documents },
            commentsByApp: { ...s2.commentsByApp, [res.application.id]: res.comments ?? [] },
            factsByApp: { ...s2.factsByApp, [res.application.id]: [] },
            activitiesByApp: { ...s2.activitiesByApp, [res.application.id]: [] },
          }));
          /* The repo puts the role into the vocabulary on its side; without
             this the dropdown cannot offer it until the next app start. */
          rememberRole(res.application.role);
          // The card exists, unassigned — Kepler starts once it is assigned.
        }),
    );
  }, [set, rememberRole]);

  /* Drops the application from the board and discards everything stored under
     its id; the DB cascade removes the rows. */
  const deleteCard = useCallback(
    (id: string) => {
      persist(db()?.applications.delete(id));
      set((s) => {
        const drop = <T,>(m: Record<string, T>): Record<string, T> => {
          if (!Object.prototype.hasOwnProperty.call(m, id)) return m;
          const next = { ...m };
          delete next[id];
          return next;
        };
        /* The repo prunes the placeholder company once the last card pointing
           at it is gone; dropping it here too keeps the pickers honest. */
        const companyId = s.applications[id]?.company_id;
        const orphanPlaceholder =
          companyId != null &&
          s.companies[companyId]?.name === UNKNOWN_COMPANY &&
          !Object.entries(s.applications).some(([k, a]) => k !== id && a.company_id === companyId);
        const companies = { ...s.companies };
        if (orphanPlaceholder) delete companies[companyId];

        return {
          ...CLOSED_EDITORS,
          board: s.board.map((c) => c.filter((x) => x !== id)),
          applications: drop(s.applications),
          companies,
          factsByApp: drop(s.factsByApp),
          linksByApp: drop(s.linksByApp),
          commentsByApp: drop(s.commentsByApp),
          roundsState: drop(s.roundsState),
          followupsByApp: drop(s.followupsByApp),
          documentsByApp: drop(s.documentsByApp),
          activitiesByApp: drop(s.activitiesByApp),
          agentRuns: drop(s.agentRuns),
          keplerAsk: drop(s.keplerAsk),
          roundExpanded: drop(s.roundExpanded),
          roundSel: drop(s.roundSel),
          cardMenu: null,
          cardContact: null,
          openCardId: s.openCardId === id ? null : s.openCardId,
          /* Its documents went with it, so the editor would render on a card
             that no longer has an Anschreiben — a blank screen with no way
             back but the breadcrumb. */
          editorCardId: s.editorCardId === id ? null : s.editorCardId,
          dragId: null,
          overCol: null,
        };
      });
    },
    [set],
  );

  const savePerson = useCallback(() => {
    const s = stRef.current;
    const e = s.personEdit;
    if (!e) return;
    // Fold any field still being typed into the draft before committing.
    const draft = { ...s.personDraft };
    if (s.personField) draft[s.personField] = (s.personFieldDraft || '').trim();
    const name = (draft.name || '').trim();
    const fields = {
      role: (draft.role || '').trim(),
      email: (draft.email || '').trim(),
      phone: (draft.phone || '').trim(),
      linkedin: (draft.linkedin || '').trim(),
    };
    const company = (draft.company || '').trim() || null;
    rememberRole(fields.role);
    /* The repo resolves the company name to a row (creating it if new); that
       row and the person's link to it land in state from the response. */
    const mergePerson = ({ person: row, company: comp }: PersonWithCompany) =>
      set((s2) => ({
        people: { ...s2.people, [String(row.id)]: personView(row) },
        companies: comp ? { ...s2.companies, [comp.id]: comp } : s2.companies,
      }));
    const clearEdit: Partial<AppState> = {
      personEdit: null,
      personDraft: null,
      personField: null,
      personFieldDraft: '',
      /* The editor's own company dropdown must not outlive it. */
      dropdown: null,
      contactEdit: e.forContact ? null : s.contactEdit,
    };

    const attachContact = (personId: number) => {
      if (!e.forContact) return;
      const isEmail = e.contactStore === LinkKind.EMAIL;
      const cur = isEmail ? emailContactsFor(e.id) : contactsFor(e.id);
      saveLinks(e.id, isEmail ? LinkKind.EMAIL : LinkKind.CONTACT, [...new Set([...idsOf(cur), personId])]);
      // A contact belongs in the card's suggestion pool as well, like today.
      const pool = linksOf(e.id, LinkKind.POOL).map((l) => l.person_id);
      if (pool.length && !pool.includes(personId)) saveLinks(e.id, LinkKind.POOL, [...pool, personId]);
    };

    if (e.isNew && !name) {
      // Discarded before naming — undo everything the create started.
      if (e.ri >= 0) {
        mutateRounds(e.id, (rs) => {
          if (rs[e.ri]) rs[e.ri].people = rs[e.ri].people.filter((k) => k !== e.key);
        });
      }
      const pid = Number(e.key);
      if (Number.isFinite(pid) && s.people[e.key]) {
        persist(db()?.people.delete(pid));
        set((s2) => {
          const people = { ...s2.people };
          delete people[e.key];
          return { people, ...clearEdit };
        });
        return;
      }
      set(clearEdit);
      return;
    }

    if (e.isNew && name) logAct(e.id, 'hat ' + name + ' als neue Person angelegt');

    const pid = Number(e.key);
    if (Number.isFinite(pid) && s.people[e.key]) {
      // Person exists in the DB — update it. An empty name keeps the old one:
      // the key must stay out of the patch entirely, or the repo would write
      // NULL into a NOT NULL column and roll back the other edits with it.
      const keptName = name || s.people[e.key].name;
      set((s2) => ({
        people: {
          ...s2.people,
          [e.key]: { ...s2.people[e.key], name: keptName, ...fields, initials: initials(keptName) },
        },
        ...clearEdit,
      }));
      persist(
        db()
          ?.people.update(pid, {
            ...(name ? { name } : {}),
            ...fields,
            company,
            initials: initials(keptName),
          })
          .then(mergePerson),
      );
      attachContact(pid);
    } else if (name) {
      // Created from a contact picker — the row is only written once named.
      set(clearEdit);
      persist(
        db()
          ?.people.create({ name, ...fields, company })
          .then((res) => {
            mergePerson(res);
            attachContact(res.person.id);
          }),
      );
    } else {
      set(clearEdit);
    }
  }, [contactsFor, emailContactsFor, idsOf, linksOf, logAct, mutateRounds, rememberRole, saveLinks, set]);

  /* Removes a company nobody applies at any more. Its people stay and are
     merely detached; a draft naming it is emptied so the editor does not
     recreate it on save. */
  const deleteCompany = useCallback(
    (companyId: number) => {
      const s = stRef.current;
      const name = s.companies[companyId]?.name;
      if (usedCompanyIds(s).has(companyId)) return;
      const companies = { ...s.companies };
      delete companies[companyId];
      set({
        companies,
        people: Object.fromEntries(
          Object.entries(s.people).map(([k, p]) => [
            k,
            p.companyId === companyId ? { ...p, companyId: null } : p,
          ]),
        ),
        personDraft:
          s.personDraft && name && s.personDraft.company === name
            ? { ...s.personDraft, company: '' }
            : s.personDraft,
      });
      persist(db()?.companies.delete(companyId));
    },
    [set],
  );

  const deleteLocation = useCallback(
    (name: string) => {
      const s = stRef.current;
      if (usedLocations(s).has(name)) return;
      set({ locations: s.locations.filter((l) => l !== name) });
      persist(db()?.locations.delete(name));
    },
    [set],
  );

  const deleteRole = useCallback(
    (name: string) => {
      const s = stRef.current;
      if (usedRoles(s).has(name)) return;
      set({ roles: s.roles.filter((r) => r !== name) });
      persist(db()?.roles.delete(name));
    },
    [set],
  );

  /* Removes a person everywhere they are referenced: the directory, every
     card's links and rounds. The DB cascade does the same on its side. */
  const deletePerson = useCallback(
    (id: string, key: string, isNew: boolean) => {
      const s = stRef.current;
      const name = person(key).name;
      const pid = Number(key);
      if (Number.isFinite(pid) && s.people[key]) persist(db()?.people.delete(pid));

      const people = { ...s.people };
      delete people[key];

      set({
        roundsState: Object.fromEntries(
          Object.entries(s.roundsState).map(([k, rounds]) => [
            k,
            rounds.map((r) => ({ ...r, people: r.people.filter((pk) => pk !== key) })),
          ]),
        ),
        people,
        linksByApp: Object.fromEntries(
          Object.entries(s.linksByApp).map(([k, v]) => [k, v.filter((l) => String(l.person_id) !== key)]),
        ),
        personEdit: null,
        personDraft: null,
        personField: null,
        personFieldDraft: '',
        dropdown: null,
      });
      if (!isNew) logAct(id, 'hat Person ' + name + ' gelöscht');
    },
    [logAct, person, set],
  );

  const createPersonForRound = useCallback(
    (id: string, ri: number, name: string) => {
      const company = companyOfCard(id);
      persist(
        db()
          ?.people.create({ name, company })
          .then(({ person: row }) => {
            const key = String(row.id);
            set((s) => ({ people: { ...s.people, [key]: personView(row) } }));
            const pool = linksOf(id, LinkKind.POOL).map((l) => l.person_id);
            if (pool.length) saveLinks(id, LinkKind.POOL, [...pool, row.id]);
            mutateRounds(id, (rs) => {
              if (rs[ri] && rs[ri].people.indexOf(key) < 0) rs[ri].people.push(key);
            });
            set({
              editing: null,
              editDraft: '',
              personEdit: { id, ri, key, isNew: true },
              personDraft: { name, role: '', email: '', phone: '', linkedin: '', company },
              personField: 'name',
              personFieldDraft: name,
            });
          }),
      );
    },
    [companyOfCard, linksOf, mutateRounds, saveLinks, set],
  );

  const saveRound = useCallback(() => {
    const s = stRef.current;
    const e = s.roundEdit;
    const d = s.roundDraft;
    if (!e || !d) return;
    const wasNew = !!e.isNew;
    if (wasNew && !(d.date && d.time && d.where && d.title.trim() && d.stage)) return;
    mutateRounds(e.id, (rs) => {
      if (wasNew) rs.push(emptyRound(d.title));
      const r = wasNew ? rs[rs.length - 1] : rs[e.ri];
      if (!r) return;
      r.title = d.title;
      r.stage = d.stage;
      r.date = d.date;
      r.time = d.time;
      r.where = d.where;
      r.people = d.people.slice();
      // Any remote interview keeps its meeting link; an in-person one has none.
      r.link = d.where === 'In Person' ? '' : d.link;
      if (r.state !== RoundState.DONE) r.state = d.date ? RoundState.NEXT : RoundState.OPEN;
    });
    logAct(
      e.id,
      wasNew
        ? 'hat das Interview „' +
            d.title +
            '“' +
            (d.people.length
              ? ' mit ' + d.people.map((k) => stRef.current.people[k]?.name ?? k).join(', ')
              : '') +
            ' hinzugefügt'
        : 'hat das Interview „' + d.title + '“ aktualisiert',
    );
    set({ roundEdit: null, roundDraft: null, roundPop: null });
  }, [logAct, mutateRounds, set]);

  const patchFollowup = useCallback(
    (id: string, row: FollowupRow) => {
      set((s) => ({
        followupsByApp: {
          ...s.followupsByApp,
          [id]: (s.followupsByApp[id] || []).map((f) => (f.id === row.id ? row : f)),
        },
      }));
    },
    [set],
  );

  const setFollowupDue = useCallback(
    (id: string, followupId: number, dueISO: string) => {
      set((s) => ({
        followupsByApp: {
          ...s.followupsByApp,
          [id]: (s.followupsByApp[id] || []).map((f) => (f.id === followupId ? { ...f, due_at: dueISO } : f)),
        },
      }));
      persist(db()?.followups.setDue(followupId, dueISO));
    },
    [set],
  );

  /* Ticks a follow-up off as sent, or puts it back on the list. The timestamp
     is what the chip counts "Erledigt vor 15 Tagen" from. */
  const setFollowupCompleted = useCallback(
    (id: string, followupId: number, done: boolean) => {
      const completedAt = done ? new Date().toISOString() : null;
      set((s) => ({
        followupsByApp: {
          ...s.followupsByApp,
          [id]: (s.followupsByApp[id] || []).map((f) =>
            f.id === followupId ? { ...f, completed_at: completedAt } : f,
          ),
        },
      }));
      persist(db()?.followups.setCompleted(followupId, completedAt));
    },
    [set],
  );

  /* Freezes a follow-up's text on its row. An unsent draft is rendered live
     from the card and never stored; this is called the moment one is ticked
     off, so the card can keep showing what actually went out. */
  const saveEmailDraft = useCallback(
    (id: string, followupId: number, subject: string, body: string) => {
      const p = db()?.followups.saveEmail(followupId, subject, body);
      if (p) persist(p.then((row) => patchFollowup(id, row)));
      else
        patchFollowup(id, {
          ...(stRef.current.followupsByApp[id] || []).find((f) => f.id === followupId)!,
          email_subject: subject,
          email_text: body,
          generated_at: new Date().toISOString(),
        });
    },
    [patchFollowup],
  );

  /* Sidebar field write. Routed labels update their owning row; only the
     free-form POSITION fields become facts rows. */
  const writeField = useCallback(
    (id: string, label: string, value: string) => {
      const s = stRef.current;
      const app = s.applications[id];
      if (!app) return;
      const cleared = !value || value === '—';
      // A URL row never stores anything but a full web address.
      if (!cleared && URL_FIELDS.has(label) && !isHttpUrl(value)) return;

      if (label === 'Berufsbezeichnung') {
        if (cleared) return;
        rememberRole(value);
        set((s2) => ({
          applications: { ...s2.applications, [id]: { ...s2.applications[id], role: value } },
        }));
        persist(db()?.applications.update(id, { role: value }));
        return;
      }
      if (label === 'Unternehmen') {
        if (cleared) return;
        persist(
          db()
            ?.applications.relinkCompany(id, value)
            .then(({ application, company }) => {
              set((s2) => {
                const companies = { ...s2.companies, [company.id]: company };
                /* The repo prunes the placeholder once nothing points at it.
                   Keeping it in memory leaves the picker offering a company
                   whose row is gone, and choosing it creates a second one. */
                const prevId = s2.applications[id]?.company_id;
                if (
                  prevId != null &&
                  prevId !== company.id &&
                  s2.companies[prevId]?.name === UNKNOWN_COMPANY
                ) {
                  delete companies[prevId];
                }
                return { applications: { ...s2.applications, [id]: application }, companies };
              });
            }),
        );
        return;
      }
      if (label in APP_FIELD) {
        const field = APP_FIELD[label];
        const stored = cleared ? null : DATE_COLUMNS.has(label) ? dateToISO(value) || null : value;
        set((s2) => ({
          applications: { ...s2.applications, [id]: { ...s2.applications[id], [field]: stored } },
        }));
        persist(db()?.applications.update(id, { [field]: stored }));
        return;
      }
      if (label in COMPANY_FIELD) {
        const field = COMPANY_FIELD[label];
        const stored = cleared ? null : value;
        set((s2) => {
          const company = s2.companies[app.company_id];
          return company
            ? { companies: { ...s2.companies, [company.id]: { ...company, [field]: stored } } }
            : {};
        });
        persist(db()?.companies.update(app.company_id, { [field]: stored }));
        return;
      }

      const existing = (s.factsByApp[id] || []).find((f) => f.label === label);
      const kind = existing?.kind ?? (SELECT_FACTS.has(label) ? FactKind.SELECT : null);
      const stored = cleared ? '' : value;
      /* A Standort the card is filed under joins the vocabulary (the repo does
         the same on its side). */
      if (label === 'Standort' && !cleared && !s.locations.includes(value.trim())) {
        set((s2) => ({ locations: [...s2.locations, value.trim()] }));
      }
      persist(
        db()
          ?.facts.upsert(id, label, stored, kind)
          .then((row) => {
            set((s2) => {
              const list = s2.factsByApp[id] || [];
              const next = list.some((f) => f.label === label)
                ? list.map((f) => (f.label === label ? row : f))
                : [...list, row];
              return { factsByApp: { ...s2.factsByApp, [id]: next } };
            });
          }),
      );
    },
    [rememberRole, set],
  );

  /* One document row, replaced by whatever the main process just wrote to
     disk. Both write routes end here, so the in-memory view and the file
     always describe the same thing. */
  const putDocumentRow = useCallback(
    (id: string, row: DocumentRow) =>
      set((s) => ({
        documentsByApp: {
          ...s.documentsByApp,
          [id]: (s.documentsByApp[id] || []).map((d) => (d.id === row.id ? row : d)),
        },
      })),
    [set],
  );

  /* Replaces a document with a file the user picks. Deliberately not
     optimistic: the row may only claim a file once the bytes are actually in
     userData, or the card would offer a download that cannot open. Returns the
     reason it failed, or null. */
  const replaceDocument = useCallback(
    async (id: string, documentId: number, kind: DocumentKind, title: string): Promise<string | null> => {
      const api = window.desktop;
      if (!api) return 'Ohne Desktop-Umgebung nicht möglich.';
      try {
        const source = await api.documents.pick('Dokument ersetzen', 'html');
        if (!source) return null; // cancelled
        const { filePath, pdfPath, pdfError } = await api.documents.copy(
          id,
          kind,
          documentLanguageOf(stRef.current, id, kind),
          source,
        );
        /* A hand-picked file did not come from a Fassung. */
        const row = await api.db.documents.setFile(documentId, filePath, pdfPath, null);
        putDocumentRow(id, row);
        logAct(id, 'hat „' + title + '“ ersetzt');
        /* The upload counts as done — the row and the history already say so.
           A failed export is reported on top of that, not instead of it. */
        return pdfError ? 'Die Datei wurde übernommen, das PDF ließ sich nicht erzeugen: ' + pdfError : null;
      } catch (err) {
        console.error('[documents]', err);
        return String(err);
      }
    },
    [logAct, set],
  );

  /* Saves the document the editor has been working on. Same trade as an upload:
     the HTML is what matters, so a PDF that would not render is reported on top
     of a save that happened rather than instead of it.

     `note` writes the activity entry. The editor saves after every accepted
     replacement and on every pause in the typing, so it asks for the entry once
     per session — an afternoon in the letter is one revision, not forty. */
  const saveDocument = useCallback(
    async (id: string, kind: DocumentKind, html: string, note: boolean): Promise<string | null> => {
      const api = window.desktop;
      if (!api) return 'Ohne Desktop-Umgebung nicht möglich.';
      const phrases = DOCUMENT_PHRASES[kind];
      const doc = documentFor(stRef.current, id, kind);
      if (!doc) return `Kein ${DOCUMENT_TITLE[kind]} vorhanden.`;
      try {
        const { filePath, pdfPath, pdfError } = await api.documents.save(
          id,
          kind,
          documentLanguageOf(stRef.current, id, kind),
          html,
        );
        /* The Fassung it was generated from still describes where it came
           from — editing it does not change that lineage. */
        const row = await api.db.documents.setFile(doc.id, filePath, pdfPath, doc.template_label);
        putDocumentRow(id, row);
        if (note) logAct(id, phrases.revised);
        return pdfError ? `${phrases.saved}, das PDF ließ sich nicht erzeugen: ` + pdfError : null;
      } catch (err) {
        console.error('[documents]', err);
        return String(err);
      }
    },
    [logAct, set],
  );

  const setInterest = useCallback(
    (id: string, interest: Interest) => {
      set((s) => ({ applications: { ...s.applications, [id]: { ...s.applications[id], interest } } }));
      persist(db()?.applications.update(id, { interest }));
    },
    [set],
  );

  const setLanguage = useCallback(
    (id: string, language: DocumentLanguage | null) => {
      if ((stRef.current.applications[id]?.language ?? null) === language) return;
      set((s) => ({ applications: { ...s.applications, [id]: { ...s.applications[id], language } } }));
      persist(db()?.applications.update(id, { language }));
      logAct(
        id,
        language
          ? `hat die Sprache auf ${LANGUAGE_TITLES[language]} gesetzt`
          : 'hat die Sprache zurückgesetzt',
      );
    },
    [logAct, set],
  );

  /* Who owns the card. Assigning Kepler is what starts a run — the card
     moves to In Bearbeitung first (unless it is already past that column
     or an earlier run failed there) so the board shows the work where it
     happens. Unassigning takes the name off the card only; a run already
     underway keeps going. */
  const setAssignee = useCallback(
    (id: string, assignee: Assignee | null) => {
      const s = stRef.current;
      if ((s.applications[id]?.assignee ?? null) === assignee) return;
      /* Kepler stays while a run is underway. */
      if (assignee !== Assignee.KEPLER && keplerHoldReason(s, id)) return;
      /* Without a posting source the main process would refuse the start —
         the card must not move and claim work that never begins. */
      if (assignee === Assignee.KEPLER && keplerStartBlocked(s, id)) return;
      set((s2) => ({ applications: { ...s2.applications, [id]: { ...s2.applications[id], assignee } } }));
      persist(db()?.applications.update(id, { assignee }));
      if (assignee !== Assignee.KEPLER) {
        logAct(id, 'hat Kepler als Bearbeiter entfernt');
        return;
      }
      logAct(id, 'hat Kepler als Bearbeiter eingesetzt');
      const IN_PROGRESS = 1;
      if (s.board.findIndex((c) => c.includes(id)) === 0) moveCard(id, IN_PROGRESS, null);
      startAgent(id);
    },
    [logAct, moveCard, persist, set, startAgent],
  );

  const saveSummary = useCallback(
    (id: string, text: string | null) => {
      set((s) => ({ applications: { ...s.applications, [id]: { ...s.applications[id], summary: text } } }));
      persist(db()?.applications.update(id, { summary: text }));
    },
    [set],
  );

  /* Not optimistic when files are staged: the attachment rows may only exist
     once the bytes are in userData, so the copy runs first and the comment
     appears when the database answers (same reasoning as replaceDocument). */
  const addComment = useCallback(
    (id: string, text: string) => {
      const body = text.trim();
      const staged = stRef.current.commentAttachments;
      if (!body && staged.length === 0) return;
      set((s) => ({
        commentDraft: '',
        commentAttachments: [],
        /* A reason Kepler could not answer last time is stale once the user
           writes on; the wait itself, if there is one, stays. */
        keplerAsk: s.keplerAsk[id]?.error
          ? { ...s.keplerAsk, [id]: { pending: false, error: null } }
          : s.keplerAsk,
      }));
      const desktop = window.desktop;
      if (!desktop) return;
      persist(
        (async () => {
          const atts = staged.length
            ? await desktop.attachments.copy(
                id,
                staged.map((a) => a.path),
              )
            : [];
          const res = await desktop.db.comments.add(id, Author.DU, body, atts);
          set((s) => ({
            commentsByApp: { ...s.commentsByApp, [id]: [...(s.commentsByApp[id] || []), res.comment] },
            attachmentsByComment: res.attachments.length
              ? { ...s.attachmentsByComment, [String(res.comment.id)]: res.attachments }
              : s.attachmentsByComment,
          }));
          /* Only once the comment is a row: Kepler reads the question from
             the database, not from the draft. */
          if (mentionsKepler(body)) askKepler(id, res.comment.id);
        })().catch((err) => {
          /* The composer empties on send so it feels sent, but nothing here is
             optimistic — the comment itself only appears once the database
             answers. If it never does, put the text and the staged files back
             rather than losing what was typed. */
          set({ commentDraft: body, commentAttachments: staged });
          throw err;
        }),
      );
    },
    [askKepler, set],
  );

  const pickCommentAttachments = useCallback(() => {
    window.desktop?.attachments.pick('Anhänge auswählen').then((files) => {
      if (files) set((s) => ({ commentAttachments: [...s.commentAttachments, ...files] }));
    });
  }, [set]);

  const removeCommentAttachment = useCallback(
    (index: number) => {
      set((s) => ({ commentAttachments: s.commentAttachments.filter((_, i) => i !== index) }));
    },
    [set],
  );

  const openStagedAttachment = useCallback((index: number) => {
    const a = stRef.current.commentAttachments[index];
    if (a) window.desktop?.attachments.openSource(a.path);
  }, []);

  const openAttachment = useCallback((filePath: string) => {
    window.desktop?.documents.open(filePath);
  }, []);

  const updateComment = useCallback(
    (id: string, commentId: number, text: string) => {
      set((s) => ({
        commentsByApp: {
          ...s.commentsByApp,
          [id]: (s.commentsByApp[id] || []).map((c) => (c.id === commentId ? { ...c, text } : c)),
        },
        commentEditing: null,
      }));
      persist(db()?.comments.update(commentId, text));
    },
    [set],
  );

  const deleteComment = useCallback(
    (id: string, commentId: number) => {
      set((s) => {
        const attachmentsByComment = { ...s.attachmentsByComment };
        delete attachmentsByComment[String(commentId)];
        const commentEdits = { ...s.commentEdits };
        delete commentEdits[String(commentId)];
        return {
          commentsByApp: {
            ...s.commentsByApp,
            [id]: (s.commentsByApp[id] || []).filter((c) => c.id !== commentId),
          },
          attachmentsByComment,
          commentEdits,
          commentMenu: null,
        };
      });
      persist(db()?.comments.delete(commentId));
    },
    [set],
  );

  /* The retry icon on a reply that carried an edit set: puts the document(s)
     back and marks the set undone. A refusal (the document moved on since)
     is written into keplerAsk, the same error row every other Kepler failure
     on this card surfaces through — the icon itself has no room for a
     sentence, and a swallowed refusal would leave the line green over a file
     that was never touched. */
  const undoEdits = useCallback(
    async (applicationId: string, commentId: number): Promise<string | null> => {
      /* `pending` for the whole call, exactly as askKepler sets it: the undo
         writes the same files through the same service, and DocumentsSection
         reads this flag to keep the editor shut while a write is owed.
         Without it the card unlocks mid-undo and a save can flush the
         pre-undo document back over the reversal. */
      set((s) => ({ keplerAsk: { ...s.keplerAsk, [applicationId]: { pending: true, error: null } } }));
      /* The card may be gone by the time this lands, and `pending` may by then
         belong to a newer ask — writing the row wholesale would clear a lock
         this call never took. */
      const settle = (error: string | null) =>
        set((s) =>
          s.applications[applicationId]
            ? { keplerAsk: { ...s.keplerAsk, [applicationId]: { pending: false, error } } }
            : {},
        );
      const fail = (error: string) => {
        settle(error);
        return error;
      };
      /* The undo writes the same file ask() does, so it carries the same view
         of the editor — the main process has none of its own. */
      let res;
      try {
        res = await window.desktop?.agent.undo(
          applicationId,
          commentId,
          stRef.current.editorCardId === applicationId ? stRef.current.editorKind : null,
        );
      } catch (err: unknown) {
        /* A broken bridge call, not a reason Kepler gave — same split
           askKepler makes: the thread gets the German line, the console the
           cause. Without this the rejection is floated by the click handler
           and the line stays green over a document that was never reverted. */
        console.error('[agent] undo failed', err);
        return fail('Kepler konnte die Änderung nicht zurücknehmen.');
      }
      if (!res) return fail('Ohne Desktop-Umgebung nicht möglich.');
      if (!res.ok) return fail(res.error);
      /* The reversal stands even when Chromium could not re-print beside it —
         reported rather than swallowed, since the applicant sends the PDF.
         An undo posts no comment of its own, so this row is the only surface
         it has. */
      settle(res.pdfError ?? null);
      /* The undo moved files and rewrote rows on the main side; the
         in-memory view has no way to know what changed, so it re-pulls.
         `resync` is the store's own name for that — see useResync near the
         top of the file. */
      resync();
      return null;
    },
    [set, resync],
  );

  /* ── Profile facts ──────────────────────────────────────────────────────
     A flat list, not keyed by card: these belong to the applicant. The row the
     database hands back replaces the optimistic one, so ids and timestamps are
     the real ones by the time anything edits them again. */

  const addProfileFact = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      set({ profileFactDraft: null });
      persist(
        db()
          ?.profileFacts.add(body)
          .then((row) => set((s) => ({ profileFacts: [...s.profileFacts, row] }))),
      );
    },
    [set, persist],
  );

  const deleteProfileFact = useCallback(
    (factId: number) => {
      set((s) => ({
        profileFacts: s.profileFacts.filter((f) => f.id !== factId),
        editing: null,
      }));
      persist(db()?.profileFacts.delete(factId));
    },
    [set, persist],
  );

  const updateProfileFact = useCallback(
    (factId: number, text: string) => {
      const body = text.trim();
      /* An emptied fact is a deleted one: there is nothing a blank line could
         tell the agent, and it would sit in the list unreadable. */
      if (!body) {
        deleteProfileFact(factId);
        return;
      }
      set((s) => ({
        profileFacts: s.profileFacts.map((f) => (f.id === factId ? { ...f, text: body } : f)),
        editing: null,
      }));
      persist(db()?.profileFacts.update(factId, body));
    },
    [set, persist, deleteProfileFact],
  );

  /* Splices the fact into its new slot. Called from dragover, which fires
     continuously, so this stays in memory — the list rearranges under the
     cursor and nothing is written until the drag ends. */
  const moveProfileFact = useCallback(
    (factId: number, toIdx: number) => {
      const cur = stRef.current.profileFacts;
      const from = cur.findIndex((f) => f.id === factId);
      if (from < 0 || from === toIdx) return;
      const next = cur.slice();
      const [moved] = next.splice(from, 1);
      next.splice(toIdx, 0, moved);
      set({ profileFacts: next });
    },
    [set],
  );

  /* Writes the order the drag landed on, as one call. Sends every id rather
     than what moved, so the database never has to work that out. */
  const commitProfileOrder = useCallback(() => {
    const ids = stRef.current.profileFacts.map((f) => f.id);
    if (ids.length) persist(db()?.profileFacts.reorder(ids));
  }, [persist]);

  // Restore the persisted theme and section collapse state.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('kb-theme');
    } catch {
      /* ignore */
    }
    const dark = saved === 'dark';
    applyTheme(dark);
    if (dark) set({ dark: true });
    try {
      const secs = JSON.parse(localStorage.getItem('kb-sections') || 'null');
      if (secs && typeof secs === 'object') set({ secOpen: secs });
    } catch {
      /* ignore */
    }
  }, [set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stRef.current;
      if (e.key === 'Escape') {
        if (s.cardMenu) set({ cardMenu: null });
        /* An open dropdown is the topmost thing on screen, wherever it sits —
           in the sidebar or inside the person editor — so Escape closes it
           first and leaves what is underneath alone. */
        else if (s.dropdown) set({ dropdown: null });
        else if (s.personEdit) savePerson();
        else if (s.cardContact) set({ cardContact: null, contactDraft: '' });
        else if (s.searchOpen) set({ searchOpen: false });
        else if (s.profileOpen) set(CLOSED_PROFILE);
        else if (s.contactEdit) set({ contactEdit: null });
        else if (s.roundPop) set({ roundPop: null });
        else if (s.roundEdit) set({ roundEdit: null, roundDraft: null, roundPop: null });
        /* An open dropdown was already handled above, so only the edit is left. */
        else if (s.editing) set({ editing: null });
        /* The letter runs its own Escape — it backs out of a marked passage
           first and asks before dropping a rewrite still in the air. Falling
           through here as well would clear the card underneath it, so leaving
           the letter later would land on the board instead of the detail view
           it was opened from. */
        else if (!s.editorCardId) set({ modalOpen: false, openCardId: null });
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'enter' && s.roundEdit) {
        e.preventDefault();
        saveRound();
      } else if (k === 'enter' && s.modalOpen) {
        e.preventDefault();
        createCard();
      } else if (k === 't') {
        e.preventDefault();
        toggleTheme();
      } else if (k === 'k') {
        e.preventDefault();
        set((s2) => ({ searchOpen: !s2.searchOpen, searchQ: '' }));
      } else if (k === 'p') {
        /* Chromium's own print dialog would otherwise open over the board,
           where there is nothing worth printing. The letter is the one place
           where there is: it claims ⌘P for itself and prints the sheet — see
           the ⌘P branch in LetterEditor, which also calls preventDefault. */
        if (s.editorCardId) return;
        e.preventDefault();
        set((s2) => (s2.profileOpen ? CLOSED_PROFILE : { profileOpen: true }));
      } else if (k === 'c') {
        // Never steal ⌘C from a real copy: text fields own their own selection,
        // and Chromium does not report it through window.getSelection().
        const ae = document.activeElement;
        const inField = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        if (!inField && !window.getSelection()?.toString()) {
          e.preventDefault();
          set({ modalOpen: true });
        }
      }
    };

    const onDocDown = (e: MouseEvent) => {
      const s = stRef.current;
      const target = e.target as HTMLElement | null;
      const inDd = !!target?.closest?.('[data-dd]');
      if (inDd) {
        /* Clicking another popover's surface leaves that popover alone, but a
           contact picker open elsewhere still has to go — a person editor
           inside it is saved on the way out, as on any other click-away. */
        const own = target?.closest?.('[data-contact-pop]') as HTMLElement | null;
        if (s.contactEdit && own?.dataset.contactPop !== s.contactEdit) {
          if (s.personEdit?.forContact === s.contactEdit) savePerson();
          else set({ contactEdit: null, contactDraft: '' });
        }
        return;
      }
      const ae = document.activeElement as HTMLElement | null;
      // Clicking inside the field being edited is not clicking away from it.
      // The second mousedown of a double click lands here, and blurring would
      // discard the word the double click just selected.
      if (isInFocusedField(ae, target)) return;
      // mousedown runs before focus moves, so flush the focused field first —
      // otherwise the value being typed is dropped.
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
      if (s.dropdown) set({ dropdown: null });
      if (s.cardMenu) set({ cardMenu: null });
      if (s.cardContact) set({ cardContact: null, contactDraft: '' });
      if (s.commentMenu) set({ commentMenu: null });
      if (s.personEdit) savePerson();
      if (s.contactEdit) set({ contactEdit: null });
      if (s.roundPop) set({ roundPop: null });
      if (s.editing) set({ editing: null, editDraft: '' });
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, [createCard, savePerson, saveRound, set, toggleTheme]);

  /* Actions only — `st` is deliberately absent so this object keeps its
     identity across a state change, and StateCtx carries the state instead. */
  const actions = useMemo<AppActions>(
    () => ({
      set,
      toggleTheme,
      roundsFor,
      mutateRounds,
      resetRound,
      addRoundNote,
      logAct,
      contactsFor,
      setContacts,
      emailContactsFor,
      setEmailContacts,
      person,
      peopleForCard,
      companyOfCard,
      moveCard,
      openCard,
      createCard,
      startAgent,
      retryAgentStep,
      stopAgent,
      askKepler,
      undoEdits,
      deleteCard,
      savePerson,
      deletePerson,
      deleteCompany,
      deleteLocation,
      deleteRole,
      createPersonForRound,
      saveRound,
      writeField,
      replaceDocument,
      saveDocument,
      setInterest,
      setLanguage,
      setAssignee,
      saveSummary,
      addComment,
      updateComment,
      deleteComment,
      pickCommentAttachments,
      removeCommentAttachment,
      openStagedAttachment,
      openAttachment,
      setFollowupDue,
      setFollowupCompleted,
      saveEmailDraft,
      addProfileFact,
      updateProfileFact,
      deleteProfileFact,
      moveProfileFact,
      commitProfileOrder,
      cancelEditRef,
      dragPosRef,
      swapLockRef,
      ghostRef,
    }),
    [
      set,
      toggleTheme,
      roundsFor,
      mutateRounds,
      resetRound,
      addRoundNote,
      logAct,
      contactsFor,
      setContacts,
      emailContactsFor,
      setEmailContacts,
      person,
      peopleForCard,
      companyOfCard,
      moveCard,
      openCard,
      createCard,
      startAgent,
      retryAgentStep,
      stopAgent,
      askKepler,
      undoEdits,
      deleteCard,
      savePerson,
      deletePerson,
      deleteCompany,
      deleteLocation,
      deleteRole,
      createPersonForRound,
      saveRound,
      writeField,
      setInterest,
      setLanguage,
      setAssignee,
      saveSummary,
      addComment,
      updateComment,
      deleteComment,
      pickCommentAttachments,
      removeCommentAttachment,
      openStagedAttachment,
      openAttachment,
      replaceDocument,
      saveDocument,
      setFollowupDue,
      setFollowupCompleted,
      saveEmailDraft,
      addProfileFact,
      updateProfileFact,
      deleteProfileFact,
      moveProfileFact,
      commitProfileOrder,
    ],
  );

  return (
    <Ctx.Provider value={actions}>
      <StateCtx.Provider value={st}>{children}</StateCtx.Provider>
    </Ctx.Provider>
  );
}

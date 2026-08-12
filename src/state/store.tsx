/* Central app state. Domain data is loaded from SQLite at boot (db:load) and
   every mutation is written through window.desktop.db; this provider keeps the
   in-memory view in sync and owns all transient UI state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SKILLS, STAGE_IDS } from '../data/config';
import type { ActivityRow, FollowupRow } from '../shared/db-types';
import { indexSnapshot, roundInput, personView } from './db-view';
import type { RoundView } from './db-view';
import { dateToISO } from '../lib/date';
import { cap, initials } from '../lib/text';
import { Ctx } from './store-context';
import type { AppState, AppStore, ContactEntry, Patch, Round } from './store-context';

const initialState = (): AppState => ({
  dark: false,

  loaded: false,
  applications: {},
  companies: {},
  factsByApp: {},
  people: {},
  linksByApp: {},
  commentsByApp: {},
  roundsState: {},
  followupsByApp: {},
  documentsByApp: {},
  activitiesByApp: {},
  board: STAGE_IDS.map(() => []),

  colOpen: [true, true, true, true, true, true, false, false, false, false],
  secOpen: {},
  commentMenu: null,
  commentEditing: null,
  commentEditDraft: '',
  commentDraft: '',
  openCardId: null,
  cardMenu: null,
  modalOpen: false,
  multiple: false,
  jobUrl: 'https://karriere.nordlicht-systems.de/jobs/senior-product-designer-4821',
  tick: 0,
  selected: SKILLS.map((s) => s[1]),
  dropdown: null,
  editing: null,
  editDraft: '',
  roundEdit: null,
  roundDraft: null,
  roundPop: null,
  roundTimeStep: 'start',
  roundTimeStart: null,
  cardTimeStep: 'start',
  cardTimeStart: null,
  personEdit: null,
  personDraft: null,
  personField: null,
  personFieldDraft: '',
  roundExpanded: {},
  roundSel: {},
  contactEdit: null,
  contactDraft: '',
  dragId: null,
  overCol: null,
  emailLoading: false,
  emailExpanded: false,
  followupSel: 0,
  searchOpen: false,
  searchQ: '',
});

const CANONICAL_TITLES = new Set(['Screening', 'Runde 1', 'Runde 2', 'Finales Gespräch']);

const emptyRound = (title: string): RoundView =>
  ({ state: 'open', title, date: '', time: '', where: '', people: [], notes: [] });

/* Sidebar labels that live on the applications row. */
const APP_FIELD: Record<string, 'channel' | 'applied_via' | 'applied_at' | 'last_contact_at'> = {
  Plattform: 'channel',
  'Beworben via': 'applied_via',
  'Beworben am': 'applied_at',
  'Letzter Kontakt': 'last_contact_at',
};
/* Sidebar labels that live on the shared companies row. */
const COMPANY_FIELD: Record<string, 'sector' | 'headcount' | 'website' | 'email' | 'phone'> = {
  Branche: 'sector',
  Mitarbeiterzahl: 'headcount',
  Karriereseite: 'website',
  'E-Mail': 'email',
  Telefon: 'phone',
};
const DATE_COLUMNS = new Set(['Beworben am', 'Letzter Kontakt']);

const db = () => window.desktop?.db;

/* Database writes are optimistic: state updates immediately, failures only
   log — there is no server, so the only realistic failure is a bug. */
function persist(p: Promise<unknown> | undefined) {
  p?.catch((err) => console.error('[db]', err));
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<AppState>(initialState);
  const stRef = useRef(st);
  stRef.current = st;

  const cancelEditRef = useRef(false);
  const dragPosRef = useRef<{ col: number; y: number } | null>(null);
  const swapLockRef = useRef<{ col: number; dir: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const mailTimerRef = useRef<number | undefined>(undefined);

  const set = useCallback((patch: Patch) => {
    setSt((s) => {
      const p = typeof patch === 'function' ? patch(s) : patch;
      return p ? { ...s, ...p } : s;
    });
  }, []);

  /* Boot: one snapshot load, then the board renders. */
  useEffect(() => {
    const api = db();
    if (!api) {
      console.warn('[db] window.desktop.db missing — running without persistence');
      set({ loaded: true });
      return;
    }
    api.load()
      .then((snap) => set({ ...indexSnapshot(snap), loaded: true }))
      .catch((err) => console.error('[db] load failed', err));
  }, [set]);

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
      try { localStorage.setItem('kb-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
      return { ...s, dark };
    });
  }, []);

  const roundsFor = useCallback((id: string): Round[] => {
    return stRef.current.roundsState[id] ?? [];
  }, []);

  /* Mutates a copy of the card's rounds, shows it immediately and persists the
     full list; new rounds get their db ids from the response. */
  const mutateRounds = useCallback((id: string, fn: (rounds: Round[]) => void) => {
    const cur = roundsFor(id).map((r) => ({ ...r, people: r.people.slice(), notes: (r.notes || []).slice() }));
    fn(cur);
    set((s) => ({ roundsState: { ...s.roundsState, [id]: cur } }));
    persist(db()?.rounds.set(id, cur.map(roundInput)).then((res) => {
      set((s) => ({
        roundsState: {
          ...s.roundsState,
          [id]: (s.roundsState[id] ?? []).map((v, i) => (res.rounds[i] ? { ...v, dbId: res.rounds[i].id } : v)),
        },
      }));
    }));
  }, [roundsFor, set]);

  const logAct = useCallback((id: string, text: string) => {
    const append = (row: ActivityRow) => set((s) => ({
      activitiesByApp: { ...s.activitiesByApp, [id]: [...(s.activitiesByApp[id] || []), row] },
    }));
    const p = db()?.activities.add(id, 'Du', text);
    if (p) persist(p.then(append));
    else append({ id: -Date.now(), application_id: id, author: 'Du', text, created_at: new Date().toISOString() });
  }, [set]);

  /* Clearing an interview blanks a canonical round but removes one the user
     added, so an accidentally created interview can actually be got rid of. */
  const resetRound = useCallback((id: string, ri: number) => {
    const rounds = roundsFor(id);
    const r = rounds[ri];
    if (!r) return;
    const removable = !CANONICAL_TITLES.has(r.title);
    mutateRounds(id, (rs) => {
      if (removable) {
        rs.splice(ri, 1);
        return;
      }
      const row = rs[ri];
      row.date = ''; row.time = ''; row.where = ''; row.link = '';
      row.people = []; row.notes = []; row.state = 'open';
    });
    logAct(id, removable
      ? 'hat das Interview „' + r.title + '“ gelöscht'
      : 'hat das Interview „' + r.title + '“ zurückgesetzt');
    set((s) => ({ dropdown: null, roundEdit: null, roundDraft: null, roundSel: { ...s.roundSel, [id]: Math.max(0, ri - (removable ? 1 : 0)) } }));
  }, [logAct, mutateRounds, roundsFor, set]);

  const addRoundNote = useCallback((id: string, ri: number, text: string) => {
    const body = text.trim();
    if (!body) return;
    const round = roundsFor(id)[ri];
    const appendLocal = (time: string) => set((s) => ({
      roundsState: {
        ...s.roundsState,
        [id]: (s.roundsState[id] ?? []).map((r, i) =>
          (i === ri ? { ...r, notes: [...(r.notes || []), { author: 'Du', text: body, time }] } : r)),
      },
    }));
    appendLocal('gerade eben');
    if (round?.dbId != null) persist(db()?.roundNotes.add(round.dbId, 'Du', body));
    logAct(id, 'hat „' + (round?.title ?? 'Interview') + '“ kommentiert');
  }, [logAct, roundsFor, set]);

  const linksOf = useCallback((id: string, kind: 'contact' | 'pool' | 'email') =>
    (stRef.current.linksByApp[id] || []).filter((l) => l.kind === kind), []);

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

  const contactsFor = useCallback((id: string): ContactEntry[] =>
    linksOf(id, 'contact').map((l) => entryFor(l.person_id)), [entryFor, linksOf]);

  const saveLinks = useCallback((id: string, kind: 'contact' | 'pool' | 'email', personIds: number[]) => {
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
  }, [set]);

  const idsOf = useCallback((list: ContactEntry[]): number[] => {
    const s = stRef.current;
    return list
      .map((c) => c.personId ?? Number(Object.keys(s.people).find((k) => s.people[k].name === c.name)))
      .filter((n): n is number => Number.isFinite(n));
  }, []);

  const setContacts = useCallback((id: string, list: ContactEntry[]) => {
    saveLinks(id, 'contact', idsOf(list));
  }, [idsOf, saveLinks]);

  /* The follow-up email keeps its own recipient list; with no explicit list it
     mirrors the card contacts. */
  const emailContactsFor = useCallback((id: string): ContactEntry[] => {
    const links = linksOf(id, 'email');
    return links.length ? links.map((l) => entryFor(l.person_id)) : contactsFor(id);
  }, [contactsFor, entryFor, linksOf]);

  const setEmailContacts = useCallback((id: string, list: ContactEntry[]) => {
    saveLinks(id, 'email', idsOf(list));
  }, [idsOf, saveLinks]);

  const person = useCallback((key: string) => {
    const p = stRef.current.people[key] || { name: 'Unbekannt', role: '', bg: 'var(--c-b3b0a8)' };
    return { key, ...p, initials: p.initials || initials(p.name) || '?' };
  }, []);

  const peopleForCard = useCallback((id: string) => {
    const s = stRef.current;
    const pool = linksOf(id, 'pool').map((l) => String(l.person_id));
    const base = pool.length ? pool : Object.keys(s.people);
    const onRounds = roundsFor(id).flatMap((r) => r.people);
    // Dedupe, drop keys whose person has been deleted, keep pool order.
    return [...new Set([...base, ...onRounds])].filter((k) => s.people[k]).map(person);
  }, [linksOf, person, roundsFor]);

  const moveCard = useCallback((id: string, toCol: number, toIdx: number | null, live = false) => {
    if (!id) return;
    set((s) => {
      const board = s.board.map((c) => c.slice());
      let fromCol = -1;
      let fromIdx = -1;
      board.forEach((c, ci) => {
        const i = c.indexOf(id);
        if (i >= 0) { fromCol = ci; fromIdx = i; }
      });
      if (fromCol < 0) return {};
      board[fromCol].splice(fromIdx, 1);
      let idx = toIdx == null ? board[toCol].length : toIdx;
      if (fromCol === toCol && fromIdx < idx) idx--;
      idx = Math.max(0, Math.min(idx, board[toCol].length));
      if (fromCol === toCol && idx === fromIdx && !live) return {};
      if (fromCol === toCol && idx === fromIdx) return s.overCol === toCol ? {} : { overCol: toCol };
      board[toCol].splice(idx, 0, id);
      if (!live) {
        persist(db()?.applications.move(id, STAGE_IDS[toCol], idx));
        const app = s.applications[id];
        const applications = app ? { ...s.applications, [id]: { ...app, stage_id: STAGE_IDS[toCol] } } : s.applications;
        return { board, applications, dragId: null, overCol: null };
      }
      return { board, overCol: toCol };
    });
  }, [set]);

  /* Opening a card clears every editor bound to the previous one, so a dialog
     can never save onto the wrong application. */
  const openCard = useCallback((id: string) => {
    window.clearTimeout(mailTimerRef.current);
    set({
      openCardId: id, cardMenu: null, emailLoading: false, emailExpanded: false, followupSel: 0,
      dropdown: null, editing: null, editDraft: '', commentDraft: '',
      roundEdit: null, roundDraft: null, roundPop: null,
      personEdit: null, personDraft: null, personField: null, personFieldDraft: '',
      contactEdit: null, contactDraft: '', commentMenu: null, commentEditing: null,
    });
  }, [set]);

  const createCard = useCallback(() => {
    const s = stRef.current;
    const url = (s.jobUrl || '').trim();
    let role = 'Neue Bewerbung';
    let company = 'Unbekanntes Unternehmen';
    try {
      const u = new URL(/^https?:/.test(url) ? url : 'https://' + url);
      const host = u.hostname.replace(/^(www|karriere|jobs|career)\./, '').split('.')[0];
      if (host) company = host.split('-').map(cap).join(' ');
      const slug = (u.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]?\d+$/, '');
      if (slug) role = slug.split(/[-_]/).filter(Boolean).map(cap).join(' ');
    } catch { /* keep the generic defaults */ }
    set((s2) => ({ modalOpen: s2.multiple }));
    persist(db()?.applications.create({ role, company, channel: 'Karriereseite' }).then((res) => {
      set((s2) => ({
        applications: {
          ...s2.applications,
          ...Object.fromEntries(res.applications.map((a) => [a.id, a])),
          [res.application.id]: res.application,
        },
        companies: { ...s2.companies, [res.company.id]: res.company },
        board: s2.board.map((c, i) => (i === 0 ? [res.application.id, ...c] : c)),
        roundsState: {
          ...s2.roundsState,
          [res.application.id]: res.rounds.map((r) => ({
            dbId: r.id, state: r.state, title: r.title, date: '', time: '', where: '', link: '', people: [], notes: [],
          })),
        },
        followupsByApp: { ...s2.followupsByApp, [res.application.id]: res.followups },
        documentsByApp: { ...s2.documentsByApp, [res.application.id]: res.documents },
        commentsByApp: { ...s2.commentsByApp, [res.application.id]: res.comments ?? [] },
        factsByApp: { ...s2.factsByApp, [res.application.id]: [] },
        activitiesByApp: { ...s2.activitiesByApp, [res.application.id]: [] },
      }));
    }));
  }, [set]);

  /* Drops the application from the board and discards everything stored under
     its id; the DB cascade removes the rows. */
  const deleteCard = useCallback((id: string) => {
    persist(db()?.applications.delete(id));
    set((s) => {
      const drop = <T,>(m: Record<string, T>): Record<string, T> => {
        if (!Object.prototype.hasOwnProperty.call(m, id)) return m;
        const next = { ...m };
        delete next[id];
        return next;
      };
      return {
        board: s.board.map((c) => c.filter((x) => x !== id)),
        applications: drop(s.applications),
        factsByApp: drop(s.factsByApp),
        linksByApp: drop(s.linksByApp),
        commentsByApp: drop(s.commentsByApp),
        roundsState: drop(s.roundsState),
        followupsByApp: drop(s.followupsByApp),
        documentsByApp: drop(s.documentsByApp),
        activitiesByApp: drop(s.activitiesByApp),
        roundExpanded: drop(s.roundExpanded),
        roundSel: drop(s.roundSel),
        cardMenu: null,
        openCardId: s.openCardId === id ? null : s.openCardId,
        dragId: null, overCol: null,
        dropdown: null, editing: null, editDraft: '',
        roundEdit: null, roundDraft: null, roundPop: null,
        personEdit: null, personDraft: null, personField: null, personFieldDraft: '',
        contactEdit: null, commentMenu: null, commentEditing: null,
      };
    });
  }, [set]);

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
    const clearEdit = { personEdit: null, personDraft: null, personField: null, personFieldDraft: '', contactEdit: e.forContact ? null : s.contactEdit } as Partial<AppState>;

    const attachContact = (personId: number) => {
      if (!e.forContact) return;
      const isEmail = e.contactStore === 'email';
      const cur = isEmail ? emailContactsFor(e.id) : contactsFor(e.id);
      const ids = [...new Set([...cur.map((c) => c.personId).filter((n): n is number => n != null), personId])];
      saveLinks(e.id, isEmail ? 'email' : 'contact', ids);
      // A contact belongs in the card's suggestion pool as well, like today.
      const pool = linksOf(e.id, 'pool').map((l) => l.person_id);
      if (pool.length && !pool.includes(personId)) saveLinks(e.id, 'pool', [...pool, personId]);
    };

    if (e.isNew && !name) {
      // Discarded before naming — undo everything the create started.
      if (e.ri >= 0) {
        mutateRounds(e.id, (rs) => { if (rs[e.ri]) rs[e.ri].people = rs[e.ri].people.filter((k) => k !== e.key); });
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
      // Person exists in the DB — update it.
      set((s2) => ({
        people: { ...s2.people, [e.key]: { ...s2.people[e.key], name: name || s2.people[e.key].name, ...fields, initials: initials(name || s2.people[e.key].name) } },
        ...clearEdit,
      }));
      persist(db()?.people.update(pid, { name: name || undefined, ...fields }));
      attachContact(pid);
    } else if (name) {
      // Created from a contact picker — the row is only written once named.
      set(clearEdit);
      persist(db()?.people.create({ name, ...fields }).then((row) => {
        set((s2) => ({ people: { ...s2.people, [String(row.id)]: personView(row) } }));
        attachContact(row.id);
      }));
    } else {
      set(clearEdit);
    }
  }, [contactsFor, emailContactsFor, linksOf, logAct, mutateRounds, saveLinks, set]);

  /* Removes a person everywhere they are referenced: the directory, every
     card's links and rounds. The DB cascade does the same on its side. */
  const deletePerson = useCallback((id: string, key: string, isNew: boolean) => {
    const s = stRef.current;
    const name = person(key).name;
    const pid = Number(key);
    if (Number.isFinite(pid) && s.people[key]) persist(db()?.people.delete(pid));

    const roundsState: Record<string, RoundView[]> = {};
    Object.keys(s.roundsState).forEach((k) => {
      roundsState[k] = s.roundsState[k].map((r) => ({ ...r, people: r.people.filter((pk) => pk !== key) }));
    });
    const people = { ...s.people };
    delete people[key];

    set({
      roundsState,
      people,
      linksByApp: Object.fromEntries(Object.entries(s.linksByApp).map(([k, v]) => [k, v.filter((l) => String(l.person_id) !== key)])),
      personEdit: null, personDraft: null, personField: null, personFieldDraft: '',
    });
    if (!isNew) logAct(id, 'hat Person ' + name + ' gelöscht');
  }, [logAct, person, set]);

  const createPersonForRound = useCallback((id: string, ri: number, name: string) => {
    persist(db()?.people.create({ name }).then((row) => {
      const key = String(row.id);
      set((s) => ({ people: { ...s.people, [key]: personView(row) } }));
      const pool = linksOf(id, 'pool').map((l) => l.person_id);
      if (pool.length) saveLinks(id, 'pool', [...pool, row.id]);
      mutateRounds(id, (rs) => { if (rs[ri] && rs[ri].people.indexOf(key) < 0) rs[ri].people.push(key); });
      set({
        editing: null, editDraft: '',
        personEdit: { id, ri, key, isNew: true },
        personDraft: { name, role: '', email: '', phone: '', linkedin: '' },
        personField: 'name', personFieldDraft: name,
      });
    }));
  }, [linksOf, mutateRounds, saveLinks, set]);

  const saveRound = useCallback(() => {
    const s = stRef.current;
    const e = s.roundEdit;
    const d = s.roundDraft;
    if (!e || !d) return;
    const wasNew = !!e.isNew;
    if (wasNew && !(d.date && d.time && d.where && d.title.trim())) return;
    mutateRounds(e.id, (rs) => {
      if (wasNew) rs.push(emptyRound(d.title));
      const r = wasNew ? rs[rs.length - 1] : rs[e.ri];
      if (!r) return;
      r.title = d.title;
      r.date = d.date;
      r.time = d.time;
      r.where = d.where;
      r.people = d.people.slice();
      r.link = d.where === 'Google Meet' || d.where === 'Microsoft Teams' ? d.link : '';
      if (r.state !== 'done') r.state = d.date ? 'next' : 'open';
    });
    logAct(e.id, wasNew
      ? 'hat das Interview „' + d.title + '“' + (d.people.length ? ' mit ' + d.people.map((k) => stRef.current.people[k]?.name ?? k).join(', ') : '') + ' hinzugefügt'
      : 'hat das Interview „' + d.title + '“ aktualisiert');
    set({ roundEdit: null, roundDraft: null, roundPop: null });
  }, [logAct, mutateRounds, set]);

  /* Sidebar field write. Routed labels update their owning row; only the
     free-form POSITION fields become facts rows. */
  const writeField = useCallback((id: string, label: string, value: string) => {
    const s = stRef.current;
    const app = s.applications[id];
    if (!app) return;
    const cleared = !value || value === '—';

    if (label === 'Berufsbezeichnung') {
      if (cleared) return;
      set((s2) => ({ applications: { ...s2.applications, [id]: { ...s2.applications[id], role: value } } }));
      persist(db()?.applications.update(id, { role: value }));
      return;
    }
    if (label === 'Firma') {
      if (cleared) return;
      persist(db()?.applications.relinkCompany(id, value).then(({ application, company }) => {
        set((s2) => ({
          applications: { ...s2.applications, [id]: application },
          companies: { ...s2.companies, [company.id]: company },
        }));
      }));
      return;
    }
    if (label in APP_FIELD) {
      const field = APP_FIELD[label];
      const stored = cleared ? null : DATE_COLUMNS.has(label) ? (dateToISO(value) || null) : value;
      set((s2) => ({ applications: { ...s2.applications, [id]: { ...s2.applications[id], [field]: stored } } }));
      persist(db()?.applications.update(id, { [field]: stored }));
      return;
    }
    if (label in COMPANY_FIELD) {
      const field = COMPANY_FIELD[label];
      const stored = cleared ? null : value;
      set((s2) => {
        const company = s2.companies[app.company_id];
        return company ? { companies: { ...s2.companies, [company.id]: { ...company, [field]: stored } } } : {};
      });
      persist(db()?.companies.update(app.company_id, { [field]: stored }));
      return;
    }

    const existing = (s.factsByApp[id] || []).find((f) => f.label === label);
    const kind = existing?.kind ?? (label in { Gehalt: 1, Erfahrung: 1 } ? 'select' : null);
    const stored = cleared ? '—' : value;
    persist(db()?.facts.upsert(id, label, stored, kind).then((row) => {
      set((s2) => {
        const list = s2.factsByApp[id] || [];
        const next = list.some((f) => f.label === label)
          ? list.map((f) => (f.label === label ? row : f))
          : [...list, row];
        return { factsByApp: { ...s2.factsByApp, [id]: next } };
      });
    }));
  }, [set]);

  const setInterest = useCallback((id: string, interest: string) => {
    set((s) => ({ applications: { ...s.applications, [id]: { ...s.applications[id], interest } } }));
    persist(db()?.applications.update(id, { interest }));
  }, [set]);

  const saveSummary = useCallback((id: string, text: string) => {
    set((s) => ({ applications: { ...s.applications, [id]: { ...s.applications[id], summary: text } } }));
    persist(db()?.applications.update(id, { summary: text }));
  }, [set]);

  const addComment = useCallback((id: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    set({ commentDraft: '' });
    persist(db()?.comments.add(id, 'Du', body).then((row) => {
      set((s) => ({ commentsByApp: { ...s.commentsByApp, [id]: [...(s.commentsByApp[id] || []), row] } }));
    }));
  }, [set]);

  const updateComment = useCallback((id: string, commentId: number, text: string) => {
    set((s) => ({
      commentsByApp: {
        ...s.commentsByApp,
        [id]: (s.commentsByApp[id] || []).map((c) => (c.id === commentId ? { ...c, text } : c)),
      },
      commentEditing: null,
    }));
    persist(db()?.comments.update(commentId, text));
  }, [set]);

  const deleteComment = useCallback((id: string, commentId: number) => {
    set((s) => ({
      commentsByApp: { ...s.commentsByApp, [id]: (s.commentsByApp[id] || []).filter((c) => c.id !== commentId) },
      commentMenu: null,
    }));
    persist(db()?.comments.delete(commentId));
  }, [set]);

  const patchFollowup = useCallback((id: string, row: FollowupRow) => {
    set((s) => ({
      followupsByApp: {
        ...s.followupsByApp,
        [id]: (s.followupsByApp[id] || []).map((f) => (f.id === row.id ? row : f)),
      },
    }));
  }, [set]);

  const setFollowupDue = useCallback((id: string, followupId: number, dueISO: string) => {
    set((s) => ({
      followupsByApp: {
        ...s.followupsByApp,
        [id]: (s.followupsByApp[id] || []).map((f) => (f.id === followupId ? { ...f, due_at: dueISO } : f)),
      },
    }));
    persist(db()?.followups.setDue(followupId, dueISO));
  }, [set]);

  /* Drafts are generated once, stored, and then read from the DB — see the
     design spec's followups section. */
  const saveEmailDraft = useCallback((id: string, followupId: number, subject: string, body: string) => {
    const p = db()?.followups.saveEmail(followupId, subject, body);
    if (p) persist(p.then((row) => patchFollowup(id, row)));
    else patchFollowup(id, {
      ...(stRef.current.followupsByApp[id] || []).find((f) => f.id === followupId)!,
      email_subject: subject, email_text: body, generated_at: new Date().toISOString(),
    });
  }, [patchFollowup]);

  const regenerateEmail = useCallback((id: string, followupId: number, subject: string, body: string) => {
    window.clearTimeout(mailTimerRef.current);
    set({ emailLoading: true });
    saveEmailDraft(id, followupId, subject, body);
    mailTimerRef.current = window.setTimeout(() => set({ emailLoading: false }), 2400);
  }, [saveEmailDraft, set]);

  // Restore the persisted theme and section collapse state.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('kb-theme'); } catch { /* ignore */ }
    const dark = saved === 'dark';
    applyTheme(dark);
    if (dark) set({ dark: true });
    try {
      const secs = JSON.parse(localStorage.getItem('kb-sections') || 'null');
      if (secs && typeof secs === 'object') set({ secOpen: secs });
    } catch { /* ignore */ }
  }, [set]);

  useEffect(() => {
    const t = window.setInterval(() => set((s) => ({ tick: s.tick + 1 })), 1000);
    return () => window.clearInterval(t);
  }, [set]);

  useEffect(() => () => window.clearTimeout(mailTimerRef.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stRef.current;
      if (e.key === 'Escape') {
        if (s.cardMenu) set({ cardMenu: null });
        else if (s.searchOpen) set({ searchOpen: false });
        else if (s.personEdit) savePerson();
        else if (s.contactEdit) set({ contactEdit: null });
        else if (s.roundPop) set({ roundPop: null });
        else if (s.roundEdit) set({ roundEdit: null, roundDraft: null, roundPop: null });
        else if (s.dropdown || s.editing) set({ dropdown: null, editing: null });
        else set({ modalOpen: false, openCardId: null });
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'enter' && s.roundEdit) { e.preventDefault(); saveRound(); }
      else if (k === 'enter' && s.modalOpen) { e.preventDefault(); createCard(); }
      else if (k === 'b') { e.preventDefault(); set({ modalOpen: true }); }
      else if (k === 'k') { e.preventDefault(); set((s2) => ({ searchOpen: !s2.searchOpen, searchQ: '' })); }
      else if (k === 'c') {
        // Never steal ⌘C from a real copy: text fields own their own selection,
        // and Chromium does not report it through window.getSelection().
        const ae = document.activeElement;
        const inField = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        if (!inField && !window.getSelection()?.toString()) { e.preventDefault(); toggleTheme(); }
      }
    };

    const onDocDown = (e: MouseEvent) => {
      const s = stRef.current;
      const target = e.target as HTMLElement | null;
      const inDd = !!target?.closest?.('[data-dd]');
      if (inDd) return;
      // mousedown runs before focus moves, so flush the focused field first —
      // otherwise the value being typed is dropped.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
      if (s.dropdown) set({ dropdown: null });
      if (s.cardMenu) set({ cardMenu: null });
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

  const store = useMemo<AppStore>(() => ({
    st, set, toggleTheme, roundsFor, mutateRounds, resetRound, addRoundNote, logAct,
    contactsFor, setContacts, emailContactsFor, setEmailContacts,
    person, peopleForCard, moveCard, openCard, createCard, deleteCard, savePerson, deletePerson,
    createPersonForRound, saveRound, writeField, setInterest, saveSummary,
    addComment, updateComment, deleteComment, setFollowupDue, saveEmailDraft, regenerateEmail,
    cancelEditRef, dragPosRef, swapLockRef, ghostRef,
  }), [st, set, toggleTheme, roundsFor, mutateRounds, resetRound, addRoundNote, logAct, contactsFor,
    setContacts, emailContactsFor, setEmailContacts, person, peopleForCard, moveCard, openCard,
    createCard, deleteCard, savePerson, deletePerson, createPersonForRound, saveRound, writeField,
    setInterest, saveSummary, addComment, updateComment, deleteComment, setFollowupDue,
    saveEmailDraft, regenerateEmail]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

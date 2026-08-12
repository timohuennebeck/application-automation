/* Central app state. Mirrors the interaction model of the design prototype.
   All data is still local sample data — the Claude Agent SDK backend will
   replace the data layer later. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DETAILS, INITIAL_BOARD, INITIAL_PEOPLE, INITIAL_PEOPLE_POOL,
  INITIAL_ROUNDS, PERSON_COLORS, SKILLS,
  type CardDef, type Round,
} from '../data/sample-data';
import { isoToDate, todayISO } from '../lib/date';
import { cap, initials } from '../lib/text';
import { Ctx } from './store-context';
import type { AppState, AppStore, ContactEntry, Patch } from './store-context';

const initialState = (): AppState => ({
  dark: false,
  board: INITIAL_BOARD.map((c) => c.slice()),
  colOpen: [true, true, true, true, true, true, false, false, false, false],
  extraCards: {},
  priority: {},
  factOverrides: {},
  summaryOverrides: {},
  addedComments: {},
  history: {},
  secOpen: {},
  commentEdits: {},
  commentDeletes: {},
  commentMenu: null,
  commentEditing: null,
  commentEditDraft: '',
  commentDraft: '',
  mentionAt: null,
  mentionIx: 0,
  openCardId: null,
  modalOpen: false,
  multiple: false,
  jobUrl: 'https://karriere.nordlicht-systems.de/jobs/senior-product-designer-4821',
  tick: 0,
  selected: SKILLS.map((s) => s[1]),
  dropdown: null,
  editing: null,
  editDraft: '',
  roundsState: {},
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
  contactOverrides: {},
  emailContactOverrides: {},
  contactEdit: null,
  contactDraft: '',
  dueOverrides: {},
  dragId: null,
  overCol: null,
  emailLoading: false,
  emailExpanded: false,
  followupSel: 0,
  searchOpen: false,
  searchQ: '',
  people: { ...INITIAL_PEOPLE },
  peoplePool: Object.fromEntries(Object.entries(INITIAL_PEOPLE_POOL).map(([k, v]) => [k, v.slice()])),
});

const emptyRound = (title: string): Round =>
  ({ state: 'open', title, date: '', time: '', when: 'Termin offen', where: '', people: [] });

/* Cards with no seeded interviews still get the four canonical rounds. */
const seedRounds = (id: string): Round[] => {
  const seeded = INITIAL_ROUNDS[id];
  if (seeded) {
    // Every process ends in a final conversation; seed one if the card lacks it.
    return seeded.some((r) => /final/i.test(r.title))
      ? seeded.map((r) => ({ ...r, people: r.people.slice() }))
      : [...seeded.map((r) => ({ ...r, people: r.people.slice() })), emptyRound('Finales Gespräch')];
  }
  return [emptyRound('Screening'), emptyRound('Runde 1'), emptyRound('Runde 2'), emptyRound('Finales Gespräch')];
};

/* Recomputes the display string and state after a date or time change. */
function syncRoundSchedule(r: Round) {
  r.when = r.date ? r.date + (r.time ? ', ' + r.time : '') : 'Termin offen';
  if (r.state !== 'done') r.state = r.date ? 'next' : 'open';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<AppState>(initialState);
  const stRef = useRef(st);
  stRef.current = st;

  const cancelEditRef = useRef(false);
  const dragPosRef = useRef<{ col: number; y: number } | null>(null);
  const swapLockRef = useRef<{ col: number; dir: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const nextNumRef = useRef(45);
  const mailTimerRef = useRef<number | undefined>(undefined);

  const set = useCallback((patch: Patch) => {
    setSt((s) => {
      const p = typeof patch === 'function' ? patch(s) : patch;
      return p ? { ...s, ...p } : s;
    });
  }, []);

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

  /* Seeded rounds are only a default view; once the card has been touched its
     stored list is authoritative, so renaming the final round cannot make a
     synthetic replacement reappear. */
  const roundsFor = useCallback((id: string): Round[] => {
    return stRef.current.roundsState[id] ?? seedRounds(id);
  }, []);

  const mutateRounds = useCallback((id: string, fn: (rounds: Round[]) => void) => {
    const cur = roundsFor(id).map((r) => ({ ...r, people: r.people.slice() }));
    fn(cur);
    set((s) => ({ roundsState: { ...s.roundsState, [id]: cur } }));
  }, [roundsFor, set]);

  const logAct = useCallback((id: string, text: string) => {
    set((s) => ({ history: { ...s.history, [id]: [...(s.history[id] || []), ['Du', text, 'gerade eben'] as [string, string, string]] } }));
  }, [set]);

  /* Clearing an interview blanks a seeded round but removes one the user added,
     so an accidentally created interview can actually be got rid of. */
  const resetRound = useCallback((id: string, ri: number) => {
    const rounds = roundsFor(id);
    const r = rounds[ri];
    if (!r) return;
    const seededTitles = new Set(seedRounds(id).map((s) => s.title));
    const removable = !seededTitles.has(r.title);
    mutateRounds(id, (rs) => {
      if (removable) {
        rs.splice(ri, 1);
        return;
      }
      const row = rs[ri];
      row.date = ''; row.time = ''; row.where = ''; row.link = '';
      row.people = []; row.notes = []; row.state = 'open';
      syncRoundSchedule(row);
    });
    logAct(id, removable
      ? 'hat das Interview „' + r.title + '“ gelöscht'
      : 'hat das Interview „' + r.title + '“ zurückgesetzt');
    set((s) => ({ dropdown: null, roundEdit: null, roundDraft: null, roundSel: { ...s.roundSel, [id]: Math.max(0, ri - (removable ? 1 : 0)) } }));
  }, [logAct, mutateRounds, roundsFor, set]);

  const contactsFor = useCallback((id: string): ContactEntry[] => {
    const s = stRef.current;
    if (Object.prototype.hasOwnProperty.call(s.contactOverrides, id)) return s.contactOverrides[id];
    return (DETAILS[id]?.contacts || []).map(([name, role, val, bg]) => ({ name, role, email: val, bg }));
  }, []);

  const setContacts = useCallback((id: string, list: ContactEntry[]) => {
    set((s) => ({ contactOverrides: { ...s.contactOverrides, [id]: list } }));
  }, [set]);

  const emailContactsFor = useCallback((id: string): ContactEntry[] => {
    const s = stRef.current;
    if (Object.prototype.hasOwnProperty.call(s.emailContactOverrides, id)) return s.emailContactOverrides[id];
    return contactsFor(id);
  }, [contactsFor]);

  const setEmailContacts = useCallback((id: string, list: ContactEntry[]) => {
    set((s) => ({ emailContactOverrides: { ...s.emailContactOverrides, [id]: list } }));
  }, [set]);

  const person = useCallback((key: string) => {
    const p = stRef.current.people[key] || { name: 'Unbekannt', role: '', bg: 'var(--c-b3b0a8)' };
    return { key, ...p, initials: p.initials || key };
  }, []);

  const peopleForCard = useCallback((id: string) => {
    const s = stRef.current;
    const pool = s.peoplePool[id] || Object.keys(s.people);
    const onRounds = roundsFor(id).flatMap((r) => r.people);
    // Dedupe, drop keys whose person has been deleted, keep pool order.
    return [...new Set([...pool, ...onRounds])].filter((k) => s.people[k]).map(person);
  }, [person, roundsFor]);

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
      return live ? { board, overCol: toCol } : { board, dragId: null, overCol: null };
    });
  }, [set]);

  /* Opening a card clears every editor bound to the previous one, so a dialog
     can never save onto the wrong application. */
  const openCard = useCallback((id: string) => {
    window.clearTimeout(mailTimerRef.current);
    set({
      openCardId: id, emailLoading: false, emailExpanded: false, followupSel: 0,
      dropdown: null, editing: null, editDraft: '', commentDraft: '', mentionAt: null,
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
    const id = 'BEW-' + nextNumRef.current++;
    set((s2) => ({
      extraCards: { ...s2.extraCards, [id]: [role, company, 'none', 'Karriereseite', 'gerade angelegt', null] as CardDef },
      board: s2.board.map((c, i) => (i === 0 ? [id, ...c] : c)),
      modalOpen: s2.multiple,
    }));
  }, [set]);

  const savePerson = useCallback(() => {
    const s = stRef.current;
    const e = s.personEdit;
    if (!e) return;
    // Fold any field still being typed into the draft before committing.
    const draft = { ...s.personDraft };
    if (s.personField) draft[s.personField] = (s.personFieldDraft || '').trim();

    const name = (draft.name || '').trim();
    const people = { ...s.people };
    const peoplePool = { ...s.peoplePool };
    const patch: Partial<AppState> = {};

    if (e.isNew && !name) {
      // Discarded before naming — undo everything createPerson set up.
      if (e.ri >= 0) {
        const cur = roundsFor(e.id).map((r) => ({ ...r, people: r.people.filter((k) => k !== e.key) }));
        patch.roundsState = { ...s.roundsState, [e.id]: cur };
      }
      delete people[e.key];
      Object.keys(peoplePool).forEach((k) => { peoplePool[k] = peoplePool[k].filter((x) => x !== e.key); });
    } else {
      const p = people[e.key] || { name: '', role: '', bg: 'var(--c-7a5aa8)' };
      people[e.key] = {
        ...p,
        name: name || p.name,
        role: (draft.role || '').trim(),
        email: (draft.email || '').trim(),
        phone: (draft.phone || '').trim(),
        linkedin: (draft.linkedin || '').trim(),
        initials: initials(name || p.name),
        createdAt: p.createdAt || (e.isNew ? isoToDate(todayISO()) : '24.07.2026'),
        updatedAt: e.isNew ? '' : isoToDate(todayISO()),
      };
    }

    if (e.isNew && name) {
      patch.history = { ...s.history, [e.id]: [...(s.history[e.id] || []), ['Du', 'hat ' + name + ' als neue Person angelegt', 'gerade eben'] as [string, string, string]] };
    }

    if (e.forContact) {
      if (name) {
        if (peoplePool[e.id] && peoplePool[e.id].indexOf(e.key) < 0) peoplePool[e.id] = [...peoplePool[e.id], e.key];
        const entry: ContactEntry = {
          name,
          role: (draft.role || '').trim(),
          email: (draft.email || '').trim(),
          phone: (draft.phone || '').trim(),
          linkedin: (draft.linkedin || '').trim(),
          bg: people[e.key]?.bg,
        };
        const isEmail = e.contactStore === 'email';
        const cur = isEmail ? emailContactsFor(e.id) : contactsFor(e.id);
        const upd = cur.filter((c) => c.name !== name).concat([entry]);
        if (isEmail) patch.emailContactOverrides = { ...s.emailContactOverrides, [e.id]: upd };
        else patch.contactOverrides = { ...s.contactOverrides, [e.id]: upd };
      }
      patch.contactEdit = null;
    }

    set({ ...patch, people, peoplePool, personEdit: null, personDraft: null, personField: null, personFieldDraft: '' });
  }, [contactsFor, emailContactsFor, roundsFor, set]);

  /* Removes a person everywhere they are referenced: the directory, every
     card's pool and rounds, and both contact stores. */
  const deletePerson = useCallback((id: string, key: string, isNew: boolean) => {
    const s = stRef.current;
    const name = person(key).name;

    const roundsState: Record<string, Round[]> = {};
    Object.keys(s.roundsState).forEach((k) => {
      roundsState[k] = s.roundsState[k].map((r) => ({ ...r, people: r.people.filter((pk) => pk !== key) }));
    });

    const stripContacts = (store: Record<string, ContactEntry[]>) =>
      Object.fromEntries(Object.entries(store).map(([k, list]) => [k, list.filter((c) => c.name !== name)]));

    const people = { ...s.people };
    delete people[key];

    const patch: Partial<AppState> = {
      roundsState,
      people,
      peoplePool: Object.fromEntries(Object.entries(s.peoplePool).map(([k, v]) => [k, v.filter((x) => x !== key)])),
      contactOverrides: stripContacts(s.contactOverrides),
      emailContactOverrides: stripContacts(s.emailContactOverrides),
      personEdit: null, personDraft: null, personField: null, personFieldDraft: '',
    };
    if (!isNew) {
      patch.history = { ...s.history, [id]: [...(s.history[id] || []), ['Du', 'hat Person ' + name + ' gelöscht', 'gerade eben'] as [string, string, string]] };
    }
    set(patch);
  }, [person, set]);

  const createPersonForRound = useCallback((id: string, ri: number, name: string) => {
    const s = stRef.current;
    const ini = initials(name || '') || 'NP';
    let key = ini;
    let i = 2;
    while (s.people[key]) { key = ini + i; i++; }
    const people = {
      ...s.people,
      [key]: { name, role: '', bg: PERSON_COLORS[Object.keys(s.people).length % PERSON_COLORS.length], initials: ini },
    };
    const peoplePool = { ...s.peoplePool };
    if (peoplePool[id]) peoplePool[id] = [...peoplePool[id], key];
    const cur = roundsFor(id).map((r) => ({ ...r, people: r.people.slice() }));
    if (cur[ri] && cur[ri].people.indexOf(key) < 0) cur[ri].people.push(key);
    set((s2) => ({
      people, peoplePool,
      roundsState: { ...s2.roundsState, [id]: cur },
      editing: null, editDraft: '',
      personEdit: { id, ri, key, isNew: true },
      personDraft: { name, role: '', email: '', phone: '', linkedin: '' },
      personField: 'name', personFieldDraft: name,
    }));
  }, [roundsFor, set]);

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
      syncRoundSchedule(r);
    });
    logAct(e.id, wasNew
      ? 'hat das Interview „' + d.title + '“' + (d.people.length ? ' mit ' + d.people.map((k) => stRef.current.people[k]?.name ?? k).join(', ') : '') + ' hinzugefügt'
      : 'hat das Interview „' + d.title + '“ aktualisiert');
    set({ roundEdit: null, roundDraft: null, roundPop: null });
  }, [logAct, mutateRounds, set]);

  const regenerateEmail = useCallback(() => {
    window.clearTimeout(mailTimerRef.current);
    set({ emailLoading: true });
    mailTimerRef.current = window.setTimeout(() => set({ emailLoading: false }), 2400);
  }, [set]);

  const addComment = useCallback((id: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    set((s) => ({
      addedComments: {
        ...s.addedComments,
        [id]: [...(s.addedComments[id] || []), ['Du', 'gerade eben', body, 'var(--c-5b7a5e)'] as [string, string, string, string]],
      },
      commentDraft: '',
      mentionAt: null,
    }));
  }, [set]);

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
        if (s.searchOpen) set({ searchOpen: false });
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
    st, set, toggleTheme, roundsFor, mutateRounds, resetRound, logAct,
    contactsFor, setContacts, emailContactsFor, setEmailContacts,
    person, peopleForCard, moveCard, openCard, createCard, savePerson, deletePerson,
    createPersonForRound, saveRound, regenerateEmail, addComment,
    cancelEditRef, dragPosRef, swapLockRef, ghostRef,
  }), [st, set, toggleTheme, roundsFor, mutateRounds, resetRound, logAct, contactsFor, setContacts,
    emailContactsFor, setEmailContacts, person, peopleForCard, moveCard, openCard, createCard,
    savePerson, deletePerson, createPersonForRound, saveRound, regenerateEmail, addComment]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

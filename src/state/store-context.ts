/* Shared app-state types and the React context handle.
   Kept apart from the provider so the store module only exports a component. */
import { createContext, useContext } from 'react';
import type {
  ActivityRow,
  ApplicationPersonRow,
  ApplicationRow,
  CommentRow,
  CompanyRow,
  DocumentRow,
  FactRow,
  FollowupRow,
} from '../shared/db-types';
import type { PersonView, RoundView } from './db-view';
import type { SortDir, SortKey } from '../data/config';
import type { Interest, LinkKind } from '../shared/enums';

/* Components render rounds through this alias. */
export type Round = RoundView;

export interface ContactEntry {
  /* DB person id; distinguishes two people sharing a name. */
  personId?: number;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  bg?: string;
}

export interface PersonEditState {
  id: string;
  /* Index of the round the person belongs to, or -1 when edited as a contact. */
  ri: number;
  key: string;
  isNew: boolean;
  /* Set when the editor was opened from a contact picker, naming that picker. */
  forContact?: string;
  /* Which link list that picker writes: the card's contacts or the follow-up
     email's recipients. */
  contactStore?: LinkKind;
}

/* What the board shows and in which order. Purely a view over the stored
   board — nothing here is persisted. */
export interface BoardFilter {
  sort: SortKey;
  dir: SortDir;
  /* Person ids; a card passes when one of its contacts is among them. */
  people: number[];
  channels: string[];
  interests: Interest[];
}

/* A board card plus a viewport position — used by the surfaces that float at
   the cursor rather than inside the column: the context menu and the card's
   contact picker. Both have to escape the board's scroll container. */
export interface CardPointerState {
  id: string;
  x: number;
  y: number;
}

export interface RoundEditState {
  id: string;
  ri: number;
  isNew?: boolean;
}

export interface RoundDraft {
  title: string;
  date: string;
  time: string;
  where: string;
  link: string;
  people: string[];
}

export interface AppState {
  dark: boolean;

  /* Domain state, loaded from the database at boot (db:load) and kept in sync
     by the store's mutation helpers. The DB is the source of truth. */
  loaded: boolean;
  /* Set when the boot load failed — the shell shows it instead of a blank page. */
  loadError: string | null;
  applications: Record<string, ApplicationRow>;
  companies: Record<number, CompanyRow>;
  factsByApp: Record<string, FactRow[]>;
  /* Keyed by String(person id). */
  people: Record<string, PersonView>;
  linksByApp: Record<string, ApplicationPersonRow[]>;
  commentsByApp: Record<string, CommentRow[]>;
  roundsState: Record<string, RoundView[]>;
  followupsByApp: Record<string, FollowupRow[]>;
  documentsByApp: Record<string, DocumentRow[]>;
  activitiesByApp: Record<string, ActivityRow[]>;
  /* Card ids per stage column, index-aligned with config COLUMNS/STAGE_IDS. */
  board: string[][];
  boardFilter: BoardFilter;

  /* Transient UI state. */
  colOpen: boolean[];
  secOpen: Record<string, boolean>;
  commentMenu: string | null;
  commentEditing: string | null;
  commentEditDraft: string;
  commentDraft: string;
  openCardId: string | null;
  cardMenu: CardPointerState | null;
  /* The card whose contacts are being edited straight from the board. */
  cardContact: CardPointerState | null;
  modalOpen: boolean;
  multiple: boolean;
  /* The create dialog's inputs: posting URL, free-text description and the
     people to attach as contacts (person ids, as AppState.people is keyed). */
  jobUrl: string;
  jobDescription: string;
  jobPeople: string[];
  /* Ticks once a second to drive the running-agent timers. */
  tick: number;
  /* Key of the single open dropdown, or null. */
  dropdown: string | null;
  /* Key of the single field being inline-edited, or null. */
  editing: string | null;
  editDraft: string;
  roundEdit: RoundEditState | null;
  roundDraft: RoundDraft | null;
  roundPop: string | null;
  roundTimeStep: 'start' | 'end';
  roundTimeStart: string | null;
  cardTimeStep: 'start' | 'end';
  cardTimeStart: string | null;
  personEdit: PersonEditState | null;
  personDraft: Record<string, string> | null;
  personField: string | null;
  personFieldDraft: string;
  roundExpanded: Record<string, boolean>;
  roundSel: Record<string, number>;
  contactEdit: string | null;
  contactDraft: string;
  dragId: string | null;
  overCol: number | null;
  emailLoading: boolean;
  emailExpanded: boolean;
  followupSel: number;
  searchOpen: boolean;
  searchQ: string;
}

export type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export interface AppStore {
  st: AppState;
  set: (patch: Patch) => void;
  toggleTheme: () => void;
  roundsFor: (id: string) => Round[];
  mutateRounds: (id: string, fn: (rounds: Round[]) => void) => void;
  resetRound: (id: string, ri: number) => void;
  addRoundNote: (id: string, ri: number, text: string) => void;
  logAct: (id: string, text: string) => void;
  contactsFor: (id: string) => ContactEntry[];
  setContacts: (id: string, list: ContactEntry[]) => void;
  emailContactsFor: (id: string) => ContactEntry[];
  setEmailContacts: (id: string, list: ContactEntry[]) => void;
  person: (key: string) => PersonView & { key: string; initials: string };
  /* Everyone suggestible for a card: its pool plus anyone already on a round. */
  peopleForCard: (id: string) => (PersonView & { key: string; initials: string })[];
  moveCard: (id: string, toCol: number, toIdx: number | null, live?: boolean) => void;
  openCard: (id: string) => void;
  createCard: () => void;
  deleteCard: (id: string) => void;
  savePerson: () => void;
  deletePerson: (id: string, key: string, isNew: boolean) => void;
  createPersonForRound: (id: string, ri: number, name: string) => void;
  saveRound: () => void;
  /* Sidebar field write, routed to the owning table (see fact-label routing). */
  writeField: (id: string, label: string, value: string) => void;
  setInterest: (id: string, interest: Interest) => void;
  saveSummary: (id: string, text: string) => void;
  addComment: (id: string, text: string) => void;
  updateComment: (id: string, commentId: number, text: string) => void;
  deleteComment: (id: string, commentId: number) => void;
  setFollowupDue: (id: string, followupId: number, dueISO: string) => void;
  /* Persist a generated draft silently (first open). */
  saveEmailDraft: (id: string, followupId: number, subject: string, body: string) => void;
  /* Persist a re-generated draft behind the loading skeleton. */
  regenerateEmail: (id: string, followupId: number, subject: string, body: string) => void;
  cancelEditRef: { current: boolean };
  dragPosRef: { current: { col: number; y: number } | null };
  swapLockRef: { current: { col: number; dir: number; y: number } | null };
  ghostRef: { current: HTMLElement | null };
}

export const Ctx = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

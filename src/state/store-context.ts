/* Shared app-state types and the React context handle.
   Kept apart from the provider so the store module only exports a component. */
import { createContext, useContext } from 'react';
import type {
  ActivityRow,
  ApplicationPersonRow,
  ApplicationRow,
  CommentAttachmentRow,
  CommentRow,
  CompanyRow,
  DocumentRow,
  FactRow,
  FollowupRow,
  ProfileFactRow,
} from '../shared/db-types';
import type { AgentRunView, PersonView, RoundView } from './db-view';
import type { SortDir, SortKey } from '../data/config';
import type { Assignee, DocumentKind, Interest, LinkKind } from '../shared/enums';

/* Components render rounds through this alias. */
export type Round = RoundView;

/* A person as the pickers and chips read them: the stored view plus its key,
   guaranteed initials and the resolved company name. */
export type PersonEntry = PersonView & { key: string; initials: string; company: string };
/* A picker row: `known` groups the person under "Bei <Unternehmen>" — linked to the
   card, on one of its rounds, or filed under its company. */
export type PersonSuggestion = PersonEntry & { known: boolean };

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
  /* Set when it was opened from a round's participant picker: the editor then
     takes over that popover instead of hanging off the participant's chip —
     the person may not be in the round at all. */
  forPicker?: boolean;
  /* Which link list that picker writes: the card's contacts or the follow-up
     email's recipients. */
  contactStore?: LinkKind;
}

/* What the board shows and in which order. Purely a view over the stored
   board — nothing here is persisted. */
export interface BoardFilter {
  sort: SortKey;
  dir: SortDir;
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
  stage: string;
  date: string;
  time: string;
  where: string;
  link: string;
  people: string[];
}

/* A file picked for the comment being written, still at its source path — the
   bytes are only copied into userData when the comment is sent. */
export interface StagedAttachment {
  path: string;
  name: string;
  size: number;
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
  /* Keyed by String(comment id). */
  attachmentsByComment: Record<string, CommentAttachmentRow[]>;
  roundsState: Record<string, RoundView[]>;
  followupsByApp: Record<string, FollowupRow[]>;
  documentsByApp: Record<string, DocumentRow[]>;
  activitiesByApp: Record<string, ActivityRow[]>;
  /* The profile's facts, in the order they are shown and handed over. */
  profileFacts: ProfileFactRow[];
  locations: string[];
  roles: string[];
  /* Kepler's latest run per application, kept live by agent:event pushes. */
  agentRuns: Record<string, AgentRunView>;
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
  /* Files staged for the comment being written, sent with the next addComment. */
  commentAttachments: StagedAttachment[];
  openCardId: string | null;
  /* The card whose Anschreiben is open in the letter editor, or null. Only the
     cover letter is editable in place — the CV has no passages to re-roll. */
  letterCardId: string | null;
  cardMenu: CardPointerState | null;
  /* The card whose contacts are being edited straight from the board. */
  cardContact: CardPointerState | null;
  modalOpen: boolean;
  multiple: boolean;
  /* The create dialog's inputs: the posting's URL and the channel
     ("Plattform") it was found on. */
  jobUrl: string;
  jobChannel: string;
  /* Whether the posting is given as a link; off means jobText carries the
     listing pasted by hand. */
  jobHasUrl: boolean;
  jobText: string;
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
  /* The profile dialog with the two document templates and the facts below. */
  profileOpen: boolean;
  /* Draft for the fact being appended, or null when the composer is closed. */
  profileFactDraft: string | null;
  /* Id of the fact being dragged in the profile list, or null. */
  profileDragId: number | null;
}

/* An updater returns null to mean "nothing changed" — `set` skips the state
   object entirely rather than spreading an empty patch into a fresh one. */
export type Patch = Partial<AppState> | null | ((s: AppState) => Partial<AppState> | null);

/* Everything the profile dialog owns, cleared together. Closing it has to drop
   the half-typed fact and the inline edit with it, or reopening resumes a
   composer the user already walked away from. */
export const CLOSED_PROFILE = {
  profileOpen: false,
  profileFactDraft: null,
  profileDragId: null,
  editing: null,
} satisfies Partial<AppState>;

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
  person: (key: string) => PersonEntry;
  /* Everyone suggestible for a card: its pool plus anyone already on a round. */
  peopleForCard: (id: string) => PersonSuggestion[];
  /* The name of the card's company; '' when the card is unknown. */
  companyOfCard: (id: string) => string;
  moveCard: (id: string, toCol: number, toIdx: number | null, live?: boolean) => void;
  openCard: (id: string) => void;
  createCard: () => void;
  /* Hands a card to Kepler; progress arrives over the agent event channel. */
  startAgent: (id: string) => void;
  /* Retries the failed step of the latest run; earlier steps stay done. */
  retryAgentStep: (id: string) => void;
  /* Halts the active run at its current step; retry resumes from there. */
  stopAgent: (id: string) => void;
  deleteCard: (id: string) => void;
  savePerson: () => void;
  deletePerson: (id: string, key: string, isNew: boolean) => void;
  /* No-op while a card still points at the company. */
  deleteCompany: (companyId: number) => void;
  /* No-op while a card's Standort still names it. */
  deleteLocation: (name: string) => void;
  /* No-op while a card or a person still carries the role. */
  deleteRole: (name: string) => void;
  createPersonForRound: (id: string, ri: number, name: string) => void;
  saveRound: () => void;
  /* Sidebar field write, routed to the owning table (see fact-label routing). */
  writeField: (id: string, label: string, value: string) => void;
  /* Picks an HTML file and points the document row at it. Resolves to the
     reason it failed, or null on success and on cancel. */
  replaceDocument: (
    id: string,
    documentId: number,
    kind: DocumentKind,
    title: string,
  ) => Promise<string | null>;
  /* Writes an edited Anschreiben back over its own file, re-renders the PDF and
     points the row at both. Resolves to the reason it failed, or null. */
  saveLetter: (id: string, html: string, note: boolean) => Promise<string | null>;
  setInterest: (id: string, interest: Interest) => void;
  /* Kepler is the only assignee; assigning it starts a run and moves the
     card from Interessiert to In Bearbeitung. */
  setAssignee: (id: string, assignee: Assignee | null) => void;
  saveSummary: (id: string, text: string | null) => void;
  addComment: (id: string, text: string) => void;
  updateComment: (id: string, commentId: number, text: string) => void;
  deleteComment: (id: string, commentId: number) => void;
  /* Opens the multi-select picker and stages what was chosen. */
  pickCommentAttachments: () => void;
  removeCommentAttachment: (index: number) => void;
  /* Opens a staged pick at its source path — it has no stored copy yet. */
  openStagedAttachment: (index: number) => void;
  /* Hands a stored attachment to the OS. */
  openAttachment: (filePath: string) => void;
  setFollowupDue: (id: string, followupId: number, dueISO: string) => void;
  setFollowupCompleted: (id: string, followupId: number, done: boolean) => void;
  /* Persist a generated draft silently (first open). */
  saveEmailDraft: (id: string, followupId: number, subject: string, body: string) => void;
  /* Persist a re-generated draft behind the loading skeleton. */
  regenerateEmail: (id: string, followupId: number, subject: string, body: string) => void;
  /* The profile's own facts. Every one of these writes optimistically and
     resyncs from the database if the write fails, as the card actions do. */
  addProfileFact: (text: string) => void;
  updateProfileFact: (factId: number, text: string) => void;
  deleteProfileFact: (factId: number) => void;
  /* Moves a fact to an index in the list, in memory only — this runs on every
     dragover, so it must not touch the database. commitProfileOrder writes the
     order that was landed on, once. */
  moveProfileFact: (factId: number, toIdx: number) => void;
  commitProfileOrder: () => void;
  cancelEditRef: { current: boolean };
  dragPosRef: { current: { col: number; y: number } | null };
  swapLockRef: { current: { col: number; dir: number; y: number } | null };
  ghostRef: { current: HTMLElement | null };
}

/* State and actions ride separate contexts. The actions bag is memoised on its
   callbacks alone, so it keeps its identity across a state change — which lets
   a component that only dispatches subscribe to `Ctx` and never re-render when
   unrelated state moves. `st` changes on every mutation by definition, so it
   gets its own context rather than dragging the actions along with it.

   useApp() reads both and hands back the combined shape, so every existing
   call site is unaffected. */
export type AppActions = Omit<AppStore, 'st'>;

export const Ctx = createContext<AppActions | null>(null);
export const StateCtx = createContext<AppState | null>(null);

export function useApp(): AppStore {
  const actions = useContext(Ctx);
  const st = useContext(StateCtx);
  if (!actions || !st) throw new Error('useApp outside provider');
  return { ...actions, st };
}

/* The dispatch half on its own: stable across state changes, so a component
   that only writes does not re-render when unrelated state moves. */
export function useActions(): AppActions {
  const actions = useContext(Ctx);
  if (!actions) throw new Error('useActions outside provider');
  return actions;
}

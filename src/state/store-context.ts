/* Shared app-state types and the React context handle.
   Kept apart from the provider so the store module only exports a component. */
import { createContext, useContext } from 'react';
import { CARD_DEFS, type CardDef, type PersonDef, type Round } from '../data/sample-data';

export interface ContactEntry {
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
  contactStore?: 'email' | 'card';
}

/* Position of the board context menu, in viewport coordinates. */
export interface CardMenuState {
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
  board: string[][];
  colOpen: boolean[];
  extraCards: Record<string, CardDef>;
  priority: Record<string, string>;
  factOverrides: Record<string, Record<string, string>>;
  summaryOverrides: Record<string, string>;
  addedComments: Record<string, [string, string, string, string][]>;
  history: Record<string, [string, string, string][]>;
  secOpen: Record<string, boolean>;
  commentEdits: Record<string, Record<number, string>>;
  commentDeletes: Record<string, Record<number, boolean>>;
  commentMenu: string | null;
  commentEditing: string | null;
  commentEditDraft: string;
  commentDraft: string;
  openCardId: string | null;
  cardMenu: CardMenuState | null;
  modalOpen: boolean;
  multiple: boolean;
  jobUrl: string;
  /* Ticks once a second to drive the running-agent timers. */
  tick: number;
  selected: boolean[];
  /* Key of the single open dropdown, or null. */
  dropdown: string | null;
  /* Key of the single field being inline-edited, or null. */
  editing: string | null;
  editDraft: string;
  roundsState: Record<string, Round[]>;
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
  contactOverrides: Record<string, ContactEntry[]>;
  emailContactOverrides: Record<string, ContactEntry[]>;
  contactEdit: string | null;
  contactDraft: string;
  dueOverrides: Record<string, string>;
  dragId: string | null;
  overCol: number | null;
  emailLoading: boolean;
  emailExpanded: boolean;
  followupSel: number;
  searchOpen: boolean;
  searchQ: string;
  people: Record<string, PersonDef>;
  peoplePool: Record<string, string[]>;
}

export type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export interface AppStore {
  st: AppState;
  set: (patch: Patch) => void;
  toggleTheme: () => void;
  roundsFor: (id: string) => Round[];
  mutateRounds: (id: string, fn: (rounds: Round[]) => void) => void;
  resetRound: (id: string, ri: number) => void;
  logAct: (id: string, text: string) => void;
  contactsFor: (id: string) => ContactEntry[];
  setContacts: (id: string, list: ContactEntry[]) => void;
  emailContactsFor: (id: string) => ContactEntry[];
  setEmailContacts: (id: string, list: ContactEntry[]) => void;
  person: (key: string) => PersonDef & { key: string; initials: string };
  /* Everyone suggestible for a card: its pool plus anyone already on a round. */
  peopleForCard: (id: string) => (PersonDef & { key: string; initials: string })[];
  moveCard: (id: string, toCol: number, toIdx: number | null, live?: boolean) => void;
  openCard: (id: string) => void;
  createCard: () => void;
  deleteCard: (id: string) => void;
  savePerson: () => void;
  deletePerson: (id: string, key: string, isNew: boolean) => void;
  createPersonForRound: (id: string, ri: number, name: string) => void;
  saveRound: () => void;
  regenerateEmail: () => void;
  addComment: (id: string, text: string) => void;
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

export function cardDefFor(st: AppState, id: string): CardDef | undefined {
  return CARD_DEFS[id] || st.extraCards[id];
}

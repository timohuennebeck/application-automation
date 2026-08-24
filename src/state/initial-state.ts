/* The shape of an app that has not loaded yet, and the cleared shapes it
   returns to. Split out of store.tsx so the provider reads as wiring rather
   than as one long literal. */
import { COLUMNS, SortDir, SortKey, STAGE_IDS } from '../data/config';
import { DocumentKind, RoundState } from '../shared/enums';
import type { RoundView } from './db-view';
import type { AppState, BoardFilter } from './store-context';

/* An untouched board: every card, in the order the stages hold them. */
export const EMPTY_FILTER: BoardFilter = {
  sort: SortKey.NONE,
  dir: SortDir.ASC,
  interests: [],
};

/* The create dialog's inputs. Kept as one object so "Erstelle mehrere" can
   reset the whole form after each card without listing the fields twice. */
export const EMPTY_DRAFT = {
  jobUrl: '',
  jobChannel: '',
  jobLanguage: null,
  jobHasUrl: true,
  jobText: '',
  /* The channel dropdown lives in AppState.dropdown like every other select. */
  dropdown: null,
} satisfies Partial<AppState>;

export const initialState = (): AppState => ({
  dark: false,

  loaded: false,
  loadError: null,
  applications: {},
  companies: {},
  factsByApp: {},
  people: {},
  linksByApp: {},
  commentsByApp: {},
  attachmentsByComment: {},
  commentEdits: {},
  roundsState: {},
  followupsByApp: {},
  documentsByApp: {},
  activitiesByApp: {},
  profileFacts: [],
  locations: [],
  roles: [],
  agentRuns: {},
  keplerAsk: {},
  board: STAGE_IDS.map(() => []),
  boardFilter: EMPTY_FILTER,

  colOpen: COLUMNS.map((c) => c.open),
  secOpen: {},
  commentMenu: null,
  commentEditing: null,
  commentEditDraft: '',
  commentDraft: '',
  commentAttachments: [],
  openCardId: null,
  editorCardId: null,
  editorKind: DocumentKind.COVER_LETTER,
  cardMenu: null,
  cardContact: null,
  modalOpen: false,
  multiple: false,
  ...EMPTY_DRAFT,
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
  emailExpanded: false,
  followupSel: 0,
  searchOpen: false,
  searchQ: '',
  profileOpen: false,
  profileFactDraft: null,
  profileDragId: null,
});

export const emptyRound = (title: string): RoundView => ({
  state: RoundState.OPEN,
  title,
  stage: '',
  date: '',
  time: '',
  where: '',
  people: [],
  notes: [],
});

/* Every editor bound to one card. Cleared whenever the open card changes or
   goes away, so a dialog can never save onto the wrong application. */
export const CLOSED_EDITORS = {
  dropdown: null,
  /* The document editor is bound to one card like any other editor: opening a
     different application while it is up would otherwise leave it on screen —
     App renders it ahead of the detail view — showing the old card's document
     and saving onto it. The kind is not reset with it: it is meaningless
     without a card, and the next open sets it. */
  editorCardId: null,
  editing: null,
  editDraft: '',
  roundEdit: null,
  roundDraft: null,
  roundPop: null,
  personEdit: null,
  personDraft: null,
  personField: null,
  personFieldDraft: '',
  contactEdit: null,
  commentMenu: null,
  commentEditing: null,
} satisfies Partial<AppState>;

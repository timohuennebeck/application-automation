/* App configuration and presentation constants: option lists, colors, the
   pipeline stages and the sidebar field catalog. Domain data lives in the
   database; sample-data.ts is seed input only. The stored value sets these
   constants are keyed by are the enums in src/shared/enums.ts. */
import { Interest, RoundState } from '../shared/enums.ts';

/* [label, priority] per interest level; the priority drives PriorityBars. */
export const INTEREST: Record<Interest, [string, number]> = {
  [Interest.URGENT]: ['Traumjob', 4],
  [Interest.HIGH]: ['Hohes Interesse', 3],
  [Interest.MEDIUM]: ['Interessant', 2],
  [Interest.LOW]: ['Unsicher', 1],
  [Interest.NONE]: ['Kein Interesse', 0],
};
export const INTEREST_ORDER: Interest[] = [
  Interest.URGENT,
  Interest.HIGH,
  Interest.MEDIUM,
  Interest.LOW,
  Interest.NONE,
];

/* Avatar colour per channel. Declaration order is also the order the two
   channel fields offer their options — see CHANNEL_OPTIONS. */
export const CHANNEL_BG: Record<string, string> = {
  LinkedIn: 'var(--c-3f6ea8)',
  Indeed: 'var(--c-5f5aa8)',
  StepStone: 'var(--c-7a5aa8)',
  Karriereseite: 'var(--c-5b7a5e)',
  Email: 'var(--c-3f7f9e)',
  Recruiter: 'var(--c-a8523f)',
  Empfehlung: 'var(--c-a4762f)',
  Initiativbewerbung: 'var(--c-a8497a)',
  Sonstiges: 'var(--c-8b8880)',
};

/* Where the job was found and how the application was sent are the same set of
   channels, so both fields share one list — and every value has a colour. */
export const CHANNEL_OPTIONS = Object.keys(CHANNEL_BG);

export const ROUND_STATE: Record<
  RoundState,
  {
    dotFill: string;
    dotStroke: string;
    dotDash: string;
    dotPie: string;
    titleColor: string;
    metaColor: string;
    metaWeight: number;
    muted: boolean;
  }
> = {
  [RoundState.DONE]: {
    dotFill: 'var(--c-c9c5bb)',
    dotStroke: 'var(--c-c9c5bb)',
    dotDash: '0',
    dotPie: '',
    titleColor: 'var(--c-8b8880)',
    metaColor: 'var(--c-a5a29a)',
    metaWeight: 400,
    muted: true,
  },
  [RoundState.NEXT]: {
    dotFill: 'none',
    dotStroke: 'var(--c-4f8f6a)',
    dotDash: '0',
    dotPie: 'M7 7 L7 1.5 A5.5 5.5 0 0 1 11.5 9.9 Z',
    titleColor: 'var(--c-1b1a17)',
    metaColor: 'var(--c-3d6b60)',
    metaWeight: 600,
    muted: false,
  },
  [RoundState.OPEN]: {
    dotFill: 'none',
    dotStroke: 'var(--c-c9c5bb)',
    dotDash: '2.2 2.2',
    dotPie: '',
    titleColor: 'var(--c-1b1a17)',
    metaColor: 'var(--c-a5a29a)',
    metaWeight: 400,
    muted: false,
  },
};

export const WHERE_OPTIONS = ['In Person', 'Google Meet', 'Microsoft Teams', 'Telefon'];

export const FACT_OPTIONS: Record<string, string[]> = {
  Erfahrung: ['0–2', '2–5', '5–8', '8+'],
  Plattform: CHANNEL_OPTIONS,
  'Beworben via': CHANNEL_OPTIONS,
  Branche: [
    'Software',
    'Beratung',
    'Dienstleister',
    'Finanzen',
    'Gesundheit',
    'Pharma',
    'Energie',
    'Industrie',
    'Handel',
    'E-Commerce',
    'Logistik',
    'Bildung',
    'Immobilien',
    'Telekommunikation',
    'Sonstiges',
  ],
  Mitarbeiterzahl: ['1–50', '51–200', '201–500', '501–1.000', '1.001–5.000', '5.000+'],
};

/* How urgent a card's next follow-up is — drives the colour of the board
   card's subtitle and the seed's due-date back-solving. */
export const Urgency = {
  DUE: 'DUE',
  SOON: 'SOON',
  MUTED: 'MUTED',
} as const;
export type Urgency = (typeof Urgency)[keyof typeof Urgency];

/* Shape of the status ring (ui/icons StatusDot), shared by the columns and the
   follow-up chips. */
export const DotKind = {
  DASHED: 'DASHED',
  PIE: 'PIE',
  CANCEL: 'CANCEL',
  MUTED: 'MUTED',
  /* Follow-ups only: ticked off as sent. */
  DONE: 'DONE',
} as const;
export type DotKind = (typeof DotKind)[keyof typeof DotKind];

export interface ColumnDef {
  name: string;
  kind: DotKind;
  frac?: number;
  tint: string;
  colTint: string;
  accent: string;
  open: boolean;
}
/* Index-aligned with STAGE_IDS and the stages table's position column. */
export const COLUMNS: ColumnDef[] = [
  {
    name: 'Blockiert',
    kind: DotKind.MUTED,
    tint: 'var(--c-fdf3ec)',
    colTint: 'var(--colt-0)',
    accent: 'var(--c-d07a3a)',
    open: true,
  },
  {
    name: 'Interessiert',
    kind: DotKind.DASHED,
    tint: 'var(--c-f4f2ed)',
    colTint: 'var(--colt-1)',
    accent: 'var(--c-b3b0a8)',
    open: true,
  },
  {
    name: 'In Bearbeitung',
    kind: DotKind.PIE,
    frac: 0.15,
    tint: 'var(--c-fdf7ea)',
    colTint: 'var(--colt-2)',
    accent: 'var(--c-d9a437)',
    open: true,
  },
  {
    name: 'Bewerbung eingereicht',
    kind: DotKind.PIE,
    frac: 0.3,
    tint: 'var(--c-f2f5fa)',
    colTint: 'var(--colt-3)',
    accent: 'var(--c-6d8cc0)',
    open: true,
  },
  {
    name: 'Screening',
    kind: DotKind.PIE,
    frac: 0.45,
    tint: 'var(--c-f6f3fa)',
    colTint: 'var(--colt-4)',
    accent: 'var(--c-9078b8)',
    open: true,
  },
  {
    name: 'Interview',
    kind: DotKind.PIE,
    frac: 0.55,
    tint: 'var(--c-f0f6f4)',
    colTint: 'var(--colt-5)',
    accent: 'var(--c-5b9083)',
    open: true,
  },
  {
    name: '2. Interview',
    kind: DotKind.PIE,
    frac: 0.7,
    tint: 'var(--c-eff6f2)',
    colTint: 'var(--colt-6)',
    accent: 'var(--c-4f8f6a)',
    open: true,
  },
  {
    name: '3. Interview',
    kind: DotKind.PIE,
    frac: 0.75,
    tint: 'var(--c-eff7f6)',
    colTint: 'var(--colt-11)',
    accent: 'var(--c-4a8f8f)',
    open: true,
  },
  {
    name: '4. Interview',
    kind: DotKind.PIE,
    frac: 0.8,
    tint: 'var(--c-eff4fa)',
    colTint: 'var(--colt-12)',
    accent: 'var(--c-4a7fae)',
    open: true,
  },
  {
    name: 'Finales Gespräch',
    kind: DotKind.PIE,
    frac: 0.85,
    tint: 'var(--c-f1f3f9)',
    colTint: 'var(--colt-7)',
    accent: 'var(--c-5f6fae)',
    open: false,
  },
  {
    name: 'Gehaltsverhandlungen begonnen',
    kind: DotKind.PIE,
    frac: 0.95,
    tint: 'var(--c-eef7f0)',
    colTint: 'var(--colt-8)',
    accent: 'var(--c-3f8f5a)',
    open: false,
  },
  {
    name: 'Korb erhalten',
    kind: DotKind.CANCEL,
    tint: 'var(--c-fbf1f0)',
    colTint: 'var(--colt-9)',
    accent: 'var(--c-c2564c)',
    open: false,
  },
  {
    name: 'Bewerbung zurückgezogen',
    kind: DotKind.MUTED,
    tint: 'var(--c-f3f2f0)',
    colTint: 'var(--colt-10)',
    accent: 'var(--c-a5a29a)',
    open: false,
  },
];

/* Stable stage ids, index-aligned with COLUMNS (mirrors electron/db/schema.ts). */
export const STAGE_IDS = [
  'blockiert',
  'interessiert',
  'in-bearbeitung',
  'eingereicht',
  'screening',
  'interview',
  'interview-2',
  'interview-3',
  'interview-4',
  'finale',
  'gehaltsverhandlung',
  'korb',
  'zurueckgezogen',
];

/* Interview rounds mirror the interview stages of the pipeline, so a round is
   drawn with its stage's accent and progress instead of a neutral ring. The
   last round is always the final conversation; any extra rounds in between
   spread across 2., 3. and 4. Interview before stacking onto "4. Interview". */
const ROUND_STAGES = ['screening', 'interview', 'interview-2', 'interview-3', 'interview-4', 'finale'].map(
  (id) => STAGE_IDS.indexOf(id),
);

/* Column index of a stage id — the board, the store and the seed all address
   columns by position, and a literal number silently rots the moment a
   column is added in front. */
export function stageIndex(id: string): number {
  return STAGE_IDS.indexOf(id);
}

/* The two stages a card does not come back from. Nothing about a rejected or
   withdrawn application is still pending — its follow-up due dates in
   particular stop meaning anything once nobody is waiting on a reply. */
const CLOSED_STAGE_IDS: string[] = ['korb', 'zurueckgezogen'];
export function isClosedStage(id: string | undefined | null): boolean {
  return !!id && CLOSED_STAGE_IDS.includes(id);
}
export function roundStage(index: number, total: number): ColumnDef {
  const stage =
    index === total - 1
      ? ROUND_STAGES[ROUND_STAGES.length - 1]
      : ROUND_STAGES[Math.min(index, ROUND_STAGES.length - 2)];
  return COLUMNS[stage];
}

/* The column a round is drawn and named from. Rounds have carried their own
   stage since migration 10, so that is the answer whenever it is set; the
   positional guess above only stands in for rounds saved before the column
   existed. Guessing where a stage is stored gets it wrong at every size the
   ladder does not fit — a lone Screening reads as the final conversation,
   because index 0 is also the last index. */
export function roundColumn(stage: string, index: number, total: number): ColumnDef {
  const named = ROUND_STAGES.map((i) => COLUMNS[i]).find((col) => col.name === stage);
  return named ?? roundStage(index, total);
}

/* What the board can be sorted by. The board's own order (drag and drop) is
   what SortKey.NONE means — no comparator, the stage positions decide. */
export const SortKey = {
  NONE: 'NONE',
  SALARY: 'SALARY',
  INTEREST: 'INTEREST',
  COMPANY: 'COMPANY',
  ROLE: 'ROLE',
} as const;
export type SortKey = (typeof SortKey)[keyof typeof SortKey];

export const SortDir = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;
export type SortDir = (typeof SortDir)[keyof typeof SortDir];

/* Menu label per sort key, plus the direction that reads as "best first" —
   most money and most interest descend, names and roles run A→Z. */
export const SORT_OPTIONS: [SortKey, string, SortDir][] = [
  [SortKey.NONE, 'Eigene Reihenfolge', SortDir.ASC],
  [SortKey.SALARY, 'Gehalt', SortDir.DESC],
  [SortKey.INTEREST, 'Interesse', SortDir.DESC],
  [SortKey.COMPANY, 'Unternehmen', SortDir.ASC],
  [SortKey.ROLE, 'Position', SortDir.ASC],
];

/* Sidebar field catalog. Most labels route to real DB columns; only the
   free-form POSITION fields are stored in the facts table. */
export const SECTIONS: [string, string[]][] = [
  ['Bewerbung', ['Plattform', 'Stellenanzeige', 'Warum interessant', 'Beworben via', 'Beworben am']],
  ['Position', ['Berufsbezeichnung', 'Standort', 'Gehalt', 'Erfahrung']],
  ['Unternehmen', ['Unternehmen', 'Branche', 'Mitarbeiterzahl', 'Firmenseite', 'Email', 'Telefon']],
];
export const DATE_FIELDS: Record<string, boolean> = { 'Beworben am': true };
/* Sidebar rows that hold a web address. Only a full http(s) URL is accepted
   — see lib/url.isHttpUrl; anything else is not a link and is not stored. */
export const URL_FIELDS = new Set(['Stellenanzeige', 'Firmenseite']);

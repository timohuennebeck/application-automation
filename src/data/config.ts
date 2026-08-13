/* App configuration and presentation constants: option lists, colors, the
   pipeline stages and the sidebar field catalog. Domain data lives in the
   database; sample-data.ts is seed input only. */

export type InterestKey = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export const INTEREST: Record<InterestKey, [string, number]> = {
  urgent: ['Traumjob', 4],
  high: ['Hohes Interesse', 3],
  medium: ['Interessant', 2],
  low: ['Zur Sicherheit', 1],
  none: ['Noch offen', 0],
};
export const INTEREST_ORDER: InterestKey[] = ['urgent', 'high', 'medium', 'low', 'none'];

export const CHANNEL_BG: Record<string, string> = {
  LinkedIn: 'var(--c-3f6ea8)',
  Karriereseite: 'var(--c-5b7a5e)',
  Empfehlung: 'var(--c-a4762f)',
  StepStone: 'var(--c-7a5aa8)',
  Recruiter: 'var(--c-a8523f)',
  Xing: 'var(--c-2f7a72)',
};

export type RoundStateKey = 'done' | 'next' | 'open';
export const ROUND_STATE: Record<RoundStateKey, {
  dotFill: string; dotStroke: string; dotDash: string; dotPie: string;
  titleColor: string; metaColor: string; metaWeight: number; muted: boolean;
}> = {
  done: { dotFill: 'var(--c-c9c5bb)', dotStroke: 'var(--c-c9c5bb)', dotDash: '0', dotPie: '', titleColor: 'var(--c-8b8880)', metaColor: 'var(--c-a5a29a)', metaWeight: 400, muted: true },
  next: { dotFill: 'none', dotStroke: 'var(--c-4f8f6a)', dotDash: '0', dotPie: 'M7 7 L7 1.5 A5.5 5.5 0 0 1 11.5 9.9 Z', titleColor: 'var(--c-1b1a17)', metaColor: 'var(--c-3d6b60)', metaWeight: 600, muted: false },
  open: { dotFill: 'none', dotStroke: 'var(--c-c9c5bb)', dotDash: '2.2 2.2', dotPie: '', titleColor: 'var(--c-1b1a17)', metaColor: 'var(--c-a5a29a)', metaWeight: 400, muted: false },
};

export const WHERE_OPTIONS = ['In Person', 'Google Meet', 'Microsoft Teams', 'Telefon'];

export const FACT_OPTIONS: Record<string, string[]> = {
  Erfahrung: ['0–2', '2–5', '5–8', '8+'],
  Plattform: ['LinkedIn', 'Xing', 'StepStone', 'Karriereseite', 'Empfehlung', 'Recruiter'],
  'Beworben via': ['Karriereseite', 'E-Mail', 'LinkedIn', 'Xing', 'StepStone', 'Recruiter'],
  Branche: ['Software', 'Energie', 'Agentur', 'Gesundheit', 'Handel', 'Finanzen', 'Industrie'],
  Mitarbeiterzahl: ['1–50', '51–200', '201–500', '501–1.000', '1.001–5.000', '5.000+'],
};

export type ColumnKind = 'dashed' | 'pie' | 'cancel' | 'muted';
export interface ColumnDef {
  name: string;
  kind: ColumnKind;
  frac?: number;
  tint: string;
  colTint: string;
  accent: string;
  open: boolean;
}
/* Index-aligned with STAGE_IDS and the stages table's position column. */
export const COLUMNS: ColumnDef[] = [
  { name: 'Interessiert', kind: 'dashed', tint: 'var(--c-f4f2ed)', colTint: 'var(--colt-1)', accent: 'var(--c-b3b0a8)', open: true },
  { name: 'In Bearbeitung', kind: 'pie', frac: 0.15, tint: 'var(--c-fdf7ea)', colTint: 'var(--colt-2)', accent: 'var(--c-d9a437)', open: true },
  { name: 'Bewerbung eingereicht', kind: 'pie', frac: 0.3, tint: 'var(--c-f2f5fa)', colTint: 'var(--colt-3)', accent: 'var(--c-6d8cc0)', open: true },
  { name: 'Screening', kind: 'pie', frac: 0.45, tint: 'var(--c-f6f3fa)', colTint: 'var(--colt-4)', accent: 'var(--c-9078b8)', open: true },
  { name: 'Interview', kind: 'pie', frac: 0.55, tint: 'var(--c-f0f6f4)', colTint: 'var(--colt-5)', accent: 'var(--c-5b9083)', open: true },
  { name: '2. Interview', kind: 'pie', frac: 0.7, tint: 'var(--c-eff6f2)', colTint: 'var(--colt-6)', accent: 'var(--c-4f8f6a)', open: true },
  { name: 'Finales Gespräch', kind: 'pie', frac: 0.85, tint: 'var(--c-f1f3f9)', colTint: 'var(--colt-7)', accent: 'var(--c-5f6fae)', open: false },
  { name: 'Gehaltsverhandlungen begonnen', kind: 'pie', frac: 0.95, tint: 'var(--c-eef7f0)', colTint: 'var(--colt-8)', accent: 'var(--c-3f8f5a)', open: false },
  { name: 'Korb erhalten', kind: 'cancel', tint: 'var(--c-fbf1f0)', colTint: 'var(--colt-9)', accent: 'var(--c-c2564c)', open: false },
  { name: 'Bewerbung zurückgezogen', kind: 'muted', tint: 'var(--c-f3f2f0)', colTint: 'var(--colt-10)', accent: 'var(--c-a5a29a)', open: false },
];

/* Stable stage ids, index-aligned with COLUMNS (mirrors electron/db/schema.ts). */
export const STAGE_IDS = [
  'interessiert', 'in-bearbeitung', 'eingereicht', 'screening', 'interview',
  'interview-2', 'finale', 'gehaltsverhandlung', 'korb', 'zurueckgezogen',
];

/* Interview rounds mirror the interview stages of the pipeline, so a round is
   drawn with its stage's accent and progress instead of a neutral ring. The
   last round is always the final conversation; any extra rounds in between
   stay on "2. Interview". */
const ROUND_STAGES = [3, 4, 5, 6]; // indices into COLUMNS
export function roundStage(index: number, total: number): ColumnDef {
  const stage = index === total - 1
    ? ROUND_STAGES[ROUND_STAGES.length - 1]
    : ROUND_STAGES[Math.min(index, ROUND_STAGES.length - 2)];
  return COLUMNS[stage];
}

/* Sidebar field catalog. Most labels route to real DB columns; only the
   free-form POSITION fields are stored in the facts table. */
export const SECTIONS: [string, string[]][] = [
  ['Bewerbung', ['Plattform', 'Beworben via', 'Beworben am', 'Letzter Kontakt']],
  ['Position', ['Berufsbezeichnung', 'Standort', 'Gehalt', 'Erfahrung']],
  ['Unternehmen', ['Firma', 'Branche', 'Mitarbeiterzahl', 'Karriereseite', 'E-Mail', 'Telefon']],
];
export const DATE_FIELDS: Record<string, boolean> = { 'Beworben am': true, 'Letzter Kontakt': true };

export const SKILLS: [string, boolean][] = [
  ['User Research', false], ['Figma', true], ['Interaction Design', false],
  ['Frontend (HTML/CSS)', true], ['Deutsch C1', false],
];

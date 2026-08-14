/* Seed input for the SQLite database (electron/db/seed.ts) plus the agent-run
   stubs the AgentRunPanel still renders. Presentation constants live in
   config.ts; live domain data comes from the database. The '.ts' extensions
   matter: the electron tree compiles this file under nodenext. */
import { Urgency } from './config.ts';
import { Author, FactKind, Interest, RoundState, TemplateKind } from '../shared/enums.ts';

export const SALARY: Record<string, string> = {
  'BEW-41': '78–92k €',
  'BEW-44': '85–100k €',
  'BEW-38': '70–84k €',
  'BEW-33': '120–135k €',
  'BEW-29': '58–70k €',
  'BEW-35': '65–78k €',
  'BEW-24': '95–110k €',
  'BEW-19': '88–102k €',
  'BEW-15': '110–125k €',
  'BEW-11': '92–105k €',
  'BEW-07': '80–95k €',
  'BEW-04': '62–74k €',
  'BEW-02': '55–65k €',
};

export const AgentStepKind = {
  DONE: 'DONE',
  RUN: 'RUN',
  WAIT: 'WAIT',
} as const;
export type AgentStepKind = (typeof AgentStepKind)[keyof typeof AgentStepKind];
export interface AgentStep {
  kind: AgentStepKind;
  label: string;
  meta: string;
  /* Which profile template the step reads — name and size come from the real
     file on disk when the panel renders. */
  doc?: TemplateKind;
}
export interface AgentRun {
  label: string;
  started: number;
  steps: AgentStep[];
}
const step = (kind: AgentStepKind, label: string, meta = '', doc?: TemplateKind): AgentStep => ({
  kind,
  label,
  meta,
  doc,
});

export const AGENT_RUNS: Record<string, AgentRun> = {
  'BEW-41': {
    label: 'LinkedIn-Stellenanzeige wird ausgelesen…',
    started: 96,
    steps: [
      step(AgentStepKind.RUN, 'LinkedIn-Stellenanzeige wird ausgelesen…'),
      step(AgentStepKind.WAIT, 'Firmendetails ergänzen'),
      step(AgentStepKind.WAIT, 'Kontaktdetails ergänzen'),
      step(AgentStepKind.WAIT, 'Hochgeladenen {doc} einlesen', '', TemplateKind.LEBENSLAUF),
      step(AgentStepKind.WAIT, 'Hochgeladenen {doc} einlesen', '', TemplateKind.ANSCHREIBEN),
      step(AgentStepKind.WAIT, 'Lebenslauf für Nordlicht Systems erstellen'),
      step(AgentStepKind.WAIT, 'Cover Letter für Nordlicht Systems erstellen'),
      step(AgentStepKind.WAIT, 'Daten und Formate prüfen'),
      step(AgentStepKind.WAIT, 'Kommentar an {m} mit Bewerbungslink hinterlassen'),
    ],
  },
  'BEW-38': {
    label: 'Lebenslauf für Aurel Mobility wird erstellt…',
    started: 214,
    steps: [
      step(AgentStepKind.DONE, 'Stellenanzeige auf der Karriereseite ausgelesen', 'vor 9 Min'),
      step(AgentStepKind.DONE, 'Firmendetails ergänzt', 'vor 8 Min'),
      step(AgentStepKind.DONE, 'Kontaktdetails ergänzt', 'vor 7 Min'),
      step(AgentStepKind.DONE, 'Hochgeladenen {doc} eingelesen', 'vor 5 Min', TemplateKind.LEBENSLAUF),
      step(AgentStepKind.DONE, 'Hochgeladenen {doc} eingelesen', 'vor 3 Min', TemplateKind.ANSCHREIBEN),
      step(AgentStepKind.RUN, 'Lebenslauf für Aurel Mobility wird erstellt…'),
      step(AgentStepKind.WAIT, 'Cover Letter für Aurel Mobility erstellen'),
      step(AgentStepKind.WAIT, 'Daten und Formate prüfen'),
      step(AgentStepKind.WAIT, 'Kommentar an {m} mit Bewerbungslink hinterlassen'),
    ],
  },
  'BEW-35': {
    label: 'Kontaktdetails werden ergänzt…',
    started: 47,
    steps: [
      step(AgentStepKind.DONE, 'Stellenanzeige auf LinkedIn ausgelesen', 'vor 3 Min'),
      step(AgentStepKind.DONE, 'Firmendetails ergänzt', 'vor 1 Min'),
      step(AgentStepKind.RUN, 'Kontaktdetails werden ergänzt…'),
      step(AgentStepKind.WAIT, 'Hochgeladenen {doc} einlesen', '', TemplateKind.LEBENSLAUF),
      step(AgentStepKind.WAIT, 'Hochgeladenen {doc} einlesen', '', TemplateKind.ANSCHREIBEN),
      step(AgentStepKind.WAIT, 'Lebenslauf für Helios Energie erstellen'),
      step(AgentStepKind.WAIT, 'Cover Letter für Helios Energie erstellen'),
      step(AgentStepKind.WAIT, 'Daten und Formate prüfen'),
      step(AgentStepKind.WAIT, 'Kommentar an {m} mit Bewerbungslink hinterlassen'),
    ],
  },
};

export interface PersonDef {
  name: string;
  role: string;
  bg: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  initials?: string;
  createdAt?: string;
  updatedAt?: string;
}
export const INITIAL_PEOPLE: Record<string, PersonDef> = {
  MH: {
    name: 'Marek Hübner',
    role: 'Talent Partner',
    bg: 'var(--c-5b9083)',
    email: 'm.huebner@talgruppe.de',
  },
  SK: {
    name: 'Sabine Kotter',
    role: 'Recruiting Lead',
    bg: 'var(--c-4f8f6a)',
    email: 's.kotter@orbishealth.at',
  },
  TB: {
    name: 'Tim Bergk',
    role: 'Design Lead, Fachbereich',
    bg: 'var(--c-a4762f)',
    email: 't.bergk@orbishealth.at',
  },
  NW: { name: 'Nadine Wolf', role: 'Geschäftsführung', bg: 'var(--c-7a5aa8)' },
  JR: { name: 'Jonas Reiter', role: 'Head of People', bg: 'var(--c-5b9083)' },
  IF: { name: 'Ines Faber', role: 'HR', bg: 'var(--c-a8523f)' },
  AL: { name: 'Anja Leitner', role: 'Head of Design', bg: 'var(--c-7a5aa8)' },
  TW: { name: 'Timo Wendt', role: 'Engineering', bg: 'var(--c-3f6ea8)' },
  LB: { name: 'Lea Brinkmann', role: 'Talent Acquisition', bg: 'var(--c-3f6ea8)' },
};

export const INITIAL_PEOPLE_POOL: Record<string, string[]> = {
  'BEW-24': ['MH', 'AL', 'TB', 'TW'],
  'BEW-19': ['SK', 'TB', 'JR', 'NW', 'IF', 'TW'],
  'BEW-15': ['LB', 'TB', 'SK', 'NW', 'JR', 'IF'],
};

export interface Round {
  state: RoundState;
  title: string;
  date: string;
  time: string;
  when: string;
  where: string;
  people: string[];
  link?: string;
  notes?: { author: string; text: string; time: string }[];
  isNew?: boolean;
}
export const INITIAL_ROUNDS: Record<string, Round[]> = {
  'BEW-24': [
    {
      state: RoundState.DONE,
      title: 'Screening',
      date: '04.08.2026',
      time: '',
      when: 'Di, 04.08. · gelaufen',
      where: '',
      people: ['MH'],
    },
    {
      state: RoundState.NEXT,
      title: 'Runde 1',
      date: '12.08.2026',
      time: '10:00 – 11:00',
      when: 'morgen 10:00',
      where: 'In Person',
      people: ['MH'],
    },
    {
      state: RoundState.OPEN,
      title: 'Runde 2',
      date: '',
      time: '',
      when: 'Termin offen',
      where: '',
      people: ['AL', 'TB'],
    },
  ],
  'BEW-19': [
    {
      state: RoundState.DONE,
      title: 'Screening',
      date: '30.07.2026',
      time: '',
      when: 'Do, 30.07. · gelaufen',
      where: '',
      people: ['SK'],
    },
    {
      state: RoundState.DONE,
      title: 'Runde 1',
      date: '05.08.2026',
      time: '',
      when: 'Mi, 05.08. · gelaufen',
      where: '',
      people: ['MH'],
    },
    {
      state: RoundState.NEXT,
      title: 'Runde 2',
      date: '13.08.2026',
      time: '14:30 – 15:30',
      when: 'morgen 14:30',
      where: 'Google Meet',
      people: ['SK', 'TB'],
    },
    {
      state: RoundState.OPEN,
      title: 'Finales Gespräch',
      date: '',
      time: '',
      when: 'Termin offen',
      where: '',
      people: ['JR', 'TB', 'NW', 'IF'],
    },
  ],
  'BEW-15': [
    {
      state: RoundState.DONE,
      title: 'Screening',
      date: '21.07.2026',
      time: '',
      when: 'Di, 21.07. · gelaufen',
      where: '',
      people: ['LB'],
    },
    {
      state: RoundState.DONE,
      title: 'Runde 1',
      date: '28.07.2026',
      time: '',
      when: 'Di, 28.07. · gelaufen',
      where: '',
      people: ['LB'],
    },
    {
      state: RoundState.DONE,
      title: 'Runde 2',
      date: '06.08.2026',
      time: '',
      when: 'Do, 06.08. · gelaufen',
      where: '',
      people: ['TB', 'SK'],
    },
    {
      state: RoundState.NEXT,
      title: 'Finales Gespräch',
      date: '14.08.2026',
      time: '09:00 – 10:30',
      when: 'Fr, 14.08., 09:00',
      where: 'In Person',
      people: ['NW', 'TB', 'JR', 'IF'],
    },
  ],
};

// [role, company, interest, channel, updated, followupState]
export type CardDef = [string, string, Interest, string, string, Urgency | null];
export const CARD_DEFS: Record<string, CardDef> = {
  'BEW-41': [
    'Senior Product Designer',
    'Nordlicht Systems, Hamburg',
    Interest.LOW,
    'LinkedIn',
    'in 5 Tagen fällig',
    Urgency.SOON,
  ],
  'BEW-44': [
    'UX Lead, Plattform',
    'Kessler & Roth, Berlin',
    Interest.NONE,
    'Indeed',
    'in 6 Tagen fällig',
    Urgency.SOON,
  ],
  'BEW-38': [
    'Interaction Designer',
    'Aurel Mobility, München',
    Interest.MEDIUM,
    'Karriereseite',
    'in 4 Tagen fällig',
    Urgency.SOON,
  ],
  'BEW-33': [
    'Design Systems Engineer',
    'Vector Labs, Zürich',
    Interest.HIGH,
    'StepStone',
    '3 Tage überfällig',
    Urgency.DUE,
  ],
  'BEW-35': [
    'Produktdesignerin Web',
    'Helios Energie, Köln',
    Interest.MEDIUM,
    'LinkedIn',
    'in 2 Tagen fällig',
    Urgency.SOON,
  ],
  'BEW-29': [
    'Senior UX Researcher',
    'Brandt Digital, Leipzig',
    Interest.MEDIUM,
    'Recruiter',
    'heute fällig',
    Urgency.DUE,
  ],
  'BEW-24': [
    'Lead Designer, Fintech',
    'Talgruppe AG, Frankfurt',
    Interest.HIGH,
    'Empfehlung',
    'morgen 10:00',
    null,
  ],
  'BEW-19': ['Staff Product Designer', 'Orbis Health, Wien', Interest.URGENT, 'Recruiter', 'Do 14:30', null],
  'BEW-15': ['Head of Design', 'Weferling Group, Stuttgart', Interest.URGENT, 'Empfehlung', 'Fr 09:00', null],
  'BEW-11': [
    'Senior Designer, Wachstum',
    'Marlow Software, Berlin',
    Interest.HIGH,
    'LinkedIn',
    'vor 1 Tag',
    null,
  ],
  'BEW-07': ['Design Manager', 'Ferro Retail, Düsseldorf', Interest.NONE, 'StepStone', 'vor 2 Wochen', null],
  'BEW-04': [
    'Produktdesigner Mobile',
    'Sanna Klinik, Bremen',
    Interest.NONE,
    'Karriereseite',
    'vor 3 Wochen',
    null,
  ],
  'BEW-02': [
    'UI Designer, Marktplatz',
    'Kranich Handel, Essen',
    Interest.NONE,
    'Indeed',
    'vor 1 Monat',
    null,
  ],
};

export const INITIAL_BOARD: string[][] = [
  ['BEW-41', 'BEW-44'],
  ['BEW-38'],
  ['BEW-33', 'BEW-35'],
  ['BEW-29'],
  ['BEW-24'],
  ['BEW-19'],
  ['BEW-15'],
  ['BEW-11'],
  ['BEW-07', 'BEW-04'],
  ['BEW-02'],
];

// [label, value, kind?] — kind decides how the sidebar renders the value
export type Fact = [string, string] | [string, string, FactKind];
export interface DetailDef {
  facts: Fact[];
  summary: string;
  contacts: [string, string, string, string][];
  upcoming: [string, string][];
  comments: [Author, string, string, string][];
}
export const DETAILS: Record<string, DetailDef> = {
  'BEW-33': {
    facts: [
      ['Standort', 'Zürich'],
      ['Gehalt', '120–135k €', FactKind.SELECT],
      ['Erfahrung', '5–8', FactKind.SELECT],
      ['Plattform', 'StepStone', FactKind.SELECT],
      ['Branche', 'Software', FactKind.SELECT],
      ['Mitarbeiterzahl', '201–500', FactKind.SELECT],
      ['Karriereseite', 'vectorlabs.ch/karriere', FactKind.LINK],
      ['Telefon', '+41 44 512 90 30'],
      ['Email', 'jobs@vectorlabs.ch', FactKind.LINK],
      ['Beworben am', '24.07.2026'],
      ['Kontaktperson', 'Nadine Wolf'],
      ['Kontaktperson Email', 'n.wolf@vectorlabs.ch', FactKind.LINK],
      ['Kontaktperson Telefon', '+41 44 512 90 34'],
      ['Kontaktperson LinkedIn', 'linkedin.com/in/nadine-wolf', FactKind.LINK],
    ],
    summary:
      'Aufbau und Pflege des Design-Systems für Web und Mobile, enge Zusammenarbeit mit Frontend. Bewerbung über StepStone eingereicht, seit 12 Tagen keine Rückmeldung.',
    contacts: [['Nadine Wolf', 'Recruiterin', 'n.wolf@vectorlabs.ch', 'var(--c-7a5aa8)']],
    upcoming: [['in 13 Tagen', 'Letztes Follow up']],
    comments: [
      [
        Author.KEPLER,
        'vor 3 Tagen',
        'Alle Schritte erledigt: Stellenanzeige ausgelesen, Firmen- und Kontaktdetails ergänzt, Lebenslauf und Cover Letter für Vector Labs erstellt und geprüft. Hier bewerben: vectorlabs.ch/careers/design-systems-engineer',
        'var(--c-1b1a17)',
      ],
      [
        Author.KEPLER,
        'vor 3 Tagen',
        'Anschreiben auf die drei Kernanforderungen der Anzeige zugeschnitten: Token-Architektur, Komponentendoku, Migration von Legacy-UI.',
        'var(--c-1b1a17)',
      ],
      [
        Author.DU,
        'vor 3 Tagen',
        'Portfolio-Link auf das Case zum Design-System gesetzt, Rest ausgeblendet.',
        'var(--c-5b7a5e)',
      ],
    ],
  },
  'BEW-35': {
    facts: [
      ['Standort', 'Köln'],
      ['Gehalt', '65–78k €', FactKind.SELECT],
      ['Erfahrung', '2–5', FactKind.SELECT],
      ['Plattform', 'LinkedIn', FactKind.SELECT],
      ['Branche', 'Energie', FactKind.SELECT],
      ['Mitarbeiterzahl', '1.001–5.000', FactKind.SELECT],
      ['Karriereseite', 'helios-energie.de/jobs', FactKind.LINK],
      ['Telefon', '+49 221 88 04 200'],
      ['Email', 'karriere@helios-energie.de', FactKind.LINK],
      ['Beworben am', '01.08.2026'],
      ['Kontaktperson', 'Lea Brinkmann'],
      ['Kontaktperson Email', 'l.brinkmann@helios.de', FactKind.LINK],
      ['Kontaktperson Telefon', '+49 221 88 04 217'],
      ['Kontaktperson LinkedIn', 'linkedin.com/in/lea-brinkmann', FactKind.LINK],
    ],
    summary:
      'Produktdesign für das Kundenportal im Bereich erneuerbare Energien. Kontakt kam über LinkedIn, Bewerbung vor 5 Tagen eingereicht.',
    contacts: [['Lea Brinkmann', 'Talent Acquisition', 'l.brinkmann@helios.de', 'var(--c-3f6ea8)']],
    upcoming: [
      ['in 9 Tagen', 'Erneutes Follow up'],
      ['in 25 Tagen', 'Letztes Follow up'],
    ],
    comments: [
      [
        Author.KEPLER,
        'vor 5 Tagen',
        'Stellenanzeige verlangt Erfahrung mit Energiedaten-Visualisierung — im Anschreiben über das Dashboard-Projekt abgedeckt.',
        'var(--c-1b1a17)',
      ],
    ],
  },
  'BEW-29': {
    facts: [
      ['Standort', 'Leipzig'],
      ['Gehalt', '58–70k €', FactKind.SELECT],
      ['Erfahrung', '2–5', FactKind.SELECT],
      ['Plattform', 'Recruiter', FactKind.SELECT],
      ['Branche', 'Dienstleister', FactKind.SELECT],
      ['Mitarbeiterzahl', '51–200', FactKind.SELECT],
      ['Karriereseite', 'brandt-digital.de/karriere', FactKind.LINK],
      ['Telefon', '+49 341 55 20 100'],
      ['Email', 'bewerbung@brandt-digital.de', FactKind.LINK],
      ['Beworben am', '21.07.2026'],
      ['Kontaktperson', 'Ines Faber'],
      ['Kontaktperson Email', 'i.faber@brandt-digital.de', FactKind.LINK],
      ['Kontaktperson Telefon', '+49 341 55 20 118'],
      ['Kontaktperson LinkedIn', 'linkedin.com/in/ines-faber', FactKind.LINK],
    ],
    summary:
      'Research-Rolle mit Schwerpunkt qualitative Studien. HR hat den Eingang bestätigt und eine Rückmeldung bis Ende der Woche angekündigt.',
    contacts: [['Ines Faber', 'HR Business Partner', '+49 341 55 20 118', 'var(--c-a8523f)']],
    upcoming: [['in 16 Tagen', 'Letztes Follow up']],
    comments: [
      [
        Author.KEPLER,
        'vor 6 Tagen',
        'Eingangsbestätigung erhalten. Nachfassen für heute vorgemerkt.',
        'var(--c-1b1a17)',
      ],
    ],
  },
};

export const HISTORY: Record<string, [Author, string, string][]> = {
  'BEW-33': [
    [Author.KEPLER, 'hat die Karte aus der StepStone-Anzeige angelegt', '24.07.'],
    [Author.KEPLER, 'hat Cover Letter und Lebenslauf erstellt', '26.07.'],
    [Author.DU, 'hat die Bewerbung eingereicht', '26.07.'],
  ],
  'BEW-35': [
    [Author.KEPLER, 'hat die Karte aus der LinkedIn-Anzeige angelegt', '30.07.'],
    [Author.DU, 'hat die Bewerbung eingereicht', '01.08.'],
  ],
  'BEW-29': [
    [Author.KEPLER, 'hat die Karte angelegt', '18.07.'],
    [Author.DU, 'hat die Bewerbung eingereicht', '21.07.'],
    [Author.KEPLER, 'hat die Eingangsbestätigung erfasst', '01.08.'],
  ],
  'BEW-24': [
    [Author.KEPLER, 'hat die Karte angelegt', '22.07.'],
    [Author.DU, 'hat Marek Hübner zu „Runde 1“ hinzugefügt', '04.08.'],
    [Author.DU, 'hat „Runde 1“ auf den 12.08. terminiert', '05.08.'],
  ],
  'BEW-19': [
    [Author.KEPLER, 'hat die Karte angelegt', '15.07.'],
    [Author.DU, 'hat „Runde 1“ abgeschlossen', '05.08.'],
    [Author.DU, 'hat „Runde 2“ auf den 13.08. terminiert', '06.08.'],
  ],
  'BEW-15': [
    [Author.KEPLER, 'hat die Karte angelegt', '10.07.'],
    [Author.DU, 'hat „Runde 2“ abgeschlossen', '06.08.'],
    [Author.DU, 'hat das finale Gespräch auf den 14.08. terminiert', '06.08.'],
  ],
};

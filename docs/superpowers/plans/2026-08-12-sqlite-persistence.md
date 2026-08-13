# SQLite Persistence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory sample-data state with a SQLite database in the Electron main process, per `docs/superpowers/specs/2026-08-12-sqlite-persistence-design.md`.

**Architecture:** `node:sqlite` (`DatabaseSync`, built into Electron 43 / Node 24 — no native deps) opened in the main process at `userData/bewerbungen.db`; numbered migrations via `PRAGMA user_version`; one-time seed from `sample-data.ts`; synchronous repo functions exposed as typed IPC channels on `window.desktop.db`; the renderer loads one snapshot at boot and mutates through IPC. Presentation strings (German dates, `when` captions, card subtitles) are derived at render, never stored.

**Tech Stack:** Electron 43, `node:sqlite`, React 19, TypeScript, vitest (new dev dep — first tests in the repo).

## Global Constraints

- Timestamps (`*_at` instants): ISO-8601 UTC via `new Date().toISOString()`. Round appointments: local wall-clock `scheduled_date 'YYYY-MM-DD'` + `start_time`/`end_time 'HH:MM'`.
- `facts.value` is renderer-owned display text (German dates stay German).
- Authors are `'Du' | 'Kepler'`. UI copy is German; code identifiers English.
- Every application always has ≥ 4 rounds and the last round is `'Finales Gespräch'`.
- Fact-label routing (see spec): `Berufsbezeichnung`→role, `Plattform`→channel, `Beworben via`→applied_via, `Beworben am`→applied_at, `Letzter Kontakt`→last_contact_at, `Firma`→company re-link, `Branche`→companies.sector, `Mitarbeiterzahl`→companies.headcount, `Karriereseite`→companies.website, `E-Mail`→companies.email, `Telefon`→companies.phone, `Kontaktperson *`→person rows. Facts rows only for: Standort, Gehalt, Erfahrung, ad-hoc labels.
- No new production dependencies. Dev deps: vitest only.
- Run after every task: `npx tsc -b --noEmit 2>&1 | head`, `npm run lint`, `npx vitest run`.

---

### Task 1: Tooling — vitest

**Files:**

- Modify: `package.json` (add `"test": "vitest run"`, devDep `vitest`)

**Steps:**

- [ ] `npm i -D vitest`
- [ ] Add `"test": "vitest run"` to scripts
- [ ] Smoke test `electron/db/__tests__/smoke.test.ts` asserting `new DatabaseSync(':memory:')` works (deleted in Task 3 when real tests exist)
- [ ] `npx vitest run` → PASS; commit

### Task 2: Shared row types

**Files:**

- Create: `src/shared/db-types.ts`

**Produces (consumed by every later task):**

```ts
export type Author = 'Du' | 'Kepler';
export interface StageRow {
  id: string;
  title: string;
  position: number;
}
export interface CompanyRow {
  id: number;
  name: string;
  sector: string | null;
  headcount: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface ApplicationRow {
  id: string;
  role: string;
  company_id: number;
  interest: string;
  channel: string | null;
  stage_id: string;
  stage_position: number;
  summary: string | null;
  applied_at: string | null;
  applied_via: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface FactRow {
  id: number;
  application_id: string;
  label: string;
  value: string;
  kind: 'select' | 'link' | null;
  position: number;
}
export interface PersonRow {
  id: number;
  name: string;
  role: string | null;
  initials: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}
export type LinkKind = 'contact' | 'pool' | 'email';
export interface ApplicationPersonRow {
  application_id: string;
  person_id: number;
  kind: LinkKind;
  position: number;
}
export interface CommentRow {
  id: number;
  application_id: string;
  author: Author;
  text: string;
  created_at: string;
  edited_at: string | null;
}
export type RoundState = 'done' | 'next' | 'open';
export interface RoundRow {
  id: number;
  application_id: string;
  position: number;
  state: RoundState;
  title: string;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  link: string | null;
}
export interface RoundPersonRow {
  round_id: number;
  person_id: number;
  position: number;
}
export interface RoundNoteRow {
  id: number;
  round_id: number;
  author: Author;
  text: string;
  created_at: string;
}
export interface FollowupRow {
  id: number;
  application_id: string;
  label: string;
  due_at: string;
  position: number;
  email_subject: string | null;
  email_text: string | null;
  generated_at: string | null;
}
export interface DocumentRow {
  id: number;
  application_id: string;
  kind: 'cover-letter' | 'lebenslauf' | 'other';
  title: string;
  format: string;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}
export interface ActivityRow {
  id: number;
  application_id: string;
  author: Author;
  text: string;
  created_at: string;
}
export interface DbSnapshot {
  stages: StageRow[];
  companies: CompanyRow[];
  applications: ApplicationRow[];
  facts: FactRow[];
  people: PersonRow[];
  applicationPeople: ApplicationPersonRow[];
  comments: CommentRow[];
  rounds: RoundRow[];
  roundPeople: RoundPersonRow[];
  roundNotes: RoundNoteRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  activities: ActivityRow[];
}
```

- [ ] Write file; `tsc` clean; commit

### Task 3: Schema + migrations (`electron/db/`)

**Files:**

- Create: `electron/db/schema.ts` (exports `MIGRATIONS: string[]` — index 0 is migration 1: all `CREATE TABLE`/`CREATE INDEX` statements exactly as in the spec's Schema section, plus `meta`)
- Create: `electron/db/migrate.ts`
- Create: `electron/db/open.ts`
- Test: `electron/db/__tests__/migrate.test.ts`

**Interfaces produced:**

- `migrate(db: DatabaseSync): void` — applies `MIGRATIONS[user_version..]` each in a transaction, bumping `PRAGMA user_version`
- `openDb(filePath: string): DatabaseSync` — opens, sets `journal_mode=WAL` (skip for `:memory:`), `foreign_keys=ON`, runs `migrate`

**Stage ids (fixed order, index = today's COLUMNS index):** `interessiert, in-bearbeitung, eingereicht, screening, interview, interview-2, finale, gehaltsverhandlung, korb, zurueckgezogen` — inserted by migration 1 itself (stages are schema-level constants).

**Tests:**

- [ ] fresh `:memory:` db → `migrate` → all 14 tables exist (query `sqlite_master`), `user_version === 1`, 10 stage rows in order
- [ ] `migrate` twice → idempotent (no throw, still `user_version 1`)
- [ ] `foreign_keys` pragma is ON via `openDb` (insert violating row → throws)
- [ ] Commit

### Task 4: Seed parsers

**Files:**

- Create: `electron/db/seed-parse.ts`
- Test: `electron/db/__tests__/seed-parse.test.ts`

**Interfaces produced (all pure; `now: Date` injected — never call `new Date()` inside):**

```ts
germanDateToISO('24.07.2026') === '2026-07-24'; // '' if unparseable
dayMonthToISO('24.07.', 2026) === '2026-07-24'; // HISTORY's yearless dates
relativeToISO('vor 12 Tagen', now); // ISO datetime now minus 12d; handles Tag/Tagen/Woche(n)/Monat(en), 'gerade eben', 'heute', 'gestern'; '' otherwise
splitTimeRange('10:00 – 11:00') === ['10:00', '11:00']; // '' time → [null, null]; single time → ['10:00', null]
splitCompany('Vector Labs, Zürich') === { name: 'Vector Labs', city: 'Zürich' }; // no comma → city null; split on LAST ', '
looksLikePhone('+49 341 55 20 118') === true; // ^[+0-9][0-9 /()-]{5,}$
```

- [ ] Failing tests first with the real sample values above (incl. `'Kessler & Roth, Berlin'`, `'in 5 Tagen fällig'` → `''` for relativeToISO)
- [ ] Implement; PASS; commit

### Task 5: Seed transform

**Files:**

- Create: `electron/db/seed.ts`
- Test: `electron/db/__tests__/seed.test.ts`

**Interface produced:** `seedIfEmpty(db: DatabaseSync, now?: Date): boolean` (true = seeded; no-op when `applications` has rows). One transaction. Imports `CARD_DEFS, INITIAL_BOARD, DETAILS, HISTORY, INITIAL_ROUNDS, INITIAL_PEOPLE, INITIAL_PEOPLE_POOL, SALARY` from `../../src/data/sample-data`.

**Rules (spec steps 1–11, concretized):**

- Companies: `splitCompany(card[1])`; one row per distinct name; timestamps = now.
- Applications: id from CARD_DEFS key; `stage_id`/`stage_position` from INITIAL_BOARD; `interest = card[2]`, `channel = card[3]`; `updated_at` from `relativeToISO(card[4])` when it parses, else `created_at`; `created_at` from the card's earliest HISTORY date (else now − 21d); `applied_at`/`last_contact_at` from DETAILS facts (`germanDateToISO` / `relativeToISO`); `applied_via` NULL; summary from DETAILS else NULL.
- Facts: DETAILS facts minus routed labels (routing table in Global Constraints, plus `Kontaktperson`, `Kontaktperson E-Mail/Telefon/LinkedIn`, `Standort` handling below); `kind`: `'s'`→`'select'`, `'l'`→`'link'`. Standort: from DETAILS fact if present, else `splitCompany().city`. Gehalt: from DETAILS fact if present else `SALARY[id]`. Position = insertion order.
- People pass 1: INITIAL_PEOPLE → rows (key order; color = seeded `bg`; initials kept). Pass 2: DETAILS.contacts merge on exact `name+role` match else new row (color = `PERSON_COLORS[rowCount % 6]`); tuple slot 2 → `phone` if `looksLikePhone` else `email`; fold `Kontaktperson *` fact values into that person's empty fields. `INITIAL_PEOPLE_POOL` → `kind='pool'` links; DETAILS.contacts → `kind='contact'` links (order = tuple order). No `'email'` links seeded (fallback = contacts, matching today).
- Comments: DETAILS.comments with `relativeToISO` created_at; cards without DETAILS get the default Kepler comment `'Karte aus der Stellenanzeige angelegt. Anschreiben und Lebenslauf liegen im Reiter Bewerbungsunterlagen.'` back-dated 2 days.
- Rounds: INITIAL_ROUNDS (append `Finales Gespräch` if missing) else the 4 canonical rounds; `germanDateToISO(date)`, `splitTimeRange(time)`; `round_people` in array order.
- Followups: slot 0 `'Follow up zur Bewerbung'` + DETAILS.upcoming (else the 2 defaults `['in 9 Tagen','Erneutes Follow up'], ['in 25 Tagen','Letztes Follow up']`); `due_at` = anchor logic frozen: base = days until Sep 1 of `now`'s year (0 if past), slot offset parsed from `'in N Tagen'`; email columns NULL.
- Documents: 2 rows/card — `('cover-letter','Cover Letter','docx', created 2026-07-26)`, `('lebenslauf','Lebenslauf','docx', updated 2026-07-24)`, `file_path` NULL.
- Activities: HISTORY via `dayMonthToISO(date, 2026)`.
- Meta: `next_bew_num = 45`.

**Tests (the audit's traps):**

- [ ] runs once, second call returns false
- [ ] two Nadine Wolfs = 2 person rows (pool 'Geschäftsführung' vs BEW-33 contact 'Recruiterin'); exactly one Lea Brinkmann row (pool role 'Talent Acquisition' equals BEW-35 contact role → merge, email folded in)
- [ ] BEW-29 Ines Faber: 2 rows (pool 'HR' vs contact 'HR Business Partner'); the contact row has the number in `phone` and `email` NULL
- [ ] BEW-33: `applied_at='2026-07-24'`, `last_contact_at` = now−12d; no `Beworben am`/`Kontaktperson*`/`Firma`/`Branche` fact rows; Kontaktperson data folded into Nadine-the-Recruiterin's row; `Karriereseite/E-Mail/Telefon` landed on the company row
- [ ] every application: ≥4 rounds, last title `'Finales Gespräch'`, a slot-0 followup, ≥1 comment, 2 documents, a `Gehalt` fact (13 SALARY entries), a `Standort` fact
- [ ] BEW-24 Runde 1: `scheduled_date='2026-08-12'`, `start_time='10:00'`, `end_time='11:00'`
- [ ] activities: BEW-33 has 3 rows, first `created_at='2026-07-24T…'` (yearless parse)
- [ ] Commit

### Task 6: Repo

**Files:**

- Create: `electron/db/repo.ts`
- Test: `electron/db/__tests__/repo.test.ts`

**Interface produced — `createRepo(db: DatabaseSync)` returning (all synchronous):**

```ts
load(): DbSnapshot
createApplication(input: { role: string; company: string; channel: string | null }): { application: ApplicationRow; company: CompanyRow; rounds: RoundRow[]; followups: FollowupRow[]; documents: DocumentRow[] }
  // id = 'BEW-' + meta.next_bew_num++; stage interessiert position 0 (existing rows shift +1);
  // inserts 4 canonical rounds, slot-0..2 followups (anchor logic), 2 documents, find-or-create company
updateApplication(id, patch: Partial<Pick<ApplicationRow,'role'|'interest'|'channel'|'summary'|'applied_at'|'applied_via'|'last_contact_at'|'stage_id'>>): ApplicationRow   // bumps updated_at
moveCard(id, toStageId: string, toIndex: number): ApplicationRow[]   // reindexes both columns, returns changed rows
deleteApplication(id): void
relinkCompany(id, name: string): { application: ApplicationRow; company: CompanyRow }   // find-or-create by name
updateCompany(companyId, patch: Partial<Pick<CompanyRow,'name'|'sector'|'headcount'|'website'|'email'|'phone'|'notes'>>): CompanyRow
upsertFact(applicationId, label, value, kind): FactRow          // plain labels only; conflict target (application_id,label)
deleteFact(applicationId, label): void
addComment(applicationId, author, text): CommentRow
updateComment(commentId, text): CommentRow                       // sets edited_at
deleteComment(commentId): void
setRounds(applicationId, rounds: Array<Omit<RoundRow,'id'|'application_id'|'position'> & { id?: number; people: number[] }>): { rounds: RoundRow[]; roundPeople: RoundPersonRow[] }
  // full-list replace: simplest correct mapping of today's mutateRounds; preserves note rows by round id when id given
addRoundNote(roundId, author, text): RoundNoteRow
createPerson(input: { name; role?; email?; phone?; linkedin? }): PersonRow   // color = PERSON_COLORS[count % 6], initials derived
updatePerson(personId, patch): PersonRow
deletePerson(personId): void                                      // FK cascades clean the links
setApplicationPeople(applicationId, kind: LinkKind, personIds: number[]): ApplicationPersonRow[]  // kind-scoped replace, position = array order
setFollowupDue(followupId, dueAt: string): FollowupRow
saveFollowupEmail(followupId, subject: string, text: string): FollowupRow    // sets generated_at
addActivity(applicationId, author, text): ActivityRow
```

**Tests:**

- [ ] seeded `:memory:` db; `createApplication` → id `BEW-45`, 4 rounds, followups, documents; `next_bew_num` now 46; delete it → recreate → `BEW-46` (no reuse)
- [ ] cascade: `deleteApplication('BEW-33')` removes its facts/comments/rounds/round_notes/followups/documents/activities/links but not people/companies
- [ ] `moveCard` reindexes: move BEW-41 to `eingereicht` index 1 → positions contiguous in both stages
- [ ] `relinkCompany('BEW-24','Talgruppe SE')` creates a company, leaves the old row untouched
- [ ] `upsertFact` updates in place on second call (same row id)
- [ ] comment update sets `edited_at`; `saveFollowupEmail` persists and sets `generated_at`
- [ ] `setRounds` replace keeps note rows when ids are passed through
- [ ] Commit

### Task 7: IPC + preload + main wiring

**Files:**

- Create: `electron/db/ipc.ts` — `registerDbIpc(repoFactory)`: one `ipcMain.handle('db:<name>', …)` per repo function above, name-mapped 1:1 (`db:load`, `db:applications.create`, `db:applications.update`, `db:applications.move`, `db:applications.delete`, `db:applications.relinkCompany`, `db:companies.update`, `db:facts.upsert`, `db:facts.delete`, `db:comments.add|update|delete`, `db:rounds.set`, `db:roundNotes.add`, `db:people.create|update|delete`, `db:applicationPeople.set`, `db:followups.setDue`, `db:followups.saveEmail`, `db:activities.add`)
- Modify: `electron/main.ts` — on `app.whenReady`: `openDb(path.join(app.getPath('userData'),'bewerbungen.db'))` + `seedIfEmpty` in try/catch → `dialog.showErrorBox` + `app.quit()` on failure; `registerDbIpc`
- Modify: `electron/preload.ts` — add `db` object: one `(…args) => ipcRenderer.invoke(channel, …args)` per channel, typed as `DbApi`
- Modify: `src/desktop.d.ts` — extend `window.desktop` with `db: DbApi` (async variants of repo signatures, importing types from `src/shared/db-types`)

- [ ] Implement; `tsc` + lint clean; `npm run dev` boots, DB file appears under `~/Library/Application Support/Bewerbungen/`; commit

### Task 8: Renderer boot — snapshot load + domain state

**Files:**

- Modify: `src/state/store-context.ts` — add domain fields to `AppState`: `loaded: boolean`, `stages: StageRow[]`, `applications: Record<string, ApplicationRow>`, `companies: Record<number, CompanyRow>`, `factsByApp: Record<string, FactRow[]>`, `people: Record<string, PersonRow>` (keyed by `String(id)`), `linksByApp: Record<string, ApplicationPersonRow[]>`, `commentsByApp`, `roundsByApp: Record<string, RoundRow[]>`, `roundPeopleByRound: Record<number, RoundPersonRow[]>`, `roundNotesByRound`, `followupsByApp`, `documentsByApp`, `activitiesByApp`, `board: string[][]` (derived, kept in state for drag)
- Modify: `src/state/store.tsx` — `useEffect` on mount: `window.desktop.db.load()` → index arrays into the records above; render `null` (splash) until `loaded`
- Create: `src/state/db-index.ts` — pure `indexSnapshot(s: DbSnapshot): DomainState` + `boardFrom(applications, stages)` (sort by `stage_position`), unit-testable

- [ ] `indexSnapshot` test with a tiny fixture snapshot
- [ ] App boots showing the seeded board (visual parity with sample data); commit

### Task 9: Applications on the board

**Files:**

- Modify: `src/state/store.tsx` — `moveCard`/`createCard`/`deleteCard` now: optimistic local board update as today, then `await db.applications.move|create|delete`, reconciling from returned rows; `logAct` → `db.activities.add`
- Modify: `src/features/board/ApplicationCard.tsx` — drop `CARD_DEFS/SALARY/INTERVIEWS` imports; new selectors from `src/state/selectors.ts`
- Create: `src/state/selectors.ts`:

```ts
cardView(st, id): { role; companyLine /* name + ', ' + Standort fact when present */; interest; channel; salary /* Gehalt fact */; subtitle: { text; tone: 'due'|'info'|'muted' }; interviewChip: { month; day; time; meta } | null }
// subtitle precedence: next round with scheduled_date >= today → 'morgen 10:00' style via relLabel/shortDate
//   else next followup → 'in N Tagen fällig' / 'N Tage überfällig' / 'heute fällig'
//   else 'vor N Tagen' from updated_at
// interviewChip from next scheduled round: month = MON_DE3 upper, meta = roundStage(pos,total).name + ' · ' + location
```

- Modify: `src/features/create/*` (create modal) + `src/features/search/*` + `src/features/shell/*` breadcrumbs to read `cardView`/`applications` instead of `cardDefFor`
- Delete from state: `extraCards`, `priority`, `nextNumRef` usage

- [ ] Board renders identically (spot-check BEW-24 chip, BEW-33 overdue, BEW-41 salary); create/move/delete survive an app restart; commit

### Task 10: Detail sidebar — facts, routing, Beworben via

**Files:**

- Modify: `src/features/detail/properties/PropertiesSidebar.tsx`, `src/features/detail/properties/FactField.tsx`
- Modify: `src/data/sample-data.ts` SECTIONS (moves in Task 15): Bewerbung section = `['Plattform', 'Beworben via', 'Beworben am', 'Letzter Kontakt']` ← **adds the Beworben-via row**; add `FACT_OPTIONS['Beworben via'] = ['Karriereseite', 'E-Mail', 'LinkedIn', 'Xing', 'StepStone', 'Recruiter']`
- Create: `src/state/fact-routing.ts` — `readField(st, id, label): string` and `writeField(store, id, label, value): Promise<void>` implementing the routing table (application columns ↔ German date conversion via `isoToDate`/`dateToISO`; company columns via `db.companies.update`; `Firma` via `db.applications.relinkCompany`; everything else `db.facts.upsert`)

- [ ] Sidebar shows all catalog fields incl. new row; editing Firma on BEW-24 doesn't rename other cards' company; Beworben am round-trips German↔ISO; restart-safe; commit

### Task 11: Comments

**Files:**

- Modify: `src/features/detail/CommentsSection.tsx` — render `commentsByApp[id]` (`CommentRow`), relative time from `created_at` via `dayDiff`/`relLabel`, avatar color by author as today; edit/delete gated on `author === 'Du'` and keyed by `comment.id`
- Modify: `src/state/store.tsx` — `addComment` → `db.comments.add`; edit/save → `db.comments.update`; delete → `db.comments.delete`; delete `addedComments/commentEdits/commentDeletes` state

- [ ] Add/edit/delete a comment; restart; still correct; commit

### Task 12: Rounds + notes

**Files:**

- Modify: `src/state/store.tsx` — `roundsFor(id)` returns the **view mapping** of `roundsByApp` rows to the existing `Round` shape components expect: `date = isoToDate(scheduled_date)`, `time = start–end join`, `when` derived (`'Termin offen'` / `shortDate + ', HH:MM'` / `'gelaufen'` styles as today via `syncRoundSchedule` logic moved into the selector), `people = round_people person ids as strings`, `notes` from `roundNotesByRound`. `mutateRounds`/`saveRound`/`resetRound` translate back and call `db.rounds.set`; note add → `db.roundNotes.add`
- Modify: `src/features/interviews/*` only where the `Round` view shape changed (people keys are now person-id strings)

- [ ] Schedule/edit/reset/add rounds + add note; restart-safe; `roundStage` final-round invariant holds; commit

### Task 13: People + contacts

**Files:**

- Modify: `src/state/store.tsx` — `person(key)` reads `people[key]` (id-keyed, `color` → `bg`); `peopleForCard` = pool links else all people; `contactsFor`/`emailContactsFor` from `linksByApp` (email kind falls back to contact list when no email links exist — preserves today's fallback); `savePerson`/`deletePerson`/`createPersonForRound`/`setContacts`/`setEmailContacts` → `db.people.*` + `db.applicationPeople.set`
- Modify: `src/features/people/*`, `src/features/detail/properties/*` (contact picker) for id-keyed people
- Delete state: `contactOverrides`, `emailContactOverrides`, `peoplePool` (links live in `linksByApp`)

- [ ] Create/edit/delete person; attach as contact and email recipient; restart-safe; the two Nadine Wolfs stay distinct; commit

### Task 14: Follow-ups + stored email drafts

**Files:**

- Modify: `src/features/followup/schedule.ts` — `followUpSlots` reads `followupsByApp[id]` rows (`iso = due_at`), keeps diff/meta/dot derivation; drop the anchor recomputation and `dueOverrides`
- Modify: `src/features/followup/FollowUpEmailCard.tsx` + `src/state/store.tsx` — on first open of a slot without `email_text`: generate via existing `draftEmail`, then `db.followups.saveEmail`; render from row afterwards; regenerate button re-runs generator + `saveEmail`; due-date picker → `db.followups.setDue`
- Delete state: `dueOverrides`

- [ ] Draft persists across restart (generated once); due-date override sticks; overdue styling matches `due_at`; commit

### Task 15: Activities, summary, documents + config split

**Files:**

- Modify: `src/features/detail/HistorySection.tsx` → `activitiesByApp`, date rendered `DD.MM.` from `created_at`
- Modify: `src/features/detail/SummaryField.tsx` → `application.summary` with generated fallback; save → `db.applications.update`
- Modify: `src/features/detail/DocumentsSection.tsx` → `documentsByApp[id]`; caption `format.toUpperCase() + ' · erstellt/aktualisiert am ' + isoToDate(...)`; click keeps stub `download()` while `file_path` is null
- Create: `src/data/config.ts` — move `INTEREST, INTEREST_ORDER, CHANNEL_BG, ROUND_STATE, PERSON_COLORS, WHERE_OPTIONS, FACT_OPTIONS, COLUMNS, roundStage, SECTIONS, SHORT_LABELS, DATE_FIELDS, SKILLS` here; `sample-data.ts` keeps only seed-input data + `AGENT_RUNS` and re-exports nothing the renderer uses except `AGENT_RUNS`
- Modify: all renderer imports accordingly; verify with `grep -rn "from '.*sample-data'" src/` → only `AgentRunPanel`/`ApplicationCard` (AGENT_RUNS) and seed remain
- Delete state fields now unused: `factOverrides`, `summaryOverrides`, `history`, `roundsState` + `syncRoundSchedule` + `seedRounds` in store.tsx

- [ ] `tsc` + lint + all tests green; full manual pass (board, detail, follow-up, interviews, people, create, delete, search, theme); commit

### Task 16: Verification + reviews

- [ ] `npx tsc -b --noEmit && npm run lint && npx vitest run`
- [ ] `npm run dev` — walk every screen against the four screenshots; delete `~/Library/Application Support/Bewerbungen/bewerbungen.db` once to verify re-seed
- [ ] Dispatch review agents per user instruction: `pr-review-toolkit:code-reviewer` ×2 and `code-simplifier:code-simplifier` ×2 (subagents, scoped to the diff since commit `71b6ea2`)
- [ ] Fix accepted findings, re-run verification, commit

# SQLite Persistence Layer — Design

**Date:** 2026-08-12
**Status:** Draft for review (revision 3 — revision 2 reworked the schema after an
adversarial audit against the actual data model; revision 3 folds in Timo's review:
companies as a first-class table, agent tables deferred, naming cleanups)

## Goal

Give the app durable local storage. Today all application data lives in one in-memory
React state object seeded from `src/data/sample-data.ts`; every edit is lost on reload.
The only persisted values are the theme and collapsed-section map in `localStorage`.

Requirements settled during brainstorming:

- **Durability only.** Single user, single Mac. No sync, no cloud, no auth.
- **A real database structure** — normalized tables with stable ids, not a JSON snapshot.
- **First run seeds the current German sample data**, so the app looks exactly like today.
- Keeps the door open for Supabase/Postgres later: the normalized schema translates
  nearly 1:1 if multi-device sync is ever needed.

Explicitly out of scope: multi-user support, cloud backup, i18n, and Agent SDK
integration — including agent-run tables. The agent panel is a hardcoded stub today
(static data + fake timer); it keeps rendering from the `AGENT_RUNS` sample stub, and
its tables get designed with the real SDK work, when we know what a run looks like.

## Architecture Overview

- **Engine:** `node:sqlite` (`DatabaseSync`) in the Electron main process —
  built into Electron 43's embedded Node 24, so no native module, no
  electron-rebuild, and vitest exercises the identical module under plain Node.
  Synchronous, no network, no second process. The renderer never touches SQL.
  (Amended from `better-sqlite3` at implementation time; same synchronous API.)
- **File:** `app.getPath('userData')/bewerbungen.db`, WAL mode, foreign keys on.
- **Boundary:** typed IPC channels on `window.desktop.db` via `electron/preload.ts` —
  the same seam already reserved for Agent SDK calls.
- **Renderer:** `store.tsx` keeps its React-context shape but splits domain state
  (loaded from the DB) from transient UI state (unchanged). All parallel
  `*Overrides` maps are deleted; tables become the single source of truth.

## Schema

Conventions:

- **Instants** (created_at, updated_at, edited_at, started_at) are ISO-8601 UTC
  strings. Relative German display text (`vor 3 Tagen`) is rendered at display time.
- **Appointments** (interview rounds) are **local wall-clock**, stored as a date
  plus optional start/end times — a UTC instant would shift the displayed hour
  across DST changes, and interview times are ranges in both the data and the
  editor (`TimeRangePicker` picks start _and_ end).
- **`facts.value` is renderer-owned display text**, exempt from the ISO rule
  (`FactField`'s date picker writes German `DD.MM.YYYY` strings today). Date-like
  labels with semantics (`Beworben am`, `Letzter Kontakt`) are NOT facts — they
  route to real `YYYY-MM-DD` columns (see routing rule below). Normalizing the
  remaining fact values is a possible later cleanup, not part of this change.
- All child tables use `ON DELETE CASCADE`, so deleting an application removes its
  facts, comments, rounds, follow-ups, documents, and activities in one statement (matching
  today's `deleteCard`). People and company rows are **not** garbage-collected when
  their last application is deleted — those directories outlive cards, matching
  current behavior.
- Presentation values (stage tint/accent colors, comment background colors) stay in
  theme code keyed by id. **Exception:** person avatar colors are persisted (see
  `people.color`) because today's assignment depends on insertion order and cannot
  be re-derived from an id.

```sql
CREATE TABLE meta (                    -- single-row key/value: schema bookkeeping
  key    TEXT PRIMARY KEY,             -- 'next_bew_num'
  value  TEXT NOT NULL
);

CREATE TABLE stages (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  position  INTEGER NOT NULL UNIQUE
);
-- The 10 real stages (today they are keyed only by array index; these slugs become
-- the stable ids, and theme code maps id → tint/accent/kind/frac):
--   interessiert, in-bearbeitung, eingereicht, screening, interview,
--   interview-2, finale, gehaltsverhandlung, korb, zurueckgezogen

CREATE TABLE companies (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  sector          TEXT,                -- 'Branche' in the sidebar
  headcount       TEXT,                -- 'Mitarbeiterzahl'; free-form ('50-200')
  website         TEXT,                -- 'Karriereseite'
  email           TEXT,                -- UNTERNEHMEN section E-Mail
  phone           TEXT,                -- UNTERNEHMEN section Telefon
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- Two applications at the same company share one row. Like people, company rows
-- are not garbage-collected when their last application is deleted.

CREATE TABLE applications (
  id              TEXT PRIMARY KEY,    -- 'BEW-41'
  role            TEXT NOT NULL,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  interest        TEXT NOT NULL DEFAULT 'none',
  channel         TEXT,
  stage_id        TEXT NOT NULL REFERENCES stages(id),
  stage_position  INTEGER NOT NULL,    -- order within the column, reindexed on drag
  summary         TEXT,                -- the editable description paragraph under the
                                       -- title in the detail view (not comments/notes);
                                       -- NULL → renderer falls back to generated text
  applied_at      TEXT,                -- 'YYYY-MM-DD'; 'Beworben am' in the sidebar
  applied_via     TEXT,                -- 'Beworben via': HOW the application was
                                       -- submitted (Karriereseite, E-Mail, LinkedIn…)
                                       -- distinct from channel = where it was FOUND
  last_contact_at TEXT,                -- 'YYYY-MM-DD'; 'Letzter Kontakt'
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- applied_at / last_contact_at are real DATE columns, not facts: they are dates
-- with semantics (sorting, follow-up timing) and obvious future queries, unlike
-- free-form sidebar text such as 'Erfahrung'.
```

Two columns from revision 1 are **gone**:

- ~~`priority`~~ — the `st.priority[id]` map in AppState is not a separate field;
  it is the _interest override_ (`ApplicationCard.tsx:27`, `PropertiesSidebar.tsx:140`
  both read/write it as interest). One `interest` column, `NOT NULL` because the
  code always resolves a value.
- ~~`followup_state`~~ — `'soon' | 'due'` is time-derived (`schedule.ts` computes it
  from day-diff at render). A stored value is stale by the next morning. Derived
  from `followups.due_at` instead.

Id generation: `next_bew_num` in `meta` (seeded to 45), incremented on create —
**not** `MAX(id)+1`, which string-compares zero-padded ids (`'BEW-07'`) wrongly and
reuses the highest id after a delete.

```sql
CREATE TABLE facts (                   -- label/value bag for the properties sidebar
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,       -- 'Gehalt', 'Standort', …
  value           TEXT NOT NULL,       -- renderer-owned display text (see conventions)
  kind            TEXT,                -- 'select' | 'link' | NULL (renderer type,
                                       -- today's misnamed 's'/'l' flags)
  position        INTEGER NOT NULL,
  UNIQUE (application_id, label)       -- labels ARE semantic keys ('Kontaktperson…'
);                                     -- filters, FACT_OPTIONS, DATE_FIELDS) and the
                                       -- upsert channel needs a conflict target
-- The MENU of choices for select-facts (Plattform → LinkedIn/Xing/…) stays in the
-- FACT_OPTIONS code config; the DB stores only the chosen value. Options move to
-- a table only if in-app editing of option lists is ever wanted.

-- Fact-label routing rule: the sidebar is a fixed catalog of labeled fields
-- (SECTIONS config: BEWERBUNG / POSITION / UNTERNEHMEN), and most labels alias
-- real columns. The repo routes them on write and synthesizes them on read;
-- they are never stored as facts rows, so two write paths can't diverge:
--   'Berufsbezeichnung' ↔ applications.role
--   'Plattform'         ↔ applications.channel     (where the listing was FOUND)
--   'Beworben via'      ↔ applications.applied_via (how it was SUBMITTED — new
--                         sidebar field; select options live in FACT_OPTIONS)
--   'Beworben am'       ↔ applications.applied_at
--   'Letzter Kontakt'   ↔ applications.last_contact_at
--   'Firma'             ↔ the linked company's name (editing it find-or-creates a
--                         company with the new name and RE-LINKS company_id — it
--                         does not rename the shared row, so fixing a typo on one
--                         card can't silently rename another application's company)
--   'Branche'           ↔ companies.sector    (updates the shared row)
--   'Mitarbeiterzahl'   ↔ companies.headcount (updates the shared row)
--   'Karriereseite'     ↔ companies.website   (updates the shared row)
--   'E-Mail'/'Telefon' (UNTERNEHMEN section) ↔ companies.email / companies.phone
-- Only genuinely free-form position fields remain facts rows: 'Standort',
-- 'Gehalt', 'Erfahrung', and any future ad-hoc labels.

CREATE TABLE people (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  initials    TEXT,                    -- display only; no longer the record key
  email       TEXT,
  phone       TEXT,
  linkedin    TEXT,
  color       TEXT NOT NULL,           -- avatar CSS token; assigned on insert via
                                       -- PERSON_COLORS[count % 6], persisted because
                                       -- insertion order can't be re-derived
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE application_people (
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,       -- 'contact' | 'pool' | 'email'
  position        INTEGER NOT NULL,    -- list order is user-visible: the board card
                                       -- shows contacts[0], adds append at the end
  PRIMARY KEY (application_id, person_id, kind)
);
-- kind='email' preserves the follow-up email card's independent recipient list
-- (emailContactOverrides today). Unifying it with 'contact' would silently change
-- FollowUpEmailCard behavior; that is a product decision, not a migration.
-- Pool fallback preserved in the selector: no 'pool' rows for a card ⇒ suggest
-- ALL people (today: `peoplePool[id] || Object.keys(people)` — only 3 of 13
-- sample cards have explicit pools).

CREATE TABLE comments (
  id              INTEGER PRIMARY KEY, -- stable id replaces index-keyed edit/delete maps
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author          TEXT NOT NULL,       -- 'Du' | 'Kepler' (single-user assumption kept)
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  edited_at       TEXT
);

CREATE TABLE rounds (                  -- interview rounds
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  state           TEXT NOT NULL,       -- 'done' | 'next' | 'open'
  title           TEXT NOT NULL,
  scheduled_date  TEXT,                -- 'YYYY-MM-DD' local; NULL = no date yet
  start_time      TEXT,                -- 'HH:MM' local; NULL = date-only round
  end_time        TEXT,                -- 'HH:MM' local; times are RANGES in the data
                                       -- ('10:00 – 11:00') and the two-step editor
  location        TEXT,                -- 'In Person' | 'Google Meet' | …
  link            TEXT,
  UNIQUE (application_id, position)
);
-- Invariant (owned by repo.createApplication and the seed): every application has
-- at least the 4 canonical rounds, and the LAST round is 'Finales Gespräch' —
-- roundStage() colors rounds by that assumption. Today seedRounds() fakes this at
-- read time; with a DB the rows must actually exist.

CREATE TABLE round_people (
  round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,         -- participant avatar order is deliberate
  PRIMARY KEY (round_id, person_id)
);

CREATE TABLE round_notes (             -- interview notes incl. @-mentions (plain text)
  id          INTEGER PRIMARY KEY,
  round_id    INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE followups (               -- replaces DETAILS[id].upcoming + dueOverrides
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,       -- 'Follow up zur Bewerbung', 'Erneutes Follow up', …
  due_at          TEXT NOT NULL,       -- 'YYYY-MM-DD'; every slot always has a date
  position        INTEGER NOT NULL,    -- slot 0 is the initial follow-up (today it is
                                       -- SYNTHESIZED by schedule.ts, not in `upcoming` —
                                       -- it must be materialized as a real row)
  email_subject   TEXT,                -- the drafted follow-up email. NULL until first
  email_text      TEXT,                -- generated; generated ONCE and stored, then
                                       -- read from here — never regenerated on open.
                                       -- The regenerate button overwrites these.
  generated_at    TEXT,
  UNIQUE (application_id, position)
);
-- No `state` column: dot/pie/dashed urgency is derived from due_at vs. today at
-- render (schedule.ts already works this way). NOTE a deliberate behavior change:
-- today's due dates FLOAT against a recomputed anchor (schedule.ts:31-37); once
-- seeded they are fixed dates that age naturally. Fixed is the correct semantic
-- for real usage; the floating behavior was a prototype artifact.
--
-- Email drafts: today draftEmail() regenerates the text on every render. That
-- changes: the first time a slot's email is needed (or when the user hits
-- regenerate), the draft is generated, persisted via db:followups.saveEmail, and
-- from then on read from email_subject/email_text. This also makes the drafts
-- durable input for the future Agent SDK generation, which won't be free to rerun.

CREATE TABLE documents (               -- Bewerbungsunterlagen (Cover Letter, Lebenslauf)
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,       -- 'cover-letter' | 'lebenslauf' | 'other'
  title           TEXT NOT NULL,       -- 'Cover Letter', 'Lebenslauf'
  format          TEXT NOT NULL,       -- 'docx' | 'pdf' | …
  file_path       TEXT,                -- relative to userData/documents/<app-id>/;
                                       -- NULL = not generated yet (today's stub
                                       -- download fallback keeps working until the
                                       -- Agent SDK writes real files)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- The FILES live on the filesystem, not in the database: the Agent SDK reads and
-- writes real .docx files, and they must stay openable in Word/Finder. The DB row
-- is metadata; the 'DOCX · erstellt am 26.07.2026' caption derives from
-- format + created_at/updated_at. repo.deleteApplication removes the card's
-- document folder along with the cascade.

CREATE TABLE activities (              -- the 'Historie' log; one row per entry,
  id              INTEGER PRIMARY KEY, -- rendered "<author> <text>", e.g. "Kepler
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author          TEXT NOT NULL,       -- who acted: 'Du' | 'Kepler'
  text            TEXT NOT NULL,       -- what happened: 'hat die Karte … angelegt'
  created_at      TEXT NOT NULL
);
```

Indexes: `application_id` on every child table; `(stage_id, stage_position)` on
`applications`.

## Derived at render (was hidden work in revision 1)

The board card's subtitle and chips currently read **pre-rendered strings and static
maps** that this design deletes. The renderer must derive them:

- **Card subtitle** (`CardDef[4] 'updated'`) conflates three things today:
  `'in 5 Tagen fällig'` (→ derive from `followups.due_at`), `'morgen 10:00'`
  (→ derive from the next scheduled round), `'vor 1 Tag'` (→ derive from
  `updated_at`). Pick by the same precedence the sample data implies:
  next interview, else next follow-up due, else last activity.
- **Interview chip** (static `INTERVIEWS` map, read directly by
  `ApplicationCard.tsx`): derived from the next round with a `scheduled_date`
  (month/day/time-range/meta from title + location).
- **Salary line** (static `SALARY` map, read directly by `ApplicationCard.tsx`):
  becomes the application's `'Gehalt'` fact.
- **Follow-up urgency dot** and `followup_state`: from `followups.due_at`
  (already how `schedule.ts` computes it).
- **Round `when` caption** (`'morgen 10:00'`, `'Termin offen'`): from
  `scheduled_date`/`start_time`; today's `syncRoundSchedule()` denormalization
  disappears.

## Main-Process Data Layer (`electron/db/`)

| File            | Responsibility                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db.ts`         | Open the database, set `journal_mode = WAL` and `foreign_keys = ON`, run migrations, run seed if empty.                                                                                                                                                  |
| `migrations.ts` | Ordered migration list tracked via `PRAGMA user_version`. Migration 1 creates the schema above. Every future shape change is a new numbered entry — upgrades run automatically at startup.                                                               |
| `seed.ts`       | First run only. See "Seed transform" below — it is the fiddliest part and is speced against the real sample values.                                                                                                                                      |
| `repo.ts`       | Plain functions per operation (`createApplication`, `moveCard`, `addComment`, `upsertFact`, `setRoundState`, …). Each is one synchronous transaction and returns the affected row(s). Owns the fact-label routing rule and the default-rounds invariant. |

**Error handling:**

- DB fails to open or migrate at startup → native error dialog with the underlying
  message, then quit. No silent in-memory fallback that would lose user edits.
- A mutation throws → the IPC invoke rejects; the renderer surfaces the error
  (console + leaving state untouched). No optimistic updates exist, so there is
  nothing to roll back.

## Seed transform (`seed.ts`)

Runs once on an empty DB, inside one transaction. Speced against the actual sample
values, which are messier than "German date → ISO":

1. **Stages:** insert the 10 stages with the slug ids listed above.
2. **Companies:** one row per distinct company name in `CARDS` (name only;
   sector/headcount/website columns start NULL — there is no such sample data).
3. **Applications:** from `CARDS` + `BOARD`, linked via `company_id`.
   `interest` from `CardDef[2]`;
   `followupState` (`CardDef[5]`) is **dropped** (derived now). `updated_at`: parse
   only genuine past-activity phrases — `vor N Tagen/Wochen/Monaten` (seed-only
   parser; the app's `dateToISO` handles only `vor N Tagen`). Interview-ish
   (`'morgen 10:00'`, `'Do 14:30'`) and follow-up-ish (`'in 5 Tagen fällig'`)
   phrases do **not** touch `updated_at` — they are derived views (see above);
   such cards get `updated_at = created_at`.
4. **People, in two passes with an explicit collision rule:**
   - Pass 1: the 13 initials-keyed `INITIAL_PEOPLE` become `people` rows with their
     seeded colors; `peoplePool` becomes `kind='pool'` join rows.
   - Pass 2: `DETAILS.contacts` name-tuples merge into an existing person **only on
     exact name + role match**; otherwise they insert a new row. This is load-bearing:
     the sample data contains _different_ people sharing a name — 'Nadine Wolf'
     (Geschäftsführung, Orbis pool) vs. 'Nadine Wolf' (Recruiterin,
     `n.wolf@vectorlabs.ch`, BEW-33 contact). Dedupe-by-name-only would
     cross-contaminate companies.
   - Contact tuple slot 2 is routed by shape, not position: values matching a phone
     pattern (`+49 341 55 20 118` on BEW-29) go to `phone`, not `email`.
   - `'Kontaktperson E-Mail'/'Telefon'/'LinkedIn'` facts (BEW-33) are **folded into
     the person row** (the tuple itself lacks phone/linkedin — dropping these facts
     without folding would lose data) and are not inserted as facts rows.
5. **Facts:** from `DETAILS.facts`, minus every routed label (`Berufsbezeichnung`/
   `Plattform` → application columns; `Firma`/`Branche`/`Mitarbeiterzahl`/
   `Karriereseite` → company columns; `Kontaktperson *` → person rows;
   `Beworben am` → `applied_at` parsing `DD.MM.YYYY`; `Letzter Kontakt` →
   `last_contact_at`, back-dating `'vor 12 Tagen'`). Remaining values are kept
   **verbatim** — `facts.value` is display text. Plus: `SALARY` map fans out to a
   `'Gehalt'` fact per card (10 of 13 cards have salaries but no `DETAILS` entry;
   without this step the board's salary lines vanish).
6. **Rounds:** from `INITIAL_ROUNDS` where present; the 10 cards without an entry
   get the 4 canonical rounds. Cards whose seed data lacks a final round (BEW-24:
   Screening/Runde 1/Runde 2) get `'Finales Gespräch'` appended — materializing
   what `seedRounds()` fakes at read time, preserving the `roundStage()` invariant.
   `'10:00 – 11:00'` ranges split into `start_time`/`end_time`; date-only rounds
   get NULL times. `round_people` keeps the seeded participant order.
7. **Comments:** from `DETAILS.comments`, relative times (`'vor 3 Tagen'`)
   back-dated to ISO instants. Cards **without** `DETAILS` get the synthetic default
   Kepler comment inserted (today `CommentsSection` fabricates it at render for 10
   of 13 cards; without seeding it those sections would empty out).
8. **Follow-ups:** materialize the full slot list per card — the synthesized slot 0
   (`'Follow up zur Bewerbung'`) **plus** `DETAILS.upcoming` (or the two defaults),
   with concrete `due_at` dates computed once from today's anchor logic. This
   freezes the floating prototype dates (deliberate, noted above) and keeps
   slot-0 overrides representable. `email_subject`/`email_text` start NULL —
   drafts are generated and stored on first open, not at seed.
9. **Documents:** two rows per card (`Cover Letter` / `Lebenslauf`, format
   `docx`, `file_path` NULL, dates from the stub captions) — matching the
   hardcoded `DOCS` pair that `DocumentsSection` currently renders identically
   for every card. Real files arrive with the Agent SDK work.
10. **Activities:** from the sample `HISTORY` map. Its dates are `'24.07.'` —
    **no year** (the app's own `dateToISO` rejects them). Seed-only parser
    assumes 2026, `DD.MM.` → `2026-MM-DD`.
11. **Counter:** `meta.next_bew_num = 45`. (Agent runs are not seeded — the agent
    panel keeps rendering the static `AGENT_RUNS` stub until the SDK work.)

## IPC Surface

Exposed as `window.desktop.db`, typed in `src/desktop.d.ts`:

- **`db:load`** — called once at boot; returns the full normalized snapshot
  (all tables as plain objects). Data volume is tiny; no partial loading.
- **One channel per mutation**, mirroring `repo.ts`: `db:applications.create`,
  `db:applications.update`, `db:applications.move`, `db:applications.delete`,
  `db:companies.update`, `db:facts.upsert` (conflict target: `application_id +
label`; routed labels update the application/company row instead),
  `db:facts.delete`, `db:comments.add` / `.update` / `.delete`, `db:rounds.*`,
  `db:roundNotes.*`, `db:people.*`, `db:applicationPeople.set` (kind-scoped list
  replace), `db:followups.setDue`, `db:followups.saveEmail`, `db:activities.add`,
  `db:documents.open` (reveals/opens the file when `file_path` is set; falls back
  to the stub download otherwise — richer document mutations come with the SDK
  work). Each writes and returns the affected row(s); the renderer sets state
  from the response.

The renderer never constructs SQL and never receives a database handle.

## Renderer Refactor

`src/state/store.tsx` splits into:

- **Domain state** — normalized entities from `db:load`:
  `applications: Record<id, Application>`, `companies`, `factsByApp`,
  `commentsByApp`, `roundsByApp`, `people`, `followupsByApp`, `activitiesByApp`,
  `documentsByApp`, plus `board` derived from `(stage_id, stage_position)`.
  Mutation helpers call the IPC channel, then set state from the returned row.
  `DocumentsSection` drops its hardcoded `DOCS` pair and renders from state.
- **UI state** — `dragId`, `dropdown`, drafts, edit buffers, collapsed sections,
  theme: unchanged (theme/sections stay in `localStorage`). The create-modal
  skill toggles (`selected`) also stay transient — a deliberate exclusion.
- **Derived views** — the card subtitle / interview chip / salary line / follow-up
  urgency selectors described in "Derived at render".

Deleted outright: `factOverrides`, `summaryOverrides`, `addedComments`,
`commentEdits`, `commentDeletes`, `contactOverrides`, `emailContactOverrides`,
`dueOverrides`, `priority`, `extraCards`, `roundsState`, the `nextNumRef` counter,
`syncRoundSchedule()`, the static `SALARY`/`INTERVIEWS` reads in `ApplicationCard`,
and all merge-at-read adapters. Components keep their props largely unchanged —
the merge adapters become straight selectors.

`sample-data.ts` stops being the renderer's data source. Its **domain data**
(cards, details, rounds, people, history) becomes seed input only; its **config
constants** (`INTEREST`, `FACT_OPTIONS`, `DATE_FIELDS`, `PERSON_COLORS`, stage
colors, …) move to a `src/data/config.ts` the renderer keeps importing; the
`AGENT_RUNS` stub stays imported by the agent panel until the SDK work.

One small UI addition rides along: the sidebar's BEWERBUNG section gains a
`'Beworben via'` select field (routed to `applications.applied_via`), separating
how an application was submitted from the existing `'Plattform'` (where the
listing was found). Seed leaves it NULL — the sample data never recorded it.

A boot loading state covers the (fast, local) `db:load` call before first paint
of the board.

## Testing

First tests in the repo: `vitest`, main-process side only, using in-memory SQLite
(`new Database(':memory:')`):

1. **Migrations** run cleanly on a blank DB and are idempotent across restarts.
2. **Seed** — beyond row counts, the audit's concrete traps become test cases:
   the two Nadine Wolfs stay separate people; BEW-29's phone lands in `phone`;
   BEW-33's Kontaktperson facts fold into the person row; every card ends with a
   `'Finales Gespräch'` round; every card has a slot-0 follow-up and a first
   comment; `SALARY` cards have a `'Gehalt'` fact; yearless history dates parse;
   `'10:00 – 11:00'` splits into start/end.
3. **Repo round-trips:** create → load → update → delete for applications and
   comments; cascade delete removes all children; board move reindexes positions;
   `upsertFact('Berufsbezeichnung')` updates `applications.role`, not a fact row;
   `upsertFact('Firma')` find-or-creates a company and re-links `company_id`
   without renaming the shared row; two seeded applications at the same company
   share one `companies` row; `saveEmail` persists a draft that survives reload;
   `createApplication` inserts the 4 default rounds and increments `next_bew_num`;
   deleting the newest card does not cause id reuse.

No UI tests in this pass.

## Implementation Sequencing

1. **Chunk 1 — backend:** `electron/db/` (schema, migrations, seed, repo), IPC
   channels, preload types, tests. App still runs on in-memory state; the DB layer
   is verifiable via tests alone.
2. **Chunk 2 — renderer:** swap the override maps for DB-backed state, delete the
   merge adapters, wire mutations through IPC, and build the derived-view selectors
   (card subtitle, interview chip, salary fact, round captions). Bigger than
   revision 1 implied — the derived views are real renderer work, not just deletion.

## Risks / Notes

- `better-sqlite3` is a native module — needs `electron-rebuild` (via
  `electron-builder install-app-deps`) in the build setup.
- Two deliberate behavior changes, both prototype-artifact removals: follow-up due
  dates freeze instead of floating against a recomputed anchor, and date-ish fact
  values (`'vor 12 Tagen'`) age as static text (they already never updated —
  they were just re-rendered from the same string).
- Single-user assumptions (`author = 'Du'`, hardcoded agent author `'Kepler'`)
  are deliberately kept. If Supabase/sync ever lands, the migration path is:
  add UUID columns + a users table, lift the schema to Postgres.

## Review findings incorporated (revision 2)

An adversarial audit of revision 1 against `store-context.ts`, `sample-data.ts`,
`store.tsx`, `schedule.ts`, and the consuming components found 8 must-fix issues,
all addressed above: (1) rounds now store local date + start/end range instead of
one UTC instant; (2) `interest`/`priority` collapsed into one column; (3)
`followup_state` dropped as time-derived; (4) `facts` gained
`UNIQUE(application_id, label)` plus the label-routing rule; (5) the email
recipient list survives as `kind='email'`; (6) join tables gained `position`
columns; (7) person colors are persisted; (8) the seed section was rewritten
against the real sample values (yearless history dates, phone-in-email slot,
same-name different-person collisions, `SALARY`/default-comment/default-round/
slot-0 materialization). Nice-to-haves adopted: `facts.kind` rename, `followups`
constraints and dropped undefined `state`, counter table instead of `MAX(id)+1`,
real stage id enumeration, documented pool fallback and derived-view work.

**Revision 3 (Timo's review):** companies became a first-class table
(`companies` + `applications.company_id`, `'Firma'` edits re-link rather than
rename); `agent_runs`/`agent_steps` dropped from scope (stub keeps rendering
static data until the SDK work); follow-up email drafts are now generated once
and persisted (`email_subject`/`email_text`/`generated_at` +
`db:followups.saveEmail`) instead of regenerated per render; `history.actor` →
`author`; `comments.body`/`round_notes.body` → `text`; documented that dropdown
option lists (`FACT_OPTIONS`) stay in code config. Later follow-ups: sidebar
date/company fields routed to real columns (`applied_at`, `last_contact_at`,
company columns), `applied_via` added, `industry`/`employee_count` →
`sector`/`headcount`, `documents` table added for Bewerbungsunterlagen, and
`history` renamed to `activities`.

## Implementation notes (post-review, 2026-08-12)

Deviations accepted during implementation and its two review passes:

- **Fact-label routing lives in the renderer**, not in `repo.upsertFact` as
  originally sketched: `store.writeField` routes labels to their owning
  columns (`APP_FIELD`/`COMPANY_FIELD`), and `seed.ts` keeps a matching
  `ROUTED_LABELS` set. `db:facts.upsert` itself does no routing — a caller
  that upserts a routed label (e.g. the future Agent SDK) would create a
  shadowed facts row. When the SDK work lands, either move the routing into
  the repo or export one shared label table.
- **Re-seed guard is a `meta` marker** (`seeded=1`), not an applications row
  count — deleting every card must not re-trigger the seed.
- **Slot-0 follow-up due dates** are back-solved from the board subtitles
  (`in 5 Tagen fällig`, `3 Tage überfällig`, `heute fällig`) so the seeded
  board keeps its urgency chips; only cards without such a subtitle use the
  frozen Sep-1 anchor.
- **Email recipient lists are always explicit**: the seed mirrors each card's
  contacts into `kind='email'` rows and the renderer has no fallback, so an
  intentionally emptied list stays empty.
- `db:facts.delete` is wired but currently unused (clearing a field stores
  `'—'`, preserving the prototype's render); `db:documents.open` does not
  exist yet — documents keep the placeholder download until real files land.
- Follow-ups have **no completion state** (open design gap): due dates can be
  moved but a follow-up can never be marked done.

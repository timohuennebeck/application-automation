# SQLite Persistence Layer — Design

**Date:** 2026-08-12
**Status:** Draft for review

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

Explicitly out of scope: multi-user support, cloud backup, i18n, Agent SDK integration
(the schema reserves tables for agent runs, but the SDK backend itself is separate work).

## Architecture Overview

- **Engine:** `better-sqlite3` in the Electron main process. Synchronous, no network,
  no second process. The renderer never touches SQL.
- **File:** `app.getPath('userData')/bewerbungen.db`, WAL mode, foreign keys on.
- **Boundary:** typed IPC channels on `window.desktop.db` via `electron/preload.ts` —
  the same seam already reserved for Agent SDK calls.
- **Renderer:** `store.tsx` keeps its React-context shape but splits domain state
  (loaded from the DB) from transient UI state (unchanged). All parallel
  `*Overrides` maps are deleted; tables become the single source of truth.

## Schema

Conventions:

- Timestamps are ISO-8601 UTC strings (`TEXT`). Relative German display text
  (`vor 3 Tagen`) is rendered at display time, never stored.
- All child tables use `ON DELETE CASCADE`, so deleting an application removes its
  facts, comments, rounds, follow-ups, history, and agent runs in one statement.
- Presentation values (stage tint/accent colors, comment background colors) stay in
  theme code keyed by id — never in the database.

```sql
CREATE TABLE stages (
  id        TEXT PRIMARY KEY,          -- e.g. 'eingang'
  title     TEXT NOT NULL,             -- e.g. 'Eingang'
  position  INTEGER NOT NULL           -- board column order
);

CREATE TABLE applications (
  id              TEXT PRIMARY KEY,    -- 'BEW-41'; next number = MAX(numeric part) + 1
  role            TEXT NOT NULL,
  company         TEXT NOT NULL,
  interest        TEXT,
  channel         TEXT,
  stage_id        TEXT NOT NULL REFERENCES stages(id),
  stage_position  INTEGER NOT NULL,    -- order within the column, reindexed on drag
  priority        TEXT,
  followup_state  TEXT,
  summary         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE facts (                   -- flexible label/value bag for the sidebar
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,       -- 'Gehalt', 'Standort', …
  value           TEXT NOT NULL,
  size            TEXT,                -- 's' | 'l' (sidebar layout hint)
  position        INTEGER NOT NULL
);

CREATE TABLE people (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  initials    TEXT,                    -- display only; no longer the record key
  email       TEXT,
  phone       TEXT,
  linkedin    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE application_people (
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,       -- 'contact' | 'pool'
  PRIMARY KEY (application_id, person_id, kind)
);

CREATE TABLE comments (
  id              INTEGER PRIMARY KEY, -- stable id replaces index-keyed edit/delete maps
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author          TEXT NOT NULL,       -- 'Du' | 'Kepler' (single-user assumption kept)
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  edited_at       TEXT
);

CREATE TABLE rounds (                  -- interview rounds
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  state           TEXT NOT NULL,
  title           TEXT NOT NULL,
  scheduled_at    TEXT,                -- replaces the denormalized date/time/when trio
  location        TEXT,
  link            TEXT
);

CREATE TABLE round_people (
  round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, person_id)
);

CREATE TABLE round_notes (             -- interview notes incl. @-mentions (plain text)
  id          INTEGER PRIMARY KEY,
  round_id    INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE followups (               -- replaces DETAILS[id].upcoming + dueOverrides
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  due_at          TEXT,
  state           TEXT NOT NULL,
  position        INTEGER NOT NULL
);

CREATE TABLE history (                 -- per-application activity log
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor           TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE agent_runs (
  id              INTEGER PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  started_at      TEXT NOT NULL
);

CREATE TABLE agent_steps (
  id        INTEGER PRIMARY KEY,
  run_id    INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  kind      TEXT NOT NULL,             -- 'done' | 'run' | 'wait'
  label     TEXT NOT NULL,
  meta      TEXT,
  doc       TEXT
);
```

Indexes: `application_id` on every child table; `(stage_id, stage_position)` on
`applications`.

## Main-Process Data Layer (`electron/db/`)

| File | Responsibility |
| --- | --- |
| `db.ts` | Open the database, set `journal_mode = WAL` and `foreign_keys = ON`, run migrations, run seed if empty. |
| `migrations.ts` | Ordered migration list tracked via `PRAGMA user_version`. Migration 1 creates the schema above. Every future shape change is a new numbered entry — upgrades run automatically at startup. |
| `seed.ts` | First run only (detected by `user_version` transition 0 → 1 with no rows). Transforms `sample-data.ts` into rows: tuples → columns, German display dates (`24.07.2026`) → ISO timestamps, relative comment times (`vor 3 Tagen`) → back-dated ISO timestamps so the UI reads the same, initials-based person keys → `people` rows + join rows. Override maps have no seed equivalent — they start empty by definition. |
| `repo.ts` | Plain functions per operation (`createApplication`, `moveCard`, `addComment`, `upsertFact`, `setRoundState`, …). Each is one synchronous transaction and returns the affected row(s). |

**Error handling:**

- DB fails to open or migrate at startup → native error dialog with the underlying
  message, then quit. No silent in-memory fallback that would lose user edits.
- A mutation throws → the IPC invoke rejects; the renderer surfaces the error
  (console + leaving state untouched). No optimistic updates exist, so there is
  nothing to roll back.

## IPC Surface

Exposed as `window.desktop.db`, typed in `src/desktop.d.ts`:

- **`db:load`** — called once at boot; returns the full normalized snapshot
  (all tables as plain objects). Data volume is tiny; no partial loading.
- **One channel per mutation**, mirroring `repo.ts`: `db:applications.create`,
  `db:applications.update`, `db:applications.move`, `db:applications.delete`,
  `db:facts.upsert`, `db:comments.add` / `.update` / `.delete`,
  `db:rounds.*`, `db:roundNotes.*`, `db:people.*`, `db:followups.*`,
  `db:history.add`. Each writes and returns the affected row(s); the renderer
  sets state from the response.

The renderer never constructs SQL and never receives a database handle.

## Renderer Refactor

`src/state/store.tsx` splits into:

- **Domain state** — normalized entities from `db:load`:
  `applications: Record<id, Application>`, `factsByApp`, `commentsByApp`,
  `roundsByApp`, `people`, `followupsByApp`, `historyByApp`, `agentRunsByApp`,
  plus `board` derived from `(stage_id, stage_position)`. Mutation helpers call
  the IPC channel, then set state from the returned row.
- **UI state** — `dragId`, `dropdown`, drafts, edit buffers, collapsed sections,
  theme: unchanged (theme/sections stay in `localStorage`).

Deleted outright: `factOverrides`, `summaryOverrides`, `addedComments`,
`commentEdits`, `commentDeletes`, `contactOverrides`, `emailContactOverrides`,
`dueOverrides`, `extraCards`, `roundsState`, the `nextNumRef` counter, and all
merge-at-read adapters. Components keep their props largely unchanged — the
merge adapters become straight selectors.

`sample-data.ts` becomes seed input only and is no longer imported by the renderer.

A boot loading state covers the (fast, local) `db:load` call before first paint
of the board.

## Testing

First tests in the repo: `vitest`, main-process side only, using in-memory SQLite
(`new Database(':memory:')`):

1. **Migrations** run cleanly on a blank DB and are idempotent across restarts.
2. **Seed** produces expected row counts and shapes from the sample data
   (spot-check one application end-to-end: facts, comments, rounds, people links).
3. **Repo round-trips:** create → load → update → delete for applications and
   comments; cascade delete removes all children; board move reindexes positions.

No UI tests in this pass.

## Implementation Sequencing

1. **Chunk 1 — backend:** `electron/db/` (schema, migrations, seed, repo), IPC
   channels, preload types, tests. App still runs on in-memory state; the DB layer
   is verifiable via tests alone.
2. **Chunk 2 — renderer:** swap the override maps for DB-backed state, delete the
   merge adapters, wire mutations through IPC. Bigger diff, mostly mechanical
   deletion.

## Risks / Notes

- `better-sqlite3` is a native module — needs `electron-rebuild` (via
  `electron-builder install-app-deps`) in the build setup.
- The seed transform is the fiddliest part (parsing German display dates and
  relative times from sample data). It runs exactly once per fresh profile and is
  covered by tests; imperfect back-dating only affects sample rows, not real data.
- Single-user assumptions (`author = 'Du'`, hardcoded agent author `'Kepler'`)
  are deliberately kept. If Supabase/sync ever lands, the migration path is:
  add UUID columns + a users table, lift the schema to Postgres.

/* Numbered schema migrations, applied in order by migrate(). Index 0 is
   migration 1. Never edit a shipped migration — append a new one. */

/* The 10 pipeline stages. Index = board column position; ids are the stable
   keys the theme maps to tint/accent colors. */
export const STAGES: [string, string][] = [
  ['interessiert', 'Interessiert'],
  ['in-bearbeitung', 'In Bearbeitung'],
  ['eingereicht', 'Bewerbung eingereicht'],
  ['screening', 'Screening'],
  ['interview', 'Interview'],
  ['interview-2', '2. Interview'],
  ['finale', 'Finales Gespräch'],
  ['gehaltsverhandlung', 'Gehaltsverhandlungen begonnen'],
  ['korb', 'Korb erhalten'],
  ['zurueckgezogen', 'Bewerbung zurückgezogen'],
];

const stageInserts = STAGES.map(
  ([id, title], i) => `INSERT INTO stages (id, title, position) VALUES ('${id}', '${title}', ${i});`,
).join('\n');

/* Append-only: a migration's index here is its `user_version`, and the hash
   guard in __tests__/migrate.test.ts refuses any edit to an existing entry.
   The "Migration N" labels below are historical and no longer line up — three
   numbers were consumed by entries that later moved — so trust the index, not
   the label. */
export const MIGRATIONS: string[] = [
  /* Migration 1: the full initial schema. */
  `
  CREATE TABLE meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE stages (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    position  INTEGER NOT NULL UNIQUE
  );

  CREATE TABLE companies (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    sector          TEXT,
    headcount       TEXT,
    website         TEXT,
    email           TEXT,
    phone           TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE applications (
    id              TEXT PRIMARY KEY,
    role            TEXT NOT NULL,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    interest        TEXT NOT NULL DEFAULT 'none',
    channel         TEXT,
    stage_id        TEXT NOT NULL REFERENCES stages(id),
    stage_position  INTEGER NOT NULL,
    summary         TEXT,
    applied_at      TEXT,
    applied_via     TEXT,
    last_contact_at TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX idx_applications_stage ON applications(stage_id, stage_position);

  CREATE TABLE facts (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    value           TEXT NOT NULL,
    kind            TEXT,
    position        INTEGER NOT NULL,
    UNIQUE (application_id, label)
  );
  CREATE INDEX idx_facts_app ON facts(application_id);

  CREATE TABLE people (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT,
    initials    TEXT,
    email       TEXT,
    phone       TEXT,
    linkedin    TEXT,
    color       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE application_people (
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    position        INTEGER NOT NULL,
    PRIMARY KEY (application_id, person_id, kind)
  );
  CREATE INDEX idx_application_people_app ON application_people(application_id);

  CREATE TABLE comments (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    author          TEXT NOT NULL,
    text            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    edited_at       TEXT
  );
  CREATE INDEX idx_comments_app ON comments(application_id);

  CREATE TABLE rounds (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    state           TEXT NOT NULL,
    title           TEXT NOT NULL,
    scheduled_date  TEXT,
    start_time      TEXT,
    end_time        TEXT,
    location        TEXT,
    link            TEXT,
    UNIQUE (application_id, position)
  );
  CREATE INDEX idx_rounds_app ON rounds(application_id);

  CREATE TABLE round_people (
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    PRIMARY KEY (round_id, person_id)
  );

  CREATE TABLE round_notes (
    id          INTEGER PRIMARY KEY,
    round_id    INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_round_notes_round ON round_notes(round_id);

  CREATE TABLE followups (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    due_at          TEXT NOT NULL,
    position        INTEGER NOT NULL,
    email_subject   TEXT,
    email_text      TEXT,
    generated_at    TEXT,
    UNIQUE (application_id, position)
  );
  CREATE INDEX idx_followups_app ON followups(application_id);

  CREATE TABLE documents (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    format          TEXT NOT NULL,
    file_path       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX idx_documents_app ON documents(application_id);

  CREATE TABLE activities (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    author          TEXT NOT NULL,
    text            TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_activities_app ON activities(application_id);

  ${stageInserts}
  `,

  /* Migration 2: the closed value sets move to the uppercase members of
     src/shared/enums.ts. Stage ids stay as they are — they are foreign-key
     targets and stable identifiers, not one of those value sets. */
  `
  UPDATE comments     SET author   = upper(author);
  UPDATE round_notes  SET author   = upper(author);
  UPDATE activities   SET author   = upper(author);
  UPDATE rounds       SET state    = upper(state);
  UPDATE applications SET interest = upper(interest);
  UPDATE application_people SET kind = upper(kind);
  UPDATE facts        SET kind     = upper(kind) WHERE kind IS NOT NULL;
  UPDATE documents    SET kind     = upper(replace(kind, '-', '_'));
  `,

  /* Migration 3: a follow-up can be ticked off once it has been sent. NULL is
     "still open"; the timestamp is what "Erledigt vor 15 Tagen" counts from.
     Migration 1 stays as it was, so this column only ever arrives here. */
  `
  ALTER TABLE followups ADD COLUMN completed_at TEXT;
  `,

  /* Migration 4: "Letzter Kontakt" is retired. Nothing was ever derived from
     it — no sort, no filter, no due-date reckoning — so the column goes, and
     its dates with it. */
  `
  ALTER TABLE applications DROP COLUMN last_contact_at;
  `,

  /* Migration 5: "E-Mail" is spelled "Email" throughout. The channel is one of
     the few labels that is also a stored value, so the rows move with it —
     otherwise a card would keep a channel no dropdown offers. */
  `
  UPDATE applications SET channel     = 'Email' WHERE channel     = 'E-Mail';
  UPDATE applications SET applied_via = 'Email' WHERE applied_via = 'E-Mail';
  `,

  /* Migration 6: a document is now two files, not one. file_path holds the HTML
     that gets edited, pdf_path the export rendered from it.

     `format` goes with them: with two renditions per row there is no single
     format left to name, and the card caption stops quoting one.

     Anything uploaded as .docx is let go rather than relabelled — the column
     now means "HTML source", and a Word file is not one. The row keeps its
     title and dates and simply reads as having no file again. */
  `
  ALTER TABLE documents ADD COLUMN pdf_path TEXT;
  ALTER TABLE documents DROP COLUMN format;
  UPDATE documents SET file_path = NULL WHERE file_path LIKE '%.docx';
  `,

  /* Migration 7: the things worth knowing about the applicant that the CV and
     the cover letter never say — the ones that make a letter sound like a
     person wrote it.

     They belong to the profile, not to an application, so there is no
     application_id and nothing cascades them away. `position` is the order the
     list is shown and handed over in; it carries no UNIQUE constraint, so
     reordering is a straight renumber. */
  `
  CREATE TABLE profile_facts (
    id          INTEGER PRIMARY KEY,
    text        TEXT NOT NULL,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  `,

  /* Migration 8: files attached to a comment. The bytes live under
     documents/<application_id>/attachments/; the row keeps the name the file
     was picked under, since the stored name is sanitized and de-collided.
     `size` is captured at copy time — the file never changes after send. */
  `
  CREATE TABLE comment_attachments (
    id          INTEGER PRIMARY KEY,
    comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    size        INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_comment_attachments_comment ON comment_attachments(comment_id);
  `,

  /* Migration 9: interviews are created by hand now, not pre-seeded four to a
     card — so the untouched placeholders those seeds left behind go. A round
     stays if anything was ever put on it: a schedule, a location or link, a
     participant, a note, or a state other than open. */
  `
  DELETE FROM rounds
  WHERE state = 'OPEN'
    AND COALESCE(scheduled_date, '') = ''
    AND COALESCE(start_time, '')     = ''
    AND COALESCE(end_time, '')       = ''
    AND COALESCE(location, '')       = ''
    AND COALESCE(link, '')           = ''
    AND id NOT IN (SELECT round_id FROM round_people)
    AND id NOT IN (SELECT round_id FROM round_notes);
  `,

  /* Migration 10: the interview stage (the board's interview columns) becomes
     its own column instead of doubling as the title. Rounds titled after the
     old presets get the matching stage; custom titles stay unstaged. */
  `
  ALTER TABLE rounds ADD COLUMN stage TEXT;
  UPDATE rounds SET stage = CASE title
    WHEN 'Screening'        THEN 'Screening'
    WHEN 'Runde 1'          THEN 'Interview'
    WHEN 'Runde 2'          THEN '2. Interview'
    WHEN 'Interview'        THEN 'Interview'
    WHEN '2. Interview'     THEN '2. Interview'
    WHEN 'Finales Gespräch' THEN 'Finales Gespräch'
  END;
  `,

  /* Migration 11: the posting source from the create dialog — the listing's
     URL or, when there was no link, its pasted text — is kept on the
     application for Kepler to read, instead of being parsed once and thrown
     away. */
  `
  ALTER TABLE applications ADD COLUMN posting_url TEXT;
  ALTER TABLE applications ADD COLUMN posting_text TEXT;
  `,

  /* Migration 14: the company homepage, separate from the careers page —
     Kepler records both, and the sidebar shows them as Website and
     Karriereseite. */
  `
  ALTER TABLE companies ADD COLUMN homepage TEXT;
  `,

  /* Migration 15: who owns the card. Creating a card no longer starts Kepler;
     assigning Kepler does, and moves the card to In Bearbeitung. Nullable —
     a fresh card belongs to nobody. */
  `
  ALTER TABLE applications ADD COLUMN assignee TEXT;
  `,

  /* Migration 16: which company a person belongs to. The people pickers group
     by it ("Bei Gemini" first, everyone else after). Nullable — a person can
     be filed without one; a deleted company detaches its people. Existing
     people are filed under the company of the first card they are linked to. */
  `
  ALTER TABLE people ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
  UPDATE people SET company_id = (
    SELECT a.company_id FROM application_people ap
    JOIN applications a ON a.id = ap.application_id
    WHERE ap.person_id = people.id
    ORDER BY a.created_at, ap.kind, ap.position LIMIT 1
  );
  `,

  /* Migration 17: the Standort vocabulary. Every location a card was ever
     filed under, so the sidebar can offer, add to and prune the list — like
     companies. Cards keep pointing at it by name through their Standort fact;
     seeded with the values already in use. */
  `
  CREATE TABLE locations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
  INSERT OR IGNORE INTO locations (name, created_at)
    SELECT DISTINCT TRIM(value), MIN(COALESCE(
      (SELECT created_at FROM applications a WHERE a.id = facts.application_id), ''))
    FROM facts WHERE label = 'Standort' AND TRIM(value) <> '' GROUP BY TRIM(value);
  `,

  /* Migration 18: the Berufsbezeichnung vocabulary — every role a card or a
     person was ever given, so the sidebar and the person editor can offer,
     add to and prune the list like companies and locations. Seeded from both;
     the "Neue Bewerbung" placeholder of a card without a role stays out. */
  `
  CREATE TABLE roles (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
  INSERT OR IGNORE INTO roles (name, created_at)
    SELECT DISTINCT TRIM(role), MIN(created_at) FROM applications
    WHERE TRIM(role) <> '' AND TRIM(role) <> 'Neue Bewerbung' GROUP BY TRIM(role);
  INSERT OR IGNORE INTO roles (name, created_at)
    SELECT DISTINCT TRIM(role), MIN(created_at) FROM people WHERE role IS NOT NULL AND TRIM(role) <> '' GROUP BY TRIM(role);
  `,

  /* Migration 19: databases that ran migration 18 before it excluded the
     placeholder still hold it in the vocabulary. */
  `
  DELETE FROM roles WHERE name = 'Neue Bewerbung';
  `,

  /* Migration 20: which Fassung of the profile template a generated document
     came from — NULL for older documents and for files the user uploaded by
     hand. And the letter row is called what the rest of the app calls it. */
  `
  ALTER TABLE documents ADD COLUMN template_label TEXT;
  UPDATE documents SET title = 'Anschreiben' WHERE kind = 'COVER_LETTER' AND title = 'Cover Letter';
  `,

  /* Migration 21: Kepler's runs become rows instead of the renderer stub. One
     run per launch — re-runs append, so older rows are the run history. Steps
     are created up front as WAIT and advanced in place; labels are stored
     fully rendered (the main process knows the company name at transition
     time), keeping only the {m}/{doc} placeholders the panel turns into chips.
     "vor 9 Min" is never stored — the renderer counts from finished_at.
     Sits after migration 20 although Kepler shipped earlier: migrations are
     applied by array index, so shipped history is append-only — inserting in
     the middle would break every database migrated before the insertion. */
  `
  CREATE TABLE agent_runs (
    id              INTEGER PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    label           TEXT NOT NULL,
    error           TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT
  );
  CREATE INDEX idx_agent_runs_app ON agent_runs(application_id);

  CREATE TABLE agent_steps (
    id           INTEGER PRIMARY KEY,
    run_id       INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    key          TEXT NOT NULL,
    status       TEXT NOT NULL,
    label        TEXT NOT NULL,
    doc          TEXT,
    error        TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    UNIQUE (run_id, position)
  );
  `,

  /* Migration 22: the listing text the run worked from is kept on the run.
     Retrying a failed step downstream of the fetch then reads it from here
     instead of scraping the page again (which may be walled by now). */
  `
  ALTER TABLE agent_runs ADD COLUMN listing TEXT;
  `,

  /* Migration 23 (index 20): the default cadence moved off day 0 (7/14/30
     instead of 0/9/25) and the drafts stopped signing with a placeholder name.
     Existing cards catch up: an unsent follow-up still sitting on the old
     default offset from its card's creation day (local, as the repo counted
     it) moves to the new one — a date the user set by hand no longer matches
     and stays. Unsent stored drafts are dropped; only a sent follow-up keeps
     its text, the one that actually went out. */
  `
  UPDATE followups
     SET due_at = date((SELECT created_at FROM applications WHERE id = application_id), 'localtime',
                       CASE position WHEN 0 THEN '+7 days' WHEN 1 THEN '+14 days' ELSE '+30 days' END)
   WHERE completed_at IS NULL
     AND position IN (0, 1, 2)
     AND due_at = date((SELECT created_at FROM applications WHERE id = application_id), 'localtime',
                       CASE position WHEN 0 THEN '+0 days' WHEN 1 THEN '+9 days' ELSE '+25 days' END);
  UPDATE followups
     SET email_subject = NULL, email_text = NULL, generated_at = NULL
   WHERE completed_at IS NULL AND email_text IS NOT NULL;
  `,

  /* Migration 24 (index 21): the language an application is conducted in —
     'de' or 'en', null until Kepler read the posting or the user chose. It
     decides which side of each template slot a run reads and what the
     generated files are called. Existing cards stay null: a card that never
     runs again keeps its German documents, one that does gets the language
     read from its posting. */
  `
  ALTER TABLE applications ADD COLUMN language TEXT;
  `,
];

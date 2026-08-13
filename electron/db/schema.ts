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
];

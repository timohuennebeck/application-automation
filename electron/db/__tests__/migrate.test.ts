import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb } from '../open.ts';
import { migrate } from '../migrate.ts';
import { MIGRATIONS, STAGES } from '../schema.ts';

/* A database as it stood after `version` migrations — the real thing, not a
   fully migrated one with its version counter wound back. Only the former
   still lacks the columns the later migrations add. */
function dbAtVersion(version: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v]);
  db.exec(`PRAGMA user_version = ${version}`);
  return db;
}

const TABLES = [
  'meta',
  'stages',
  'companies',
  'applications',
  'facts',
  'people',
  'application_people',
  'comments',
  'rounds',
  'round_people',
  'round_notes',
  'followups',
  'documents',
  'activities',
  'profile_facts',
];

describe('migrations', () => {
  it('creates all tables and seeds the stages', () => {
    const db = openDb(':memory:');
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);

    const stages = db.prepare('SELECT id, title, position FROM stages ORDER BY position').all() as {
      id: string;
      title: string;
      position: number;
    }[];
    expect(stages).toHaveLength(10);
    expect(stages[0]).toEqual({ id: 'interessiert', title: 'Interessiert', position: 0 });
    expect(stages[9].id).toBe('zurueckgezogen');
    expect(stages.map((s) => s.id)).toEqual(STAGES.map(([id]) => id));
  });

  it('is idempotent', () => {
    const db = openDb(':memory:');
    migrate(db);
    migrate(db);
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(Number(v.user_version)).toBe(MIGRATIONS.length);
  });

  /* Migration 2 rewrites the value sets that became enums. A database created
     before it holds the old lower-case spellings, so run migration 1 alone,
     insert those rows, and let migration 2 catch up with them. */
  it('uppercases the pre-enum value sets', () => {
    const db = dbAtVersion(1);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'high', 'interessiert', 0, 't', 't');
      INSERT INTO comments (application_id, author, text, created_at) VALUES ('BEW-1', 'Kepler', 'x', 't');
      INSERT INTO rounds (application_id, position, state, title) VALUES ('BEW-1', 0, 'done', 'Screening');
      INSERT INTO facts (application_id, label, value, kind, position) VALUES ('BEW-1', 'Gehalt', '60k', 'select', 0);
      INSERT INTO facts (application_id, label, value, kind, position) VALUES ('BEW-1', 'Standort', 'Köln', NULL, 1);
      INSERT INTO people (id, name, color, created_at, updated_at) VALUES (1, 'Ines', 'c', 't', 't');
      INSERT INTO application_people (application_id, person_id, kind, position) VALUES ('BEW-1', 1, 'contact', 0);
      INSERT INTO documents (application_id, kind, title, format, created_at, updated_at)
        VALUES ('BEW-1', 'cover-letter', 'Cover Letter', 'docx', 't', 't');
    `);

    migrate(db);

    const one = <T>(sql: string) => db.prepare(sql).get() as T;
    expect(one<{ interest: string }>('SELECT interest FROM applications').interest).toBe('HIGH');
    expect(one<{ author: string }>('SELECT author FROM comments').author).toBe('KEPLER');
    expect(one<{ state: string }>('SELECT state FROM rounds').state).toBe('DONE');
    expect(one<{ kind: string }>('SELECT kind FROM application_people').kind).toBe('CONTACT');
    expect(one<{ kind: string }>("SELECT kind FROM facts WHERE label = 'Gehalt'").kind).toBe('SELECT');
    expect(one<{ kind: string | null }>("SELECT kind FROM facts WHERE label = 'Standort'").kind).toBeNull();
    expect(one<{ kind: string }>('SELECT kind FROM documents').kind).toBe('COVER_LETTER');
  });

  /* Migration 3 adds followups.completed_at. A database created before it has
     the rows but not the column, so run migration 2 alone, insert a follow-up,
     and let migration 3 catch up with it. */
  it('opens every existing follow-up when it adds completed_at', () => {
    const db = dbAtVersion(2);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, 't', 't');
      INSERT INTO followups (application_id, label, due_at, position)
        VALUES ('BEW-1', 'Follow up', '2026-08-09', 0);
    `);

    migrate(db);

    const row = db.prepare('SELECT * FROM followups').get() as { completed_at: string | null };
    expect(row.completed_at).toBeNull();
  });

  /* Migration 4 drops applications.last_contact_at, which nothing derived
     anything from — the column and its data go for good. */
  it('drops last_contact_at and leaves the rest of the row intact', () => {
    const db = dbAtVersion(3);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, applied_at, last_contact_at, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, '2026-07-19', '2026-07-31', 't', 't');
    `);

    migrate(db);

    const columns = (db.prepare('PRAGMA table_info(applications)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('last_contact_at');
    expect(columns).toContain('applied_at');
    const row = db.prepare('SELECT * FROM applications').get() as { applied_at: string; role: string };
    expect(row).toMatchObject({ role: 'Designer', applied_at: '2026-07-19' });
  });

  /* Migration 5 renames the stored channel value along with its label, so a
     card already on "E-Mail" keeps its colour and stays selectable. */
  it('renames the E-Mail channel on both columns it can sit in', () => {
    const db = dbAtVersion(4);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, channel, applied_via, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'E-Mail', 'E-Mail', 'interessiert', 0, 't', 't');
      INSERT INTO applications (id, role, company_id, interest, channel, applied_via, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-2', 'Texter', 1, 'LOW', 'LinkedIn', NULL, 'interessiert', 1, 't', 't');
    `);

    migrate(db);

    const rows = db.prepare('SELECT id, channel, applied_via FROM applications ORDER BY id').all() as {
      id: string;
      channel: string | null;
      applied_via: string | null;
    }[];
    expect(rows[0]).toEqual({ id: 'BEW-1', channel: 'Email', applied_via: 'Email' });
    expect(rows[1]).toEqual({ id: 'BEW-2', channel: 'LinkedIn', applied_via: null });
  });

  /* Migration 6 turns one file per document into two: the HTML that is edited
     and the PDF rendered from it. */
  it('adds pdf_path, retires format and lets go of the .docx uploads', () => {
    const db = dbAtVersion(5);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, 't', 't');
      INSERT INTO documents (application_id, kind, title, format, file_path, created_at, updated_at)
        VALUES ('BEW-1', 'LEBENSLAUF', 'Lebenslauf', 'DOCX', 'documents/BEW-1/lebenslauf.docx', 't', 't');
      INSERT INTO documents (application_id, kind, title, format, file_path, created_at, updated_at)
        VALUES ('BEW-1', 'COVER_LETTER', 'Anschreiben', 'DOCX', NULL, 't', 't');
    `);

    migrate(db);

    const columns = (db.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain('pdf_path');
    expect(columns).not.toContain('format');

    const rows = db.prepare('SELECT title, file_path, pdf_path FROM documents ORDER BY id').all() as {
      title: string;
      file_path: string | null;
      pdf_path: string | null;
    }[];
    /* The Word upload is dropped rather than passed off as HTML; the row keeps
       everything else it had. */
    expect(rows[0]).toEqual({ title: 'Lebenslauf', file_path: null, pdf_path: null });
    expect(rows[1]).toEqual({ title: 'Anschreiben', file_path: null, pdf_path: null });
  });

  /* Migration 7: the facts that belong to the applicant rather than to any one
     application, which is why the table has no application_id to cascade from. */
  it('adds profile_facts without touching what is already there', () => {
    const db = dbAtVersion(6);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, 't', 't');
    `);

    migrate(db);

    const columns = (db.prepare('PRAGMA table_info(profile_facts)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toEqual(['id', 'text', 'position', 'created_at', 'updated_at']);
    /* Nothing to migrate into it: the table starts empty on an existing
       database, and the application that was there is untouched. */
    expect((db.prepare('SELECT * FROM profile_facts').all() as unknown[]).length).toBe(0);
    expect((db.prepare('SELECT id FROM applications').all() as { id: string }[])[0].id).toBe('BEW-1');
  });

  it('enforces foreign keys', () => {
    const db = openDb(':memory:');
    expect(() =>
      db
        .prepare(
          "INSERT INTO applications (id, role, company_id, stage_id, stage_position, created_at, updated_at) VALUES ('BEW-1','x', 999, 'interessiert', 0, 't', 't')",
        )
        .run(),
    ).toThrow();
  });
});

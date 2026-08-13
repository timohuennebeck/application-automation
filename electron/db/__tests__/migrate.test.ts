import { describe, expect, it } from 'vitest';
import { openDb } from '../open.ts';
import { migrate } from '../migrate.ts';
import { MIGRATIONS, STAGES } from '../schema.ts';

const TABLES = [
  'meta', 'stages', 'companies', 'applications', 'facts', 'people',
  'application_people', 'comments', 'rounds', 'round_people', 'round_notes',
  'followups', 'documents', 'activities',
];

describe('migrations', () => {
  it('creates all tables and seeds the stages', () => {
    const db = openDb(':memory:');
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);

    const stages = db.prepare('SELECT id, title, position FROM stages ORDER BY position').all() as
      { id: string; title: string; position: number }[];
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
    const db = openDb(':memory:');
    db.exec('PRAGMA user_version = 1');
    db.exec(`
      DELETE FROM comments; DELETE FROM applications; DELETE FROM companies;
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

  it('enforces foreign keys', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.prepare(
        "INSERT INTO applications (id, role, company_id, stage_id, stage_position, created_at, updated_at) VALUES ('BEW-1','x', 999, 'interessiert', 0, 't', 't')",
      ).run(),
    ).toThrow();
  });
});

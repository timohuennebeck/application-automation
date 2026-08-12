import { describe, expect, it } from 'vitest';
import { openDb } from '../open';
import { migrate } from '../migrate';
import { STAGES } from '../schema';

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
    expect(Number(v.user_version)).toBe(1);
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

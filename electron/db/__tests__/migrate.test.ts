import { createHash } from 'node:crypto';
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

/* The company and application almost every upgrade test starts from. The
   interest casing is the only thing that varies by schema era ('high' before
   migration 2 uppercased the enums). */
function seedApp(db: DatabaseSync, interest = 'HIGH'): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
    INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
      VALUES ('BEW-1', 'Designer', 1, '${interest}', 'interessiert', 0, 't', 't');
  `);
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
  'comment_attachments',
  'locations',
  'roles',
  'comment_edits',
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
    seedApp(db, 'high');
    db.exec(`
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
    seedApp(db);
    db.exec(`
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
    seedApp(db);
    db.exec(`
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
    seedApp(db);

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

  /* Migration 9: rounds used to be pre-created for every card, so a database
     is full of untouched placeholders. Only a round with nothing on it at all
     goes — a date, a participant, a note, or a finished state keeps it. */
  it('deletes rounds that were never touched and keeps every other one', () => {
    const db = dbAtVersion(8);
    seedApp(db);
    db.exec(`
      INSERT INTO people (id, name, color, created_at, updated_at) VALUES (1, 'Ines', 'c', 't', 't');
      INSERT INTO rounds (id, application_id, position, state, title) VALUES (1, 'BEW-1', 0, 'OPEN', 'Screening');
      INSERT INTO rounds (id, application_id, position, state, title, scheduled_date)
        VALUES (2, 'BEW-1', 1, 'OPEN', 'Runde 1', '2026-08-20');
      INSERT INTO rounds (id, application_id, position, state, title) VALUES (3, 'BEW-1', 2, 'OPEN', 'Runde 2');
      INSERT INTO rounds (id, application_id, position, state, title) VALUES (4, 'BEW-1', 3, 'OPEN', 'Finales Gespräch');
      INSERT INTO rounds (id, application_id, position, state, title) VALUES (5, 'BEW-1', 4, 'DONE', 'Kennenlernen');
      INSERT INTO round_people (round_id, person_id, position) VALUES (3, 1, 0);
      INSERT INTO round_notes (round_id, author, text, created_at) VALUES (4, 'DU', 'Vorbereitung', 't');
    `);

    migrate(db);

    const titles = (
      db.prepare('SELECT title FROM rounds ORDER BY position').all() as { title: string }[]
    ).map((r) => r.title);
    /* Runde 1 has a date, Runde 2 a participant, Finales Gespräch a note and
       Kennenlernen is done — only the blank Screening placeholder goes. */
    expect(titles).toEqual(['Runde 1', 'Runde 2', 'Finales Gespräch', 'Kennenlernen']);
  });

  /* Migration 10: the interview stage becomes its own column, no longer read
     out of the title. Rounds whose title was one of the old presets get the
     matching board stage; custom titles stay unstaged. */
  it('backfills the stage from legacy preset titles', () => {
    const db = dbAtVersion(9);
    seedApp(db);
    db.exec(`
      INSERT INTO rounds (application_id, position, state, title, scheduled_date)
        VALUES ('BEW-1', 0, 'DONE', 'Screening', '2026-08-01');
      INSERT INTO rounds (application_id, position, state, title, scheduled_date)
        VALUES ('BEW-1', 1, 'DONE', 'Runde 1', '2026-08-05');
      INSERT INTO rounds (application_id, position, state, title, scheduled_date)
        VALUES ('BEW-1', 2, 'NEXT', 'Runde 2', '2026-08-20');
      INSERT INTO rounds (application_id, position, state, title, scheduled_date)
        VALUES ('BEW-1', 3, 'OPEN', 'Kennenlernen mit dem Team', '2026-08-25');
    `);

    migrate(db);

    const rows = db.prepare('SELECT title, stage FROM rounds ORDER BY position').all() as {
      title: string;
      stage: string | null;
    }[];
    expect(rows).toEqual([
      { title: 'Screening', stage: 'Screening' },
      { title: 'Runde 1', stage: 'Interview' },
      { title: 'Runde 2', stage: '2. Interview' },
      { title: 'Kennenlernen mit dem Team', stage: null },
    ]);
  });

  /* Migration 11: the posting source (URL or pasted text) is kept on the
     application instead of being parsed once and thrown away. */
  it('adds the posting source columns and leaves existing rows empty', () => {
    const db = dbAtVersion(10);
    seedApp(db);

    migrate(db);

    const row = db.prepare('SELECT posting_url, posting_text FROM applications').get() as {
      posting_url: string | null;
      posting_text: string | null;
    };
    expect(row).toEqual({ posting_url: null, posting_text: null });
  });

  /* Migration 15: who owns the card. New and existing rows start unassigned. */
  it('adds the assignee column and leaves existing rows unassigned', () => {
    const db = dbAtVersion(12);
    seedApp(db);

    migrate(db);

    const row = db.prepare('SELECT assignee FROM applications').get() as { assignee: string | null };
    expect(row).toEqual({ assignee: null });
  });

  /* Migration 21: Kepler's runs become real rows. Both tables arrive empty and
     cascade away with their application. */
  it('adds the agent run tables wired to cascade with the application', () => {
    const db = dbAtVersion(18);
    seedApp(db);

    migrate(db);

    db.exec(`
      INSERT INTO agent_runs (application_id, status, label, started_at)
        VALUES ('BEW-1', 'RUNNING', 'Firmendetails werden ergänzt…', 't');
      INSERT INTO agent_steps (run_id, position, key, status, label)
        VALUES (1, 0, 'EXTRACT', 'RUN', 'Firmendetails werden ergänzt…');
    `);
    db.prepare('DELETE FROM applications WHERE id = ?').run('BEW-1');

    expect((db.prepare('SELECT * FROM agent_runs').all() as unknown[]).length).toBe(0);
    expect((db.prepare('SELECT * FROM agent_steps').all() as unknown[]).length).toBe(0);
  });

  /* Migration 22: the fetched listing text is kept on the run so a retried
     step downstream of the fetch never has to scrape again. */
  it('adds the listing column to agent runs', () => {
    const db = dbAtVersion(19);
    migrate(db);
    const columns = (db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain('listing');
  });

  /* Migration 14: the company homepage gets its own column next to the
     careers page, so Kepler can record both. */
  it('adds the company homepage column', () => {
    const db = dbAtVersion(11);
    db.exec("INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't')");
    migrate(db);
    const row = db.prepare('SELECT homepage, website FROM companies').get() as {
      homepage: string | null;
      website: string | null;
    };
    expect(row.homepage).toBeNull();
  });

  /* The cadence migration (index 20): the defaults moved off day 0 and the
     drafts stopped signing with a placeholder. Follow-ups still on the old
     defaults are re-based from the card's creation day; a date the user set by
     hand, and anything already sent, is left alone. Unsent stored drafts are
     dropped — they are rendered live from the card from now on. */
  it('re-bases default follow-ups and drops unsent drafts', () => {
    const db = dbAtVersion(20);
    db.exec(`
      INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, 'Acme', 't', 't');
      INSERT INTO applications (id, role, company_id, interest, stage_id, stage_position, created_at, updated_at)
        VALUES ('BEW-1', 'Designer', 1, 'HIGH', 'interessiert', 0, '2026-08-10T12:00:00.000Z', 't');
      INSERT INTO followups (application_id, label, due_at, position, email_subject, email_text, generated_at, completed_at) VALUES
        ('BEW-1', 'Follow up zur Bewerbung', '2026-08-10', 0, 'Betreff', 'Hallo,\n\n…\nSarah Thal', 't', NULL),
        ('BEW-1', 'Erneutes Follow up',      '2026-08-19', 1, NULL, NULL, NULL, NULL),
        ('BEW-1', 'Letztes Follow up',       '2026-08-20', 2, 'Betreff', 'Text', 't', '2026-08-11T09:00:00.000Z');
    `);

    migrate(db);

    const rows = db.prepare('SELECT due_at, email_text FROM followups ORDER BY position').all() as {
      due_at: string;
      email_text: string | null;
    }[];
    /* Slot 0 sat on the old day-0 default → a week out; slot 1 on the old +9
       → +14; slot 2 was moved by hand (and sent) → untouched, draft and all. */
    expect(rows.map((r) => r.due_at)).toEqual(['2026-08-17', '2026-08-24', '2026-08-20']);
    expect(rows.map((r) => r.email_text)).toEqual([null, null, 'Text']);
  });

  /* migrate() applies by array index, so shipped history is append-only: an
     entry that is edited, moved or inserted mid-array silently breaks every
     database that already ran the old order (its user_version then points at
     the wrong entries). New migrations go at the END and get appended here. */
  it('never rewrites shipped migrations — the array is append-only', () => {
    const shipped = [
      '2d9d1434f2151d1d',
      '51b15c67a1c16a27',
      'fc88e4356ce8339d',
      '846af40d0a210b67',
      'bd5fcf459cc7e279',
      'a74d3b834b33b994',
      '364f87119253b0fc',
      '828b28e24c53c208',
      'bd56af40692c04cb',
      'a047d02d1b3f52a7',
      'b45a8258f8ca73f2',
      '574937fb6bd6fd77',
      '627f9a89ff6052ec',
      'c6608a2063b21349',
      '8a6d5bf8dd64b45d',
      '5e23bfe96f3d9939',
      '61e095a97edc9efe',
      '7ddea38829a6734d',
      '9c1a6d865251bca0',
      '6ceff5f94b3e1f9e',
    ];
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(shipped.length);
    const hashes = MIGRATIONS.slice(0, shipped.length).map((sql) =>
      createHash('sha256').update(sql).digest('hex').slice(0, 16),
    );
    expect(hashes).toEqual(shipped);
  });

  /* The exact upgrade a real install performs: a database from the release
     before Kepler (user_version 12, homepage already applied) must come up
     with the agent tables and every later column. */
  it('upgrades a database from the shipped pre-Kepler release', () => {
    const db = dbAtVersion(12);
    seedApp(db);

    migrate(db);

    const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(Number(v.user_version)).toBe(MIGRATIONS.length);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain('agent_runs');
    expect(tables).toContain('agent_steps');
    const appColumns = (db.prepare('PRAGMA table_info(applications)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(appColumns).toContain('assignee');
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

/* Migration 18 seeds the Berufsbezeichnung vocabulary from card and person
   roles, once each, trimmed. */
describe('migration 18', () => {
  it('collects the distinct roles of cards and people', () => {
    const db = dbAtVersion(15);
    const t = '2026-08-01T00:00:00.000Z';
    db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)').run(
      'Gemini',
      t,
      t,
    );
    db.prepare(
      `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, created_at, updated_at)
       VALUES ('BEW-1', ' Designer ', 1, 'NONE', NULL, 'interessiert', 0, ?, ?)`,
    ).run(t, t);
    db.prepare(
      "INSERT INTO people (name, role, color, created_at, updated_at) VALUES ('A', 'Designer', 'c', ?, ?)",
    ).run(t, t);
    db.prepare(
      "INSERT INTO people (name, role, color, created_at, updated_at) VALUES ('B', 'Recruiter', 'c', ?, ?)",
    ).run(t, t);
    db.prepare(
      "INSERT INTO people (name, role, color, created_at, updated_at) VALUES ('C', NULL, 'c', ?, ?)",
    ).run(t, t);
    db.prepare(
      `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, created_at, updated_at)
       VALUES ('BEW-2', 'Neue Bewerbung', 1, 'NONE', NULL, 'interessiert', 1, ?, ?)`,
    ).run(t, t);

    migrate(db);

    const rows = db.prepare('SELECT name FROM roles ORDER BY name').all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(['Designer', 'Recruiter']);
  });
});

/* Migration 17 creates the Standort vocabulary from the values cards already
   use, once each, trimmed. */
describe('migration 17', () => {
  it('collects the distinct Standort values', () => {
    const db = dbAtVersion(14);
    const t = '2026-08-01T00:00:00.000Z';
    db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)').run(
      'Gemini',
      t,
      t,
    );
    for (const id of ['BEW-1', 'BEW-2', 'BEW-3']) {
      db.prepare(
        `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, created_at, updated_at)
         VALUES (?, 'Dev', 1, 'NONE', NULL, 'interessiert', 0, ?, ?)`,
      ).run(id, t, t);
    }
    const ins = db.prepare(
      'INSERT INTO facts (application_id, label, value, kind, position) VALUES (?,?,?,NULL,0)',
    );
    ins.run('BEW-1', 'Standort', 'Berlin');
    ins.run('BEW-2', 'Standort', ' Berlin ');
    ins.run('BEW-3', 'Standort', 'Hamburg');
    ins.run('BEW-3', 'Gehalt', '90k');

    migrate(db);

    const rows = db.prepare('SELECT name FROM locations ORDER BY name').all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(['Berlin', 'Hamburg']);
  });
});

/* Migration 16 adds people.company_id and files existing people under the
   company of the first card they are linked to; unlinked people stay
   unfiled. */
describe('migration 16', () => {
  it('backfills people from their card links', () => {
    const db = dbAtVersion(13);
    const t = '2026-08-01T00:00:00.000Z';
    db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)').run(
      'Gemini',
      t,
      t,
    );
    db.prepare(
      `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, created_at, updated_at)
       VALUES ('BEW-1', 'Dev', 1, 'NONE', NULL, 'interessiert', 0, ?, ?)`,
    ).run(t, t);
    db.prepare(
      "INSERT INTO people (id, name, color, created_at, updated_at) VALUES (1, 'Test', 'c', ?, ?)",
    ).run(t, t);
    db.prepare(
      "INSERT INTO people (id, name, color, created_at, updated_at) VALUES (2, 'Loner', 'c', ?, ?)",
    ).run(t, t);
    db.prepare("INSERT INTO application_people VALUES ('BEW-1', 1, 'CONTACT', 0)").run();

    migrate(db);

    const rows = db.prepare('SELECT id, company_id FROM people ORDER BY id').all() as {
      id: number;
      company_id: number | null;
    }[];
    expect(rows).toEqual([
      { id: 1, company_id: 1 },
      { id: 2, company_id: null },
    ]);
  });
});

describe('migration 24', () => {
  /* The language an application is conducted in. Null for every existing card:
     Kepler decides from the posting on its next run, and a card that never
     runs again keeps its German documents. */
  it('adds a nullable language column to applications', () => {
    const db = dbAtVersion(21);
    seedApp(db);
    migrate(db);
    expect(db.prepare('SELECT language FROM applications').get()).toEqual({ language: null });
    db.prepare("UPDATE applications SET language = 'en'").run();
    expect(db.prepare('SELECT language FROM applications').get()).toEqual({ language: 'en' });
  });
});

describe('migration 25', () => {
  it('creates comment_edits and cascades it with its comment', () => {
    /* Pinned to its index (not MIGRATIONS.length - 1): later appends must not
       silently retarget this test at a different migration. */
    const db = dbAtVersion(22);
    seedApp(db);
    db.exec(
      'INSERT INTO comments (id, application_id, author, text, created_at) ' +
        "VALUES (9, 'BEW-1', 'KEPLER', 'Text', 't')",
    );

    db.exec(MIGRATIONS[22]);

    db.exec(
      'INSERT INTO comment_edits (comment_id, document, kind, find_text, replace_text, position) ' +
        "VALUES (9, 'COVER_LETTER', 'replace', 'alt', 'neu', 0)",
    );
    expect(db.prepare('SELECT count(*) c FROM comment_edits').get()).toMatchObject({ c: 1 });

    db.exec('DELETE FROM comments WHERE id = 9');

    /* The edits describe a comment; without it they are unreachable rows that
       nothing ever cleans. */
    expect(db.prepare('SELECT count(*) c FROM comment_edits').get()).toMatchObject({ c: 0 });
  });
});

describe('migration 26', () => {
  /* Why the applicant wants exactly this position. Null for every existing
     card — the field only ever arrives through the create dialog. */
  it('adds a nullable interest_reason column to applications', () => {
    const db = dbAtVersion(23);
    seedApp(db);
    migrate(db);
    expect(db.prepare('SELECT interest_reason FROM applications').get()).toEqual({ interest_reason: null });
    db.prepare("UPDATE applications SET interest_reason = 'Produkt und Stack passen'").run();
    expect(db.prepare('SELECT interest_reason FROM applications').get()).toEqual({
      interest_reason: 'Produkt und Stack passen',
    });
  });
});

describe('migration 20', () => {
  /* Migration 20: generated documents remember the Fassung they came from, and
     the letter is called by its German name like everything else. */
  it('adds template_label and renames the letter rows to Anschreiben', () => {
    const db = dbAtVersion(17);
    seedApp(db);
    db.exec(`
      INSERT INTO documents (application_id, kind, title, created_at, updated_at)
        VALUES ('BEW-1', 'COVER_LETTER', 'Cover Letter', 't', 't');
      INSERT INTO documents (application_id, kind, title, created_at, updated_at)
        VALUES ('BEW-1', 'LEBENSLAUF', 'Lebenslauf', 't', 't');
    `);
    migrate(db);
    const rows = db.prepare('SELECT kind, title, template_label FROM documents ORDER BY id').all();
    expect(rows).toEqual([
      { kind: 'COVER_LETTER', title: 'Anschreiben', template_label: null },
      { kind: 'LEBENSLAUF', title: 'Lebenslauf', template_label: null },
    ]);
  });
});

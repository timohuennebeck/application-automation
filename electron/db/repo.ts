/* All database operations, one synchronous function per mutation. The IPC
   layer maps these 1:1 onto db:* channels; the renderer never sees SQL.
   Fact-label routing (Berufsbezeichnung → role, Firma → company re-link, …)
   lives here so the sidebar's two write paths cannot diverge. */
import type { DatabaseSync } from 'node:sqlite';
import type {
  ActivityRow, ApplicationPersonRow, ApplicationRow, Author, CommentRow, CompanyRow,
  DbSnapshot, DocumentRow, FactKind, FactRow, FollowupRow, LinkKind, PersonRow,
  RoundNoteRow, RoundPersonRow, RoundRow, RoundState, StageRow,
} from '../../src/shared/db-types';

/* Person avatar palette — insertion-order assignment, persisted per row
   (mirrors PERSON_COLORS in the renderer config). */
const PERSON_COLORS = [
  'var(--c-5b9083)', 'var(--c-a4762f)', 'var(--c-7a5aa8)',
  'var(--c-3f6ea8)', 'var(--c-a8523f)', 'var(--c-4f8f6a)',
];

const CANONICAL_ROUNDS = ['Screening', 'Runde 1', 'Runde 2', 'Finales Gespräch'];
const DAY = 86_400_000;

export interface RoundInput {
  id?: number;
  state: RoundState;
  title: string;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  link: string | null;
  people: number[];
}

export interface CreateApplicationResult {
  application: ApplicationRow;
  company: CompanyRow;
  rounds: RoundRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  applications: ApplicationRow[]; // stage siblings whose position shifted
}

export type Repo = ReturnType<typeof createRepo>;

export function createRepo(db: DatabaseSync, nowFn: () => Date = () => new Date()) {
  const nowISO = () => nowFn().toISOString();

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const getApplication = (id: string) =>
    db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow | undefined;
  const mustGetApplication = (id: string): ApplicationRow => {
    const row = getApplication(id);
    if (!row) throw new Error(`unknown application ${id}`);
    return row;
  };
  const getCompany = (id: number) =>
    db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow;
  const getPerson = (id: number) =>
    db.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow;
  const getFollowup = (id: number) =>
    db.prepare('SELECT * FROM followups WHERE id = ?').get(id) as FollowupRow;

  const touchApplication = (id: string) =>
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(nowISO(), id);

  function findOrCreateCompany(name: string): CompanyRow {
    const existing = db.prepare('SELECT * FROM companies WHERE name = ?').get(name.trim()) as CompanyRow | undefined;
    if (existing) return existing;
    const t = nowISO();
    const res = db.prepare('INSERT INTO companies (name, created_at, updated_at) VALUES (?,?,?)').run(name.trim(), t, t);
    return getCompany(Number(res.lastInsertRowid));
  }

  function reindexStage(stageId: string) {
    const rows = db.prepare(
      'SELECT id FROM applications WHERE stage_id = ? ORDER BY stage_position',
    ).all(stageId) as { id: string }[];
    const upd = db.prepare('UPDATE applications SET stage_position = ? WHERE id = ?');
    rows.forEach((r, i) => upd.run(i, r.id));
  }

  function insertDefaultChildren(appId: string, now: Date): { rounds: RoundRow[]; followups: FollowupRow[]; documents: DocumentRow[] } {
    const insRound = db.prepare('INSERT INTO rounds (application_id, position, state, title) VALUES (?,?,?,?)');
    CANONICAL_ROUNDS.forEach((title, pos) => insRound.run(appId, pos, 'open', title));

    /* Same follow-up cadence a fresh card gets today: immediate + the two defaults. */
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const due = (days: number) => {
      const d = new Date(midnight.getTime() + days * DAY);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const insFollowup = db.prepare('INSERT INTO followups (application_id, label, due_at, position) VALUES (?,?,?,?)');
    insFollowup.run(appId, 'Follow up zur Bewerbung', due(0), 0);
    insFollowup.run(appId, 'Erneutes Follow up', due(9), 1);
    insFollowup.run(appId, 'Letztes Follow up', due(25), 2);

    const t = now.toISOString();
    const insDoc = db.prepare('INSERT INTO documents (application_id, kind, title, format, created_at, updated_at) VALUES (?,?,?,?,?,?)');
    insDoc.run(appId, 'cover-letter', 'Cover Letter', 'docx', t, t);
    insDoc.run(appId, 'lebenslauf', 'Lebenslauf', 'docx', t, t);

    return {
      rounds: db.prepare('SELECT * FROM rounds WHERE application_id = ? ORDER BY position').all(appId) as RoundRow[],
      followups: db.prepare('SELECT * FROM followups WHERE application_id = ? ORDER BY position').all(appId) as FollowupRow[],
      documents: db.prepare('SELECT * FROM documents WHERE application_id = ? ORDER BY id').all(appId) as DocumentRow[],
    };
  }

  return {
    load(): DbSnapshot {
      return {
        stages: db.prepare('SELECT * FROM stages ORDER BY position').all() as StageRow[],
        companies: db.prepare('SELECT * FROM companies').all() as CompanyRow[],
        applications: db.prepare('SELECT * FROM applications').all() as ApplicationRow[],
        facts: db.prepare('SELECT * FROM facts ORDER BY application_id, position').all() as FactRow[],
        people: db.prepare('SELECT * FROM people').all() as PersonRow[],
        applicationPeople: db.prepare('SELECT * FROM application_people ORDER BY application_id, kind, position').all() as ApplicationPersonRow[],
        comments: db.prepare('SELECT * FROM comments ORDER BY application_id, id').all() as CommentRow[],
        rounds: db.prepare('SELECT * FROM rounds ORDER BY application_id, position').all() as RoundRow[],
        roundPeople: db.prepare('SELECT * FROM round_people ORDER BY round_id, position').all() as RoundPersonRow[],
        roundNotes: db.prepare('SELECT * FROM round_notes ORDER BY round_id, id').all() as RoundNoteRow[],
        followups: db.prepare('SELECT * FROM followups ORDER BY application_id, position').all() as FollowupRow[],
        documents: db.prepare('SELECT * FROM documents ORDER BY application_id, id').all() as DocumentRow[],
        activities: db.prepare('SELECT * FROM activities ORDER BY application_id, id').all() as ActivityRow[],
      };
    },

    createApplication(input: { role: string; company: string; channel: string | null }): CreateApplicationResult {
      return tx(() => {
        const now = nowFn();
        const t = now.toISOString();
        const num = Number((db.prepare("SELECT value FROM meta WHERE key = 'next_bew_num'").get() as { value: string }).value);
        db.prepare("UPDATE meta SET value = ? WHERE key = 'next_bew_num'").run(String(num + 1));
        const id = 'BEW-' + num;

        const company = findOrCreateCompany(input.company || 'Unbekanntes Unternehmen');
        db.prepare('UPDATE applications SET stage_position = stage_position + 1 WHERE stage_id = ?').run('interessiert');
        db.prepare(
          `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(id, input.role, company.id, 'none', input.channel, 'interessiert', 0, t, t);

        const children = insertDefaultChildren(id, now);
        return {
          application: mustGetApplication(id),
          company,
          ...children,
          applications: db.prepare("SELECT * FROM applications WHERE stage_id = 'interessiert'").all() as ApplicationRow[],
        };
      });
    },

    updateApplication(
      id: string,
      patch: Partial<Pick<ApplicationRow, 'role' | 'interest' | 'channel' | 'summary' | 'applied_at' | 'applied_via' | 'last_contact_at' | 'stage_id'>>,
    ): ApplicationRow {
      return tx(() => {
        const allowed = ['role', 'interest', 'channel', 'summary', 'applied_at', 'applied_via', 'last_contact_at', 'stage_id'] as const;
        const keys = allowed.filter((k) => k in patch);
        if (keys.length) {
          const setSql = keys.map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE applications SET ${setSql}, updated_at = ? WHERE id = ?`).run(
            ...keys.map((k) => patch[k] ?? null), nowISO(), id,
          );
        }
        return mustGetApplication(id);
      });
    },

    moveCard(id: string, toStageId: string, toIndex: number): ApplicationRow[] {
      return tx(() => {
        const app = mustGetApplication(id);
        const fromStage = app.stage_id;
        /* Take the card out, reindex the source, then splice it in. */
        db.prepare('UPDATE applications SET stage_id = ?, stage_position = ? WHERE id = ?').run(toStageId, 100000, id);
        reindexStage(fromStage);
        const siblings = (db.prepare(
          'SELECT id FROM applications WHERE stage_id = ? AND id != ? ORDER BY stage_position',
        ).all(toStageId, id) as { id: string }[]).map((r) => r.id);
        const idx = Math.max(0, Math.min(toIndex, siblings.length));
        siblings.splice(idx, 0, id);
        const upd = db.prepare('UPDATE applications SET stage_position = ? WHERE id = ?');
        siblings.forEach((sid, i) => upd.run(i, sid));
        touchApplication(id);
        return db.prepare('SELECT * FROM applications WHERE stage_id IN (?, ?)').all(fromStage, toStageId) as ApplicationRow[];
      });
    },

    deleteApplication(id: string): void {
      tx(() => {
        db.prepare('DELETE FROM applications WHERE id = ?').run(id);
      });
    },

    relinkCompany(id: string, name: string): { application: ApplicationRow; company: CompanyRow } {
      return tx(() => {
        const company = findOrCreateCompany(name);
        db.prepare('UPDATE applications SET company_id = ?, updated_at = ? WHERE id = ?').run(company.id, nowISO(), id);
        return { application: mustGetApplication(id), company };
      });
    },

    updateCompany(
      companyId: number,
      patch: Partial<Pick<CompanyRow, 'name' | 'sector' | 'headcount' | 'website' | 'email' | 'phone' | 'notes'>>,
    ): CompanyRow {
      return tx(() => {
        const allowed = ['name', 'sector', 'headcount', 'website', 'email', 'phone', 'notes'] as const;
        const keys = allowed.filter((k) => k in patch);
        if (keys.length) {
          const setSql = keys.map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE companies SET ${setSql}, updated_at = ? WHERE id = ?`).run(
            ...keys.map((k) => patch[k] ?? null), nowISO(), companyId,
          );
        }
        return getCompany(companyId);
      });
    },

    upsertFact(applicationId: string, label: string, value: string, kind: FactKind): FactRow {
      return tx(() => {
        const next = (db.prepare(
          'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM facts WHERE application_id = ?',
        ).get(applicationId) as { p: number }).p;
        db.prepare(
          `INSERT INTO facts (application_id, label, value, kind, position) VALUES (?,?,?,?,?)
           ON CONFLICT (application_id, label) DO UPDATE SET value = excluded.value`,
        ).run(applicationId, label, value, kind, next);
        touchApplication(applicationId);
        return db.prepare('SELECT * FROM facts WHERE application_id = ? AND label = ?').get(applicationId, label) as FactRow;
      });
    },

    deleteFact(applicationId: string, label: string): void {
      tx(() => {
        db.prepare('DELETE FROM facts WHERE application_id = ? AND label = ?').run(applicationId, label);
        touchApplication(applicationId);
      });
    },

    addComment(applicationId: string, author: Author, text: string): CommentRow {
      return tx(() => {
        const res = db.prepare('INSERT INTO comments (application_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(applicationId, author, text, nowISO());
        touchApplication(applicationId);
        return db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(res.lastInsertRowid)) as CommentRow;
      });
    },

    updateComment(commentId: number, text: string): CommentRow {
      return tx(() => {
        db.prepare('UPDATE comments SET text = ?, edited_at = ? WHERE id = ?').run(text, nowISO(), commentId);
        return db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as CommentRow;
      });
    },

    deleteComment(commentId: number): void {
      tx(() => {
        db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
      });
    },

    /* Full-list replace — the direct mapping of the renderer's mutateRounds.
       Rows arriving with an id keep it (and their notes); the rest are new. */
    setRounds(applicationId: string, rounds: RoundInput[]): { rounds: RoundRow[]; roundPeople: RoundPersonRow[] } {
      return tx(() => {
        const keep = rounds.filter((r) => r.id != null).map((r) => r.id as number);
        const existing = (db.prepare('SELECT id FROM rounds WHERE application_id = ?').all(applicationId) as { id: number }[])
          .map((r) => r.id);
        const del = db.prepare('DELETE FROM rounds WHERE id = ?');
        for (const rid of existing) if (!keep.includes(rid)) del.run(rid);

        /* Two passes so UNIQUE(application_id, position) never collides mid-update. */
        const park = db.prepare('UPDATE rounds SET position = position + 10000 WHERE application_id = ?');
        park.run(applicationId);

        const updRound = db.prepare(
          'UPDATE rounds SET position = ?, state = ?, title = ?, scheduled_date = ?, start_time = ?, end_time = ?, location = ?, link = ? WHERE id = ?',
        );
        const insRound = db.prepare(
          `INSERT INTO rounds (application_id, position, state, title, scheduled_date, start_time, end_time, location, link)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        );
        const clearPeople = db.prepare('DELETE FROM round_people WHERE round_id = ?');
        const insPerson = db.prepare('INSERT INTO round_people (round_id, person_id, position) VALUES (?,?,?)');

        rounds.forEach((r, pos) => {
          let rid: number;
          if (r.id != null) {
            updRound.run(pos, r.state, r.title, r.scheduled_date, r.start_time, r.end_time, r.location, r.link, r.id);
            rid = r.id;
          } else {
            const res = insRound.run(applicationId, pos, r.state, r.title, r.scheduled_date, r.start_time, r.end_time, r.location, r.link);
            rid = Number(res.lastInsertRowid);
          }
          clearPeople.run(rid);
          r.people.forEach((pid, pi) => insPerson.run(rid, pid, pi));
        });
        touchApplication(applicationId);
        return {
          rounds: db.prepare('SELECT * FROM rounds WHERE application_id = ? ORDER BY position').all(applicationId) as RoundRow[],
          roundPeople: db.prepare(
            'SELECT rp.* FROM round_people rp JOIN rounds r ON r.id = rp.round_id WHERE r.application_id = ? ORDER BY rp.round_id, rp.position',
          ).all(applicationId) as RoundPersonRow[],
        };
      });
    },

    addRoundNote(roundId: number, author: Author, text: string): RoundNoteRow {
      return tx(() => {
        const res = db.prepare('INSERT INTO round_notes (round_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(roundId, author, text, nowISO());
        return db.prepare('SELECT * FROM round_notes WHERE id = ?').get(Number(res.lastInsertRowid)) as RoundNoteRow;
      });
    },

    createPerson(input: { name: string; role?: string; email?: string; phone?: string; linkedin?: string }): PersonRow {
      return tx(() => {
        const count = (db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n;
        const initials = input.name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2) || 'NP';
        const t = nowISO();
        const res = db.prepare(
          'INSERT INTO people (name, role, initials, email, phone, linkedin, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ).run(
          input.name.trim(), input.role || null, initials, input.email || null,
          input.phone || null, input.linkedin || null,
          PERSON_COLORS[Number(count) % PERSON_COLORS.length], t, t,
        );
        return getPerson(Number(res.lastInsertRowid));
      });
    },

    updatePerson(
      personId: number,
      patch: Partial<Pick<PersonRow, 'name' | 'role' | 'email' | 'phone' | 'linkedin' | 'initials'>>,
    ): PersonRow {
      return tx(() => {
        const allowed = ['name', 'role', 'email', 'phone', 'linkedin', 'initials'] as const;
        const keys = allowed.filter((k) => k in patch);
        if (keys.length) {
          const setSql = keys.map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE people SET ${setSql}, updated_at = ? WHERE id = ?`).run(
            ...keys.map((k) => patch[k] ?? null), nowISO(), personId,
          );
        }
        return getPerson(personId);
      });
    },

    deletePerson(personId: number): void {
      tx(() => {
        db.prepare('DELETE FROM people WHERE id = ?').run(personId);
      });
    },

    setApplicationPeople(applicationId: string, kind: LinkKind, personIds: number[]): ApplicationPersonRow[] {
      return tx(() => {
        db.prepare('DELETE FROM application_people WHERE application_id = ? AND kind = ?').run(applicationId, kind);
        const ins = db.prepare('INSERT INTO application_people (application_id, person_id, kind, position) VALUES (?,?,?,?)');
        personIds.forEach((pid, i) => ins.run(applicationId, pid, kind, i));
        return db.prepare(
          'SELECT * FROM application_people WHERE application_id = ? AND kind = ? ORDER BY position',
        ).all(applicationId, kind) as ApplicationPersonRow[];
      });
    },

    setFollowupDue(followupId: number, dueAt: string): FollowupRow {
      return tx(() => {
        db.prepare('UPDATE followups SET due_at = ? WHERE id = ?').run(dueAt, followupId);
        return getFollowup(followupId);
      });
    },

    saveFollowupEmail(followupId: number, subject: string, text: string): FollowupRow {
      return tx(() => {
        db.prepare('UPDATE followups SET email_subject = ?, email_text = ?, generated_at = ? WHERE id = ?')
          .run(subject, text, nowISO(), followupId);
        return getFollowup(followupId);
      });
    },

    addActivity(applicationId: string, author: Author, text: string): ActivityRow {
      return tx(() => {
        const res = db.prepare('INSERT INTO activities (application_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(applicationId, author, text, nowISO());
        return db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(res.lastInsertRowid)) as ActivityRow;
      });
    },
  };
}

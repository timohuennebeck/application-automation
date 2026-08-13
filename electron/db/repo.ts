/* All database operations, one synchronous function per mutation. The IPC
   layer maps these 1:1 onto db:* channels; the renderer never sees SQL.
   Fact-label routing (Berufsbezeichnung → role, Firma → company re-link, …)
   lives here so the sidebar's two write paths cannot diverge. */
import type { DatabaseSync } from 'node:sqlite';
import type {
  ActivityRow,
  ApplicationPatch,
  ApplicationPersonRow,
  ApplicationRow,
  CommentRow,
  CompanyPatch,
  CompanyRow,
  CreateApplicationResult,
  DbSnapshot,
  DocumentRow,
  FactRow,
  FollowupRow,
  PersonInput,
  PersonPatch,
  PersonRow,
  RoundInput,
  RoundNoteRow,
  RoundPersonRow,
  RoundRow,
  StageRow,
} from '../../src/shared/db-types.ts';
import { Author, DocumentKind, FactKind, Interest, LinkKind, RoundState } from '../../src/shared/enums.ts';
import { CANONICAL_ROUNDS, DEFAULT_COMMENT, DEFAULT_FOLLOWUPS } from '../../src/shared/domain.ts';

/* Person avatar palette — insertion-order assignment, persisted per row. */
const PERSON_COLORS = [
  'var(--c-5b9083)',
  'var(--c-a4762f)',
  'var(--c-7a5aa8)',
  'var(--c-3f6ea8)',
  'var(--c-a8523f)',
  'var(--c-4f8f6a)',
];

const DAY = 86_400_000;

/* Columns each patch method may write. stage_id is deliberately absent from
   the application list: stage changes go through moveCard, which keeps
   stage_position contiguous. */
const APPLICATION_FIELDS: (keyof ApplicationPatch)[] = [
  'role',
  'interest',
  'channel',
  'summary',
  'applied_at',
  'applied_via',
];
const COMPANY_FIELDS: (keyof CompanyPatch)[] = [
  'name',
  'sector',
  'headcount',
  'website',
  'email',
  'phone',
  'notes',
];
const PERSON_FIELDS: (keyof PersonPatch)[] = ['name', 'role', 'email', 'phone', 'linkedin', 'initials'];

export type Repo = ReturnType<typeof createRepo>;

export function createRepo(db: DatabaseSync, nowFn: () => Date = () => new Date()) {
  const nowISO = () => nowFn().toISOString();

  /* node:sqlite is untyped beyond SupportedValueType, so every read casts.
       These two keep that cast in one place instead of at 40 call sites. */
  const all = <T>(sql: string, ...args: unknown[]): T[] =>
    db.prepare(sql).all(...(args as never[])) as unknown as T[];
  const one = <T>(sql: string, ...args: unknown[]): T =>
    db.prepare(sql).get(...(args as never[])) as unknown as T;

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

  /* Writes the patched columns and bumps updated_at. Keys the patch does not
       carry (or carries as undefined) are left alone: NULLing a NOT NULL column
       would roll the statement back and silently drop the other edits with it. */
  const patchRow = (
    table: string,
    fields: string[],
    patch: Record<string, string | number | null | undefined>,
    id: string | number,
  ): void => {
    const keys = fields.filter((k) => k in patch && patch[k] !== undefined);
    if (!keys.length) return;
    const setSql = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${setSql}, updated_at = ? WHERE id = ?`).run(
      ...(keys.map((k) => patch[k] ?? null) as never[]),
      nowISO(),
      id as never,
    );
  };

  const getApplication = (id: string) =>
    one<ApplicationRow | undefined>('SELECT * FROM applications WHERE id = ?', id);
  const mustGetApplication = (id: string): ApplicationRow => {
    const row = getApplication(id);
    if (!row) throw new Error(`unknown application ${id}`);
    return row;
  };
  const getCompany = (id: number) => one<CompanyRow>('SELECT * FROM companies WHERE id = ?', id);
  const getPerson = (id: number) => one<PersonRow>('SELECT * FROM people WHERE id = ?', id);
  const getFollowup = (id: number) => one<FollowupRow>('SELECT * FROM followups WHERE id = ?', id);

  const touchApplication = (id: string) =>
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(nowISO(), id);

  function findOrCreateCompany(name: string): CompanyRow {
    const existing = one<CompanyRow | undefined>('SELECT * FROM companies WHERE name = ?', name.trim());
    if (existing) return existing;
    const t = nowISO();
    const res = db
      .prepare('INSERT INTO companies (name, created_at, updated_at) VALUES (?,?,?)')
      .run(name.trim(), t, t);
    return getCompany(Number(res.lastInsertRowid));
  }

  function reindexStage(stageId: string) {
    const rows = all<{ id: string }>(
      'SELECT id FROM applications WHERE stage_id = ? ORDER BY stage_position',
      stageId,
    );
    const upd = db.prepare('UPDATE applications SET stage_position = ? WHERE id = ?');
    rows.forEach((r, i) => upd.run(i, r.id));
  }

  function insertDefaultChildren(
    appId: string,
    now: Date,
  ): {
    rounds: RoundRow[];
    followups: FollowupRow[];
    documents: DocumentRow[];
    comments: CommentRow[];
  } {
    const insRound = db.prepare(
      'INSERT INTO rounds (application_id, position, state, title) VALUES (?,?,?,?)',
    );
    CANONICAL_ROUNDS.forEach((title, pos) => insRound.run(appId, pos, RoundState.OPEN, title));

    db.prepare('INSERT INTO comments (application_id, author, text, created_at) VALUES (?,?,?,?)').run(
      appId,
      Author.KEPLER,
      DEFAULT_COMMENT,
      now.toISOString(),
    );

    /* The default cadence, counted from today's midnight. */
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const due = (days: number) => {
      const d = new Date(midnight.getTime() + days * DAY);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const insFollowup = db.prepare(
      'INSERT INTO followups (application_id, label, due_at, position) VALUES (?,?,?,?)',
    );
    DEFAULT_FOLLOWUPS.forEach(([days, label], pos) => insFollowup.run(appId, label, due(days), pos));

    const t = now.toISOString();
    const insDoc = db.prepare(
      'INSERT INTO documents (application_id, kind, title, format, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    );
    insDoc.run(appId, DocumentKind.COVER_LETTER, 'Cover Letter', 'docx', t, t);
    insDoc.run(appId, DocumentKind.LEBENSLAUF, 'Lebenslauf', 'docx', t, t);

    return {
      rounds: all<RoundRow>('SELECT * FROM rounds WHERE application_id = ? ORDER BY position', appId),
      followups: all<FollowupRow>(
        'SELECT * FROM followups WHERE application_id = ? ORDER BY position',
        appId,
      ),
      documents: all<DocumentRow>('SELECT * FROM documents WHERE application_id = ? ORDER BY id', appId),
      comments: all<CommentRow>('SELECT * FROM comments WHERE application_id = ? ORDER BY id', appId),
    };
  }

  return {
    load(): DbSnapshot {
      return {
        stages: all<StageRow>('SELECT * FROM stages ORDER BY position'),
        companies: all<CompanyRow>('SELECT * FROM companies'),
        applications: all<ApplicationRow>('SELECT * FROM applications'),
        facts: all<FactRow>('SELECT * FROM facts ORDER BY application_id, position'),
        people: all<PersonRow>('SELECT * FROM people'),
        applicationPeople: all<ApplicationPersonRow>(
          'SELECT * FROM application_people ORDER BY application_id, kind, position',
        ),
        comments: all<CommentRow>('SELECT * FROM comments ORDER BY application_id, id'),
        rounds: all<RoundRow>('SELECT * FROM rounds ORDER BY application_id, position'),
        roundPeople: all<RoundPersonRow>('SELECT * FROM round_people ORDER BY round_id, position'),
        roundNotes: all<RoundNoteRow>('SELECT * FROM round_notes ORDER BY round_id, id'),
        followups: all<FollowupRow>('SELECT * FROM followups ORDER BY application_id, position'),
        documents: all<DocumentRow>('SELECT * FROM documents ORDER BY application_id, id'),
        activities: all<ActivityRow>('SELECT * FROM activities ORDER BY application_id, id'),
      };
    },

    createApplication(input: {
      role: string;
      company: string;
      channel: string | null;
      /* The dialog's description; null when it was left empty. */
      summary?: string | null;
      /* People picked in the dialog, linked as the card's contacts. */
      people?: number[];
    }): CreateApplicationResult {
      return tx(() => {
        const now = nowFn();
        const t = now.toISOString();
        const num = Number(one<{ value: string }>("SELECT value FROM meta WHERE key = 'next_bew_num'").value);
        db.prepare("UPDATE meta SET value = ? WHERE key = 'next_bew_num'").run(String(num + 1));
        const id = 'BEW-' + num;

        const company = findOrCreateCompany(input.company || 'Unbekanntes Unternehmen');
        db.prepare('UPDATE applications SET stage_position = stage_position + 1 WHERE stage_id = ?').run(
          'interessiert',
        );
        db.prepare(
          `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position, summary, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          input.role,
          company.id,
          Interest.NONE,
          input.channel,
          'interessiert',
          0,
          input.summary || null,
          t,
          t,
        );

        /* Contacts double as the follow-up email's recipients, the way
                   seeded cards start out — that list is never derived later. */
        const insLink = db.prepare(
          'INSERT INTO application_people (application_id, person_id, kind, position) VALUES (?,?,?,?)',
        );
        [...new Set(input.people ?? [])].forEach((pid, i) => {
          insLink.run(id, pid, LinkKind.CONTACT, i);
          insLink.run(id, pid, LinkKind.EMAIL, i);
        });

        const children = insertDefaultChildren(id, now);
        return {
          application: mustGetApplication(id),
          company,
          ...children,
          people: all<ApplicationPersonRow>(
            'SELECT * FROM application_people WHERE application_id = ? ORDER BY kind, position',
            id,
          ),
          applications: all<ApplicationRow>("SELECT * FROM applications WHERE stage_id = 'interessiert'"),
        };
      });
    },

    updateApplication(id: string, patch: ApplicationPatch): ApplicationRow {
      return tx(() => {
        patchRow('applications', APPLICATION_FIELDS, patch, id);
        return mustGetApplication(id);
      });
    },

    moveCard(id: string, toStageId: string, toIndex: number): ApplicationRow[] {
      return tx(() => {
        const app = mustGetApplication(id);
        const fromStage = app.stage_id;
        /* Take the card out, reindex the source, then splice it in. */
        db.prepare('UPDATE applications SET stage_id = ?, stage_position = ? WHERE id = ?').run(
          toStageId,
          100000,
          id,
        );
        reindexStage(fromStage);
        const siblings = all<{ id: string }>(
          'SELECT id FROM applications WHERE stage_id = ? AND id != ? ORDER BY stage_position',
          toStageId,
          id,
        ).map((r) => r.id);
        const idx = Math.max(0, Math.min(toIndex, siblings.length));
        siblings.splice(idx, 0, id);
        const upd = db.prepare('UPDATE applications SET stage_position = ? WHERE id = ?');
        siblings.forEach((sid, i) => upd.run(i, sid));
        touchApplication(id);
        return all<ApplicationRow>(
          'SELECT * FROM applications WHERE stage_id IN (?, ?)',
          fromStage,
          toStageId,
        );
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
        db.prepare('UPDATE applications SET company_id = ?, updated_at = ? WHERE id = ?').run(
          company.id,
          nowISO(),
          id,
        );
        return { application: mustGetApplication(id), company };
      });
    },

    updateCompany(companyId: number, patch: CompanyPatch): CompanyRow {
      return tx(() => {
        patchRow('companies', COMPANY_FIELDS, patch, companyId);
        return getCompany(companyId);
      });
    },

    upsertFact(applicationId: string, label: string, value: string, kind: FactKind | null): FactRow {
      return tx(() => {
        const next = one<{ p: number }>(
          'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM facts WHERE application_id = ?',
          applicationId,
        ).p;
        db.prepare(
          `INSERT INTO facts (application_id, label, value, kind, position) VALUES (?,?,?,?,?)
           ON CONFLICT (application_id, label) DO UPDATE SET value = excluded.value, kind = excluded.kind`,
        ).run(applicationId, label, value, kind, next);
        touchApplication(applicationId);
        return one<FactRow>(
          'SELECT * FROM facts WHERE application_id = ? AND label = ?',
          applicationId,
          label,
        );
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
        const res = db
          .prepare('INSERT INTO comments (application_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(applicationId, author, text, nowISO());
        touchApplication(applicationId);
        return one<CommentRow>('SELECT * FROM comments WHERE id = ?', Number(res.lastInsertRowid));
      });
    },

    updateComment(commentId: number, text: string): CommentRow {
      return tx(() => {
        db.prepare('UPDATE comments SET text = ?, edited_at = ? WHERE id = ?').run(text, nowISO(), commentId);
        return one<CommentRow>('SELECT * FROM comments WHERE id = ?', commentId);
      });
    },

    deleteComment(commentId: number): void {
      tx(() => {
        db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
      });
    },

    /* Full-list replace — the direct mapping of the renderer's mutateRounds.
       Rows arriving with an id keep it (and their notes); the rest are new. */
    setRounds(
      applicationId: string,
      rounds: RoundInput[],
    ): { rounds: RoundRow[]; roundPeople: RoundPersonRow[] } {
      return tx(() => {
        const keep = rounds.filter((r) => r.id != null).map((r) => r.id as number);
        const existing = all<{ id: number }>(
          'SELECT id FROM rounds WHERE application_id = ?',
          applicationId,
        ).map((r) => r.id);
        const del = db.prepare('DELETE FROM rounds WHERE id = ?');
        for (const rid of existing) if (!keep.includes(rid)) del.run(rid);

        /* Two passes so UNIQUE(application_id, position) never collides mid-update. */
        const park = db.prepare('UPDATE rounds SET position = position + 10000 WHERE application_id = ?');
        park.run(applicationId);

        const updRound = db.prepare(
          'UPDATE rounds SET position = ?, state = ?, title = ?, scheduled_date = ?, start_time = ?, end_time = ?, location = ?, link = ? WHERE id = ? AND application_id = ?',
        );
        const insRound = db.prepare(
          `INSERT INTO rounds (application_id, position, state, title, scheduled_date, start_time, end_time, location, link)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        );
        const clearPeople = db.prepare('DELETE FROM round_people WHERE round_id = ?');
        const insPerson = db.prepare(
          'INSERT INTO round_people (round_id, person_id, position) VALUES (?,?,?)',
        );

        rounds.forEach((r, pos) => {
          let rid: number;
          if (r.id != null) {
            updRound.run(
              pos,
              r.state,
              r.title,
              r.scheduled_date,
              r.start_time,
              r.end_time,
              r.location,
              r.link,
              r.id,
              applicationId,
            );
            rid = r.id;
          } else {
            const res = insRound.run(
              applicationId,
              pos,
              r.state,
              r.title,
              r.scheduled_date,
              r.start_time,
              r.end_time,
              r.location,
              r.link,
            );
            rid = Number(res.lastInsertRowid);
          }
          clearPeople.run(rid);
          r.people.forEach((pid, pi) => insPerson.run(rid, pid, pi));
        });
        touchApplication(applicationId);
        return {
          rounds: all<RoundRow>(
            'SELECT * FROM rounds WHERE application_id = ? ORDER BY position',
            applicationId,
          ),
          roundPeople: all<RoundPersonRow>(
            'SELECT rp.* FROM round_people rp JOIN rounds r ON r.id = rp.round_id WHERE r.application_id = ? ORDER BY rp.round_id, rp.position',
            applicationId,
          ),
        };
      });
    },

    addRoundNote(roundId: number, author: Author, text: string): RoundNoteRow {
      return tx(() => {
        const res = db
          .prepare('INSERT INTO round_notes (round_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(roundId, author, text, nowISO());
        return one<RoundNoteRow>('SELECT * FROM round_notes WHERE id = ?', Number(res.lastInsertRowid));
      });
    },

    createPerson(input: PersonInput): PersonRow {
      return tx(() => {
        const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM people').n;
        const initials =
          input.name
            .trim()
            .split(/\s+/)
            .map((w) => w[0] ?? '')
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'NP';
        const t = nowISO();
        const res = db
          .prepare(
            'INSERT INTO people (name, role, initials, email, phone, linkedin, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            input.name.trim(),
            input.role || null,
            initials,
            input.email || null,
            input.phone || null,
            input.linkedin || null,
            PERSON_COLORS[Number(count) % PERSON_COLORS.length],
            t,
            t,
          );
        return getPerson(Number(res.lastInsertRowid));
      });
    },

    updatePerson(personId: number, patch: PersonPatch): PersonRow {
      return tx(() => {
        patchRow('people', PERSON_FIELDS, patch, personId);
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
        db.prepare('DELETE FROM application_people WHERE application_id = ? AND kind = ?').run(
          applicationId,
          kind,
        );
        const ins = db.prepare(
          'INSERT INTO application_people (application_id, person_id, kind, position) VALUES (?,?,?,?)',
        );
        [...new Set(personIds)].forEach((pid, i) => ins.run(applicationId, pid, kind, i));
        return all<ApplicationPersonRow>(
          'SELECT * FROM application_people WHERE application_id = ? AND kind = ? ORDER BY position',
          applicationId,
          kind,
        );
      });
    },

    setFollowupDue(followupId: number, dueAt: string): FollowupRow {
      return tx(() => {
        db.prepare('UPDATE followups SET due_at = ? WHERE id = ?').run(dueAt, followupId);
        return getFollowup(followupId);
      });
    },

    /* Ticks a follow-up off as sent, or puts it back on the list with null. */
    setFollowupCompleted(followupId: number, completedAt: string | null): FollowupRow {
      return tx(() => {
        db.prepare('UPDATE followups SET completed_at = ? WHERE id = ?').run(completedAt, followupId);
        return getFollowup(followupId);
      });
    },

    saveFollowupEmail(followupId: number, subject: string, text: string): FollowupRow {
      return tx(() => {
        db.prepare(
          'UPDATE followups SET email_subject = ?, email_text = ?, generated_at = ? WHERE id = ?',
        ).run(subject, text, nowISO(), followupId);
        return getFollowup(followupId);
      });
    },

    addActivity(applicationId: string, author: Author, text: string): ActivityRow {
      return tx(() => {
        const res = db
          .prepare('INSERT INTO activities (application_id, author, text, created_at) VALUES (?,?,?,?)')
          .run(applicationId, author, text, nowISO());
        return one<ActivityRow>('SELECT * FROM activities WHERE id = ?', Number(res.lastInsertRowid));
      });
    },
  };
}

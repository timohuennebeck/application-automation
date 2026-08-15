/* One-time transform of the design prototype's sample data into real rows.
   Runs only on an empty database, inside a single transaction. The messy parts
   (yearless dates, phone-in-email slots, same-name different-person contacts)
   are speced in docs/superpowers/specs/2026-08-12-sqlite-persistence-design.md
   and covered by __tests__/seed.test.ts. */
import type { DatabaseSync } from 'node:sqlite';
import { UNKNOWN_ROLE } from '../../src/shared/domain.ts';
import {
  CARD_DEFS,
  DETAILS,
  HISTORY,
  INITIAL_BOARD,
  INITIAL_PEOPLE,
  INITIAL_PEOPLE_POOL,
  INITIAL_ROUNDS,
  SALARY,
} from '../../src/data/sample-data.ts';
import { DEFAULT_COMMENT, DEFAULT_FOLLOWUPS } from '../../src/shared/domain.ts';
import { Author, DocumentKind, FactKind, LinkKind } from '../../src/shared/enums.ts';
import { STAGES } from './schema.ts';
import {
  dayMonthToISO,
  germanDateToISO,
  looksLikePhone,
  relativeToISO,
  splitCompany,
  splitTimeRange,
} from './seed-parse.ts';

const SEED_YEAR = 2026;
const DAY = 86_400_000;

/* Labels that route to real columns and must never become facts rows. */
const ROUTED_LABELS = new Set([
  'Berufsbezeichnung',
  'Firma',
  'Plattform',
  'Beworben via',
  'Beworben am',
  'Branche',
  'Mitarbeiterzahl',
  'Karriereseite',
  'Email',
  'Telefon',
  'Kontaktperson',
  'Kontaktperson Email',
  'Kontaktperson Telefon',
  'Kontaktperson LinkedIn',
]);

const atNine = (isoDate: string) => `${isoDate}T09:00:00.000Z`;

/* Local calendar date — toISOString would shift the day for users west of UTC. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function factValue(id: string, label: string): string | undefined {
  const f = DETAILS[id]?.facts.find((x) => x[0] === label);
  return f?.[1];
}

/* Frozen version of schedule.ts's floating anchor: first follow-up lands on
   Sep 1 (or today if that has passed), repeats offset from there. */
function followupDates(now: Date, offsets: number[]): string[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const anchor = new Date(midnight.getFullYear(), midnight.getMonth() >= 8 ? midnight.getMonth() : 8, 1);
  const base = anchor < midnight ? 0 : Math.round((anchor.getTime() - midnight.getTime()) / DAY);
  return offsets.map((o) => localDay(new Date(midnight.getTime() + (base + o) * DAY)));
}

/* Board subtitles like 'in 5 Tagen fällig' / '3 Tage überfällig' / 'heute
   fällig' are the card's real first follow-up date — back-solve them so the
   seeded board keeps its urgency chips. Returns null for non-followup text. */
function dueDateFromSubtitle(subtitle: string, now: Date): string | null {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m = subtitle.match(/^in (\d+) Tagen fällig$/);
  if (m) return localDay(new Date(midnight.getTime() + +m[1] * DAY));
  m = subtitle.match(/^(\d+) Tage? überfällig$/);
  if (m) return localDay(new Date(midnight.getTime() - +m[1] * DAY));
  if (subtitle === 'heute fällig') return localDay(midnight);
  return null;
}

export function seedIfEmpty(db: DatabaseSync, now = new Date()): boolean {
  // A meta marker, not a row count: deleting every application must not
  // trigger a re-seed (the kept companies/people would violate UNIQUE names).
  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (seeded) return false;

  const nowISO = now.toISOString();
  db.exec('BEGIN');
  try {
    const insCompany = db.prepare(
      'INSERT INTO companies (name, sector, headcount, website, email, phone, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    );
    const insApp = db.prepare(
      `INSERT INTO applications (id, role, company_id, interest, channel, stage_id, stage_position,
        summary, applied_at, applied_via, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insFact = db.prepare(
      'INSERT INTO facts (application_id, label, value, kind, position) VALUES (?,?,?,?,?)',
    );
    const insPerson = db.prepare(
      'INSERT INTO people (name, role, initials, email, phone, linkedin, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    const insLink = db.prepare(
      'INSERT INTO application_people (application_id, person_id, kind, position) VALUES (?,?,?,?)',
    );
    const insComment = db.prepare(
      'INSERT INTO comments (application_id, author, text, created_at) VALUES (?,?,?,?)',
    );
    const insRound = db.prepare(
      `INSERT INTO rounds (application_id, position, state, title, stage, scheduled_date, start_time, end_time, location, link)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    const insRoundPerson = db.prepare(
      'INSERT INTO round_people (round_id, person_id, position) VALUES (?,?,?)',
    );
    const insFollowup = db.prepare(
      'INSERT INTO followups (application_id, label, due_at, position) VALUES (?,?,?,?)',
    );
    const insDocument = db.prepare(
      'INSERT INTO documents (application_id, kind, title, created_at, updated_at) VALUES (?,?,?,?,?)',
    );
    const insActivity = db.prepare(
      'INSERT INTO activities (application_id, author, text, created_at) VALUES (?,?,?,?)',
    );

    /* Companies — one row per distinct name; sidebar UNTERNEHMEN fields come
       from the owning card's DETAILS facts. */
    const companyIds = new Map<string, number>();
    for (const [id, card] of Object.entries(CARD_DEFS)) {
      const { name } = splitCompany(card[1]);
      if (companyIds.has(name)) continue;
      const res = insCompany.run(
        name,
        factValue(id, 'Branche') ?? null,
        factValue(id, 'Mitarbeiterzahl') ?? null,
        factValue(id, 'Karriereseite') ?? null,
        factValue(id, 'Email') ?? null,
        factValue(id, 'Telefon') ?? null,
        nowISO,
        nowISO,
      );
      companyIds.set(name, Number(res.lastInsertRowid));
    }

    /* Applications — stage/position from the board layout. */
    for (let col = 0; col < INITIAL_BOARD.length; col++) {
      for (let pos = 0; pos < INITIAL_BOARD[col].length; pos++) {
        const id = INITIAL_BOARD[col][pos];
        const card = CARD_DEFS[id];
        const { name } = splitCompany(card[1]);
        const firstHistory = HISTORY[id]?.[0]?.[2];
        const createdAt = firstHistory
          ? atNine(dayMonthToISO(firstHistory, SEED_YEAR))
          : new Date(now.getTime() - 21 * DAY).toISOString();
        const updatedAt = relativeToISO(card[4], now) || createdAt;
        insApp.run(
          id,
          card[0],
          companyIds.get(name)!,
          card[2],
          card[3],
          STAGES[col][0],
          pos,
          DETAILS[id]?.summary ?? null,
          germanDateToISO(factValue(id, 'Beworben am') ?? '') || null,
          null,
          createdAt,
          updatedAt < createdAt ? createdAt : updatedAt,
        );
      }
    }

    /* Facts — unrouted labels only; every card gets Standort + Gehalt. */
    for (const [id, card] of Object.entries(CARD_DEFS)) {
      let pos = 0;
      const seen = new Set<string>();
      for (const f of DETAILS[id]?.facts ?? []) {
        if (ROUTED_LABELS.has(f[0])) continue;
        insFact.run(id, f[0], f[1], f[2] ?? null, pos++);
        seen.add(f[0]);
      }
      const city = splitCompany(card[1]).city;
      if (!seen.has('Standort') && city) insFact.run(id, 'Standort', city, null, pos++);
      if (!seen.has('Gehalt') && SALARY[id]) insFact.run(id, 'Gehalt', SALARY[id], FactKind.SELECT, pos++);
    }

    /* People pass 1: the initials-keyed directory. */
    const personIdByKey = new Map<string, number>();
    for (const [key, p] of Object.entries(INITIAL_PEOPLE)) {
      const res = insPerson.run(
        p.name,
        p.role || null,
        p.initials || key,
        p.email || null,
        p.phone || null,
        p.linkedin || null,
        p.bg,
        nowISO,
        nowISO,
      );
      personIdByKey.set(key, Number(res.lastInsertRowid));
    }

    /* People pass 2: DETAILS.contacts. Merge only on exact name+role — the
       sample data has different people sharing a name (two Nadine Wolfs). */
    const findPerson = db.prepare(
      'SELECT id, email, phone, linkedin FROM people WHERE name = ? AND role IS ?',
    );
    for (const [appId, det] of Object.entries(DETAILS)) {
      det.contacts.forEach(([name, role, val, bg], idx) => {
        const isPhone = looksLikePhone(val);
        let row = findPerson.get(name, role || null) as
          { id: number; email: string | null; phone: string | null; linkedin: string | null } | undefined;
        if (!row) {
          const res = insPerson.run(
            name,
            role || null,
            name
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .toUpperCase(),
            isPhone ? null : val || null,
            isPhone ? val : null,
            null,
            bg,
            nowISO,
            nowISO,
          );
          row = {
            id: Number(res.lastInsertRowid),
            email: isPhone ? null : val,
            phone: isPhone ? val : null,
            linkedin: null,
          };
        }
        /* Fold the Kontaktperson-* facts into this person's empty fields —
           the tuple itself lacks phone/linkedin. */
        if (factValue(appId, 'Kontaktperson') === name) {
          const upd = db.prepare(
            'UPDATE people SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), linkedin = COALESCE(linkedin, ?) WHERE id = ?',
          );
          upd.run(
            factValue(appId, 'Kontaktperson Email') ?? null,
            factValue(appId, 'Kontaktperson Telefon') ?? null,
            factValue(appId, 'Kontaktperson LinkedIn') ?? null,
            row.id,
          );
        }
        insLink.run(appId, row.id, LinkKind.CONTACT, idx);
        // The follow-up email starts with the same recipients, as its own
        // explicit list — so clearing it later actually sticks.
        insLink.run(appId, row.id, LinkKind.EMAIL, idx);
      });
    }

    /* Pools. */
    for (const [appId, keys] of Object.entries(INITIAL_PEOPLE_POOL)) {
      keys.forEach((key, idx) => insLink.run(appId, personIdByKey.get(key)!, LinkKind.POOL, idx));
    }

    /* The Standort vocabulary: every location the seeded cards use. */
    db.prepare(
      `INSERT OR IGNORE INTO locations (name, created_at)
       SELECT DISTINCT TRIM(value), ? FROM facts WHERE label = 'Standort' AND TRIM(value) <> ''`,
    ).run(nowISO);

    /* The Berufsbezeichnung vocabulary: every role the seeded cards and people carry. */
    db.prepare(
      `INSERT OR IGNORE INTO roles (name, created_at)
       SELECT DISTINCT TRIM(role), ? FROM applications WHERE TRIM(role) <> '' AND TRIM(role) <> ?`,
    ).run(nowISO, UNKNOWN_ROLE);
    db.prepare(
      `INSERT OR IGNORE INTO roles (name, created_at)
       SELECT DISTINCT TRIM(role), ? FROM people WHERE role IS NOT NULL AND TRIM(role) <> ''`,
    ).run(nowISO);

    /* Every seeded person is filed under the company of the first card they
       are linked to — the sample data has no company per person of its own. */
    db.exec(`
      UPDATE people SET company_id = (
        SELECT a.company_id FROM application_people ap
        JOIN applications a ON a.id = ap.application_id
        WHERE ap.person_id = people.id
        ORDER BY a.created_at, ap.kind, ap.position LIMIT 1
      ) WHERE company_id IS NULL
    `);

    /* Comments — cards without DETAILS get the default Kepler comment the UI
       currently fabricates at render time. */
    for (const id of Object.keys(CARD_DEFS)) {
      const list = DETAILS[id]?.comments;
      if (list) {
        for (const [author, time, text] of list) {
          insComment.run(id, author, text, relativeToISO(time, now) || nowISO);
        }
      } else {
        insComment.run(id, Author.KEPLER, DEFAULT_COMMENT, new Date(now.getTime() - 2 * DAY).toISOString());
      }
    }

    /* Rounds — only the ones the sample actually defines; interviews are
       added by hand, so no card starts with placeholders. The sample titles
       predate the stage column, so the stage is read off the title. */
    const LEGACY_STAGE: Record<string, string> = {
      Screening: 'Screening',
      'Runde 1': 'Interview',
      'Runde 2': '2. Interview',
      'Finales Gespräch': 'Finales Gespräch',
    };
    for (const id of Object.keys(CARD_DEFS)) {
      const rounds = INITIAL_ROUNDS[id] ?? [];
      rounds.forEach((r, pos) => {
        const [start, end] = splitTimeRange(r.time);
        const res = insRound.run(
          id,
          pos,
          r.state,
          r.title,
          LEGACY_STAGE[r.title] ?? null,
          germanDateToISO(r.date) || null,
          start,
          end,
          r.where || null,
          r.link || null,
        );
        r.people.forEach((key, pi) =>
          insRoundPerson.run(Number(res.lastInsertRowid), personIdByKey.get(key)!, pi),
        );
      });
    }

    /* Follow-ups — slot 0 is the synthesized initial follow-up. Cards whose
       board subtitle names a due date keep it (that's the urgency chip);
       everyone else gets the frozen Sep-1 anchor. */
    for (const [id, card] of Object.entries(CARD_DEFS)) {
      // DETAILS.upcoming names its offsets in prose ('in 9 Tagen'); cards
      // without one fall back to the shared default cadence.
      const upcoming = DETAILS[id]?.upcoming;
      const slots: [number, string][] = upcoming
        ? upcoming.map((u) => [+(u[0].match(/\d+/) || ['0'])[0], u[1]])
        : DEFAULT_FOLLOWUPS.slice(1);
      slots.unshift([0, DEFAULT_FOLLOWUPS[0][1]]);
      const dates = followupDates(
        now,
        slots.map((s) => s[0]),
      );
      const slot0 = card[5] ? dueDateFromSubtitle(card[4], now) : null;
      if (slot0) dates[0] = slot0;
      slots.forEach(([, label], pos) => insFollowup.run(id, label, dates[pos], pos));
    }

    /* Documents — the stub pair every card shows today; files come with the
       Agent SDK work. */
    for (const id of Object.keys(CARD_DEFS)) {
      insDocument.run(
        id,
        DocumentKind.COVER_LETTER,
        'Anschreiben',
        atNine('2026-07-26'),
        atNine('2026-07-26'),
      );
      insDocument.run(id, DocumentKind.LEBENSLAUF, 'Lebenslauf', atNine('2026-07-22'), atNine('2026-07-24'));
    }

    /* Activities — HISTORY's yearless dates, year 2026 assumed. */
    for (const [id, rows] of Object.entries(HISTORY)) {
      for (const [author, text, date] of rows) {
        insActivity.run(id, author, text, atNine(dayMonthToISO(date, SEED_YEAR)));
      }
    }

    db.prepare('INSERT INTO meta (key, value) VALUES (?,?)').run('next_bew_num', '45');
    db.prepare('INSERT INTO meta (key, value) VALUES (?,?)').run('seeded', '1');

    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

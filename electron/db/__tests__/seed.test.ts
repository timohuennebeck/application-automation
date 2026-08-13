import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open.ts';
import { seedIfEmpty } from '../seed.ts';

const NOW = new Date('2026-08-12T12:00:00.000Z');

let db: DatabaseSync;
beforeAll(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
});

const all = <T>(sql: string, ...args: unknown[]): T[] => db.prepare(sql).all(...(args as never[])) as T[];
const one = <T>(sql: string, ...args: unknown[]): T => db.prepare(sql).get(...(args as never[])) as T;

describe('seedIfEmpty', () => {
  it('seeds once and never again', () => {
    expect(seedIfEmpty(db, NOW)).toBe(false);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM applications').n).toBe(13);
  });

  it('does not re-seed after the user deletes every application', () => {
    // The marker, not a row count, decides — kept companies/people would
    // otherwise collide with the seed's UNIQUE names on the next launch.
    const fresh = openDb(':memory:');
    seedIfEmpty(fresh, NOW);
    fresh.exec('DELETE FROM applications');
    expect(seedIfEmpty(fresh, NOW)).toBe(false);
    expect((fresh.prepare('SELECT COUNT(*) AS n FROM applications').get() as { n: number }).n).toBe(0);
  });

  it('keeps the two Nadine Wolfs apart and merges the one Lea Brinkmann', () => {
    const nadines = all<{ role: string }>("SELECT role FROM people WHERE name = 'Nadine Wolf' ORDER BY role");
    expect(nadines.map((r) => r.role)).toEqual(['Geschäftsführung', 'Recruiterin']);
    const leas = all<{ email: string | null }>("SELECT email FROM people WHERE name = 'Lea Brinkmann'");
    expect(leas).toHaveLength(1);
    expect(leas[0].email).toBe('l.brinkmann@helios.de');
  });

  it("routes BEW-29's phone-shaped contact value to phone", () => {
    const ines = one<{ email: string | null; phone: string | null }>(
      "SELECT email, phone FROM people WHERE name = 'Ines Faber' AND role = 'HR Business Partner'",
    );
    expect(ines.phone).toBe('+49 341 55 20 118');
    expect(ines.email).toBe('i.faber@brandt-digital.de'); // folded from the Kontaktperson facts
    // The pool 'HR' Ines is a separate person.
    expect(all("SELECT id FROM people WHERE name = 'Ines Faber'")).toHaveLength(2);
  });

  it('routes BEW-33 sidebar fields to columns, not facts', () => {
    const app = one<{ applied_at: string; channel: string; summary: string | null }>(
      "SELECT applied_at, channel, summary FROM applications WHERE id = 'BEW-33'",
    );
    expect(app.applied_at).toBe('2026-07-24');
    expect(app.channel).toBe('StepStone');
    const labels = all<{ label: string }>("SELECT label FROM facts WHERE application_id = 'BEW-33'").map(
      (r) => r.label,
    );
    expect(labels.sort()).toEqual(['Erfahrung', 'Gehalt', 'Standort']);
    const company = one<{ sector: string; headcount: string; website: string; email: string; phone: string }>(
      "SELECT c.sector, c.headcount, c.website, c.email, c.phone FROM companies c JOIN applications a ON a.company_id = c.id WHERE a.id = 'BEW-33'",
    );
    expect(company).toEqual({
      sector: 'Software',
      headcount: '201–500',
      website: 'vectorlabs.ch/karriere',
      email: 'jobs@vectorlabs.ch',
      phone: '+41 44 512 90 30',
    });
    // Kontaktperson data folded into the Recruiterin Nadine.
    const nadine = one<{ phone: string; linkedin: string }>(
      "SELECT phone, linkedin FROM people WHERE name = 'Nadine Wolf' AND role = 'Recruiterin'",
    );
    expect(nadine.phone).toBe('+41 44 512 90 34');
    expect(nadine.linkedin).toBe('linkedin.com/in/nadine-wolf');
  });

  it('gives every application a slot-0 followup, a comment, 2 documents, Gehalt+Standort facts — and rounds only where the sample defines them', () => {
    const sampled = new Set(['BEW-24', 'BEW-19', 'BEW-15']);
    for (const { id } of all<{ id: string }>('SELECT id FROM applications')) {
      const rounds = all<{ title: string }>(
        'SELECT title FROM rounds WHERE application_id = ? ORDER BY position',
        id,
      );
      /* Interviews are added by hand — no card starts with placeholders. */
      if (sampled.has(id)) expect(rounds.length, id).toBeGreaterThanOrEqual(3);
      else expect(rounds, id).toEqual([]);
      expect(
        one<{ n: number }>(
          'SELECT COUNT(*) AS n FROM followups WHERE application_id = ? AND position = 0',
          id,
        ).n,
        id,
      ).toBe(1);
      expect(
        one<{ n: number }>('SELECT COUNT(*) AS n FROM comments WHERE application_id = ?', id).n,
        id,
      ).toBeGreaterThanOrEqual(1);
      expect(
        one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE application_id = ?', id).n,
        id,
      ).toBe(2);
      const labels = all<{ label: string }>('SELECT label FROM facts WHERE application_id = ?', id).map(
        (r) => r.label,
      );
      expect(labels, id).toContain('Gehalt');
      expect(labels, id).toContain('Standort');
    }
  });

  it('splits round time ranges', () => {
    const r1 = one<{ scheduled_date: string; start_time: string; end_time: string; location: string }>(
      "SELECT scheduled_date, start_time, end_time, location FROM rounds WHERE application_id = 'BEW-24' AND title = 'Runde 1'",
    );
    expect(r1).toEqual({
      scheduled_date: '2026-08-12',
      start_time: '10:00',
      end_time: '11:00',
      location: 'In Person',
    });
    // BEW-24's seed has exactly its three sample rounds — nothing is appended.
    expect(all("SELECT title FROM rounds WHERE application_id = 'BEW-24'")).toHaveLength(3);
  });

  it('parses yearless activity dates and keeps participant order', () => {
    const acts = all<{ text: string; created_at: string }>(
      "SELECT text, created_at FROM activities WHERE application_id = 'BEW-33' ORDER BY id",
    );
    expect(acts).toHaveLength(3);
    expect(acts[0].created_at).toBe('2026-07-24T09:00:00.000Z');
    const finale = one<{ id: number }>(
      "SELECT id FROM rounds WHERE application_id = 'BEW-15' AND title = 'Finales Gespräch'",
    );
    const people = all<{ name: string }>(
      'SELECT p.name FROM round_people rp JOIN people p ON p.id = rp.person_id WHERE rp.round_id = ? ORDER BY rp.position',
      finale.id,
    ).map((r) => r.name);
    expect(people).toEqual(['Nadine Wolf', 'Tim Bergk', 'Jonas Reiter', 'Ines Faber']);
  });

  it('back-solves slot-0 due dates from the board subtitles, anchor for the rest', () => {
    const slots = all<{ label: string; due_at: string; position: number }>(
      "SELECT label, due_at, position FROM followups WHERE application_id = 'BEW-35' ORDER BY position",
    );
    expect(slots.map((s) => s.label)).toEqual([
      'Follow up zur Bewerbung',
      'Erneutes Follow up',
      'Letztes Follow up',
    ]);
    expect(slots[0].due_at).toBe('2026-08-14'); // 'in 2 Tagen fällig'
    expect(slots[1].due_at).toBe('2026-09-10'); // anchor (Sep 1) + 9
    const due = (id: string) =>
      one<{ due_at: string }>('SELECT due_at FROM followups WHERE application_id = ? AND position = 0', id)
        .due_at;
    expect(due('BEW-33')).toBe('2026-08-09'); // '3 Tage überfällig'
    expect(due('BEW-29')).toBe('2026-08-12'); // 'heute fällig'
    expect(due('BEW-24')).toBe('2026-09-01'); // no followup subtitle → anchor
    expect(one<{ value: string }>("SELECT value FROM meta WHERE key = 'next_bew_num'").value).toBe('45');
  });

  it('mirrors contacts into the explicit email recipient list and clamps updated_at', () => {
    const kinds = all<{ kind: string; person_id: number }>(
      "SELECT kind, person_id FROM application_people WHERE application_id = 'BEW-33' AND kind IN ('CONTACT','EMAIL') ORDER BY kind",
    );
    expect(kinds.filter((k) => k.kind === 'EMAIL').map((k) => k.person_id)).toEqual(
      kinds.filter((k) => k.kind === 'CONTACT').map((k) => k.person_id),
    );
    // BEW-02: 'vor 1 Monat' would back-date updated_at before created_at.
    const app = one<{ created_at: string; updated_at: string }>(
      "SELECT created_at, updated_at FROM applications WHERE id = 'BEW-02'",
    );
    expect(app.updated_at >= app.created_at).toBe(true);
  });

  it('shares one company row across applications at the same company', () => {
    // All 13 sample companies are distinct; assert names have no city suffix.
    const names = all<{ name: string }>('SELECT name FROM companies').map((r) => r.name);
    expect(names).toContain('Vector Labs');
    expect(names).toContain('Kessler & Roth');
    expect(names.some((n) => n.includes(','))).toBe(false);
  });
});

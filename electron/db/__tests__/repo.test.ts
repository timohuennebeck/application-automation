import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open.ts';
import { seedIfEmpty } from '../seed.ts';
import { createRepo, type Repo } from '../repo.ts';
import { Author, FactKind, LinkKind, RoundState } from '../../../src/shared/enums.ts';

const NOW = new Date('2026-08-12T12:00:00.000Z');

let db: DatabaseSync;
let repo: Repo;
beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
  repo = createRepo(db, () => NOW);
});

const count = (sql: string, ...args: unknown[]) =>
  Number((db.prepare(sql).get(...(args as never[])) as { n: number }).n);

describe('repo', () => {
  it('creates BEW-45 with default children and never reuses ids', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: 'LinkedIn' });
    expect(res.application.id).toBe('BEW-45');
    expect(res.application.stage_id).toBe('interessiert');
    expect(res.application.stage_position).toBe(0);
    expect(res.rounds.map((r) => r.title)).toEqual(['Screening', 'Runde 1', 'Runde 2', 'Finales Gespräch']);
    expect(res.followups).toHaveLength(3);
    expect(res.documents).toHaveLength(2);
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].author).toBe(Author.KEPLER);

    repo.deleteApplication('BEW-45');
    const again = repo.createApplication({ role: 'X', company: 'Acme GmbH', channel: null });
    expect(again.application.id).toBe('BEW-46'); // counter, not MAX+1
  });

  it('stores the dialog description and links the picked people', () => {
    const people = repo.load().people.slice(0, 2).map((p) => p.id);
    const res = repo.createApplication({
      role: 'Designer',
      company: 'Acme GmbH',
      channel: null,
      summary: 'Rolle mit Fokus auf Design-Systeme.',
      people,
    });
    expect(res.application.summary).toBe('Rolle mit Fokus auf Design-Systeme.');

    const byKind = (kind: LinkKind) =>
      res.people.filter((l) => l.kind === kind).map((l) => l.person_id);
    expect(byKind(LinkKind.CONTACT)).toEqual(people);
    // The follow-up email starts with the same recipients, like a seeded card.
    expect(byKind(LinkKind.EMAIL)).toEqual(people);
  });

  it('leaves summary and links empty when the dialog fields were', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });
    expect(res.application.summary).toBeNull();
    expect(res.people).toEqual([]);
  });

  it('cascade-deletes children but keeps people and companies', () => {
    const peopleBefore = count('SELECT COUNT(*) AS n FROM people');
    const companiesBefore = count('SELECT COUNT(*) AS n FROM companies');
    repo.deleteApplication('BEW-33');
    for (const table of ['facts', 'comments', 'rounds', 'followups', 'documents', 'activities', 'application_people']) {
      expect(count(`SELECT COUNT(*) AS n FROM ${table} WHERE application_id = 'BEW-33'`), table).toBe(0);
    }
    expect(count('SELECT COUNT(*) AS n FROM people')).toBe(peopleBefore);
    expect(count('SELECT COUNT(*) AS n FROM companies')).toBe(companiesBefore);
  });

  it('moves cards with contiguous reindexing', () => {
    // BEW-41 sits in interessiert[0]; move it to eingereicht index 1.
    repo.moveCard('BEW-41', 'eingereicht', 1);
    const target = db.prepare(
      "SELECT id, stage_position FROM applications WHERE stage_id = 'eingereicht' ORDER BY stage_position",
    ).all() as { id: string; stage_position: number }[];
    expect(target.map((r) => r.id)).toEqual(['BEW-33', 'BEW-41', 'BEW-35']);
    expect(target.map((r) => r.stage_position)).toEqual([0, 1, 2]);
    const source = db.prepare(
      "SELECT stage_position FROM applications WHERE stage_id = 'interessiert' ORDER BY stage_position",
    ).all() as { stage_position: number }[];
    expect(source.map((r) => r.stage_position)).toEqual([0]);
  });

  it('re-links Firma without renaming the shared company row', () => {
    const before = repo.load().companies.find((c) => c.name === 'Talgruppe AG')!;
    const { application, company } = repo.relinkCompany('BEW-24', 'Talgruppe SE');
    expect(company.name).toBe('Talgruppe SE');
    expect(application.company_id).toBe(company.id);
    expect(repo.load().companies.find((c) => c.id === before.id)!.name).toBe('Talgruppe AG');
  });

  it('upserts facts in place', () => {
    const a = repo.upsertFact('BEW-24', 'Erfahrung', '5–8', FactKind.SELECT);
    const b = repo.upsertFact('BEW-24', 'Erfahrung', '8+', FactKind.SELECT);
    expect(b.id).toBe(a.id);
    expect(b.value).toBe('8+');
  });

  it('tracks comment edits and stored email drafts', () => {
    const c = repo.addComment('BEW-24', Author.DU, 'Hallo');
    expect(c.edited_at).toBeNull();
    const edited = repo.updateComment(c.id, 'Hallo!');
    expect(edited.edited_at).toBe(NOW.toISOString());

    const slot = repo.load().followups.find((f) => f.application_id === 'BEW-24' && f.position === 0)!;
    const saved = repo.saveFollowupEmail(slot.id, 'Betreff', 'Text');
    expect(saved.email_subject).toBe('Betreff');
    expect(saved.generated_at).toBe(NOW.toISOString());
  });

  it('setRounds keeps notes for surviving rounds and drops removed ones', () => {
    const rounds = repo.load().rounds.filter((r) => r.application_id === 'BEW-24');
    const note = repo.addRoundNote(rounds[1].id, Author.DU, 'Merken');
    const updated = repo.setRounds('BEW-24', [
      { ...rounds[1], people: [1] },
      { ...rounds[3], people: [] },
      { id: undefined, state: RoundState.OPEN, title: 'Extra', scheduled_date: null, start_time: null, end_time: null, location: null, link: null, people: [] },
    ]);
    expect(updated.rounds.map((r) => r.title)).toEqual(['Runde 1', 'Finales Gespräch', 'Extra']);
    expect(count('SELECT COUNT(*) AS n FROM round_notes WHERE id = ?', note.id)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM rounds WHERE id = ?', rounds[0].id)).toBe(0);
    expect(updated.roundPeople.filter((rp) => rp.round_id === rounds[1].id).map((rp) => rp.person_id)).toEqual([1]);
  });

  it('creates people with cycling colors and kind-scoped link replace', () => {
    const p = repo.createPerson({ name: 'Neue Person' });
    expect(p.initials).toBe('NP');
    expect(p.color).toMatch(/^var\(--c-/);
    const links = repo.setApplicationPeople('BEW-24', LinkKind.EMAIL, [p.id]);
    expect(links).toEqual([{ application_id: 'BEW-24', person_id: p.id, kind: LinkKind.EMAIL, position: 0 }]);
    // contact links untouched
    expect(count("SELECT COUNT(*) AS n FROM application_people WHERE application_id = 'BEW-24' AND kind = 'POOL'")).toBe(4);
    repo.deletePerson(p.id);
    expect(count('SELECT COUNT(*) AS n FROM application_people WHERE person_id = ?', p.id)).toBe(0);
  });
});

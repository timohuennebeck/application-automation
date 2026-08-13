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
    /* No pre-seeded interviews — rounds only exist once the user adds one. */
    expect(res.rounds).toEqual([]);
    expect(res.followups).toHaveLength(3);
    expect(res.documents).toHaveLength(2);
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].author).toBe(Author.KEPLER);

    repo.deleteApplication('BEW-45');
    const again = repo.createApplication({ role: 'X', company: 'Acme GmbH', channel: null });
    expect(again.application.id).toBe('BEW-46'); // counter, not MAX+1
  });

  it('starts a document with neither file and points it at both when one is uploaded', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];
    expect(doc).toMatchObject({ file_path: null, pdf_path: null });

    const html = 'documents/BEW-45/cover-letter.html';
    const pdf = 'documents/BEW-45/cover-letter.pdf';
    const row = repo.setDocumentFile(doc.id, html, pdf);

    expect(row).toMatchObject({ file_path: html, pdf_path: pdf });
    /* "aktualisiert am" on the card hangs off this being later than created_at. */
    expect(row.updated_at >= row.created_at).toBe(true);
  });

  /* A failed export leaves the source without its rendition; the row has to be
     able to say so rather than keep pointing at a PDF that is not there. */
  it('records an upload whose PDF export failed', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];

    const row = repo.setDocumentFile(doc.id, 'documents/BEW-45/cover-letter.html', null);

    expect(row.pdf_path).toBeNull();
    expect(row.file_path).toBe('documents/BEW-45/cover-letter.html');
  });

  it('stores the dialog description and links the picked people', () => {
    const people = repo
      .load()
      .people.slice(0, 2)
      .map((p) => p.id);
    const res = repo.createApplication({
      role: 'Designer',
      company: 'Acme GmbH',
      channel: null,
      summary: 'Rolle mit Fokus auf Design-Systeme.',
      people,
    });
    expect(res.application.summary).toBe('Rolle mit Fokus auf Design-Systeme.');

    const byKind = (kind: LinkKind) => res.people.filter((l) => l.kind === kind).map((l) => l.person_id);
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
    for (const table of [
      'facts',
      'comments',
      'rounds',
      'followups',
      'documents',
      'activities',
      'application_people',
    ]) {
      expect(count(`SELECT COUNT(*) AS n FROM ${table} WHERE application_id = 'BEW-33'`), table).toBe(0);
    }
    expect(count('SELECT COUNT(*) AS n FROM people')).toBe(peopleBefore);
    expect(count('SELECT COUNT(*) AS n FROM companies')).toBe(companiesBefore);
  });

  it('moves cards with contiguous reindexing', () => {
    // BEW-41 sits in interessiert[0]; move it to eingereicht index 1.
    repo.moveCard('BEW-41', 'eingereicht', 1);
    const target = db
      .prepare(
        "SELECT id, stage_position FROM applications WHERE stage_id = 'eingereicht' ORDER BY stage_position",
      )
      .all() as { id: string; stage_position: number }[];
    expect(target.map((r) => r.id)).toEqual(['BEW-33', 'BEW-41', 'BEW-35']);
    expect(target.map((r) => r.stage_position)).toEqual([0, 1, 2]);
    const source = db
      .prepare(
        "SELECT stage_position FROM applications WHERE stage_id = 'interessiert' ORDER BY stage_position",
      )
      .all() as { stage_position: number }[];
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
    const { comment: c } = repo.addComment('BEW-24', Author.DU, 'Hallo');
    expect(c.edited_at).toBeNull();
    const edited = repo.updateComment(c.id, 'Hallo!');
    expect(edited.edited_at).toBe(NOW.toISOString());

    const slot = repo.load().followups.find((f) => f.application_id === 'BEW-24' && f.position === 0)!;
    const saved = repo.saveFollowupEmail(slot.id, 'Betreff', 'Text');
    expect(saved.email_subject).toBe('Betreff');
    expect(saved.generated_at).toBe(NOW.toISOString());
  });

  describe('comment attachments', () => {
    const ZEUGNIS = {
      name: 'Zeugnis 2024.pdf',
      filePath: 'documents/BEW-24/attachments/Zeugnis 2024.pdf',
      size: 9,
    };

    it('stores the attachments with the comment and returns them', () => {
      const res = repo.addComment('BEW-24', Author.DU, 'Anbei das Zeugnis', [ZEUGNIS]);

      expect(res.attachments).toHaveLength(1);
      expect(res.attachments[0]).toMatchObject({
        comment_id: res.comment.id,
        name: ZEUGNIS.name,
        file_path: ZEUGNIS.filePath,
        size: ZEUGNIS.size,
        created_at: NOW.toISOString(),
      });
      expect(repo.load().commentAttachments.map((a) => a.id)).toContain(res.attachments[0].id);
    });

    it('accepts a comment that is only an attachment', () => {
      const res = repo.addComment('BEW-24', Author.DU, '', [ZEUGNIS]);
      expect(res.comment.text).toBe('');
      expect(res.attachments).toHaveLength(1);
    });

    it('deleteComment returns the stored paths and cascades the rows', () => {
      const res = repo.addComment('BEW-24', Author.DU, 'Anbei', [ZEUGNIS]);

      const paths = repo.deleteComment(res.comment.id);

      expect(paths).toEqual([ZEUGNIS.filePath]);
      expect(
        count('SELECT COUNT(*) AS n FROM comment_attachments WHERE comment_id = ?', res.comment.id),
      ).toBe(0);
    });

    it('cascades away with the application', () => {
      repo.addComment('BEW-24', Author.DU, 'Anbei', [ZEUGNIS]);
      repo.deleteApplication('BEW-24');
      expect(count('SELECT COUNT(*) AS n FROM comment_attachments')).toBe(0);
    });
  });

  it('setRounds keeps notes for surviving rounds and drops removed ones', () => {
    const rounds = repo.load().rounds.filter((r) => r.application_id === 'BEW-24');
    const note = repo.addRoundNote(rounds[1].id, Author.DU, 'Merken');
    const updated = repo.setRounds('BEW-24', [
      { ...rounds[1], people: [1] },
      { ...rounds[2], people: [] },
      {
        id: undefined,
        state: RoundState.OPEN,
        title: 'Extra',
        stage: '2. Interview',
        scheduled_date: null,
        start_time: null,
        end_time: null,
        location: null,
        link: null,
        people: [],
      },
    ]);
    expect(updated.rounds.map((r) => r.title)).toEqual(['Runde 1', 'Runde 2', 'Extra']);
    /* The stage travels with the round — both on insert and on update. */
    expect(updated.rounds.map((r) => r.stage)).toEqual(['Interview', '2. Interview', '2. Interview']);
    expect(count('SELECT COUNT(*) AS n FROM round_notes WHERE id = ?', note.id)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM rounds WHERE id = ?', rounds[0].id)).toBe(0);
    expect(
      updated.roundPeople.filter((rp) => rp.round_id === rounds[1].id).map((rp) => rp.person_id),
    ).toEqual([1]);
  });

  describe('profile facts', () => {
    const texts = () => repo.load().profileFacts.map((f) => f.text);

    it('appends a new fact after the ones already there', () => {
      const before = texts();
      const row = repo.addProfileFact('Spreche fließend Spanisch');

      expect(row.text).toBe('Spreche fließend Spanisch');
      expect(texts()).toEqual([...before, 'Spreche fließend Spanisch']);
    });

    it('rewrites the text and bumps updated_at, keeping the position', () => {
      const row = repo.addProfileFact('Sprech fließend Spanisch');
      const fixed = repo.updateProfileFact(row.id, 'Spreche fließend Spanisch');

      expect(fixed.text).toBe('Spreche fließend Spanisch');
      expect(fixed.position).toBe(row.position);
      expect(fixed.updated_at >= row.created_at).toBe(true);
    });

    it('deletes only the fact asked for', () => {
      const a = repo.addProfileFact('Bleibt');
      const b = repo.addProfileFact('Geht');

      repo.deleteProfileFact(b.id);

      expect(texts()).toContain('Bleibt');
      expect(texts()).not.toContain('Geht');
      expect(count('SELECT COUNT(*) AS n FROM profile_facts WHERE id = ?', a.id)).toBe(1);
    });

    /* The renderer sends the ids in the order the list now reads, so the
       positions are rewritten to match rather than swapped pairwise. */
    it('renumbers positions to the order the ids arrive in', () => {
      const a = repo.addProfileFact('A');
      const b = repo.addProfileFact('B');
      const c = repo.addProfileFact('C');

      const rows = repo.reorderProfileFacts([c.id, a.id, b.id]);

      expect(rows.map((f) => f.text)).toEqual(['C', 'A', 'B']);
      expect(rows.map((f) => f.position)).toEqual([0, 1, 2]);
      expect(texts()).toEqual(['C', 'A', 'B']);
    });

    /* A gap left by a delete must not strand the next reorder — positions are
       assigned from the incoming order, not adjusted from what they were. */
    it('reorders cleanly after a delete left a gap', () => {
      const a = repo.addProfileFact('A');
      const b = repo.addProfileFact('B');
      const c = repo.addProfileFact('C');
      repo.deleteProfileFact(b.id);

      const rows = repo.reorderProfileFacts([c.id, a.id]);

      expect(rows.map((f) => f.text)).toEqual(['C', 'A']);
      expect(rows.map((f) => f.position)).toEqual([0, 1]);
    });
  });

  it('creates people with cycling colors and kind-scoped link replace', () => {
    const p = repo.createPerson({ name: 'Neue Person' });
    expect(p.initials).toBe('NP');
    expect(p.color).toMatch(/^var\(--c-/);
    const links = repo.setApplicationPeople('BEW-24', LinkKind.EMAIL, [p.id]);
    expect(links).toEqual([{ application_id: 'BEW-24', person_id: p.id, kind: LinkKind.EMAIL, position: 0 }]);
    // contact links untouched
    expect(
      count("SELECT COUNT(*) AS n FROM application_people WHERE application_id = 'BEW-24' AND kind = 'POOL'"),
    ).toBe(4);
    repo.deletePerson(p.id);
    expect(count('SELECT COUNT(*) AS n FROM application_people WHERE person_id = ?', p.id)).toBe(0);
  });
});

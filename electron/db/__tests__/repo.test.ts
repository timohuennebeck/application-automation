import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open.ts';
import { seedIfEmpty } from '../seed.ts';
import { createRepo, type Repo } from '../repo.ts';
import {
  Assignee,
  Author,
  DocumentKind,
  DocumentLanguage,
  EditKind,
  FactKind,
  LinkKind,
  RoundState,
} from '../../../src/shared/enums.ts';
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from '../../../src/shared/domain.ts';

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
    /* Nothing is due on the day the card is made: the first nudge waits a week. */
    expect(res.followups.map((f) => f.due_at)).toEqual(['2026-08-19', '2026-08-26', '2026-09-11']);
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
    const later = new Date('2026-08-13T09:00:00.000Z');
    const row = createRepo(db, () => later).setDocumentFile(doc.id, html, pdf, null);

    expect(row).toMatchObject({ file_path: html, pdf_path: pdf });
    /* The first file IS the document's creation: the placeholder row's own
       insert time would make a freshly generated document read as an update. */
    expect(row.created_at).toBe(later.toISOString());
    expect(row.updated_at).toBe(later.toISOString());
  });

  it('keeps created_at when a document that already has a file is replaced', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];
    const first = repo.setDocumentFile(doc.id, 'documents/BEW-45/cover-letter.html', null, null);
    const later = new Date('2026-08-13T09:00:00.000Z');
    const second = createRepo(db, () => later).setDocumentFile(
      doc.id,
      'documents/BEW-45/cover-letter.html',
      null,
      null,
    );
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at).toBe(later.toISOString());
  });

  /* A failed export leaves the source without its rendition; the row has to be
     able to say so rather than keep pointing at a PDF that is not there. */
  it('records an upload whose PDF export failed', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];

    const row = repo.setDocumentFile(doc.id, 'documents/BEW-45/cover-letter.html', null, null);

    expect(row.pdf_path).toBeNull();
    expect(row.file_path).toBe('documents/BEW-45/cover-letter.html');
  });

  it('stores which Fassung a generated document came from, and clears it for a hand-uploaded file', () => {
    const doc = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
      .documents[0];
    const generated = repo.setDocumentFile(doc.id, 'documents/BEW-45/x.html', null, 'Kurz');
    expect(generated.template_label).toBe('Kurz');
    const uploaded = repo.setDocumentFile(doc.id, 'documents/BEW-45/x.html', null, null);
    expect(uploaded.template_label).toBeNull();
  });

  it('creates the letter placeholder as "Anschreiben"', () => {
    const docs = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null }).documents;
    expect(docs.map((d) => d.title)).toEqual(['Anschreiben', 'Lebenslauf']);
  });

  it('starts without summary, posting source or links when the dialog gave none', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });
    expect(res.application.summary).toBeNull();
    expect(res.people).toEqual([]);
    expect(res.application.posting_url).toBeNull();
    expect(res.application.posting_text).toBeNull();
  });

  it('stores the posting URL for Kepler to read later', () => {
    const res = repo.createApplication({
      role: 'Designer',
      company: 'Acme GmbH',
      channel: null,
      postingUrl: 'https://acme.de/jobs/designer',
    });
    expect(res.application.posting_url).toBe('https://acme.de/jobs/designer');
    expect(res.application.posting_text).toBeNull();
  });

  it('stores the pasted posting text when there was no link', () => {
    const res = repo.createApplication({
      role: 'Designer',
      company: 'Acme GmbH',
      channel: null,
      postingText: 'Wir suchen eine:n Designer:in mit Fokus auf Design-Systeme.',
    });
    expect(res.application.posting_text).toBe('Wir suchen eine:n Designer:in mit Fokus auf Design-Systeme.');
    expect(res.application.posting_url).toBeNull();
  });

  /* The paste-text recovery after a blocked fetch saves the listing through
     the ordinary application patch. */
  it('patches the posting text so a blocked fetch can be recovered from', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });

    const row = repo.updateApplication(res.application.id, { posting_text: 'Wir suchen …' });

    expect(row.posting_text).toBe('Wir suchen …');
  });

  /* Assigning Kepler is an ordinary patch; a fresh card belongs to nobody. */
  it('creates cards unassigned and patches the assignee', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });
    expect(res.application.assignee).toBeNull();

    const row = repo.updateApplication(res.application.id, { assignee: Assignee.KEPLER });
    expect(row.assignee).toBe('kepler');

    expect(repo.updateApplication(res.application.id, { assignee: null }).assignee).toBeNull();
  });

  /* Null until Kepler read the posting or the user chose; either writes it. */
  it('creates cards without a language and patches it', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });
    expect(res.application.language).toBeNull();
    expect(repo.updateApplication(res.application.id, { language: DocumentLanguage.EN }).language).toBe('en');
    expect(repo.updateApplication(res.application.id, { language: null }).language).toBeNull();
  });

  it('stores the language chosen in the dialog', () => {
    const res = repo.createApplication({
      role: 'Designer',
      company: 'Acme GmbH',
      channel: null,
      language: DocumentLanguage.EN,
    });
    expect(res.application.language).toBe('en');
  });

  it('hands out an application together with its company', () => {
    const res = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null });
    const ctx = repo.getApplicationWithCompany(res.application.id);
    expect(ctx?.application.id).toBe(res.application.id);
    expect(ctx?.company.name).toBe('Acme GmbH');
    expect(repo.getApplicationWithCompany('BEW-999')).toBeUndefined();
  });

  it('returns the agent run tables in the snapshot', () => {
    const snap = repo.load();
    expect(snap.agentRuns).toEqual([]);
    expect(snap.agentSteps).toEqual([]);
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

  describe('comment edits', () => {
    it('stores a set in order and reads it back', () => {
      const appId = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
        .application.id;
      const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;

      repo.addCommentEdits(comment.id, [
        { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
        { document: DocumentKind.COVER_LETTER, kind: EditKind.DELETE, find: 'c', replace: '', after: 'd' },
      ]);

      const rows = repo.commentEdits(comment.id);
      expect(rows.map((r) => r.position)).toEqual([0, 1]);
      expect(rows[0]).toMatchObject({ kind: EditKind.REPLACE, find_text: 'a', replace_text: 'b' });
      expect(rows[1]).toMatchObject({ kind: EditKind.DELETE, after_text: 'd', undone_at: null });
    });

    it('marks a set undone so the icon can change its meaning', () => {
      const appId = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
        .application.id;
      const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;
      repo.addCommentEdits(comment.id, [
        { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
      ]);

      repo.markEditsUndone(comment.id);

      expect(repo.commentEdits(comment.id).every((r) => r.undone_at !== null)).toBe(true);
    });

    it('carries the edits in the snapshot the renderer loads', () => {
      const appId = repo.createApplication({ role: 'Designer', company: 'Acme GmbH', channel: null })
        .application.id;
      const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;
      repo.addCommentEdits(comment.id, [
        { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
      ]);

      expect(repo.load().commentEdits).toHaveLength(1);
    });
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
    const { person: p } = repo.createPerson({ name: 'Neue Person' });
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

  it('files a person under a company, creating it by name like Firma does', () => {
    const before = count('SELECT COUNT(*) AS n FROM companies');
    const created = repo.createPerson({ name: 'Anna Neu', company: 'Brandneu AG' });
    expect(created.company).not.toBeNull();
    expect(created.company!.name).toBe('Brandneu AG');
    expect(created.person.company_id).toBe(created.company!.id);
    expect(count('SELECT COUNT(*) AS n FROM companies')).toBe(before + 1);

    /* An existing name re-links to the same row rather than duplicating it. */
    const moved = repo.updatePerson(created.person.id, { company: 'Brandneu AG ' });
    expect(moved.company!.id).toBe(created.company!.id);
    expect(count('SELECT COUNT(*) AS n FROM companies')).toBe(before + 1);

    /* Clearing detaches; the company row itself stays. */
    const cleared = repo.updatePerson(created.person.id, { company: null });
    expect(cleared.person.company_id).toBeNull();
    expect(cleared.company).toBeNull();
    expect(count('SELECT COUNT(*) AS n FROM companies')).toBe(before + 1);

    /* A patch that leaves company out keeps it. */
    repo.updatePerson(created.person.id, { company: 'Brandneu AG' });
    expect(repo.updatePerson(created.person.id, { role: 'CTO' }).person.company_id).toBe(created.company!.id);
  });

  it('keeps the placeholder company only while a card needs it', () => {
    const { application } = repo.createApplication({ role: 'X', company: '', channel: null });
    const has = () => count('SELECT COUNT(*) AS n FROM companies WHERE name = ?', UNKNOWN_COMPANY);
    expect(has()).toBe(1);
    repo.relinkCompany(application.id, 'Echte GmbH');
    expect(has()).toBe(0);
    repo.relinkCompany(application.id, UNKNOWN_COMPANY);
    expect(has()).toBe(1);
    repo.deleteApplication(application.id);
    expect(has()).toBe(0);
  });

  it('deletes an unused company and detaches its people, but refuses one with cards', () => {
    const { person, company } = repo.createPerson({ name: 'Otto', company: 'Weg GmbH' });
    repo.deleteCompany(company!.id);
    expect(count('SELECT COUNT(*) AS n FROM companies WHERE id = ?', company!.id)).toBe(0);
    expect(repo.load().people.find((p) => p.id === person.id)?.company_id).toBeNull();

    const app = repo.createApplication({ role: 'X', company: 'Bleibt AG', channel: null });
    expect(() => repo.deleteCompany(app.company.id)).toThrow(/verwendet/);
    expect(count('SELECT COUNT(*) AS n FROM companies WHERE id = ?', app.company.id)).toBe(1);
  });

  it('keeps a Standort vocabulary: seeded from the cards, grown by writes, pruned when unused', () => {
    const names = () => repo.load().locations.map((l) => l.name);
    /* Every seeded card has a Standort, so the vocabulary starts populated. */
    expect(names()).toContain('Berlin');

    repo.upsertFact('BEW-24', 'Standort', ' Bielefeld ', null);
    expect(names()).toContain('Bielefeld');
    expect(() => repo.deleteLocation('Bielefeld')).toThrow(/verwendet/);

    repo.upsertFact('BEW-24', 'Standort', 'Berlin', null);
    repo.deleteLocation('Bielefeld');
    expect(names()).not.toContain('Bielefeld');
    /* Clearing a card's Standort does not touch the vocabulary. */
    repo.upsertFact('BEW-24', 'Standort', '', null);
    expect(names()).toContain('Berlin');
  });

  it('keeps a Berufsbezeichnung vocabulary fed by cards and people, pruned when unused', () => {
    const names = () => repo.load().roles.map((r) => r.name);
    expect(names().length).toBeGreaterThan(0);

    const app = repo.createApplication({ role: 'Staff Engineer', company: 'Acme', channel: null });
    expect(names()).toContain('Staff Engineer');
    /* The placeholder of a card without a role is not a role anyone picks. */
    repo.createApplication({ role: UNKNOWN_ROLE, company: 'Acme', channel: null });
    expect(names()).not.toContain(UNKNOWN_ROLE);
    expect(() => repo.deleteRole('Staff Engineer')).toThrow(/verwendet/);

    repo.updateApplication(app.application.id, { role: 'Principal Engineer' });
    const { person } = repo.createPerson({ name: 'Rita', role: 'Staff Engineer' });
    expect(() => repo.deleteRole('Staff Engineer')).toThrow(/verwendet/);
    repo.updatePerson(person.id, { role: 'Recruiterin' });
    repo.deleteRole('Staff Engineer');
    expect(names()).not.toContain('Staff Engineer');
    expect(names()).toEqual(expect.arrayContaining(['Principal Engineer', 'Recruiterin']));
  });

  it('stores roles without their gender marker so the vocabulary does not fork', () => {
    const names = () => repo.load().roles.map((r) => r.name);
    const a = repo.createApplication({
      role: 'Frontend Engineer (all genders)',
      company: 'Acme',
      channel: null,
    });
    const b = repo.createApplication({ role: 'Frontend Engineer (m/w/d)', company: 'Acme', channel: null });
    expect(a.application.role).toBe('Frontend Engineer');
    expect(b.application.role).toBe('Frontend Engineer');
    expect(names().filter((n) => n.startsWith('Frontend Engineer'))).toEqual(['Frontend Engineer']);

    const updated = repo.updateApplication(a.application.id, { role: 'Backend Engineer m/w/d' });
    expect(updated.role).toBe('Backend Engineer');

    const { person } = repo.createPerson({ name: 'Rita', role: 'Recruiter*in (m/w/d)' });
    expect(person.role).toBe('Recruiter');
    expect(repo.updatePerson(person.id, { role: 'Talent Partner (gn)' }).person.role).toBe('Talent Partner');
    expect(names()).toEqual(expect.arrayContaining(['Backend Engineer', 'Recruiter', 'Talent Partner']));
    expect(names()).not.toContain('Talent Partner (gn)');
  });

  it('nulls a person’s company when the company row goes away', () => {
    const { person, company } = repo.createPerson({ name: 'Otto', company: 'Weg GmbH' });
    db.prepare('DELETE FROM companies WHERE id = ?').run(company!.id);
    expect(repo.load().people.find((p) => p.id === person.id)?.company_id).toBeNull();
  });
});

describe('seed', () => {
  it('files every linked person under a company', () => {
    const { people, applicationPeople, applications } = repo.load();
    const linked = new Set(applicationPeople.map((l) => l.person_id));
    for (const p of people.filter((p) => linked.has(p.id))) {
      const appIds = applicationPeople.filter((l) => l.person_id === p.id).map((l) => l.application_id);
      const companyIds = applications.filter((a) => appIds.includes(a.id)).map((a) => a.company_id);
      expect(companyIds).toContain(p.company_id);
    }
  });
});

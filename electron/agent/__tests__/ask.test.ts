import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { documentPaths } from '../../files.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { createAskService } from '../ask.ts';
import { KeplerError } from '../errors.ts';
import type { LlmRequest } from '../orchestrator.ts';
import { Author, DocumentKind, DocumentLanguage, RoundState } from '../../../src/shared/enums.ts';

const NOW = new Date('2026-08-16T09:00:00.000Z');

/* A fresh directory per test file, not per test: writeLetter() re-points the
   row at the same path every time, so a stale file from an earlier test never
   leaks in. */
const ROOT = mkdtempSync(path.join(tmpdir(), 'bew-ask-'));

let db: DatabaseSync;
let repo: Repo;
let runs: RunStore;

beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
  repo = createRepo(db, () => NOW);
  runs = createRunStore(db, () => NOW);
});

const createApp = () =>
  repo.createApplication({
    role: 'Senior Frontend Developer',
    company: 'Personio SE',
    channel: 'LinkedIn',
    postingText: 'Wir suchen jemanden für React und Expo.',
  }).application.id;

const ask = (id: string, text: string) => repo.addComment(id, Author.DU, text).comment.id;

/* A generated Anschreiben on disk with its row pointed at it — the shape
   ask() reads and writes. */
function writeLetter(appId: string, html: string): void {
  const { htmlAbs, htmlRel } = documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE);
  mkdirSync(path.dirname(htmlAbs), { recursive: true });
  writeFileSync(htmlAbs, html);
  const row = repo
    .load()
    .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
  repo.setDocumentFile(row.id, htmlRel, null, 'Standard');
}

const readLetter = (appId: string) =>
  readFileSync(documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE).htmlAbs, 'utf8');

/* Same shape, the other document — for the cross-document all-or-nothing
   test, which needs two files on disk to prove one group's failure leaves
   the other's untouched. */
function writeCv(appId: string, html: string): void {
  const { htmlAbs, htmlRel } = documentPaths(ROOT, appId, DocumentKind.LEBENSLAUF, DocumentLanguage.DE);
  mkdirSync(path.dirname(htmlAbs), { recursive: true });
  writeFileSync(htmlAbs, html);
  const row = repo
    .load()
    .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.LEBENSLAUF)!;
  repo.setDocumentFile(row.id, htmlRel, null, 'Standard');
}

const readCv = (appId: string) =>
  readFileSync(documentPaths(ROOT, appId, DocumentKind.LEBENSLAUF, DocumentLanguage.DE).htmlAbs, 'utf8');

/* Stands in for the SDK call: hands back whatever the validator makes of
   `answer`, so the service's own behaviour is what is under test. */
const renderPdf = vi.fn(async () => undefined);
const service = (answer: unknown, onPrompt?: (p: string) => void) =>
  createAskService({
    repo,
    runs,
    userDataPath: ROOT,
    renderPdf,
    llm: (async (req: LlmRequest<unknown>) => {
      onPrompt?.(req.prompt);
      return req.validate(answer);
    }) as Parameters<typeof createAskService>[0]['llm'],
  });

const ANSWER = { antwort: 'Kurz: **zwei** Runden, beide gut gelaufen.' };

describe('ask service', () => {
  it('writes the answer into the thread as a Kepler comment and hands it back', async () => {
    const id = createApp();
    const commentId = ask(id, '@Kepler wie stehen wir?');
    const res = await service(ANSWER).ask({ applicationId: id, commentId, openDocument: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.comment.author).toBe(Author.KEPLER);
    expect(res.comment.text).toBe('Kurz: **zwei** Runden, beide gut gelaufen.');
    const thread = repo.load().comments.filter((c) => c.application_id === id);
    expect(thread.map((c) => c.author)).toEqual([Author.KEPLER, Author.DU, Author.KEPLER]);
  });

  it('shows Kepler the card, the thread and the interviews with their notes', async () => {
    const id = createApp();
    const { person } = repo.createPerson({ name: 'Anna Weber', role: 'Recruiterin' });
    repo.setApplicationPeople(id, 'CONTACT', [person.id]);
    const { rounds } = repo.setRounds(id, [
      {
        state: RoundState.DONE,
        title: 'Erstgespräch',
        stage: null,
        scheduled_date: '2026-08-12',
        start_time: null,
        end_time: null,
        location: 'Remote',
        link: null,
        people: [person.id],
      },
    ]);
    repo.addRoundNote(rounds[0].id, Author.DU, 'Gehalt: 85k möglich.');
    repo.addComment(id, Author.DU, 'Erster Eindruck gut.');
    const commentId = ask(id, '@Kepler fass die Interviews zusammen');

    let prompt = '';
    await service(ANSWER, (p) => (prompt = p)).ask({ applicationId: id, commentId, openDocument: null });
    expect(prompt).toContain('"Senior Frontend Developer" bei Personio SE');
    expect(prompt).toContain('@Timo');
    expect(prompt).toContain('- Anna Weber — Recruiterin');
    expect(prompt).toContain('Erster Eindruck gut.');
    expect(prompt).toContain('Du (16.08.2026) [diese Frage]:\n@Kepler fass die Interviews zusammen');
    expect(prompt).toContain('## Erstgespräch — erledigt, 12.08.2026, Remote\nTeilnehmer: Anna Weber');
    expect(prompt).toContain('Gehalt: 85k möglich.');
    /* The listing and the documents stay out: Kepler answers about the card,
       it does not review texts. */
    expect(prompt).not.toContain('Wir suchen jemanden für React und Expo.');
  });

  it('refuses an unknown card or comment without calling the model', async () => {
    const id = createApp();
    const llm = vi.fn();
    const svc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: llm as unknown as Parameters<typeof createAskService>[0]['llm'],
    });
    expect(await svc.ask({ applicationId: 'BEW-999', commentId: 1, openDocument: null })).toEqual({
      ok: false,
      error: 'Unbekannte Bewerbung.',
    });
    expect(await svc.ask({ applicationId: id, commentId: 999_999, openDocument: null })).toEqual({
      ok: false,
      error: 'Kommentar nicht gefunden.',
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it('stands aside while Kepler is running on that card', async () => {
    const id = createApp();
    const commentId = ask(id, '@Kepler?');
    runs.createRun(id, 'Kepler wartet…', [{ key: 'FETCH', label: 'Anzeige holen' }]);
    expect(await service(ANSWER).ask({ applicationId: id, commentId, openDocument: null })).toEqual({
      ok: false,
      error: 'Kepler arbeitet bereits an dieser Bewerbung.',
    });
  });

  it('answers the questions of one card in order, one after the other', async () => {
    const id = createApp();
    const first = ask(id, '@Kepler eins');
    const second = ask(id, '@Kepler zwei');
    const releases: Array<(v: unknown) => void> = [];
    const svc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate(await new Promise((r) => releases.push(r)))) as Parameters<
        typeof createAskService
      >[0]['llm'],
    });

    const a = svc.ask({ applicationId: id, commentId: first, openDocument: null });
    const b = svc.ask({ applicationId: id, commentId: second, openDocument: null });
    await Promise.resolve();
    /* The second waits for the first — only one call is in the air. */
    expect(releases).toHaveLength(1);

    releases[0]({ antwort: 'Antwort eins' });
    expect(await a).toMatchObject({ ok: true, comment: { text: 'Antwort eins' } });
    await Promise.resolve();
    expect(releases).toHaveLength(2);
    releases[1]({ antwort: 'Antwort zwei' });
    expect(await b).toMatchObject({ ok: true, comment: { text: 'Antwort zwei' } });

    const thread = repo.load().comments.filter((c) => c.application_id === id && c.author === Author.KEPLER);
    expect(thread.map((c) => c.text).slice(-2)).toEqual(['Antwort eins', 'Antwort zwei']);
  });

  it('stop ends the call in the air without writing, and the next question still gets through', async () => {
    const id = createApp();
    const first = ask(id, '@Kepler eins');
    const signals: AbortSignal[] = [];
    const svc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: (async (req: LlmRequest<unknown>) => {
        signals.push(req.signal!);
        return new Promise((_resolve, reject) => {
          req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
        });
      }) as Parameters<typeof createAskService>[0]['llm'],
    });

    const pending = svc.ask({ applicationId: id, commentId: first, openDocument: null });
    await Promise.resolve();
    expect(signals).toHaveLength(1);
    svc.stop(id);
    expect(await pending).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(
      repo.load().comments.filter((c) => c.application_id === id && c.author === Author.KEPLER),
    ).toHaveLength(1);
    expect((await service(ANSWER).ask({ applicationId: id, commentId: first, openDocument: null })).ok).toBe(
      true,
    );
  });

  it('writes nothing when the card went away while the model was thinking', async () => {
    const id = createApp();
    const commentId = ask(id, '@Kepler?');
    let release!: (v: unknown) => void;
    const svc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate(await new Promise((r) => (release = r)))) as Parameters<
        typeof createAskService
      >[0]['llm'],
    });
    const pending = svc.ask({ applicationId: id, commentId, openDocument: null });
    await Promise.resolve();
    repo.deleteApplication(id);
    release(ANSWER);
    expect(await pending).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(repo.load().comments.some((c) => c.application_id === id)).toBe(false);
  });
});

describe('a comment that mentions a document', () => {
  it('hands the document text to the model', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler was steht im @Anschreiben?');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(llm.mock.calls[0][0].prompt).toContain('Engineering Hiring Team');
  });

  it('applies the edits, re-renders the PDF and stores the set', async () => {
    const { service, repo, appId, renderPdf } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Maria Haushofer',
            after: null,
          },
        ],
      },
    });
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');

    const res = await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(res.ok).toBe(true);
    expect(readLetter(appId)).toContain('Frau Maria Haushofer');
    expect(renderPdf).toHaveBeenCalled();
    const reply = repo.load().comments.at(-1)!;
    expect(repo.commentEdits(reply.id)).toHaveLength(1);
    /* The card must point at the freshly rendered PDF, not whatever it had
       before the edit. */
    const row = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    expect(row.pdf_path).toBe(
      documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE).pdfRel,
    );
  });

  it('clears pdf_path when the re-render after an edit fails', async () => {
    const { service, repo, appId, renderPdf } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Maria Haushofer',
            after: null,
          },
        ],
      },
    });
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    /* Simulates a PDF that already exists from an earlier, successful render
       — the case the old bug got wrong: it left this stale path in place
       instead of clearing it, so proving the fix needs a non-null path to
       start from. */
    const { htmlRel, pdfRel } = documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE);
    const before = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    repo.setDocumentFile(before.id, htmlRel, pdfRel, 'Standard');

    renderPdf.mockRejectedValueOnce(new Error('Chromium ist abgestürzt'));
    const comment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    /* The HTML still carries the edit — losing it would be worse than a
       missing PDF — but the card must not advertise a PDF whose text is the
       pre-edit text while the HTML underneath it has already moved on. */
    expect(readLetter(appId)).toContain('Frau Maria Haushofer');
    const after = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    expect(after.pdf_path).toBeNull();
  });

  it('changes nothing when a passage cannot be placed', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Ich ändere das.',
        edits: [
          { document: 'COVER_LETTER', kind: 'replace', find: 'gibt es nicht', replace: 'X', after: null },
        ],
      },
    });
    const original = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    writeLetter(appId, original);
    const comment = addComment(appId, '@Kepler ändere das @Anschreiben');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(readLetter(appId)).toBe(original);
    const reply = repo.load().comments.at(-1)!;
    expect(repo.commentEdits(reply.id)).toHaveLength(0);
    expect(reply.text).toContain('gibt es nicht');
  });

  it('leaves every document untouched when one of several groups cannot be placed', async () => {
    /* The plan-then-write split is the load-bearing line of the design: an
       implementation that wrote each group as it went would pass every other
       test here and still fail this one. */
    const { service, appId } = fixture({
      answer: {
        antwort: 'Ich ändere beides.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Haushofer',
            after: null,
          },
          { document: 'LEBENSLAUF', kind: 'replace', find: 'gibt es nicht', replace: 'X', after: null },
        ],
      },
    });
    const letterOriginal = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    const cvOriginal = '<p>Lebenslauf-Inhalt</p>';
    writeLetter(appId, letterOriginal);
    writeCv(appId, cvOriginal);
    const comment = addComment(appId, '@Kepler trag Maria im @Anschreiben und @Lebenslauf ein');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    /* The Anschreiben's edit lands fine in isolation — it must still be
       refused because the Lebenslauf's does not. */
    expect(readLetter(appId)).toBe(letterOriginal);
    expect(readCv(appId)).toBe(cvOriginal);
  });

  it('an unreadable document turns into a German reason, not a throw that poisons the queue', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Ich ändere das.',
        edits: [{ document: 'COVER_LETTER', kind: 'replace', find: 'X', replace: 'Y', after: null }],
      },
    });
    /* Points the row at a file that was never written — the plan phase's
       read must turn into a German reason, not a throw that would reject
       the promise and poison the chain for whatever is queued behind it.
       Application ids are reused across tests (each starts from a fresh
       in-memory db), but the temp directory is shared for the whole file, so
       an earlier test's file at this same path is removed first. */
    const { htmlAbs, htmlRel } = documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE);
    rmSync(htmlAbs, { force: true });
    const row = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    repo.setDocumentFile(row.id, htmlRel, null, 'Standard');
    const first = addComment(appId, '@Kepler ändere das @Anschreiben');
    const second = addComment(appId, '@Kepler nochmal, bitte');

    const a = service.ask({ applicationId: appId, commentId: first.id, openDocument: null });
    const b = service.ask({ applicationId: appId, commentId: second.id, openDocument: null });

    const resA = await a;
    expect(resA.ok).toBe(true);
    if (resA.ok) expect(resA.comment.text).toContain('ist nicht mehr da');

    /* The point: the second call still gets answered rather than inheriting
       a rejection from the first. */
    const resB = await b;
    expect(resB.ok).toBe(true);
    /* createApplication itself leaves a "Karte angelegt" Kepler comment —
       counted alongside the two replies rather than filtered out by hand. */
    const replies = repo
      .load()
      .comments.filter((c) => c.application_id === appId && c.text.includes('ist nicht mehr da'));
    expect(replies).toHaveLength(2);
  });

  it('refuses while the document is open in the editor, without calling the model', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Text</p>');
    const comment = addComment(appId, '@Kepler kürze das @Anschreiben');

    const res = await service.ask({
      applicationId: appId,
      commentId: comment.id,
      openDocument: DocumentKind.COVER_LETTER,
    });

    expect(res.ok).toBe(false);
    expect(llm).not.toHaveBeenCalled();
  });

  /* The design's driving case, end to end. "Engineering Hiring Team" stands in
     both the recipient block and the salutation, so the only thing that can
     tell them apart is the markup around them — a model reading flattened
     prose could not write a quote that both is unique and matches the file,
     and the feature refused its own headline request. */
  it('gives the model markup it can quote a unique passage out of, and places it', async () => {
    const original =
      '<!doctype html><html><head><style>body{font-family:Inter}</style></head><body>' +
      '<p class="recipient">Engineering Hiring Team</p>' +
      '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>' +
      '<p>ich bewerbe mich auf die ausgeschriebene Stelle.</p>' +
      '</body></html>';
    const { service, appId, llm } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: '<p class="recipient">Engineering Hiring Team</p>',
            replace: '<p class="recipient">Frau Maria Haushofer</p>',
            after: null,
          },
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>',
            replace: '<p class="salutation">Sehr geehrte Frau Haushofer,</p>',
            after: null,
          },
        ],
      },
    });
    writeLetter(appId, original);
    const comment = addComment(appId, '@Kepler trag Maria Haushofer im @Anschreiben ein');

    const res = await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    /* What the model was given has to be what the file holds, byte for byte —
       otherwise the quote it writes back cannot match. */
    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('<p class="recipient">Engineering Hiring Team</p>');
    expect(prompt).toContain('<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>');
    expect(prompt).not.toContain('font-family');

    expect(res.ok).toBe(true);
    expect(readLetter(appId)).toBe(
      '<!doctype html><html><head><style>body{font-family:Inter}</style></head><body>' +
        '<p class="recipient">Frau Maria Haushofer</p>' +
        '<p class="salutation">Sehr geehrte Frau Haushofer,</p>' +
        '<p>ich bewerbe mich auf die ausgeschriebene Stelle.</p>' +
        '</body></html>',
    );
  });

  it('leaves the first document untouched when a later one cannot be written', async () => {
    /* Not the same failure as a passage that will not place: both groups plan
       fine, and the write itself throws. Written straight through, the
       Anschreiben would be changed on disk while the throw carries past the
       comment and past addCommentEdits — a changed document, a silent thread
       and no set to undo. Staging every file beside its target and renaming
       only once all of them exist is what keeps that from happening; the temp
       suffix is named here because that is the only way to make the second
       write fail on demand. */
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Ich ändere beides.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Haushofer',
            after: null,
          },
          { document: 'LEBENSLAUF', kind: 'replace', find: 'Inhalt', replace: 'Neues', after: null },
        ],
      },
    });
    const letterOriginal = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    writeLetter(appId, letterOriginal);
    writeCv(appId, '<p>Lebenslauf-Inhalt</p>');
    /* A directory where the Lebenslauf's temp file wants to go: writeFileSync
       throws EISDIR, after the Anschreiben has already been staged. */
    const cvTmp =
      documentPaths(ROOT, appId, DocumentKind.LEBENSLAUF, DocumentLanguage.DE).htmlAbs + '.kepler-tmp';
    mkdirSync(cvTmp, { recursive: true });
    const comment = addComment(appId, '@Kepler ändere @Anschreiben und @Lebenslauf');

    const res = await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(res.ok).toBe(false);
    expect(readLetter(appId)).toBe(letterOriginal);
    /* And nothing half-written left lying beside it. */
    expect(
      existsSync(
        documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE).htmlAbs + '.kepler-tmp',
      ),
    ).toBe(false);
    expect(
      repo.load().comments.filter((c) => c.author === Author.KEPLER && c.text === 'Ich ändere beides.'),
    ).toHaveLength(0);
    rmSync(cvTmp, { recursive: true, force: true });
  });

  it('ignores a document that was not mentioned', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler wie ist der Stand?');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(llm.mock.calls[0][0].prompt).not.toContain('Engineering Hiring Team');
  });
});

describe('undo', () => {
  it('puts the document back and marks the set undone', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Maria Haushofer',
            after: null,
          },
        ],
      },
    });
    const original = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    writeLetter(appId, original);
    const comment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');
    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });
    const reply = repo.load().comments.at(-1)!;

    await service.undo(appId, reply.id, null);

    expect(readLetter(appId)).toBe(original);
    expect(repo.commentEdits(reply.id).every((r) => r.undone_at !== null)).toBe(true);
  });

  it('refuses to undo a set twice', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [{ document: 'COVER_LETTER', kind: 'replace', find: 'alt', replace: 'neu', after: null }],
      },
    });
    writeLetter(appId, '<p>alt</p>');
    const comment = addComment(appId, '@Kepler ändere das @Anschreiben');
    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });
    const reply = repo.load().comments.at(-1)!;
    await service.undo(appId, reply.id, null);

    const again = await service.undo(appId, reply.id, null);

    expect(again.ok).toBe(false);
  });

  it('waits for an in-flight ask instead of racing it', async () => {
    const appId = createApp();
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');

    /* Setup: an already-applied edit, awaited normally, gives undo() something
       to reverse. */
    const setupComment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');
    const setupSvc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate({
          antwort: 'Eingetragen.',
          edits: [
            {
              document: 'COVER_LETTER',
              kind: 'replace',
              find: 'Engineering Hiring Team',
              replace: 'Frau Maria Haushofer',
              after: null,
            },
          ],
        })) as Parameters<typeof createAskService>[0]['llm'],
    });
    await setupSvc.ask({ applicationId: appId, commentId: setupComment.id, openDocument: null });
    const reply = repo.load().comments.at(-1)!;

    /* A second ask, held open by a deferred llm response, builds on that
       edit's result; undo() is queued right behind it. */
    let release!: (v: unknown) => void;
    const secondComment = addComment(appId, '@Kepler mach daraus eine Doktorin');
    const svc = createAskService({
      repo,
      runs,
      userDataPath: ROOT,
      renderPdf,
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate(await new Promise((r) => (release = r)))) as Parameters<
        typeof createAskService
      >[0]['llm'],
    });
    const askPending = svc.ask({ applicationId: appId, commentId: secondComment.id, openDocument: null });
    await Promise.resolve();
    const undoPending = svc.undo(appId, reply.id, null);

    release({
      antwort: 'Gemacht.',
      edits: [
        {
          document: 'COVER_LETTER',
          kind: 'replace',
          find: 'Frau Maria Haushofer',
          replace: 'Frau Dr. Haushofer',
          after: null,
        },
      ],
    });
    const askResult = await askPending;
    const undoResult = await undoPending;

    /* The ask, already in flight when undo was called, has to land first —
       undo then tries to reverse a passage the ask has since changed, and
       refuses rather than silently discarding the ask's write. Had undo
       raced ahead instead, it would have found "Frau Maria Haushofer" intact
       and succeeded, which is exactly the bug this locks out. */
    expect(askResult.ok).toBe(true);
    expect(readLetter(appId)).toBe('<p>Sehr geehrtes Frau Dr. Haushofer,</p>');
    expect(undoResult.ok).toBe(false);
  });
});

/* A ready-to-use app, service and comment helper for the mention/undo tests
   below — those need a document on disk and a service they can inspect the
   calls of, which the plain `service()` fixture above does not expose. */
function fixture(opts: { answer?: unknown } = {}) {
  const appId = createApp();
  const llm = vi.fn(async (req: LlmRequest<unknown>) => req.validate(opts.answer ?? ANSWER));
  const renderPdf = vi.fn(async () => undefined);
  const svc = createAskService({
    repo,
    runs,
    userDataPath: ROOT,
    renderPdf,
    llm: llm as unknown as Parameters<typeof createAskService>[0]['llm'],
  });
  return { service: svc, repo, appId, llm, renderPdf };
}

const addComment = (appId: string, text: string) => repo.addComment(appId, Author.DU, text).comment;

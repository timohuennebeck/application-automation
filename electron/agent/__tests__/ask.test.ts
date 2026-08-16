import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { createAskService } from '../ask.ts';
import { KeplerError } from '../errors.ts';
import type { LlmRequest } from '../orchestrator.ts';
import { Author, RoundState } from '../../../src/shared/enums.ts';

const NOW = new Date('2026-08-16T09:00:00.000Z');

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

/* Stands in for the SDK call: hands back whatever the validator makes of
   `answer`, so the service's own behaviour is what is under test. */
const service = (answer: unknown, onPrompt?: (p: string) => void) =>
  createAskService({
    repo,
    runs,
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
    const res = await service(ANSWER).ask({ applicationId: id, commentId });
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
    await service(ANSWER, (p) => (prompt = p)).ask({ applicationId: id, commentId });
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
      llm: llm as unknown as Parameters<typeof createAskService>[0]['llm'],
    });
    expect(await svc.ask({ applicationId: 'BEW-999', commentId: 1 })).toEqual({
      ok: false,
      error: 'Unbekannte Bewerbung.',
    });
    expect(await svc.ask({ applicationId: id, commentId: 999_999 })).toEqual({
      ok: false,
      error: 'Kommentar nicht gefunden.',
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it('stands aside while Kepler is running on that card', async () => {
    const id = createApp();
    const commentId = ask(id, '@Kepler?');
    runs.createRun(id, 'Kepler wartet…', [{ key: 'FETCH', label: 'Anzeige holen' }]);
    expect(await service(ANSWER).ask({ applicationId: id, commentId })).toEqual({
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
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate(await new Promise((r) => releases.push(r)))) as Parameters<
        typeof createAskService
      >[0]['llm'],
    });

    const a = svc.ask({ applicationId: id, commentId: first });
    const b = svc.ask({ applicationId: id, commentId: second });
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
      llm: (async (req: LlmRequest<unknown>) => {
        signals.push(req.signal!);
        return new Promise((_resolve, reject) => {
          req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
        });
      }) as Parameters<typeof createAskService>[0]['llm'],
    });

    const pending = svc.ask({ applicationId: id, commentId: first });
    await Promise.resolve();
    expect(signals).toHaveLength(1);
    svc.stop(id);
    expect(await pending).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(
      repo.load().comments.filter((c) => c.application_id === id && c.author === Author.KEPLER),
    ).toHaveLength(1);
    expect((await service(ANSWER).ask({ applicationId: id, commentId: first })).ok).toBe(true);
  });

  it('writes nothing when the card went away while the model was thinking', async () => {
    const id = createApp();
    const commentId = ask(id, '@Kepler?');
    let release!: (v: unknown) => void;
    const svc = createAskService({
      repo,
      runs,
      llm: (async (req: LlmRequest<unknown>) =>
        req.validate(await new Promise((r) => (release = r)))) as Parameters<
        typeof createAskService
      >[0]['llm'],
    });
    const pending = svc.ask({ applicationId: id, commentId });
    await Promise.resolve();
    repo.deleteApplication(id);
    release(ANSWER);
    expect(await pending).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(repo.load().comments.some((c) => c.application_id === id)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { createVariantsService } from '../variants.ts';
import { KeplerError } from '../errors.ts';
import type { LlmRequest } from '../orchestrator.ts';

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

/* Stands in for the SDK call: hands back whatever the validator makes of
   `answer`, so the service's own behaviour is what is under test. */
const service = (answer: unknown, onPrompt?: (p: string) => void) =>
  createVariantsService({
    repo,
    runs,
    userDataPath: '/nowhere',
    llm: (async (req: LlmRequest<unknown>) => {
      onPrompt?.(req.prompt);
      return req.validate(answer);
    }) as Parameters<typeof createVariantsService>[0]['llm'],
  });

const REQUEST = {
  callId: '1',
  passage: 'Personio nimmt Unternehmen die Personalarbeit ab.',
  letter: 'Sehr geehrte Frau Weber, Personio nimmt Unternehmen die Personalarbeit ab.',
  instruction: null,
};

const THREE = { variants: ['eins', 'zwei', 'drei'] };

/* A service whose calls hang until their signal fires, collecting the signals
   so a test can see which ones a stop actually reached. Stands in for the SDK,
   which rejects when its signal fires. */
const abortingService = (signals: AbortSignal[]) =>
  createVariantsService({
    repo,
    runs,
    userDataPath: '/nowhere',
    llm: (async (req: LlmRequest<unknown>) => {
      signals.push(req.signal!);
      return new Promise((_resolve, reject) => {
        req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
      });
    }) as Parameters<typeof createVariantsService>[0]['llm'],
  });

describe('variants service', () => {
  it('answers with the suggestions and asks with the passage in the prompt', async () => {
    const id = createApp();
    let prompt = '';
    const res = await service(THREE, (p) => (prompt = p)).suggest({
      applicationId: id,
      ...REQUEST,
    });
    expect(res).toEqual({ ok: true, variants: ['eins', 'zwei', 'drei'] });
    expect(prompt).toContain('Personio nimmt Unternehmen die Personalarbeit ab.');
    expect(prompt).toContain('Wir suchen jemanden für React und Expo.');
  });

  it('refuses an unknown card and an empty passage without calling the model', async () => {
    const id = createApp();
    const llm = vi.fn();
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: llm as unknown as Parameters<typeof createVariantsService>[0]['llm'],
    });
    expect(await svc.suggest({ applicationId: 'BEW-999', ...REQUEST })).toEqual({
      ok: false,
      error: 'Unbekannte Bewerbung.',
    });
    expect(await svc.suggest({ applicationId: id, ...REQUEST, passage: '   ' })).toEqual({
      ok: false,
      error: 'Keine Stelle markiert.',
    });
    expect(llm).not.toHaveBeenCalled();
  });

  /* A run rewrites the whole letter from the template. Letting a rewrite land
     while that is in flight would put a suggestion into a file about to be
     replaced — the user would watch their choice disappear. */
  it('stands aside while Kepler is running on that card', async () => {
    const id = createApp();
    runs.createRun(id, 'Kepler wartet…', [{ key: 'FETCH', label: 'Anzeige holen' }]);
    const res = await service(THREE).suggest({ applicationId: id, ...REQUEST });
    expect(res).toEqual({ ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' });
  });

  /* Several passages at once is the point: the model takes seconds, and a
     single slot meant marking the next one had to wait out the first. */
  it('lets three rewrites run at the same time and refuses the fourth', async () => {
    const id = createApp();
    let started = 0;
    let release!: (v: unknown) => void;
    const pending = new Promise((resolve) => (release = resolve));
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: (async (req: LlmRequest<unknown>) => {
        started++;
        return req.validate(await pending);
      }) as Parameters<typeof createVariantsService>[0]['llm'],
    });

    const inFlight = [1, 2, 3].map(() => svc.suggest({ applicationId: id, ...REQUEST }));
    await Promise.resolve();
    expect(started).toBe(3);

    const fourth = await svc.suggest({ applicationId: id, ...REQUEST });
    expect(fourth).toEqual({ ok: false, error: 'Kepler schreibt schon an 3 Stellen — kurz warten.' });
    expect(started).toBe(3);

    release(THREE);
    for (const settled of await Promise.all(inFlight)) {
      expect(settled).toEqual({ ok: true, variants: ['eins', 'zwei', 'drei'] });
    }
    /* The slots come back once they settle. */
    expect((await svc.suggest({ applicationId: id, ...REQUEST })).ok).toBe(true);
  });

  /* Closing the editor must actually end the calls. Left running they would
     hold their slots for the full timeout, so reopening the letter and marking
     three passages would be refused by work nobody is waiting for. */
  it('aborts the calls a card has in the air and gives their slots back', async () => {
    const id = createApp();
    const signals: AbortSignal[] = [];
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: (async (req: LlmRequest<unknown>) => {
        signals.push(req.signal!);
        /* Stands in for the SDK, which rejects when its signal fires. */
        return new Promise((_resolve, reject) => {
          req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
        });
      }) as Parameters<typeof createVariantsService>[0]['llm'],
    });

    const inFlight = [1, 2, 3].map(() => svc.suggest({ applicationId: id, ...REQUEST }));
    await Promise.resolve();
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    /* All three slots are taken. */
    expect((await svc.suggest({ applicationId: id, ...REQUEST })).ok).toBe(false);

    svc.stop(id);
    expect(signals.every((s) => s.aborted)).toBe(true);
    for (const settled of await Promise.all(inFlight)) {
      expect(settled).toEqual({ ok: false, error: 'Abgebrochen.' });
    }

    /* And the slots are free again straight away, not after a timeout. */
    const after = await service(THREE).suggest({ applicationId: id, ...REQUEST });
    expect(after.ok).toBe(true);
  });

  it('stops one rewrite by its call id and leaves the others on that card running', async () => {
    /* The editor puts a stop on every passage it is waiting for, so a stop has
       to mean that passage — not everything the card has in the air. */
    const id = createApp();
    const signals: AbortSignal[] = [];
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: (async (req: LlmRequest<unknown>) => {
        signals.push(req.signal!);
        return new Promise((_r, reject) => {
          req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
        });
      }) as Parameters<typeof createVariantsService>[0]['llm'],
    });
    const first = svc.suggest({ applicationId: id, ...REQUEST, callId: 'a' });
    const second = svc.suggest({ applicationId: id, ...REQUEST, callId: 'b' });
    await Promise.resolve();
    expect(signals).toHaveLength(2);

    svc.stop(id, 'a');

    expect(await first).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(signals[1].aborted).toBe(false);
    svc.stop(id);
    await second;
  });

  /* The bookkeeping used to be a map keyed by callId, cleaned up by key. Both
     of these walked through the gap that left: an entry removed by whoever
     happened to finish first, rather than by the call that owned it. */
  it('still stops the rest of a card after one call was stopped by name', async () => {
    const id = createApp();
    const signals: AbortSignal[] = [];
    const svc = abortingService(signals);

    const first = svc.suggest({ applicationId: id, ...REQUEST, callId: 'a' });
    await Promise.resolve();
    svc.stop(id, 'a');
    expect(await first).toEqual({ ok: false, error: 'Abgebrochen.' });

    /* 'a' settled and cleaned up after itself; 'b' started in between must not
       have gone with it. */
    const second = svc.suggest({ applicationId: id, ...REQUEST, callId: 'b' });
    await Promise.resolve();
    svc.stop(id);
    expect(signals[1].aborted).toBe(true);
    expect(await second).toEqual({ ok: false, error: 'Abgebrochen.' });
  });

  it('stops both calls when two on one card carry the same name', async () => {
    /* The editor numbers its calls per mount, so reopening a letter starts at
       1 again. Keyed by name, the second would have overwritten the first —
       leaving it running with nothing able to reach it. */
    const id = createApp();
    const signals: AbortSignal[] = [];
    const svc = abortingService(signals);

    const first = svc.suggest({ applicationId: id, ...REQUEST, callId: '1' });
    const second = svc.suggest({ applicationId: id, ...REQUEST, callId: '1' });
    await Promise.resolve();
    expect(signals).toHaveLength(2);

    svc.stop(id, '1');

    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(await first).toEqual({ ok: false, error: 'Abgebrochen.' });
    expect(await second).toEqual({ ok: false, error: 'Abgebrochen.' });
  });

  it('leaves the calls of another card alone', async () => {
    const a = createApp();
    const b = createApp();
    const seen = new Map<string, AbortSignal>();
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: (async (req: LlmRequest<unknown>) => {
        seen.set(req.prompt.includes(a) ? 'a' : 'b', req.signal!);
        return new Promise((_r, reject) => {
          req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
        });
      }) as Parameters<typeof createVariantsService>[0]['llm'],
    });
    const first = svc.suggest({ applicationId: a, ...REQUEST });
    const second = svc.suggest({ applicationId: b, ...REQUEST });
    await Promise.resolve();

    svc.stop(a);
    expect(await first).toEqual({ ok: false, error: 'Abgebrochen.' });
    /* b is still going. */
    let bSettled = false;
    second.then(() => (bSettled = true));
    await Promise.resolve();
    expect(bSettled).toBe(false);
    svc.stop(b);
    await second;
  });

  it('frees the slot after a failure and reports the reason as it stands', async () => {
    const id = createApp();
    const svc = createVariantsService({
      repo,
      runs,
      userDataPath: '/nowhere',
      llm: (async () => {
        throw new KeplerError('Claude Code ist nicht angemeldet.');
      }) as Parameters<typeof createVariantsService>[0]['llm'],
    });
    expect(await svc.suggest({ applicationId: id, ...REQUEST })).toEqual({
      ok: false,
      error: 'Claude Code ist nicht angemeldet.',
    });
    /* Not stuck busy: a failed call must not lock the feature for the session. */
    expect(await svc.suggest({ applicationId: id, ...REQUEST })).toEqual({
      ok: false,
      error: 'Claude Code ist nicht angemeldet.',
    });
  });
});

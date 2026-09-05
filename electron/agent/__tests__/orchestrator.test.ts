import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { runPipeline, type LlmRequest, type PipelineDeps } from '../orchestrator.ts';
import { STOP_ERROR, stepLabel, stepPlan } from '../labels.ts';
import { KeplerError } from '../errors.ts';
import { AgentRunStatus, AgentStepKey, AgentStepStatus, Author } from '../../../src/shared/enums.ts';
import { EXTRACTION_SCHEMA } from '../schemas.ts';
import type { AgentEvent } from '../../../src/shared/agent.ts';

const NOW = new Date('2026-08-14T09:00:00.000Z');

const EXTRACTION = {
  role: 'Senior Designer',
  summary: 'Produktdesign für die Energieplattform.',
  company: {
    name: 'Helios Energie',
    sector: 'Energie',
    headcount: '201–500',
    homepage: 'https://helios.de',
    email: 'jobs@helios.de',
    phone: null,
  },
  standort: 'Berlin',
  gehalt: '70–85k €',
  erfahrung: '5–8',
  language: 'de',
};

let root: string;
let db: DatabaseSync;
let repo: Repo;
let runs: RunStore;
let events: AgentEvent[];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bew-agent-'));
  db = openDb(':memory:');
  seedIfEmpty(db, NOW);
  repo = createRepo(db, () => NOW);
  runs = createRunStore(db, () => NOW);
  events = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function createApp(input: { postingUrl?: string; postingText?: string }) {
  return repo.createApplication({
    role: 'Neue Bewerbung',
    company: 'Unbekanntes Unternehmen',
    channel: 'LinkedIn',
    ...input,
  }).application.id;
}

function createRun(appId: string) {
  const app = repo.getApplicationWithCompany(appId)!;
  const plan = stepPlan(!!app.application.posting_url, {
    company: app.company.name,
    source: app.application.posting_url ? app.application.channel || '' : '',
  });
  return runs.createRun(appId, 'Kepler wartet in der Warteschlange…', plan).run.id;
}

/* An llm fake keyed by the request's schema — only the extraction call
   remains in the pipeline now. */
function fakeLlm(overrides: Partial<Record<string, (req: LlmRequest<unknown>) => unknown>> = {}) {
  const fn = vi.fn(async (req: LlmRequest<unknown>): Promise<unknown> => {
    if (req.schema === EXTRACTION_SCHEMA) return req.validate(overrides.extraction?.(req) ?? EXTRACTION);
    throw new Error('unbekanntes Schema');
  });
  return fn as unknown as PipelineDeps['llm'] & { mock: typeof fn.mock };
}

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    repo,
    runs,
    userDataPath: root,
    scrape: vi.fn(async () => 'Stellenanzeige: Senior Designer bei Helios Energie in Berlin …'),
    llm: fakeLlm(),
    renderPdf: vi.fn(async (_html: string, pdfAbs: string) => {
      writeFileSync(pdfAbs, 'pdf');
    }),
    emit: (e) => events.push(e),
    ...over,
  };
}

describe('runPipeline', () => {
  /* The scrape only measures length, so a cookie banner or a login wall
     reaches the extraction. Stopping there costs one call; going on would
     write a whole card from nothing. */
  it('stops the run when the extraction recognised something other than a posting', async () => {
    const appId = createApp({ postingText: 'Wir verwenden Cookies, um Inhalte zu personalisieren.' });
    const runId = createRun(appId);
    await runPipeline(
      appId,
      runId,
      deps({ llm: fakeLlm({ extraction: () => ({ ...EXTRACTION, textKind: 'cookie_notice' }) }) }),
    );

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);
    const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
    expect(failed.key).toBe(AgentStepKey.EXTRACT);
  });

  /* The message names what the text looked like — "eine Fehlerseite" tells the
     user to check the link, "ein Cookie-Hinweis" tells them the page never
     loaded properly. One sentence apart, two different repairs. */
  it('says in the error which kind of text it found', async () => {
    const appId = createApp({ postingText: '404 — Seite nicht gefunden' });
    const runId = createRun(appId);
    await runPipeline(
      appId,
      runId,
      deps({ llm: fakeLlm({ extraction: () => ({ ...EXTRACTION, textKind: 'error_page' }) }) }),
    );

    const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
    expect(failed.error).toMatch(/Fehlerseite/);
  });

  it('walks a URL posting through every step and lands the results in the DB', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const d = deps();

    await runPipeline(appId, runId, d);

    expect(d.scrape).toHaveBeenCalledWith('https://linkedin.com/jobs/1', undefined);
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(runs.stepsFor(runId).every((s) => s.status === AgentStepStatus.DONE)).toBe(true);

    const { application, company } = repo.getApplicationWithCompany(appId)!;
    expect(application.role).toBe('Senior Designer');
    expect(application.summary).toBe('Produktdesign für die Energieplattform.');
    expect(company.name).toBe('Helios Energie');
    expect(company.sector).toBe('Energie');
    expect(company.headcount).toBe('201–500');
    expect(company.homepage).toBe('https://helios.de');

    const snap = repo.load();
    const facts = snap.facts.filter((f) => f.application_id === appId);
    expect(facts.find((f) => f.label === 'Standort')).toMatchObject({ value: 'Berlin', kind: null });
    expect(facts.find((f) => f.label === 'Gehalt')).toMatchObject({ value: '70–85k €' });
    expect(facts.find((f) => f.label === 'Erfahrung')).toMatchObject({ value: '5–8' });

    /* The contact lookup is gone — the run links nobody; contacts are the
       user's to add by hand. */
    expect(snap.applicationPeople.filter((l) => l.application_id === appId)).toEqual([]);
    /* Nor are any documents generated — those are uploaded by hand now. */
    expect(snap.documents.filter((doc) => doc.application_id === appId && doc.file_path)).toEqual([]);

    const comment = snap.comments.filter((c) => c.application_id === appId).at(-1)!;
    expect(comment.author).toBe(Author.KEPLER);
    /* One line, nothing else — no finding bullets, no application link. */
    expect(comment.text).toBe('Fertig — Firmendetails, Kontakte und Unterlagen sind ergänzt.');
    expect(snap.activities.some((a) => a.application_id === appId && a.author === Author.KEPLER)).toBe(true);
  });

  it('feeds pasted text straight to the extraction when there is no URL', async () => {
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const runId = createRun(appId);
    const scrape = vi.fn(async () => '');
    const llm = fakeLlm();
    await runPipeline(appId, runId, deps({ scrape, llm }));

    expect(scrape).not.toHaveBeenCalled();
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const extractionCall = llm.mock.calls.find((c) => c[0].schema === EXTRACTION_SCHEMA)!;
    expect(extractionCall[0].prompt).toContain('Wir suchen einen Senior Designer');
  });

  it('fails the fetch step with the paste hint and leaves the rest waiting', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    await runPipeline(
      appId,
      runId,
      deps({
        scrape: vi.fn(async () => {
          throw new KeplerError(
            'Die Stellenanzeige konnte nicht automatisch geladen werden. Bitte füge den Text der Anzeige ein und starte Kepler erneut.',
          );
        }),
      }),
    );

    const run = runs.getRun(runId);
    expect(run.status).toBe(AgentRunStatus.FAILED);
    expect(run.error).toContain('füge den Text');
    const steps = runs.stepsFor(runId);
    expect(steps[0].status).toBe(AgentStepStatus.ERROR);
    expect(steps.slice(1).every((s) => s.status === AgentStepStatus.WAIT)).toBe(true);
    /* Nothing was extracted, so nothing may have been written. */
    expect(repo.getApplicationWithCompany(appId)!.application.role).toBe('Neue Bewerbung');
  });

  describe('stop', () => {
    it('fails the in-flight step with the stop message and leaves the rest waiting', async () => {
      const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
      const runId = createRun(appId);
      const controller = new AbortController();
      /* The extraction call hangs until the stop tears it down — as the SDK
         does when its abort controller fires. */
      const hanging = vi.fn(
        (req: LlmRequest<unknown>) =>
          new Promise<unknown>((_, reject) => {
            req.signal!.addEventListener('abort', () => reject(new KeplerError('Abgebrochen.')));
          }),
      );
      const d = deps({ llm: hanging as unknown as PipelineDeps['llm'], signal: controller.signal });

      const done = runPipeline(appId, runId, d);
      await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      await done;

      const run = runs.getRun(runId);
      expect(run.status).toBe(AgentRunStatus.FAILED);
      expect(run.error).toBe(STOP_ERROR);
      const steps = runs.stepsFor(runId);
      expect(steps[0]).toMatchObject({ status: AgentStepStatus.ERROR, error: STOP_ERROR });
      expect(steps.slice(1).every((s) => s.status === AgentStepStatus.WAIT)).toBe(true);
      /* The panel saw the halted step. */
      expect(events.at(-1)!.step).toMatchObject({ status: AgentStepStatus.ERROR });
    });

    it('keeps a step that finished in the stop window and halts on the next one', async () => {
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      const runId = createRun(appId);
      const controller = new AbortController();
      /* Stop lands while the listing is already on its way back. */
      const scrape = vi.fn(async () => {
        controller.abort();
        return 'Stellenanzeige …';
      });

      await runPipeline(appId, runId, deps({ scrape, signal: controller.signal }));

      const steps = runs.stepsFor(runId);
      expect(steps[0].status).toBe(AgentStepStatus.DONE);
      expect(steps[1]).toMatchObject({ status: AgentStepStatus.ERROR, error: STOP_ERROR });
      expect(steps.slice(2).every((s) => s.status === AgentStepStatus.WAIT)).toBe(true);
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);
    });

    /* The stop-window state above used to strand the run: fetch DONE but the
       listing never stored, so a retry "succeeded" on an empty prompt. */
    it('resumes after a stop in the fetch window with the listing it scraped', async () => {
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      const runId = createRun(appId);
      const controller = new AbortController();
      const scrape = vi.fn(async () => {
        controller.abort();
        return 'Stellenanzeige: Senior Designer bei Helios …';
      });
      await runPipeline(appId, runId, deps({ scrape, signal: controller.signal }));
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);
      /* Persisted the moment the scrape returned, stop or not. */
      expect(runs.getRun(runId).listing).toBe('Stellenanzeige: Senior Designer bei Helios …');

      const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
      runs.resetStep(failed.id, failed.label);
      runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');
      const second = deps();
      await runPipeline(appId, runId, second);

      expect(second.scrape).not.toHaveBeenCalled();
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
      const extractionCall = (
        second.llm as unknown as { mock: { calls: [LlmRequest<unknown>][] } }
      ).mock.calls.find((c) => c[0].schema === EXTRACTION_SCHEMA)!;
      expect(extractionCall[0].prompt).toContain('Stellenanzeige: Senior Designer bei Helios');
    });

    it('does nothing for a run that was stopped while still queued', async () => {
      const appId = createApp({ postingText: 'Wir suchen …' });
      const runId = createRun(appId);
      const controller = new AbortController();
      controller.abort();
      const d = deps({ signal: controller.signal });

      await runPipeline(appId, runId, d);

      expect(runs.getRun(runId).status).toBe(AgentRunStatus.QUEUED);
      expect(events).toHaveLength(0);
    });
  });

  it('creates no people and links nobody — contacts are added by hand', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm();
    const peopleBefore = repo.load().people.length;
    await runPipeline(appId, runId, deps({ llm }));

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(repo.load().people.length).toBe(peopleBefore);
    expect(repo.load().applicationPeople.filter((l) => l.application_id === appId)).toEqual([]);
    /* And no call went looking for one — WebSearch left the pipeline. */
    expect(llm.mock.calls.some(([req]: [LlmRequest<unknown>]) => req.tools?.length)).toBe(false);
  });

  /* Runs planned before the removals still carry the rows; a resume closes
     them instead of leaving the panel with steps that wait forever. */
  it('closes legacy CONTACTS and VALIDATE steps without doing any work', async () => {
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const app = repo.getApplicationWithCompany(appId)!;
    const ctx = { company: app.company.name, source: '' };
    const plan = stepPlan(false, ctx);
    plan.splice(1, 0, {
      key: AgentStepKey.CONTACTS,
      label: stepLabel(AgentStepKey.CONTACTS, AgentStepStatus.WAIT, ctx),
    });
    plan.splice(plan.length - 1, 0, {
      key: AgentStepKey.VALIDATE,
      label: stepLabel(AgentStepKey.VALIDATE, AgentStepStatus.WAIT, ctx),
    });
    const runId = runs.createRun(appId, 'wartet', plan).run.id;

    await runPipeline(appId, runId, deps());

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(runs.stepsFor(runId).every((s) => s.status === AgentStepStatus.DONE)).toBe(true);
  });

  /* Same idea as CONTACTS/VALIDATE above, for the document steps removed in
     the same change — a run planned before this removal still carries these
     rows, and a resume must close them rather than hang or throw. */
  it('closes legacy document-generation steps without doing any work', async () => {
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const app = repo.getApplicationWithCompany(appId)!;
    const ctx = { company: app.company.name, source: '' };
    const plan = stepPlan(false, ctx);
    const legacyKeys = [
      AgentStepKey.READ_CV,
      AgentStepKey.READ_LETTER,
      AgentStepKey.GEN_CV,
      AgentStepKey.GEN_LETTER,
      AgentStepKey.RATE,
      AgentStepKey.PROOFS,
    ];
    plan.splice(
      1,
      0,
      ...legacyKeys.map((key) => ({ key, label: stepLabel(key, AgentStepStatus.WAIT, ctx) })),
    );
    const runId = runs.createRun(appId, 'wartet', plan).run.id;

    await runPipeline(appId, runId, deps());

    const steps = runs.stepsFor(runId);
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(steps.every((s) => s.status === AgentStepStatus.DONE)).toBe(true);
    for (const key of legacyKeys) {
      const step = steps.find((s) => s.key === key)!;
      expect(step.label).toBe(stepLabel(key, AgentStepStatus.DONE, ctx));
    }
    /* No document was written on the way through. */
    expect(repo.load().documents.filter((d) => d.application_id === appId && d.file_path)).toEqual([]);
  });

  it('completes a run whose plan predates a legacy step entirely', async () => {
    /* A run created after the removal has no PROOFS row. pending() returns
       false for a key the run does not carry, so the step is skipped. */
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const runId = createRun(appId);

    await runPipeline(appId, runId, deps());

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(runs.stepsFor(runId).some((s) => s.key === AgentStepKey.PROOFS)).toBe(false);
  });

  it('closes with the one-line comment', async () => {
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    await runPipeline(appId, createRun(appId), deps());

    const text = repo
      .load()
      .comments.filter((c) => c.application_id === appId)
      .at(-1)!.text;
    expect(text).toBe('Fertig — Firmendetails, Kontakte und Unterlagen sind ergänzt.');
  });

  it('stops quietly when the application is deleted during the fetch', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const scrape = vi.fn(async () => {
      repo.deleteApplication(appId);
      return 'Stellenanzeige …';
    });

    await expect(runPipeline(appId, runId, deps({ scrape }))).resolves.toBeUndefined();
    /* Every event still carries a run row — the renderer dereferences it. */
    expect(events.every((e) => !!e.run)).toBe(true);
    expect(repo.getApplicationWithCompany(appId)).toBeUndefined();
  });

  it('stops quietly when the application is deleted mid-run', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm({
      extraction: () => {
        repo.deleteApplication(appId);
        return EXTRACTION;
      },
    });

    await expect(runPipeline(appId, runId, deps({ llm }))).resolves.toBeUndefined();
    /* The rows cascaded with the application; nothing may have been recreated. */
    expect(repo.load().comments.filter((c) => c.application_id === appId)).toEqual([]);
  });

  /* A step retry resumes the SAME run: everything already done stays done and
     is not paid for again — no second scrape, no second extraction. */
  it('resumes a failed run from the failed step without redoing earlier work', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const first = deps({
      scrape: vi.fn(async () => {
        throw new KeplerError('Die Stellenanzeige konnte nicht automatisch geladen werden.');
      }),
    });
    await runPipeline(appId, runId, first);
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);

    const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
    runs.resetStep(failed.id, failed.label);
    runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');

    const second = deps();
    await runPipeline(appId, runId, second);

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const snap = repo.load();
    expect(snap.comments.filter((c) => c.application_id === appId).at(-1)!.text).toContain('Fertig');
  });

  /* The paste-text recovery retries the SAME run: the fetch step completes
     from the pasted text instead of scraping the wall again. */
  it('completes a retried fetch step from pasted text without scraping', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    await runPipeline(
      appId,
      runId,
      deps({
        scrape: vi.fn(async () => {
          throw new KeplerError('Die Stellenanzeige konnte nicht automatisch geladen werden.');
        }),
      }),
    );
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);

    repo.updateApplication(appId, { posting_text: 'Wir suchen einen Senior Designer …' });
    const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
    runs.resetStep(failed.id, failed.label);
    runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');

    const second = deps();
    await runPipeline(appId, runId, second);

    expect(second.scrape).not.toHaveBeenCalled();
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const extractionCall = (
      second.llm as unknown as { mock: { calls: [LlmRequest<unknown>][] } }
    ).mock.calls.find((c) => c[0].schema === EXTRACTION_SCHEMA)!;
    expect(extractionCall[0].prompt).toContain('Wir suchen einen Senior Designer');
  });
});

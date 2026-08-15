import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db/open.ts';
import { seedIfEmpty } from '../../db/seed.ts';
import { createRepo, type Repo } from '../../db/repo.ts';
import { createRunStore, type RunStore } from '../run-store.ts';
import { runPipeline, type LlmRequest, type PipelineDeps } from '../orchestrator.ts';
import { STOP_ERROR, stepPlan } from '../labels.ts';
import { KeplerError } from '../errors.ts';
import {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Author,
  DocumentKind,
  FactKind,
  LinkKind,
} from '../../../src/shared/enums.ts';
import { CONTACT_SCHEMA, DOCUMENT_SCHEMA, EXTRACTION_SCHEMA, CHECKS_SCHEMA } from '../schemas.ts';
import type { AgentEvent } from '../../../src/shared/agent.ts';

const NOW = new Date('2026-08-14T09:00:00.000Z');
const CV_HTML = '<!doctype html><html><body>Lebenslauf für Helios</body></html>';
const LETTER_HTML = '<!doctype html><html><body>Anschreiben für Helios</body></html>';

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
  people: [{ name: 'Lena Vogt', role: 'Recruiterin', email: null, phone: null, linkedin: null }],
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

/* Writes one Fassung per slot and marks it as the one Kepler uses. */
function uploadTemplates(slots: string[] = ['lebenslauf', 'anschreiben'], label = 'Standard') {
  for (const dir of slots) {
    const d = path.join(root, 'templates', dir, label);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, dir + '.html'), `<html><body>${dir}-Vorlage</body></html>`);
    writeFileSync(path.join(root, 'templates', dir, '.selected'), label);
  }
}

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

/* An llm fake keyed by the request's schema — extraction, contact research,
   the two documents, and the validation pass. */
function fakeLlm(overrides: Partial<Record<string, (req: LlmRequest<unknown>) => unknown>> = {}) {
  let docCount = 0;
  const fn = vi.fn(async (req: LlmRequest<unknown>): Promise<unknown> => {
    const pick = () => {
      if (req.schema === EXTRACTION_SCHEMA) return overrides.extraction?.(req) ?? EXTRACTION;
      if (req.schema === CONTACT_SCHEMA) return overrides.contact?.(req) ?? { person: null };
      if (req.schema === DOCUMENT_SCHEMA) {
        if (overrides.document) return overrides.document(req);
        return { html: docCount++ === 0 ? CV_HTML : LETTER_HTML };
      }
      if (req.schema === CHECKS_SCHEMA) return overrides.checks?.(req) ?? { issues: [] };
      throw new Error('unbekanntes Schema');
    };
    return req.validate(pick());
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
  it('generates from the selected Fassung of each slot and records its label', async () => {
    uploadTemplates(['lebenslauf', 'anschreiben']);
    uploadTemplates(['lebenslauf'], 'Kurz'); // marks "Kurz" for the CV slot only
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    await runPipeline(appId, createRun(appId), deps());

    const docs = repo.load().documents.filter((doc) => doc.application_id === appId);
    expect(docs.find((doc) => doc.kind === DocumentKind.LEBENSLAUF)!.template_label).toBe('Kurz');
    expect(docs.find((doc) => doc.kind === DocumentKind.COVER_LETTER)!.template_label).toBe('Standard');
  });

  it('walks a URL posting through every step and lands the results in the DB', async () => {
    uploadTemplates();
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
    /* The careers page is no longer extracted; the seeded value stays untouched. */
    expect(company.website).toBe('helios-energie.de/jobs');

    const snap = repo.load();
    const facts = snap.facts.filter((f) => f.application_id === appId);
    expect(facts.find((f) => f.label === 'Standort')).toMatchObject({ value: 'Berlin', kind: null });
    expect(facts.find((f) => f.label === 'Gehalt')).toMatchObject({
      value: '70–85k €',
      kind: FactKind.SELECT,
    });
    expect(facts.find((f) => f.label === 'Erfahrung')).toMatchObject({ value: '5–8', kind: FactKind.SELECT });

    const lena = snap.people.find((p) => p.name === 'Lena Vogt');
    expect(lena?.role).toBe('Recruiterin');
    expect(
      snap.applicationPeople.some(
        (l) => l.application_id === appId && l.person_id === lena!.id && l.kind === LinkKind.CONTACT,
      ),
    ).toBe(true);

    const docs = snap.documents.filter((doc) => doc.application_id === appId);
    const cv = docs.find((doc) => doc.kind === DocumentKind.LEBENSLAUF)!;
    expect(cv.file_path).toBe(path.join('documents', appId, 'Timo_Huennebeck_Lebenslauf.html'));
    expect(cv.pdf_path).toBe(path.join('documents', appId, 'Timo_Huennebeck_Lebenslauf.pdf'));
    expect(readFileSync(path.join(root, cv.file_path!), 'utf8')).toBe(CV_HTML);
    const letter = docs.find((doc) => doc.kind === DocumentKind.COVER_LETTER)!;
    expect(readFileSync(path.join(root, letter.file_path!), 'utf8')).toBe(LETTER_HTML);
    expect(cv.template_label).toBe('Standard');
    expect(letter.template_label).toBe('Standard');

    const comment = snap.comments.filter((c) => c.application_id === appId).at(-1)!;
    expect(comment.author).toBe(Author.KEPLER);
    expect(comment.text).toContain('@Timo');
    expect(comment.text).toContain('https://linkedin.com/jobs/1');
    expect(snap.activities.some((a) => a.application_id === appId && a.author === Author.KEPLER)).toBe(true);

    /* The document steps carry the extracted company name once it is known. */
    const genCv = runs.stepsFor(runId).find((s) => s.key === AgentStepKey.GEN_CV)!;
    expect(genCv.label).toContain('Helios Energie');
  });

  it('feeds pasted text straight to the extraction when there is no URL', async () => {
    uploadTemplates();
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
    uploadTemplates();
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
      uploadTemplates();
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
      uploadTemplates();
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

  it('researches a contact when the listing names nobody, marking it unverified', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm({
      extraction: () => ({ ...EXTRACTION, people: [] }),
      contact: () => ({
        person: { name: 'Mia Falk', role: 'Talent Lead', email: null, phone: null, linkedin: null },
      }),
    });
    await runPipeline(appId, runId, deps({ llm }));

    const contactCall = llm.mock.calls.find((c) => c[0].schema === CONTACT_SCHEMA)!;
    expect(contactCall[0].tools).toContain('WebSearch');
    const snap = repo.load();
    const mia = snap.people.find((p) => p.name === 'Mia Falk')!;
    expect(mia.role).toBe('Talent Lead (unbestätigt)');
    expect(snap.applicationPeople.some((l) => l.application_id === appId && l.person_id === mia.id)).toBe(
      true,
    );
  });

  it('finishes the contact step empty-handed when the research finds nobody', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm({ extraction: () => ({ ...EXTRACTION, people: [] }) });
    await runPipeline(appId, runId, deps({ llm }));

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(repo.load().applicationPeople.filter((l) => l.application_id === appId)).toEqual([]);
  });

  it('fails the template step in German when no CV template was uploaded', async () => {
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    await runPipeline(appId, runId, deps());

    const run = runs.getRun(runId);
    expect(run.status).toBe(AgentRunStatus.FAILED);
    expect(run.error).toContain('Vorlage');
    const readCv = runs.stepsFor(runId).find((s) => s.key === AgentStepKey.READ_CV)!;
    expect(readCv.status).toBe(AgentStepStatus.ERROR);
    /* The extraction before it stays: partial results persist. */
    expect(repo.getApplicationWithCompany(appId)!.application.role).toBe('Senior Designer');
  });

  it('keeps the HTML when the PDF export fails and still finishes', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    await runPipeline(
      appId,
      runId,
      deps({
        renderPdf: vi.fn(async () => {
          throw new Error('print failed');
        }),
      }),
    );

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const cv = repo
      .load()
      .documents.find((doc) => doc.application_id === appId && doc.kind === DocumentKind.LEBENSLAUF)!;
    expect(cv.file_path).not.toBeNull();
    expect(cv.pdf_path).toBeNull();
    expect(existsSync(path.join(root, 'documents', appId, 'Timo_Huennebeck_Lebenslauf.pdf'))).toBe(false);
  });

  it('appends validation issues to the final comment', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm({ checks: () => ({ issues: ['Gehalt ohne Währung'] }) });
    await runPipeline(appId, runId, deps({ llm }));

    const comment = repo
      .load()
      .comments.filter((c) => c.application_id === appId)
      .at(-1)!;
    expect(comment.text).toContain('Gehalt ohne Währung');
  });

  it('stops quietly when the application is deleted during the fetch', async () => {
    uploadTemplates();
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

  it('writes no files when the application is deleted during document generation', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const llm = fakeLlm({
      document: () => {
        repo.deleteApplication(appId);
        return { html: CV_HTML };
      },
    });

    await expect(runPipeline(appId, runId, deps({ llm }))).resolves.toBeUndefined();
    /* purgeApplicationFiles already ran with the delete; recreating the
       folder afterwards would leave orphans nothing ever cleans. */
    expect(existsSync(path.join(root, 'documents', appId))).toBe(false);
    expect(events.every((e) => !!e.run)).toBe(true);
  });

  /* Re-running must not fill the people list with duplicates — the extracted
     contact already exists after the first run. */
  it('reuses the existing person on a re-run instead of duplicating them', async () => {
    uploadTemplates();
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    await runPipeline(appId, createRun(appId), deps());
    await runPipeline(appId, createRun(appId), deps());

    const snap = repo.load();
    expect(snap.people.filter((p) => p.name === 'Lena Vogt')).toHaveLength(1);
    expect(snap.applicationPeople.filter((l) => l.application_id === appId)).toHaveLength(1);
  });

  /* A step retry resumes the SAME run: everything already done stays done and
     is not paid for again — no second scrape, no second extraction. */
  it('resumes a failed run from the failed step without redoing earlier work', async () => {
    uploadTemplates(['lebenslauf']);
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    const runId = createRun(appId);
    const first = deps();
    await runPipeline(appId, runId, first);
    expect(runs.stepsFor(runId).find((s) => s.key === AgentStepKey.READ_LETTER)?.status).toBe(
      AgentStepStatus.ERROR,
    );

    /* The user uploads the missing template and retries the step. */
    uploadTemplates(['anschreiben']);
    const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
    runs.resetStep(failed.id, failed.label);
    runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');

    const second = deps();
    await runPipeline(appId, runId, second);

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(second.scrape).not.toHaveBeenCalled();
    const llmCalls = (second.llm as unknown as { mock: { calls: [LlmRequest<unknown>][] } }).mock.calls;
    expect(llmCalls.some((c) => c[0].schema === EXTRACTION_SCHEMA)).toBe(false);
    /* Both documents exist afterwards, and the contact was not duplicated. */
    const snap = repo.load();
    const docs = snap.documents.filter((doc) => doc.application_id === appId);
    expect(docs.every((doc) => doc.file_path !== null)).toBe(true);
    expect(snap.people.filter((p) => p.name === 'Lena Vogt')).toHaveLength(1);
    expect(snap.comments.filter((c) => c.application_id === appId).at(-1)!.text).toContain('@Timo');
  });

  /* The paste-text recovery retries the SAME run: the fetch step completes
     from the pasted text instead of scraping the wall again. */
  it('completes a retried fetch step from pasted text without scraping', async () => {
    uploadTemplates();
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

  it('stops quietly when the application is deleted mid-run', async () => {
    uploadTemplates();
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
});

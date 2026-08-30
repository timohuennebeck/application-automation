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
import { PROOFS_REWRITE_LABEL, RATE_REWRITE_LABEL, STOP_ERROR, stepLabel, stepPlan } from '../labels.ts';
import { KeplerError } from '../errors.ts';
import {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Author,
  DocumentKind,
  DocumentLanguage,
  FactKind,
} from '../../../src/shared/enums.ts';
import { FILL_SCHEMA, EXTRACTION_SCHEMA, PROOFS_SCHEMA, RATING_SCHEMA } from '../schemas.ts';
import type { AgentEvent } from '../../../src/shared/agent.ts';
import { VALUE_BUDGET } from '../budgets.ts';

const NOW = new Date('2026-08-14T09:00:00.000Z');
/* Every Fassung carries a slot; what Kepler returns are the values for it. */
const templateHtml = (slot: string) =>
  `<!doctype html><html><body>${slot}-Vorlage für {{COMPANY_NAME}}</body></html>`;
const FILLED = { fields: [{ key: 'COMPANY_NAME', value: 'Helios Energie' }] };

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

/* Writes one Fassung per slot on one language side and marks it as the one
   Kepler uses for that language. */
function uploadTemplates(
  slots: string[] = ['lebenslauf', 'anschreiben'],
  label = 'Standard',
  html?: string,
  language: DocumentLanguage = DocumentLanguage.DE,
) {
  for (const dir of slots) {
    const side = path.join(root, 'templates', dir, language);
    const d = path.join(side, label);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, dir + '.html'), html ?? templateHtml(dir));
    writeFileSync(path.join(side, '.selected'), label);
  }
}

function createApp(input: { postingUrl?: string; postingText?: string; language?: DocumentLanguage }) {
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

/* An llm fake keyed by the request's schema — extraction, the two documents,
   the Opus rating, and the proofs pass. */
function fakeLlm(overrides: Partial<Record<string, (req: LlmRequest<unknown>) => unknown>> = {}) {
  const fn = vi.fn(async (req: LlmRequest<unknown>): Promise<unknown> => {
    const pick = () => {
      if (req.schema === EXTRACTION_SCHEMA) return overrides.extraction?.(req) ?? EXTRACTION;
      if (req.schema === FILL_SCHEMA) {
        return overrides.document?.(req) ?? FILLED;
      }
      if (req.schema === RATING_SCHEMA) return overrides.rating?.(req) ?? { score: 9, improvements: [] };
      if (req.schema === PROOFS_SCHEMA) return overrides.proofs?.(req) ?? { unsupported: [] };
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
  /* The scrape only measures length, so a cookie banner or a login wall
     reaches the extraction. Stopping there costs one call; going on would
     build a whole card and two documents out of nothing. */
  it('stops the run when the extraction recognised something other than a posting', async () => {
    uploadTemplates();
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
    expect(repo.load().documents.filter((d) => d.application_id === appId && d.file_path)).toEqual([]);
  });

  /* The message names what the text looked like — "eine Fehlerseite" tells the
     user to check the link, "ein Cookie-Hinweis" tells them the page never
     loaded properly. One sentence apart, two different repairs. */
  it('says in the error which kind of text it found', async () => {
    uploadTemplates();
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

  it('generates from the selected Fassung of each slot and records its label', async () => {
    uploadTemplates(['lebenslauf', 'anschreiben']);
    uploadTemplates(['lebenslauf'], 'Kurz'); // marks "Kurz" for the CV slot only
    const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
    await runPipeline(appId, createRun(appId), deps());

    const docs = repo.load().documents.filter((doc) => doc.application_id === appId);
    expect(docs.find((doc) => doc.kind === DocumentKind.LEBENSLAUF)!.template_label).toBe('Kurz');
    expect(docs.find((doc) => doc.kind === DocumentKind.COVER_LETTER)!.template_label).toBe('Standard');
  });

  /* Which side of the slots a run reads, in order of precedence: what the
     card says, else what the posting is written in, else German. */
  describe('language', () => {
    const ENGLISH = (slot: string) => `<html><body>English ${slot} for {{COMPANY_NAME}}</body></html>`;
    const uploadBoth = () => {
      uploadTemplates();
      uploadTemplates(['lebenslauf'], 'Standard', ENGLISH('lebenslauf'), DocumentLanguage.EN);
      uploadTemplates(['anschreiben'], 'Standard', ENGLISH('anschreiben'), DocumentLanguage.EN);
    };
    const fillPrompts = (llm: ReturnType<typeof fakeLlm>) =>
      llm.mock.calls.map(([req]) => req).filter((req) => req.schema === FILL_SCHEMA);
    const filePaths = (appId: string) =>
      repo
        .load()
        .documents.filter((d) => d.application_id === appId)
        .map((d) => path.basename(d.file_path ?? ''))
        .sort();

    it('reads the English side and names the files in English when the card says so', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1', language: DocumentLanguage.EN });
      const runId = createRun(appId);
      const d = deps();
      await runPipeline(appId, runId, d);

      expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
      expect(filePaths(appId)).toEqual(['Timo_Huennebeck_CV.html', 'Timo_Huennebeck_Cover_Letter.html']);
      expect(readFileSync(path.join(root, 'documents', appId, 'Timo_Huennebeck_CV.html'), 'utf8')).toBe(
        '<html><body>English lebenslauf for Helios Energie</body></html>',
      );
      for (const req of fillPrompts(d.llm as ReturnType<typeof fakeLlm>)) {
        expect(req.prompt).toContain('English');
        expect(req.prompt).toContain('British English');
      }
      expect(existsSync(path.join(root, 'documents', appId, 'Timo_Huennebeck_Lebenslauf.html'))).toBe(false);
    });

    it('takes the language from the posting when the card has none, and writes it onto the card', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      expect(repo.getApplicationWithCompany(appId)!.application.language).toBeNull();
      await runPipeline(
        appId,
        createRun(appId),
        deps({ llm: fakeLlm({ extraction: () => ({ ...EXTRACTION, language: 'en' }) }) }),
      );

      expect(repo.getApplicationWithCompany(appId)!.application.language).toBe('en');
      expect(filePaths(appId)).toEqual(['Timo_Huennebeck_CV.html', 'Timo_Huennebeck_Cover_Letter.html']);
    });

    it('lets the card overrule the posting', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1', language: DocumentLanguage.DE });
      await runPipeline(
        appId,
        createRun(appId),
        deps({ llm: fakeLlm({ extraction: () => ({ ...EXTRACTION, language: 'en' }) }) }),
      );

      expect(repo.getApplicationWithCompany(appId)!.application.language).toBe('de');
      expect(filePaths(appId)).toEqual([
        'Timo_Huennebeck_Anschreiben.html',
        'Timo_Huennebeck_Lebenslauf.html',
      ]);
    });

    it('falls back to German when neither the card nor the posting says', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      await runPipeline(
        appId,
        createRun(appId),
        deps({ llm: fakeLlm({ extraction: () => ({ ...EXTRACTION, language: null }) }) }),
      );

      expect(repo.getApplicationWithCompany(appId)!.application.language).toBe('de');
      expect(filePaths(appId)).toEqual([
        'Timo_Huennebeck_Anschreiben.html',
        'Timo_Huennebeck_Lebenslauf.html',
      ]);
    });

    it('fails the template step naming the missing English side', async () => {
      uploadTemplates(); // German only
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1', language: DocumentLanguage.EN });
      const runId = createRun(appId);
      await runPipeline(appId, runId, deps());

      const run = runs.getRun(runId);
      expect(run.status).toBe(AgentRunStatus.FAILED);
      expect(run.error).toMatch(/englische Lebenslauf-Vorlage/);
      expect(runs.stepsFor(runId).find((s) => s.key === AgentStepKey.READ_CV)!.status).toBe(
        AgentStepStatus.ERROR,
      );
    });

    /* The card can be switched between attempts — the Sprache chip is not
       locked while a run is failed. The documents on disk still carry the
       names the finished steps wrote, so the proofs pass has to find them by
       the row rather than by recomputing the name, or it would check two
       empty strings and report a card with German documents as sound. */
    it('checks the documents that were written, not the ones the new language would be called', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      const runId = createRun(appId);
      /* Fails at GEN_LETTER, after the CV was written under its German name. */
      let calls = 0;
      await runPipeline(
        appId,
        runId,
        deps({
          llm: fakeLlm({
            document: () => {
              if (calls++ === 0) return FILLED;
              throw new Error('Modell nicht erreichbar');
            },
          }),
        }),
      );
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);
      expect(existsSync(path.join(root, 'documents', appId, 'Timo_Huennebeck_Lebenslauf.html'))).toBe(true);

      repo.updateApplication(appId, { language: DocumentLanguage.EN });
      const step = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
      runs.resetStep(step.id, step.label);
      runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');
      const llm = fakeLlm();
      await runPipeline(appId, runId, deps({ llm }));

      /* The proofs pass read the German CV file the finished step wrote — not
         an empty string under the name the new language would use. */
      const proofs = (llm as ReturnType<typeof fakeLlm>).mock.calls
        .map(([req]) => req)
        .find((req) => req.schema === PROOFS_SCHEMA)!;
      expect(proofs.prompt).toContain('lebenslauf-Vorlage für Helios Energie');
    });

    /* A resumed run must not re-decide: the documents already written carry
       the first decision's names, and the retry writes beside them. */
    it('keeps the language a resumed run was started with', async () => {
      uploadBoth();
      const appId = createApp({ postingUrl: 'https://linkedin.com/jobs/1' });
      const runId = createRun(appId);
      let fails = 0;
      const llm = fakeLlm({
        extraction: () => ({ ...EXTRACTION, language: 'en' }),
        document: () => {
          if (fails++ === 0) throw new Error('Modell nicht erreichbar');
          return FILLED;
        },
      });
      await runPipeline(appId, runId, deps({ llm }));
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.FAILED);

      const failed = runs.stepsFor(runId).find((s) => s.status === AgentStepStatus.ERROR)!;
      runs.resetStep(failed.id, failed.label);
      runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');
      await runPipeline(appId, runId, deps({ llm }));
      expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
      expect(filePaths(appId)).toEqual(['Timo_Huennebeck_CV.html', 'Timo_Huennebeck_Cover_Letter.html']);
    });
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

    /* The contact lookup is gone — the run links nobody; contacts are the
       user's to add by hand. */
    expect(snap.applicationPeople.filter((l) => l.application_id === appId)).toEqual([]);

    const docs = snap.documents.filter((doc) => doc.application_id === appId);
    const cv = docs.find((doc) => doc.kind === DocumentKind.LEBENSLAUF)!;
    expect(cv.file_path).toBe(path.join('documents', appId, 'Timo_Huennebeck_Lebenslauf.html'));
    expect(cv.pdf_path).toBe(path.join('documents', appId, 'Timo_Huennebeck_Lebenslauf.pdf'));
    expect(readFileSync(path.join(root, cv.file_path!), 'utf8')).toBe(
      templateHtml('lebenslauf').replace('{{COMPANY_NAME}}', 'Helios Energie'),
    );
    const letter = docs.find((doc) => doc.kind === DocumentKind.COVER_LETTER)!;
    expect(readFileSync(path.join(root, letter.file_path!), 'utf8')).toBe(
      templateHtml('anschreiben').replace('{{COMPANY_NAME}}', 'Helios Energie'),
    );
    expect(cv.template_label).toBe('Standard');
    expect(letter.template_label).toBe('Standard');

    const comment = snap.comments.filter((c) => c.application_id === appId).at(-1)!;
    expect(comment.author).toBe(Author.KEPLER);
    /* One line, nothing else — no finding bullets, no application link. */
    expect(comment.text).toBe('Fertig — Firmendetails, Kontakte und Unterlagen sind ergänzt.');
    expect(snap.activities.some((a) => a.application_id === appId && a.author === Author.KEPLER)).toBe(true);

    /* The document steps carry the extracted company name once it is known. */
    const genCv = runs.stepsFor(runId).find((s) => s.key === AgentStepKey.GEN_CV)!;
    expect(genCv.label).toContain('Helios Energie');
  });

  it('fills the Fassung in code, so everything outside a slot survives byte for byte', async () => {
    /* The bug this replaces: asked for the whole document back, the model
       returned the base64 image with its middle silently missing. */
    const base64 = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(20_000);
    const template =
      `<!doctype html><html><body><img src="data:image/png;base64,${base64}">` +
      `<h1>{{COMPANY_NAME}}</h1></body></html>`;
    uploadTemplates(['lebenslauf'], 'Standard', template);
    uploadTemplates(['anschreiben']);
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });

    await runPipeline(appId, createRun(appId), deps());

    const cv = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.LEBENSLAUF)!;
    const written = readFileSync(path.join(root, cv.file_path!), 'utf8');
    expect(written).toBe(template.replace('{{COMPANY_NAME}}', 'Helios Energie'));
    expect(written).toContain(base64);
  });

  it('dates the document itself, without ever offering the slot to the model', async () => {
    /* The template used to fill its date from an inline script. Nothing runs
       that script — printToPDF loads the document with javascript off — so
       every letter carried the date the template was authored on. */
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>München, {{LETTER_DATE}}</p><h1>{{COMPANY_NAME}}</h1></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const llm = fakeLlm();

    await runPipeline(appId, createRun(appId), deps({ llm, now: () => NOW }));

    const letter = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    expect(readFileSync(path.join(root, letter.file_path!), 'utf8')).toContain('München, 14.08.2026');
    /* The model has no clock: asked for a date it writes a plausible one, so
       the slot is never listed among the ones it is asked to fill. It still
       reads the Fassung's own text, slots and all — that is what tells it
       where a value sits — so only the list is checked. */
    const offered = llm.mock.calls
      .map(([req]: [LlmRequest<unknown>]) => req.prompt)
      .filter((prompt: string) => prompt.includes('<platzhalter>'))
      /* On its own line — the output rules name the block in prose too. */
      .map((prompt: string) => prompt.split('\n<platzhalter>\n')[1].split('\n</platzhalter>')[0]);
    expect(offered.length).toBe(2);
    for (const list of offered) expect(list).not.toContain('LETTER_DATE');
  });

  it('keeps its own date even when the model answers with one anyway', async () => {
    /* The Fassung's text shows the slot, so a model can volunteer a value for
       it. The process knows the day and the model does not — its answer goes
       in first and is written over. */
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>München, {{LETTER_DATE}}</p><h1>{{COMPANY_NAME}}</h1></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const llm = fakeLlm({
      document: () => ({
        fields: [
          { key: 'COMPANY_NAME', value: 'Helios Energie' },
          { key: 'LETTER_DATE', value: '01.01.2001' },
        ],
      }),
    });

    await runPipeline(appId, createRun(appId), deps({ llm, now: () => NOW }));

    const letter = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    const written = readFileSync(path.join(root, letter.file_path!), 'utf8');
    expect(written).toContain('München, 14.08.2026');
    expect(written).not.toContain('01.01.2001');
  });

  it('fails the document step when a slot is left unanswered', async () => {
    /* Shipping a PDF with a literal {{…}} in it is worse than a failed step
       the retry icon offers to resume. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const runId = createRun(appId);
    const llm = fakeLlm({ document: () => ({ fields: [] }) });

    await runPipeline(appId, runId, deps({ llm }));

    const step = runs.stepsFor(runId).find((s) => s.key === AgentStepKey.GEN_CV)!;
    expect(step.status).toBe(AgentStepStatus.ERROR);
    expect(step.error).toContain('COMPANY_NAME');
    expect(existsSync(path.join(root, 'documents', appId))).toBe(false);
  });

  it('asks again when a value came back over its budget', async () => {
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
    let asked = 0;
    const llm = fakeLlm({
      document: (req) => {
        asked++;
        /* Both templates' slots in one answer: the CV Fassung wants
             COMPANY_NAME, and a value for a slot a template does not have is
             ignored by fillPlaceholders (and, since the budget check, ignored
             by the redo decision too — the CV never sees this value as its
             own). Short only once told to shorten, so the redo this test
             checks for is unmistakably the letter's, not an accident of call
             order. */
        return {
          fields: [
            { key: 'COMPANY_NAME', value: 'Helios Energie' },
            {
              key: 'COMPANY_HOOK_SENTENCE',
              value: req.prompt.includes('Diese Werte sind zu lang') ? 'Kurz und knapp.' : long,
            },
          ],
        };
      },
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    /* One document call for the CV (its own budget is never at issue), two
       for the letter — its own over-budget answer, then the redo. */
    expect(asked).toBe(3);
    const letter = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    expect(readFileSync(path.join(root, letter.file_path!), 'utf8')).toContain('Kurz und knapp.');
  });

  it('names the offending slot and its budget in the second ask', async () => {
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
    const prompts: string[] = [];
    const llm = fakeLlm({
      document: (req) => {
        prompts.push(req.prompt);
        return {
          fields: [
            { key: 'COMPANY_NAME', value: 'Helios Energie' },
            { key: 'COMPANY_HOOK_SENTENCE', value: long },
          ],
        };
      },
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    const redo = prompts.at(-1)!;
    expect(redo).toContain('COMPANY_HOOK_SENTENCE');
    expect(redo).toContain(String(VALUE_BUDGET.COMPANY_HOOK_SENTENCE));
    expect(redo).toContain('40');
  });

  it('keeps a second answer that is still too long rather than failing the step', async () => {
    /* A letter three words too long is worth having; a failed step is not. */
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
    const llm = fakeLlm({
      document: () => ({
        fields: [
          { key: 'COMPANY_NAME', value: 'Helios Energie' },
          { key: 'COMPANY_HOOK_SENTENCE', value: long },
        ],
      }),
    });

    const runId = createRun(appId);
    await runPipeline(appId, runId, deps({ llm }));

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const letter = repo
      .load()
      .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
    expect(letter.file_path).toBeTruthy();
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

    /* The stop-window state above used to strand the run: fetch DONE but the
       listing never stored, so a retry "succeeded" on an empty prompt. */
    it('resumes after a stop in the fetch window with the listing it scraped', async () => {
      uploadTemplates();
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
    uploadTemplates();
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
    uploadTemplates();
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

  describe('rating', () => {
    it('asks Opus 5 for the rating and leaves the letter alone when nothing is named', async () => {
      uploadTemplates();
      const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
      let letters = 0;
      const llm = fakeLlm({
        document: (req) => {
          if (req.prompt.includes('anschreiben-Vorlage')) letters++;
          return FILLED;
        },
      });
      await runPipeline(appId, createRun(appId), deps({ llm }));

      const rating = llm.mock.calls.find(([req]: [LlmRequest<unknown>]) => req.schema === RATING_SCHEMA)!;
      expect(rating[0].model).toBe('claude-opus-5');
      expect(rating[0].prompt).toContain('anschreiben-Vorlage für Helios Energie');
      expect(letters).toBe(1);
    });

    it('regenerates the letter once with the named improvements', async () => {
      uploadTemplates();
      const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
      const prompts: string[] = [];
      let letters = 0;
      const llm = fakeLlm({
        document: (req) => {
          if (req.prompt.includes('anschreiben-Vorlage')) {
            letters++;
            prompts.push(req.prompt);
          }
          return FILLED;
        },
        rating: () => ({ score: 6, improvements: ['Hook konkreter auf das Produkt beziehen.'] }),
      });
      const runId = createRun(appId);
      await runPipeline(appId, runId, deps({ llm }));

      expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
      expect(letters).toBe(2);
      expect(prompts.at(-1)).toContain('6/10');
      expect(prompts.at(-1)).toContain('Hook konkreter auf das Produkt beziehen.');
      /* The panel saw the honest label while the feedback was worked in. */
      expect(
        events.some((e) => e.step?.key === AgentStepKey.RATE && e.step.label === RATE_REWRITE_LABEL),
      ).toBe(true);
    });

    it('does not fail the run when the rating call itself rejects', async () => {
      uploadTemplates();
      const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
      const llm = fakeLlm({
        rating: () => {
          throw new Error('Opus nicht erreichbar');
        },
      });
      const runId = createRun(appId);
      await runPipeline(appId, runId, deps({ llm }));

      expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
      expect(runs.stepsFor(runId).find((s) => s.key === AgentStepKey.RATE)!.status).toBe(
        AgentStepStatus.DONE,
      );
    });
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
        return FILLED;
      },
    });

    await expect(runPipeline(appId, runId, deps({ llm }))).resolves.toBeUndefined();
    /* purgeApplicationFiles already ran with the delete; recreating the
       folder afterwards would leave orphans nothing ever cleans. */
    expect(existsSync(path.join(root, 'documents', appId))).toBe(false);
    expect(events.every((e) => !!e.run)).toBe(true);
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
    /* Both documents exist afterwards, and the run closed with its comment. */
    const snap = repo.load();
    const docs = snap.documents.filter((doc) => doc.application_id === appId);
    expect(docs.every((doc) => doc.file_path !== null)).toBe(true);
    expect(snap.comments.filter((c) => c.application_id === appId).at(-1)!.text).toContain('Fertig');
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

  it('rewrites the Anschreiben once when a claim in it is unsupported', async () => {
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    let checks = 0;
    let letters = 0;
    const llm = fakeLlm({
      document: (req) => {
        if (req.prompt.includes('anschreiben-Vorlage')) letters++;
        return FILLED;
      },
      proofs: () => {
        checks++;
        return { unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }] };
      },
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    /* One reading, one rewrite — the comment stopped reporting findings, so
       there is no second reading to feed it. */
    expect(letters).toBe(2);
    expect(checks).toBe(1);
  });

  it('quotes the unsupported claim back when it rewrites', async () => {
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const prompts: string[] = [];
    const llm = fakeLlm({
      document: (req) => {
        prompts.push(req.prompt);
        return FILLED;
      },
      proofs: () => ({
        unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }],
      }),
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    expect(prompts.at(-1)).toContain('zwei Bereiche');
    expect(prompts.at(-1)).toContain('nicht im CV');
  });

  it('leaves the Lebenslauf alone when the claim sits there', async () => {
    /* The CV is copied from the Fassung; only its header line is generated.
       Rewriting it would not fix a claim the Fassung itself makes. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    let documents = 0;
    const llm = fakeLlm({
      document: () => {
        documents++;
        return FILLED;
      },
      proofs: () => ({
        unsupported: [{ document: 'LEBENSLAUF', quote: '1 Mio. Nutzer', why: 'Fassung sagt 12.000' }],
      }),
    });

    const runId = createRun(appId);
    await runPipeline(appId, runId, deps({ llm }));

    expect(documents).toBe(2);
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
  });

  it('does not fail the run when the proofs call itself rejects', async () => {
    /* PROOFS is advisory, like the budget check the design (§3) already
       exempts from failing a step: both documents are already on disk and
       correct, so a broken proofs call must not turn a finished run into a
       FAILED one with no closing comment. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const llm = fakeLlm({
      proofs: () => {
        throw new Error('Belege-Prüfung nicht erreichbar');
      },
    });

    const runId = createRun(appId);
    await runPipeline(appId, runId, deps({ llm }));

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    const comment = repo
      .load()
      .comments.filter((c) => c.application_id === appId)
      .at(-1)!;
    expect(comment.text).toContain('Fertig');
  });

  it('generates the letter at most three times, whatever both checks say', async () => {
    /* The ceiling the design promises: one letter, one budget redo, one
       proofs rewrite — and the rewrite suppresses a second budget redo, so
       the two do not stack into four. */
    uploadTemplates(['lebenslauf']);
    uploadTemplates(
      ['anschreiben'],
      'Standard',
      '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
    );
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
    let letters = 0;
    const llm = fakeLlm({
      document: (req) => {
        /* Braced, not bare: the mock answers COMPANY_HOOK_SENTENCE for every
           document call, CV included, but overForThisTemplate scopes the
           budget check to a template's own slots — the CV has no such
           placeholder, so that answer never earns it a redo of its own. Only
           letterPrompt's glossary spells the name in braces, so matching
           {{…}} is what counts letter generations and not CV ones. */
        if (req.prompt.includes('{{COMPANY_HOOK_SENTENCE}}')) letters++;
        return {
          fields: [
            { key: 'COMPANY_NAME', value: 'Helios Energie' },
            { key: 'COMPANY_HOOK_SENTENCE', value: long },
          ],
        };
      },
      proofs: () => ({
        unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }],
      }),
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    expect(letters).toBe(3);
  });

  it('closes with the one-line comment whatever the checks found', async () => {
    /* The comment is the fixed sentence — findings change the documents, not
       the note under the card. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const llm = fakeLlm({
      proofs: () => ({
        unsupported: [
          { document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' },
          { document: 'LEBENSLAUF', quote: '1 Mio. Nutzer', why: 'Fassung sagt 12.000' },
        ],
      }),
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    const text = repo
      .load()
      .comments.filter((c) => c.application_id === appId)
      .at(-1)!.text;
    expect(text).toBe('Fertig — Firmendetails, Kontakte und Unterlagen sind ergänzt.');
  });

  it('completes a run whose plan predates the step', async () => {
    /* A run created by an older build has no PROOFS row. pending() returns
       false for a key the run does not carry, so the step is skipped. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const app = repo.getApplicationWithCompany(appId)!;
    const plan = stepPlan(false, { company: app.company.name, source: '' }).filter(
      (s) => s.key !== AgentStepKey.PROOFS,
    );
    const runId = runs.createRun(appId, 'wartet', plan).run.id;

    await runPipeline(appId, runId, deps());

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
  });

  it('reads the letter back off disk when resumed at PROOFS alone', async () => {
    /* cvHtml/letterHtml are only set inside the GEN_CV/GEN_LETTER blocks —
       both are DONE on this second run, so PROOFS falls through to
       readGeneratedHtml exactly as VALIDATE does. A regression here would
       hand the model '' and report no claims on an unchecked letter. */
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    const runId = createRun(appId);
    await runPipeline(appId, runId, deps());
    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);

    const proofsStep = runs.stepsFor(runId).find((s) => s.key === AgentStepKey.PROOFS)!;
    runs.resetStep(proofsStep.id, proofsStep.label);
    runs.requeueRun(runId, 'Kepler wartet in der Warteschlange…');

    const prompts: string[] = [];
    const llm = fakeLlm({
      proofs: (req) => {
        prompts.push(req.prompt);
        return { unsupported: [] };
      },
    });
    await runPipeline(appId, runId, deps({ llm }));

    expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
    expect(prompts.at(-1)).toContain('anschreiben-Vorlage für Helios Energie');
  });

  it('flips the step label to the rewrite wording while it rewrites', async () => {
    uploadTemplates();
    const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
    let checks = 0;
    const llm = fakeLlm({
      proofs: () => {
        checks++;
        return checks === 1
          ? { unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }] }
          : { unsupported: [] };
      },
    });

    await runPipeline(appId, createRun(appId), deps({ llm }));

    expect(
      events.some((e) => e.step?.key === AgentStepKey.PROOFS && e.step.label === PROOFS_REWRITE_LABEL),
    ).toBe(true);
  });
});

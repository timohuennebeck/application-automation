/* The deterministic step chain of one Kepler run — prompt chaining, not an
   autonomous agent: this file decides what happens next, the LLM only fills
   in single steps. Every dependency with a side channel (network, model,
   printing, events) is injected, so the whole pipeline runs in tests against
   fakes and an in-memory database. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Repo } from '../db/repo.ts';
import { documentFileName, documentPaths, selectedTemplatePath } from '../files.ts';
import type { AgentEvent } from '../../src/shared/agent.ts';
import type { AgentStepRow, ApplicationRow, CompanyRow } from '../../src/shared/db-types.ts';
import {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Author,
  DocumentKind,
  FactKind,
  LinkKind,
  TEMPLATE_TITLES,
  TemplateKind,
} from '../../src/shared/enums.ts';
import { INTERRUPTED_HEADLINE } from '../../src/shared/agent.ts';
import { KeplerError, userMessage } from './errors.ts';
import { STOP_ERROR, stepLabel, type LabelCtx } from './labels.ts';
import {
  checksPrompt,
  contactPrompt,
  cvPrompt,
  extractionPrompt,
  letterPrompt,
  type DocumentInput,
} from './prompts.ts';
import type { RunStore } from './run-store.ts';
import {
  CHECKS_SCHEMA,
  CONTACT_SCHEMA,
  DOCUMENT_SCHEMA,
  EXTRACTION_SCHEMA,
  validateChecks,
  validateContact,
  validateDocumentHtml,
  validateExtraction,
  type ExtractedPerson,
  type Extraction,
} from './schemas.ts';

export interface LlmRequest<T> {
  prompt: string;
  schema: object;
  validate(x: unknown): T;
  /* Tool names the call may use; empty means a single plain completion. */
  tools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  /* Fires when the user stops the run — the call is torn down at once. */
  signal?: AbortSignal;
}

export type LlmRunner = <T>(req: LlmRequest<T>) => Promise<T>;

export interface PipelineDeps {
  repo: Repo;
  runs: RunStore;
  userDataPath: string;
  scrape(url: string, signal?: AbortSignal): Promise<string>;
  llm: LlmRunner;
  renderPdf(htmlAbs: string, pdfAbs: string): Promise<void>;
  emit(event: AgentEvent): void;
  /* Aborted by the service when the user stops the run. */
  signal?: AbortSignal;
}

const SINGLE_CALL_TIMEOUT = 120_000;
const RESEARCH_TIMEOUT = 300_000;
/* Rewriting a whole HTML template is the longest call by far — a real CV
   template runs tens of kilobytes in and out. */
const DOCUMENT_TIMEOUT = 360_000;

/* The application was deleted mid-run: its run rows cascaded away with it, so
   there is nothing left to fail — the pipeline just stops. */
class Deleted extends Error {}

/* The user pressed stop: whatever step was in flight fails with the stop
   message, and the run goes FAILED so the retry icon offers to resume it. */
class Stopped extends Error {}

export async function runPipeline(applicationId: string, runId: number, deps: PipelineDeps): Promise<void> {
  const { repo, runs, emit, signal } = deps;

  /* Stopped while still queued: the service already settled the rows. */
  if (signal?.aborted) return;

  const alive = (): { application: ApplicationRow; company: CompanyRow } => {
    if (signal?.aborted) throw new Stopped();
    const ctx = repo.getApplicationWithCompany(applicationId);
    if (!ctx) throw new Deleted();
    return ctx;
  };

  let app: ApplicationRow;
  let company: CompanyRow;
  try {
    ({ application: app, company } = alive());
  } catch {
    return;
  }

  const source = app.posting_url ? app.channel || '' : '';
  const labelCtx = (): LabelCtx => ({ company: company.name, source });

  const steps = runs.stepsFor(runId);
  const byKey = new Map(steps.map((s) => [s.key, s]));
  let current: AgentStepRow | null = null;

  /* The run row can cascade away mid-await (application deleted); an event
     without its run would crash the renderer's merge. */
  const push = (step?: AgentStepRow, refresh?: boolean) => {
    const run = runs.getRun(runId);
    if (run) emit({ run, step, refresh });
  };

  /* Starts a step: the row goes RUN, the run headline follows it, and the
     record is confirmed to still exist. */
  const start = (key: AgentStepKey) => {
    alive();
    const step = byKey.get(key);
    if (!step) return;
    const label = stepLabel(key, AgentStepStatus.RUN, labelCtx());
    current = runs.startStep(step.id, label);
    byKey.set(key, current);
    if (runs.getRun(runId).status === AgentRunStatus.QUEUED) runs.startRun(runId, label);
    else runs.setRunLabel(runId, label);
    push(current);
  };

  const done = (key: AgentStepKey, refresh = false) => {
    /* The step's await was the window in which the record may have been
       deleted — its rows are gone, so there is nothing left to finish. A stop
       that landed in the same window is not checked here: the work is done
       and stays done; the next start() is where the run halts. */
    if (!repo.getApplicationWithCompany(applicationId)) throw new Deleted();
    const step = byKey.get(key);
    if (!step) return;
    const row = runs.finishStep(step.id, stepLabel(key, AgentStepStatus.DONE, labelCtx()));
    byKey.set(key, row);
    if (current?.id === row.id) current = null;
    push(row, refresh);
  };

  /* A retry resumes the same run: finished steps are skipped, and whatever
     they produced is re-derived from where it landed — the listing from the
     run row, the extraction from the database, the documents from disk. */
  const pending = (key: AgentStepKey): boolean => {
    const step = byKey.get(key);
    return !!step && step.status !== AgentStepStatus.DONE;
  };

  try {
    /* ── Read the listing ─────────────────────────────────────────────── */
    let listing = runs.getRun(runId).listing ?? app.posting_text ?? '';
    if (pending(AgentStepKey.FETCH)) {
      start(AgentStepKey.FETCH);
      /* Pasted after a blocked fetch: the text is the listing — no scrape. */
      listing = app.posting_text ?? (await deps.scrape(app.posting_url ?? '', signal));
      /* Persisted the moment it exists: a stop landing between the fetch and
         the extract must not strand the run — a later retry would otherwise
         "succeed" on an empty listing. */
      runs.setListing(runId, listing);
      done(AgentStepKey.FETCH);
    } else if (!listing && app.posting_url) {
      /* A run stranded by an older build (fetch done, listing never stored):
         scrape again rather than working from nothing. */
      listing = await deps.scrape(app.posting_url, signal);
      runs.setListing(runId, listing);
    }

    /* ── Extract and apply the company details ────────────────────────── */
    let extraction: Extraction | null = null;
    if (pending(AgentStepKey.EXTRACT)) {
      start(AgentStepKey.EXTRACT);
      /* The no-fetch path (pasted text) also keeps what the run works from. */
      runs.setListing(runId, listing);
      extraction = await deps.llm({
        prompt: extractionPrompt(listing),
        schema: EXTRACTION_SCHEMA,
        validate: validateExtraction,
        timeoutMs: SINGLE_CALL_TIMEOUT,
        signal,
      });
      alive();
      applyExtraction(repo, applicationId, company, extraction);
      ({ application: app, company } = alive());
      /* The waiting document steps were planned before the company had a
         name — rewrite them now that it does. */
      for (const key of [AgentStepKey.GEN_CV, AgentStepKey.GEN_LETTER]) {
        const step = byKey.get(key);
        if (step && step.status === AgentStepStatus.WAIT) {
          byKey.set(key, runs.relabelStep(step.id, stepLabel(key, AgentStepStatus.WAIT, labelCtx())));
        }
      }
      done(AgentStepKey.EXTRACT, true);
    }
    /* On resume the extraction lives in the database — rebuild it from there
       (people are not reconstructable; the contact step researches instead). */
    const needExtraction = (): Extraction => (extraction ??= extractionFromDb(repo, applicationId));

    /* ── Contacts: from the listing, else researched ──────────────────── */
    if (pending(AgentStepKey.CONTACTS)) {
      start(AgentStepKey.CONTACTS);
      let people = needExtraction().people;
      if (!people.length) {
        const found = await deps.llm({
          prompt: contactPrompt(company.name, company.homepage, app.role),
          schema: CONTACT_SCHEMA,
          validate: validateContact,
          tools: ['WebSearch'],
          maxTurns: 8,
          timeoutMs: RESEARCH_TIMEOUT,
          signal,
        });
        /* Researched, not stated in the listing — say so on the person. */
        if (found)
          people = [{ ...found, role: found.role ? found.role + ' (unbestätigt)' : '(unbestätigt)' }];
      }
      alive();
      linkContacts(repo, applicationId, people);
      done(AgentStepKey.CONTACTS, true);
    }

    /* ── The uploaded templates ───────────────────────────────────────── */
    if (pending(AgentStepKey.READ_CV)) {
      start(AgentStepKey.READ_CV);
      readTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF);
      done(AgentStepKey.READ_CV);
    }
    if (pending(AgentStepKey.READ_LETTER)) {
      start(AgentStepKey.READ_LETTER);
      readTemplate(deps.userDataPath, TemplateKind.ANSCHREIBEN);
      done(AgentStepKey.READ_LETTER);
    }

    /* ── Generate both documents ──────────────────────────────────────── */
    /* The prompt input plus the label of the Fassung it was read from — the
       label is stamped on the generated document, never shown to the model. */
    const docInput = (kind: TemplateKind): { input: DocumentInput; label: string } => {
      const { html, label } = readTemplate(deps.userDataPath, kind);
      return {
        label,
        input: {
          template: html,
          listing,
          extraction: needExtraction(),
          profileFacts: repo.load().profileFacts.map((f) => f.text),
          contacts: linkedContacts(repo, applicationId),
          cv: kind === TemplateKind.ANSCHREIBEN ? cvTemplateText(deps.userDataPath) : null,
          company: company.name,
          role: app.role,
        },
      };
    };

    let cvHtml: string | null = null;
    if (pending(AgentStepKey.GEN_CV)) {
      start(AgentStepKey.GEN_CV);
      const { input, label } = docInput(TemplateKind.LEBENSLAUF);
      cvHtml = await generateDocument(deps, applicationId, DocumentKind.LEBENSLAUF, cvPrompt(input), label);
      done(AgentStepKey.GEN_CV, true);
    }

    let letterHtml: string | null = null;
    if (pending(AgentStepKey.GEN_LETTER)) {
      start(AgentStepKey.GEN_LETTER);
      const { input, label } = docInput(TemplateKind.ANSCHREIBEN);
      letterHtml = await generateDocument(
        deps,
        applicationId,
        DocumentKind.COVER_LETTER,
        letterPrompt(input),
        label,
      );
      done(AgentStepKey.GEN_LETTER, true);
    }

    /* ── Validate, then report ────────────────────────────────────────── */
    let issues: string[] = [];
    if (pending(AgentStepKey.VALIDATE)) {
      start(AgentStepKey.VALIDATE);
      issues = await deps.llm({
        prompt: checksPrompt(
          needExtraction(),
          cvHtml ?? readGeneratedHtml(deps.userDataPath, applicationId, DocumentKind.LEBENSLAUF),
          letterHtml ?? readGeneratedHtml(deps.userDataPath, applicationId, DocumentKind.COVER_LETTER),
        ),
        schema: CHECKS_SCHEMA,
        validate: validateChecks,
        timeoutMs: SINGLE_CALL_TIMEOUT,
        signal,
      });
      done(AgentStepKey.VALIDATE);
    }

    if (pending(AgentStepKey.COMMENT)) {
      start(AgentStepKey.COMMENT);
      alive();
      repo.addComment(applicationId, Author.KEPLER, finalComment(app.posting_url, issues));
      repo.addActivity(applicationId, Author.KEPLER, 'hat Firmendetails, Kontakte und Unterlagen ergänzt');
      done(AgentStepKey.COMMENT, true);
    }

    runs.finishRun(runId, 'Alle Schritte erledigt');
    push();
  } catch (err) {
    if (err instanceof Deleted) return;
    /* The card was deleted mid-step (which also aborted the run): its rows are
       gone with it, so there is nothing left to mark as failed. */
    if (!repo.getApplicationWithCompany(applicationId)) return;
    /* An abort surfaces from wherever the step was awaiting (the SDK, the
       scrape window) in varying shapes — the signal, not the error, decides. */
    const stopped = signal?.aborted || err instanceof Stopped;
    const message = stopped ? STOP_ERROR : userMessage(err);
    /* A stop between two steps has nothing in flight — the halt is pinned to
       the step that was about to run, so the retry has a place to resume. */
    if (!current && stopped) {
      current = runs.stepsFor(runId).find((s) => s.status !== AgentStepStatus.DONE) ?? null;
    }
    if (current) {
      const step: AgentStepRow = current;
      current = runs.failStep(step.id, stepLabel(step.key, AgentStepStatus.ERROR, labelCtx()), message);
    }
    runs.failRun(runId, INTERRUPTED_HEADLINE, message);
    push(current ?? undefined);
  }
}

/* Writes everything the extraction found through the same paths the sidebar
   uses, so the two write routes cannot diverge. */
function applyExtraction(repo: Repo, applicationId: string, company: CompanyRow, ex: Extraction): void {
  const appPatch: { role?: string; summary?: string } = {};
  if (ex.role) appPatch.role = ex.role;
  if (ex.summary) appPatch.summary = ex.summary;
  if (Object.keys(appPatch).length) repo.updateApplication(applicationId, appPatch);

  let companyId = company.id;
  if (ex.company.name && ex.company.name !== company.name) {
    companyId = repo.relinkCompany(applicationId, ex.company.name).company.id;
  }
  const patch: Record<string, string> = {};
  for (const key of ['sector', 'headcount', 'homepage', 'email', 'phone'] as const) {
    const value = ex.company[key];
    if (value) patch[key] = value;
  }
  if (Object.keys(patch).length) repo.updateCompany(companyId, patch);

  if (ex.standort) repo.upsertFact(applicationId, 'Standort', ex.standort, null);
  if (ex.gehalt) repo.upsertFact(applicationId, 'Gehalt', ex.gehalt, FactKind.SELECT);
  if (ex.erfahrung) repo.upsertFact(applicationId, 'Erfahrung', ex.erfahrung, FactKind.SELECT);
}

function linkContacts(repo: Repo, applicationId: string, people: ExtractedPerson[]): void {
  if (!people.length) return;
  /* A re-run extracts the same names again — reuse the rows the first run
     created instead of piling up duplicates. */
  const existing = repo.load().people;
  /* Contacts Kepler finds are filed under the card's company. */
  const company = repo.getApplicationWithCompany(applicationId)?.company.name ?? null;
  const ids = people.map((p) => {
    const match = existing.find((row) => row.name === p.name);
    if (match) return match.id;
    return repo.createPerson({
      name: p.name,
      role: p.role ?? undefined,
      email: p.email ?? undefined,
      phone: p.phone ?? undefined,
      linkedin: p.linkedin ?? undefined,
      company,
    }).person.id;
  });
  repo.setApplicationPeople(applicationId, LinkKind.CONTACT, ids);
}

/* The card's contacts as the letter prompt wants them — the rows written by
   linkContacts, so a resumed run addresses the same person as a fresh one. */
function linkedContacts(repo: Repo, applicationId: string): string[] {
  const { people, applicationPeople } = repo.load();
  return applicationPeople
    .filter((l) => l.application_id === applicationId && l.kind === LinkKind.CONTACT)
    .map((l) => people.find((p) => p.id === l.person_id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p) => (p.role ? `${p.name} (${p.role})` : p.name));
}

/* The Lebenslauf Fassung as the letter's source of facts about the applicant.
   Is null when none is uploaded — the letter step then works from the profile
   alone rather than failing for a slot it does not generate. */
function cvTemplateText(userDataPath: string): string | null {
  const selected = selectedTemplatePath(userDataPath, TemplateKind.LEBENSLAUF);
  return selected ? readFileSync(selected.path, 'utf8') : null;
}

/* On resume, everything the extraction wrote is read back from where it
   landed. People links are live rows rather than extraction output, so the
   list stays empty here — the contact step researches when it needs one. */
function extractionFromDb(repo: Repo, applicationId: string): Extraction {
  const ctx = repo.getApplicationWithCompany(applicationId);
  if (!ctx) throw new Deleted();
  const facts = repo.load().facts.filter((f) => f.application_id === applicationId);
  const fact = (label: string) => facts.find((f) => f.label === label)?.value ?? null;
  return {
    role: ctx.application.role,
    summary: ctx.application.summary,
    company: {
      name: ctx.company.name,
      sector: ctx.company.sector,
      headcount: ctx.company.headcount,
      homepage: ctx.company.homepage,
      email: ctx.company.email,
      phone: ctx.company.phone,
    },
    standort: fact('Standort'),
    gehalt: fact('Gehalt'),
    erfahrung: fact('Erfahrung'),
    people: [],
  };
}

/* A document generated by an earlier attempt of this run, for the checks. */
function readGeneratedHtml(userDataPath: string, applicationId: string, kind: DocumentKind): string {
  try {
    return readFileSync(documentPaths(userDataPath, applicationId, kind).htmlAbs, 'utf8');
  } catch {
    return '';
  }
}

/* The selected Fassung of a slot: its markup and the label the generated
   document is stamped with. */
function readTemplate(userDataPath: string, kind: TemplateKind): { html: string; label: string } {
  const selected = selectedTemplatePath(userDataPath, kind);
  if (!selected) {
    throw new KeplerError(
      `Keine ${TEMPLATE_TITLES[kind]}-Vorlage hochgeladen. Bitte im Profil (⌘P) eine HTML-Vorlage hinterlegen.`,
    );
  }
  return { html: readFileSync(selected.path, 'utf8'), label: selected.label };
}

/* Asks for the document, writes the HTML into the application's folder and
   renders the PDF beside it. A failed export keeps the HTML — losing the
   document because Chromium could not print it would be the wrong trade. */
async function generateDocument(
  deps: PipelineDeps,
  applicationId: string,
  kind: DocumentKind,
  prompt: string,
  templateLabel: string,
): Promise<string> {
  const html = await deps.llm({
    prompt,
    schema: DOCUMENT_SCHEMA as unknown as Record<string, unknown>,
    validate: validateDocumentHtml,
    timeoutMs: DOCUMENT_TIMEOUT,
    signal: deps.signal,
  });

  /* Deleted during the call: its files were already purged with it, and
     writing now would recreate a folder nothing ever cleans again. */
  if (!deps.repo.getApplicationWithCompany(applicationId)) throw new Deleted();

  const { htmlAbs, pdfAbs, pdfRel } = documentPaths(deps.userDataPath, applicationId, kind);
  mkdirSync(path.dirname(htmlAbs), { recursive: true });
  writeFileSync(htmlAbs, html);
  let storedPdf: string | null = pdfRel;
  try {
    await deps.renderPdf(htmlAbs, pdfAbs);
  } catch (err) {
    /* Keeping the HTML is the right trade — losing it because Chromium could
       not print would be worse. Discarding the reason as well is not: this is
       the failure a template with a blur shadow hits, and the run otherwise
       reports success with a document that silently has no PDF. */
    console.error('[agent] PDF-Export fehlgeschlagen', kind, err);
    rmSync(pdfAbs, { force: true });
    storedPdf = null;
  }

  const row = deps.repo
    .load()
    .documents.find((doc) => doc.application_id === applicationId && doc.kind === kind);
  if (row) {
    deps.repo.setDocumentFile(
      row.id,
      path.join('documents', applicationId, documentFileName(kind, 'html')),
      storedPdf,
      templateLabel,
    );
  } else {
    /* Both document rows are inserted at application creation, so this is a
       guard rather than a path — but silently orphaning the files it just
       wrote is not something to find out about from an empty card. */
    console.error('[agent] Kein Dokument-Row für', applicationId, kind);
  }
  return html;
}

function finalComment(postingUrl: string | null, issues: string[]): string {
  const lines = ['**Fertig** — Firmendetails, Kontakte und Unterlagen sind ergänzt.'];
  if (issues.length) {
    /* The prompt asks for at most three; the cap holds even when the model
       does not. */
    lines.push('', ...issues.slice(0, 3).map((i) => '• ' + i));
  }
  lines.push('', postingUrl ? `@Timo Hier bewerben: ${postingUrl}` : '@Timo Die Unterlagen sind bereit.');
  return lines.join('\n');
}

/* The deterministic step chain of one Kepler run — prompt chaining, not an
   autonomous agent: this file decides what happens next, the LLM only fills
   in single steps. Every dependency with a side channel (network, model,
   printing, events) is injected, so the whole pipeline runs in tests against
   fakes and an in-memory database. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Repo } from '../db/repo.ts';
import { documentPaths, readSelectedTemplate, resolveDocumentPath } from '../files.ts';
import type { AgentEvent } from '../../src/shared/agent.ts';
import type { AgentStepRow, ApplicationRow, CompanyRow } from '../../src/shared/db-types.ts';
import {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Author,
  DocumentKind,
  DocumentLanguage,
  FactKind,
  LANGUAGE_TITLES,
  LinkKind,
  TEMPLATE_TITLES,
  TemplateKind,
} from '../../src/shared/enums.ts';
import { INTERRUPTED_HEADLINE } from '../../src/shared/agent.ts';
import { KeplerError, userMessage } from './errors.ts';
import { fillPlaceholders, findPlaceholders } from './fill.ts';
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
  EXTRACTION_SCHEMA,
  FILL_SCHEMA,
  validateChecks,
  validateContact,
  validateExtraction,
  validateFill,
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
/* The document steps answer with a Fassung's placeholder values. Both the
   question and the answer are small now — the Fassung goes in as its text
   rather than its markup — but the values are the most considered writing
   Kepler does: the letter's requirement matrix is worked out here. */
const DOCUMENT_TIMEOUT = 180_000;

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
      applyExtraction(repo, applicationId, app, company, extraction);
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

    /* The side of the template slots this run reads. applyExtraction wrote
       the posting's language onto a card that had none, so by now the card
       always says — a resumed run reads the same side the first attempt
       wrote its files under. German for a card from before languages whose
       extraction step is already done. */
    const language: DocumentLanguage = app.language ?? DocumentLanguage.DE;

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
      readTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF, language);
      done(AgentStepKey.READ_CV);
    }
    if (pending(AgentStepKey.READ_LETTER)) {
      start(AgentStepKey.READ_LETTER);
      readTemplate(deps.userDataPath, TemplateKind.ANSCHREIBEN, language);
      done(AgentStepKey.READ_LETTER);
    }

    /* ── Generate both documents ──────────────────────────────────────── */
    /* The prompt input plus the label of the Fassung it was read from — the
       label is stamped on the generated document, never shown to the model. */
    const docInput = (kind: TemplateKind): { input: DocumentInput; templateLabel: string } => {
      const { html, label } = readTemplate(deps.userDataPath, kind, language);
      return {
        templateLabel: label,
        input: {
          template: html,
          language,
          listing,
          extraction: needExtraction(),
          profileFacts: repo.load().profileFacts.map((f) => f.text),
          contacts: linkedContacts(repo, applicationId),
          /* The Lebenslauf Fassung as the letter's source of facts about the
             applicant. Null when none is uploaded — the letter step then works
             from the profile alone rather than failing for a slot it does not
             generate. */
          cv:
            kind === TemplateKind.ANSCHREIBEN
              ? (readSelectedTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF, language)?.html ?? null)
              : null,
          company: company.name,
          role: app.role,
        },
      };
    };

    let cvHtml: string | null = null;
    if (pending(AgentStepKey.GEN_CV)) {
      start(AgentStepKey.GEN_CV);
      cvHtml = await generateDocument(deps, applicationId, {
        kind: DocumentKind.LEBENSLAUF,
        buildPrompt: cvPrompt,
        ...docInput(TemplateKind.LEBENSLAUF),
      });
      done(AgentStepKey.GEN_CV, true);
    }

    let letterHtml: string | null = null;
    if (pending(AgentStepKey.GEN_LETTER)) {
      start(AgentStepKey.GEN_LETTER);
      letterHtml = await generateDocument(deps, applicationId, {
        kind: DocumentKind.COVER_LETTER,
        buildPrompt: letterPrompt,
        ...docInput(TemplateKind.ANSCHREIBEN),
      });
      done(AgentStepKey.GEN_LETTER, true);
    }

    /* ── Validate, then report ────────────────────────────────────────── */
    let issues: string[] = [];
    if (pending(AgentStepKey.VALIDATE)) {
      start(AgentStepKey.VALIDATE);
      issues = await deps.llm({
        prompt: checksPrompt(
          needExtraction(),
          cvHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.LEBENSLAUF),
          letterHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.COVER_LETTER),
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
function applyExtraction(
  repo: Repo,
  applicationId: string,
  app: ApplicationRow,
  company: CompanyRow,
  ex: Extraction,
): void {
  const appPatch: { role?: string; summary?: string; language?: DocumentLanguage } = {};
  if (ex.role) appPatch.role = ex.role;
  if (ex.summary) appPatch.summary = ex.summary;
  /* The posting's language becomes the card's — unless the user already
     chose, which detection never overrides. Written even when the posting
     gave nothing (then German), so the card shows what the run went with and
     a later retry reads the same side. */
  if (!app.language) appPatch.language = ex.language ?? DocumentLanguage.DE;
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
    language: ctx.application.language,
    people: [],
  };
}

/* A document generated by an earlier attempt of this run, for the checks.
   Found through the row rather than by rebuilding the name from the card:
   the card's language can be changed between attempts, and the file on disk
   still carries the name the finished step wrote it under. Rebuilding it
   would miss, and the validation would pass judgement on an empty string. */
function readGeneratedHtml(deps: PipelineDeps, applicationId: string, kind: DocumentKind): string {
  const stored = deps.repo
    .load()
    .documents.find((doc) => doc.application_id === applicationId && doc.kind === kind)?.file_path;
  if (!stored) return '';
  try {
    return readFileSync(resolveDocumentPath(deps.userDataPath, stored), 'utf8');
  } catch {
    return '';
  }
}

/* The German adjective in the message that names an empty side. */
const LANGUAGE_ADJECTIVE: Record<DocumentLanguage, string> = {
  [DocumentLanguage.DE]: 'deutsche',
  [DocumentLanguage.EN]: 'englische',
};

/* The selected Fassung on the run's side of a slot: its markup and the label
   the generated document is stamped with. */
function readTemplate(
  userDataPath: string,
  kind: TemplateKind,
  language: DocumentLanguage,
): { html: string; label: string } {
  const selected = readSelectedTemplate(userDataPath, kind, language);
  if (!selected) {
    throw new KeplerError(
      `Keine ${LANGUAGE_ADJECTIVE[language]} ${TEMPLATE_TITLES[kind]}-Vorlage hochgeladen. Bitte im Profil (⌘P) unter „${LANGUAGE_TITLES[language]}“ eine HTML-Vorlage hinterlegen.`,
    );
  }
  return selected;
}

interface DocumentJob {
  kind: DocumentKind;
  /* The prompt is built here rather than handed in, so the Fassung the model is
     asked about and the one fillPlaceholders writes into cannot drift apart —
     everything outside a placeholder is copied from `input.template` rather
     than reproduced by the model, since a template carries tens of kilobytes of
     base64 and asking for it back returned it truncated. */
  buildPrompt: (input: DocumentInput) => string;
  input: DocumentInput;
  templateLabel: string;
}

/* Asks for the placeholder values, fills them into the Fassung, writes the
   HTML into the application's folder and renders the PDF beside it. A failed
   export keeps the HTML — losing the document because Chromium could not print
   it would be the wrong trade. */
async function generateDocument(
  deps: PipelineDeps,
  applicationId: string,
  { kind, buildPrompt, input, templateLabel }: DocumentJob,
): Promise<string> {
  const template = input.template;
  const values = await deps.llm({
    prompt: buildPrompt(input),
    schema: FILL_SCHEMA,
    /* An answer that skipped half the slots is a bad answer, not a failed
       step: complaining here rather than after the fill is what puts it in
       front of the runner, which asks once more with the reason attached. The
       `missing` check below stays as the backstop for whatever comes back. */
    validate: (x) => {
      const values = validateFill(x);
      const unanswered = findPlaceholders(template).filter((name) => values[name] === undefined);
      if (unanswered.length) throw new Error(`Platzhalter ohne Wert: ${unanswered.join(', ')}`);
      return values;
    },
    timeoutMs: DOCUMENT_TIMEOUT,
    signal: deps.signal,
  });

  /* Deleted during the call: its files were already purged with it, and
     writing now would recreate a folder nothing ever cleans again. */
  if (!deps.repo.getApplicationWithCompany(applicationId)) throw new Deleted();

  const { html, missing } = fillPlaceholders(template, values);
  /* A document that still shows {{…}} is worse than a failed step: the run
     would report success and the user would send it out. */
  if (missing.length) {
    throw new KeplerError(
      `Kepler hat diese Platzhalter der Vorlage nicht gefüllt: ${missing.join(', ')}. Bitte den Schritt erneut starten.`,
    );
  }

  const { htmlAbs, htmlRel, pdfAbs, pdfRel } = documentPaths(
    deps.userDataPath,
    applicationId,
    kind,
    input.language,
  );
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
    deps.repo.setDocumentFile(row.id, htmlRel, storedPdf, templateLabel);
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

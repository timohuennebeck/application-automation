/* The deterministic step chain of one Kepler run — prompt chaining, not an
   autonomous agent: this file decides what happens next, the LLM only fills
   in single steps. Every dependency with a side channel (network, model,
   printing, events) is injected, so the whole pipeline runs in tests against
   fakes and an in-memory database. */
import type { Repo } from '../db/repo.ts';
import type { AgentEvent } from '../../src/shared/agent.ts';
import type { AgentStepRow, ApplicationRow, CompanyRow } from '../../src/shared/db-types.ts';
import {
  AgentRunStatus,
  AgentStepKey,
  AgentStepStatus,
  Author,
  DocumentLanguage,
  FactKind,
} from '../../src/shared/enums.ts';
import { INTERRUPTED_HEADLINE } from '../../src/shared/agent.ts';
import { KeplerError, userMessage } from './errors.ts';
import { STOP_ERROR, stepLabel, type LabelCtx } from './labels.ts';
import { extractionPrompt } from './prompts.ts';
import type { RunStore } from './run-store.ts';
import { EXTRACTION_SCHEMA, validateExtraction, type Extraction, type TextKind } from './schemas.ts';

export interface LlmRequest<T> {
  prompt: string;
  schema: object;
  validate(x: unknown): T;
  /* Tool names the call may use; empty means a single plain completion. */
  tools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  /* Overrides the default model for this call. */
  model?: string;
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
  /* The day a document is written, which is the date it carries. Injected
     like every other side channel so a generated letter can be checked
     against a fixed date rather than against whatever the test ran on. */
  now?: () => Date;
  /* Aborted by the service when the user stops the run. */
  signal?: AbortSignal;
}

const SINGLE_CALL_TIMEOUT = 120_000;

/* What the run closes with. One line, deliberately without the finding
   bullets and the application link the comment used to carry. */
const FINAL_COMMENT = 'Fertig — Firmendetails, Kontakte und Unterlagen sind ergänzt.';

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
    if (pending(AgentStepKey.EXTRACT)) {
      start(AgentStepKey.EXTRACT);
      /* The no-fetch path (pasted text) also keeps what the run works from. */
      runs.setListing(runId, listing);
      const extraction = await deps.llm({
        prompt: extractionPrompt(listing),
        schema: EXTRACTION_SCHEMA,
        validate: validateExtraction,
        timeoutMs: SINGLE_CALL_TIMEOUT,
        signal,
      });
      /* Before anything is written: the scrape only checks length, so a
         cookie banner or an error page gets this far — and on the pasted-text
         path it never ran at all. Extracting either would rename the company
         and overwrite the card, which the user would have to undo by hand. */
      if (extraction.textKind && extraction.textKind !== 'posting') {
        throw new KeplerError(
          `Der hinterlegte Text sieht nach ${TEXT_KIND_LABEL[extraction.textKind]} aus, nicht nach einer Stellenanzeige. Bitte prüf den Link oder füge den Text der Anzeige ein.`,
        );
      }
      alive();
      applyExtraction(repo, applicationId, app, company, extraction);
      ({ application: app, company } = alive());
      done(AgentStepKey.EXTRACT, true);
    }

    /* ── Contacts are the user's to add ───────────────────────────────── */
    /* The research step was removed — contacts are searched and linked by
       hand now. A run planned before the removal still carries the row, so a
       resume closes it instead of leaving it waiting forever. */
    if (pending(AgentStepKey.CONTACTS)) {
      start(AgentStepKey.CONTACTS);
      done(AgentStepKey.CONTACTS);
    }

    /* Legacy like CONTACTS above: the CV and cover letter are no longer
       generated automatically — the user writes and uploads them by hand —
       so reading the uploaded Fassung, generating both documents, the Opus
       rating and the proofs check all go with it. Runs planned before the
       removal still carry these rows, so a resume closes them instead of
       leaving them waiting forever. */
    for (const key of [
      AgentStepKey.READ_CV,
      AgentStepKey.READ_LETTER,
      AgentStepKey.GEN_CV,
      AgentStepKey.GEN_LETTER,
      AgentStepKey.RATE,
      AgentStepKey.PROOFS,
    ]) {
      if (pending(key)) {
        start(key);
        done(key);
      }
    }

    /* Legacy like CONTACTS above: the standalone format check went with the
       findings comment it reported into — only rows from older runs remain. */
    if (pending(AgentStepKey.VALIDATE)) {
      start(AgentStepKey.VALIDATE);
      done(AgentStepKey.VALIDATE);
    }

    if (pending(AgentStepKey.COMMENT)) {
      start(AgentStepKey.COMMENT);
      alive();
      repo.addComment(applicationId, Author.KEPLER, FINAL_COMMENT);
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

/* What the run says it found instead, in the case the sentence needs. Typed
   without 'posting': that kind never reaches the message, and saying so here
   means the compiler agrees rather than a comment claiming it. */
const TEXT_KIND_LABEL: Record<Exclude<TextKind, 'posting'>, string> = {
  cookie_notice: 'einem Cookie-Hinweis',
  error_page: 'einer Fehlerseite',
  login_wall: 'einer Anmeldeseite',
  other: 'etwas anderem',
};

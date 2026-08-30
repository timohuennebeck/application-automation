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
import { fillPlaceholders, modelPlaceholders, systemValues } from './fill.ts';
import { PROOFS_REWRITE_LABEL, RATE_REWRITE_LABEL, STOP_ERROR, stepLabel, type LabelCtx } from './labels.ts';
import {
  cvPrompt,
  extractionPrompt,
  letterPrompt,
  proofsPrompt,
  ratingPrompt,
  type DocumentInput,
} from './prompts.ts';
import type { RunStore } from './run-store.ts';
import { overBudget, type OverBudget } from './budgets.ts';
import {
  EXTRACTION_SCHEMA,
  FILL_SCHEMA,
  PROOFS_SCHEMA,
  RATING_SCHEMA,
  validateExtraction,
  validateFill,
  validateProofs,
  validateRating,
  type Extraction,
  type TextKind,
  type UnsupportedClaim,
} from './schemas.ts';

export interface LlmRequest<T> {
  prompt: string;
  schema: object;
  validate(x: unknown): T;
  /* Tool names the call may use; empty means a single plain completion. */
  tools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  /* Overrides the default model for this call — the rating step asks Opus 5
     instead of the pipeline's Sonnet. */
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
/* The document steps answer with a Fassung's placeholder values. Both the
   question and the answer are small now — the Fassung goes in as its text
   rather than its markup — but the values are the most considered writing
   Kepler does: the letter's requirement matrix is worked out here. */
const DOCUMENT_TIMEOUT = 180_000;

/* The rating runs on Opus 5, not on the pipeline's Sonnet — a second pair of
   eyes only counts when it is a stronger one. Pinned to the id rather than
   the "opus" alias so a CLI whose alias moves cannot silently swap the
   reviewer out. */
const RATING_MODEL = 'claude-opus-5';

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
      /* Before anything is written: the scrape only checks length, so a
         cookie banner or an error page gets this far — and on the pasted-text
         path it never ran at all. Extracting either would rename the company,
         overwrite the card and generate two documents out of nothing, all of
         which the user would have to undo by hand. */
      if (extraction.textKind && extraction.textKind !== 'posting') {
        throw new KeplerError(
          `Der hinterlegte Text sieht nach ${TEXT_KIND_LABEL[extraction.textKind]} aus, nicht nach einer Stellenanzeige. Bitte prüf den Link oder füge den Text der Anzeige ein.`,
        );
      }
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

    /* ── Contacts are the user's to add ───────────────────────────────── */
    /* The research step was removed — contacts are searched and linked by
       hand now. A run planned before the removal still carries the row, so a
       resume closes it instead of leaving it waiting forever. */
    if (pending(AgentStepKey.CONTACTS)) {
      start(AgentStepKey.CONTACTS);
      done(AgentStepKey.CONTACTS);
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
          interestReason: app.interest_reason,
        },
      };
    };

    let cvHtml: string | null = null;
    if (pending(AgentStepKey.GEN_CV)) {
      start(AgentStepKey.GEN_CV);
      const generated = await generateDocument(deps, applicationId, {
        kind: DocumentKind.LEBENSLAUF,
        buildPrompt: cvPrompt,
        ...docInput(TemplateKind.LEBENSLAUF),
      });
      cvHtml = generated.html;
      done(AgentStepKey.GEN_CV, true);
    }

    let letterHtml: string | null = null;
    if (pending(AgentStepKey.GEN_LETTER)) {
      start(AgentStepKey.GEN_LETTER);
      const generated = await generateDocument(deps, applicationId, {
        kind: DocumentKind.COVER_LETTER,
        buildPrompt: letterPrompt,
        ...docInput(TemplateKind.ANSCHREIBEN),
      });
      letterHtml = generated.html;
      done(AgentStepKey.GEN_LETTER, true);
    }

    /* ── A second pair of eyes on the letter ──────────────────────────── */
    /* Opus 5 marks the finished Anschreiben 0–10 and names what would raise
       the score; anything named is worked into one regeneration. Advisory
       like PROOFS below: the letter on disk is correct whatever this call
       answers, so a broken rating must not sink the run. */
    if (pending(AgentStepKey.RATE)) {
      start(AgentStepKey.RATE);
      try {
        const rating = await deps.llm({
          prompt: ratingPrompt({
            letter: letterHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.COVER_LETTER),
            cv: readSelectedTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF, language)?.html ?? null,
            listing,
            company: company.name,
            role: app.role,
          }),
          schema: RATING_SCHEMA,
          validate: validateRating,
          timeoutMs: DOCUMENT_TIMEOUT,
          model: RATING_MODEL,
          signal,
        });
        if (rating.improvements.length) {
          alive();
          runs.setRunLabel(runId, RATE_REWRITE_LABEL);
          const rateStep = byKey.get(AgentStepKey.RATE);
          if (rateStep) {
            byKey.set(AgentStepKey.RATE, runs.relabelStep(rateStep.id, RATE_REWRITE_LABEL));
            push(byKey.get(AgentStepKey.RATE));
          }
          const generated = await generateDocument(deps, applicationId, {
            kind: DocumentKind.COVER_LETTER,
            buildPrompt: letterPrompt,
            ...docInput(TemplateKind.ANSCHREIBEN),
            complaint: ratingComplaint(rating.score, rating.improvements),
            /* The feedback already says what to change; a budget redo on top
               would make one unlucky letter three generations. */
            skipBudgetRedo: true,
          });
          letterHtml = generated.html;
        }
      } catch (err) {
        /* Deleted and Stopped are the pipeline's own control flow, not a
           rating failure — they still have to reach the run's outer catch. */
        if (err instanceof Deleted || err instanceof Stopped || signal?.aborted) throw err;
        console.error('[agent] Anschreiben-Bewertung fehlgeschlagen', err);
      }
      done(AgentStepKey.RATE, true);
    }

    /* ── Are the claims backed by the Lebenslauf? ─────────────────────── */
    if (pending(AgentStepKey.PROOFS)) {
      start(AgentStepKey.PROOFS);
      try {
        const cvFassung =
          readSelectedTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF, language)?.html ?? null;
        const profileFacts = repo.load().profileFacts.map((f) => f.text);
        /* On a resumed run the documents are not in memory — they are read back
           off disk. */
        const claims = await deps.llm({
          prompt: proofsPrompt({
            cv: cvHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.LEBENSLAUF),
            letter: letterHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.COVER_LETTER),
            cvFassung,
            profileFacts,
          }),
          schema: PROOFS_SCHEMA,
          validate: validateProofs,
          timeoutMs: SINGLE_CALL_TIMEOUT,
          signal,
        });
        /* Only the Anschreiben is rewritten. The Lebenslauf is copied from the
           Fassung and only its header line is generated, so a claim it makes is
           the Fassung's to fix, not Kepler's. One rewrite, no second reading:
           the closing comment stopped reporting findings, so the rewrite is
           the whole point of this step now. */
        const inLetter = claims.filter((c) => c.document === DocumentKind.COVER_LETTER);
        if (inLetter.length) {
          alive();
          runs.setRunLabel(runId, PROOFS_REWRITE_LABEL);
          const rewriteStep = byKey.get(AgentStepKey.PROOFS);
          if (rewriteStep) {
            byKey.set(AgentStepKey.PROOFS, runs.relabelStep(rewriteStep.id, PROOFS_REWRITE_LABEL));
            push(byKey.get(AgentStepKey.PROOFS));
          }
          const generated = await generateDocument(deps, applicationId, {
            kind: DocumentKind.COVER_LETTER,
            buildPrompt: letterPrompt,
            ...docInput(TemplateKind.ANSCHREIBEN),
            complaint: proofsComplaint(inLetter),
            /* Its complaint already says what to change; a budget redo on top
               would make one unlucky letter three generations. */
            skipBudgetRedo: true,
          });
          letterHtml = generated.html;
        }
      } catch (err) {
        /* PROOFS is advisory, exactly like the budget check the design (§3)
           already exempts from failing a step: both documents are on disk and
           correct no matter what this call answers, so a broken proofs call
           must not sink an otherwise finished run. Deleted and Stopped are the
           pipeline's own control flow rather than a proofs failure — they
           still have to reach the run's outer catch, not be swallowed here. */
        if (err instanceof Deleted || err instanceof Stopped || signal?.aborted) throw err;
        console.error('[agent] Belege-Prüfung fehlgeschlagen', err);
      }
      done(AgentStepKey.PROOFS, true);
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

/* The card's contacts as the letter prompt wants them — whatever the user
   linked by hand, so a resumed run addresses the same person as a fresh one. */
function linkedContacts(repo: Repo, applicationId: string): string[] {
  const { people, applicationPeople } = repo.load();
  return applicationPeople
    .filter((l) => l.application_id === applicationId && l.kind === LinkKind.CONTACT)
    .map((l) => people.find((p) => p.id === l.person_id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p) => (p.role ? `${p.name} (${p.role})` : p.name));
}

/* On resume, everything the extraction wrote is read back from where it
   landed. */
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
    /* The step that asks this question is already DONE on a resumed run — it
       answered once, and the card exists because of it. */
    textKind: 'posting',
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
  /* Not '': the checks below read this to decide whether the document says
     anything unbacked, and an empty string answers "nothing unbacked" for
     every question they ask — a clean bill of health over a file nobody
     looked at. The caller decides what a failed read costs; PROOFS carries
     it into the comment, VALIDATE fails the step. */
  if (!stored) throw new KeplerError(`Die Datei zum ${DOCUMENT_LABEL[kind]} fehlt.`);
  try {
    return readFileSync(resolveDocumentPath(deps.userDataPath, stored), 'utf8');
  } catch {
    throw new KeplerError(`Die Datei zum ${DOCUMENT_LABEL[kind]} ist nicht mehr da.`);
  }
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
  /* Appended to the prompt as the reason this document is being written
     again. The proofs step passes the claims it could not find support for. */
  complaint?: string;
  /* The proofs rewrite sets this: its complaint already says what to change,
     and letting the budget ask a third time would triple the cost of one
     unlucky letter for a rule the redo cannot see the answer to anyway. */
  skipBudgetRedo?: boolean;
}

/* What the second ask says. It quotes the distance rather than only the rule:
   told "höchstens 25" against an answer of 40, the model cuts; told only that
   it was too long, it shortens by a word. */
function budgetComplaint(over: OverBudget[]): string {
  const lines = over.map((o) => `- ${o.slot}: höchstens ${o.budget} Wörter, erhalten ${o.words}`);
  return [
    '',
    'Diese Werte sind zu lang. Schreibe die ganze Antwort noch einmal, alle Platzhalter, und halte für diese die Wortzahl ein:',
    ...lines,
    'Kürze, indem du weglässt — nicht, indem du Wörter zusammenziehst.',
  ].join('\n');
}

/* What the rewrite after the Opus rating is told: the score as the verdict
   and the improvements verbatim — they were written to be actionable, and
   paraphrasing them here would only soften them. */
function ratingComplaint(score: number, improvements: string[]): string {
  return [
    '',
    `Ein zweiter Prüfer hat das bisherige Anschreiben mit ${score}/10 bewertet. Schreibe die ganze Antwort noch einmal, alle Platzhalter, und setze diese Verbesserungen um:`,
    ...improvements.map((i) => `- ${i}`),
    'Alle Faktenregeln gelten unverändert — erfinde nichts, was Lebenslauf und Profil nicht hergeben.',
  ].join('\n');
}

/* What the rewrite is told. The claims are quoted in the document's own words
   so the model can find them, and the reason is quoted with them — "nicht im
   CV" and "Fassung sagt 12.000" call for different repairs. */
function proofsComplaint(claims: UnsupportedClaim[]): string {
  return [
    '',
    'Diese Aussagen im bisherigen Anschreiben sind durch <lebenslauf> und <profil> nicht gedeckt. Schreibe die ganze Antwort noch einmal, alle Platzhalter, und stütze dich nur auf Belegtes:',
    ...claims.map((c) => `- „${c.quote}“ — ${c.why}`),
  ].join('\n');
}

/* Asks for the placeholder values, fills them into the Fassung, writes the
   HTML into the application's folder and renders the PDF beside it. A failed
   export keeps the HTML — losing the document because Chromium could not print
   it would be the wrong trade. */
async function generateDocument(
  deps: PipelineDeps,
  applicationId: string,
  { kind, buildPrompt, input, templateLabel, complaint, skipBudgetRedo }: DocumentJob,
): Promise<{ html: string; overBudget: OverBudget[] }> {
  const template = input.template;
  const basePrompt = buildPrompt(input) + (complaint ?? '');
  const ask = (prompt: string) =>
    deps.llm({
      prompt,
      schema: FILL_SCHEMA,
      /* An answer that skipped half the slots is a bad answer, not a failed
         step: complaining here rather than after the fill is what puts it in
         front of the runner, which asks once more with the reason attached. */
      validate: (x) => {
        const values = validateFill(x);
        const unanswered = modelPlaceholders(template).filter((name) => values[name] === undefined);
        if (unanswered.length) throw new Error(`Platzhalter ohne Wert: ${unanswered.join(', ')}`);
        return values;
      },
      timeoutMs: DOCUMENT_TIMEOUT,
      signal: deps.signal,
    });

  /* Scoped to this Fassung's own slots: a value for a placeholder the
     template does not carry is discarded by fillPlaceholders below and never
     reaches the document, so measuring it against a budget is measuring
     nothing — and redoing a 180 s generation over it would cost real time for
     no change anyone would see. */
  const slots = modelPlaceholders(template);
  const overForThisTemplate = (v: Record<string, string>) =>
    overBudget(v).filter((o) => slots.includes(o.slot));

  let values = await ask(basePrompt);
  let over = overForThisTemplate(values);
  /* One redo, and then whatever it says. This is deliberately not routed
     through validate(): a validator that throws gets one retry from
     createLlmRunner and fails the step after it, which is right for a
     malformed answer and wrong here — a letter a few words too long is worth
     having, and the user is told about it in the closing comment instead. */
  if (over.length && !skipBudgetRedo) {
    values = await ask(basePrompt + budgetComplaint(over));
    over = overForThisTemplate(values);
  }

  /* Deleted during the call: its files were already purged with it, and
     writing now would recreate a folder nothing ever cleans again. */
  if (!deps.repo.getApplicationWithCompany(applicationId)) throw new Deleted();

  /* The slots the process fills itself go in beside the answers — never
     before them in the record, so a model that answered a system slot anyway
     cannot overwrite the value this side is sure of. */
  const { html, missing } = fillPlaceholders(template, {
    ...values,
    ...systemValues(input.language, deps.now?.() ?? new Date()),
  });
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
  return { html, overBudget: over };
}

const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  [DocumentKind.COVER_LETTER]: 'Anschreiben',
  [DocumentKind.LEBENSLAUF]: 'Lebenslauf',
  [DocumentKind.OTHER]: 'Dokument',
};

/* Answering a comment that addressed Kepler.

   Beside the pipeline, like the letter rewrite: one call, outside the queue,
   refused while a run holds the card. Unlike the rewrite it writes — the answer
   lands in the thread as a Kepler comment and travels back as that row, so the
   renderer appends it without a re-pull. Kepler reads the card, and — when the
   comment named one — the document it named; it may change that document, but
   nothing else. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Repo } from '../db/repo.ts';
import { resolveDocumentPath } from '../files.ts';
import type { RunStore } from './run-store.ts';
import type { AskRequest, AskResult } from '../../src/shared/agent.ts';
import type {
  CommentEditRow,
  CommentRow,
  DbSnapshot,
  DocumentEdit,
  DocumentRow,
  RoundNoteRow,
} from '../../src/shared/db-types.ts';
import { APPLICANT_NAME } from '../../src/shared/applicant.ts';
import { Author, AUTHOR_LABEL, DocumentKind, RoundState } from '../../src/shared/enums.ts';
import { applyEdits, reverseEdits } from './edits.ts';
import type { LlmRunner } from './orchestrator.ts';
import { askPrompt, documentExcerpt } from './prompts.ts';
import type { AskComment, AskDocument, AskInput, AskInterview } from './prompts.ts';
import { ASK_SCHEMA, validateAsk } from './schemas.ts';
import { userMessage } from './errors.ts';

/* One answer, not a document: a stuck call holds a thread the user is
   watching. */
const ASK_TIMEOUT = 90_000;

interface AskDeps {
  repo: Repo;
  runs: RunStore;
  llm: LlmRunner;
  userDataPath: string;
  renderPdf(htmlAbs: string, pdfAbs: string): Promise<void>;
}

export interface AskService {
  ask(req: AskRequest): Promise<AskResult>;
  /* The retry icon on an applied answer: puts the document back and marks the
     set undone. */
  undo(applicationId: string, commentId: number): Promise<AskResult>;
  stop(applicationId: string): void;
}

/* What each document is mentioned as. The same strings the picker offers, so
   what the user clicked is what this finds. */
const DOCUMENT_MENTION: Record<DocumentKind, string> = {
  [DocumentKind.COVER_LETTER]: 'Anschreiben',
  [DocumentKind.LEBENSLAUF]: 'Lebenslauf',
  [DocumentKind.OTHER]: '',
};

/* Which documents this comment named. Read from the comment's own text rather
   than passed in by the renderer: the row is the record of what was asked, so
   a mention that never reached the text cannot cause a change. */
function mentionedDocuments(text: string): DocumentKind[] {
  const found: DocumentKind[] = [];
  for (const [kind, title] of Object.entries(DOCUMENT_MENTION) as [DocumentKind, string][]) {
    if (new RegExp('(?<![\\p{L}\\d@])@' + title + '(?![\\p{L}\\d])', 'u').test(text)) found.push(kind);
  }
  return found;
}

/* A stored row back into the shape edits.ts works in. The column names differ
   because `replace` is a SQLite function name; nothing else does. */
function fromRows(rows: CommentEditRow[]): DocumentEdit[] {
  return rows.map((r) => ({
    document: r.document,
    kind: r.kind,
    find: r.find_text,
    replace: r.replace_text,
    after: r.after_text,
  }));
}

const ROUND_STATE_LABEL: Record<RoundState, string> = {
  [RoundState.DONE]: 'erledigt',
  [RoundState.NEXT]: 'als Nächstes',
  [RoundState.OPEN]: 'offen',
};

/* Plain dates (due dates, appointments) carry no zone — reordering the string
   keeps them as written, where Date would read them as UTC midnight and hand
   back the day before west of Greenwich. Timestamps are stored in UTC and
   shown as the local day: a note written just after midnight belongs to that
   day, not the one before. */
function day(iso: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function entry(row: CommentRow | RoundNoteRow, asked = false): AskComment {
  return { author: AUTHOR_LABEL[row.author], date: day(row.created_at), text: row.text, asked };
}

/* Everything the card knows about itself, gathered from one snapshot so the
   thread, the rounds and the people are read at the same instant. */
function buildInput(
  snap: DbSnapshot,
  applicationId: string,
  asking: CommentRow,
  documents: AskDocument[],
): AskInput {
  const app = snap.applications.find((a) => a.id === applicationId)!;
  const company = snap.companies.find((c) => c.id === app.company_id);
  const stage = snap.stages.find((s) => s.id === app.stage_id);

  const card = [
    stage ? `Phase: ${stage.title}` : null,
    app.summary ? `Zusammenfassung: ${app.summary}` : null,
    app.channel ? `Kanal: ${app.channel}` : null,
    app.applied_at ? `Beworben am: ${day(app.applied_at)}` : null,
    app.applied_via ? `Beworben über: ${app.applied_via}` : null,
    ...snap.facts
      .filter((f) => f.application_id === applicationId)
      .sort((a, b) => a.position - b.position)
      .map((f) => `${f.label}: ${f.value}`),
  ].filter((line): line is string => line !== null);

  const people = snap.applicationPeople
    .filter((l) => l.application_id === applicationId)
    .map((l) => snap.people.find((p) => p.id === l.person_id))
    .filter((p) => p !== undefined)
    /* A person may be linked as contact and pool member at once. */
    .filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
    .map((p) => [p.name, p.role, p.email].filter(Boolean).join(' — '));

  const comments = snap.comments
    .filter((c) => c.application_id === applicationId)
    .map((c) => entry(c, c.id === asking.id));

  const interviews: AskInterview[] = snap.rounds
    .filter((r) => r.application_id === applicationId)
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      title: r.title,
      status: [ROUND_STATE_LABEL[r.state], r.scheduled_date ? day(r.scheduled_date) : null, r.location]
        .filter(Boolean)
        .join(', '),
      people: snap.roundPeople
        .filter((rp) => rp.round_id === r.id)
        .sort((a, b) => a.position - b.position)
        .map((rp) => snap.people.find((p) => p.id === rp.person_id)?.name)
        .filter((n): n is string => n !== undefined),
      notes: snap.roundNotes.filter((n) => n.round_id === r.id).map((n) => entry(n)),
    }));

  const followups = snap.followups
    .filter((f) => f.application_id === applicationId)
    .sort((a, b) => a.position - b.position)
    .map((f) => `${f.label} — fällig ${day(f.due_at)}${f.completed_at ? ' (erledigt)' : ''}`);

  return {
    company: company?.name ?? '',
    role: app.role,
    /* The user is the only one who writes here besides Kepler, and the thread
       renders "@Timo" as the same chip Kepler's run reports use. */
    askedBy: APPLICANT_NAME.split(' ')[0],
    card,
    people,
    comments,
    interviews,
    followups,
    profileFacts: snap.profileFacts.map((f) => f.text),
    documents,
  };
}

export function createAskService({ repo, runs, llm, userDataPath, renderPdf }: AskDeps): AskService {
  /* Questions on one card are answered in the order they were asked — a thread
     reads as a conversation, and two Kepler replies racing each other would
     not. Each card has its own chain, so cards do not wait on each other. */
  const chains = new Map<string, Promise<unknown>>();
  /* The call currently in the air per card — what stop() aborts. */
  const inFlight = new Map<string, AbortController>();

  /* Groups the edits by document, applies each group against that document's
     HTML, and — only if every group landed — writes the files and re-renders
     their PDFs. Returns the German reason on the first group that refused,
     with nothing written. Shared by ask() and undo(): the forward direction
     applies what the model returned, the backward direction applies
     reverseEdits() of what was stored, but both are one set placed atomically
     against the files on disk. */
  const writeGroups = async (
    applicationId: string,
    edits: DocumentEdit[],
  ): Promise<{ error: string | null }> => {
    const rows = repo.load().documents.filter((d) => d.application_id === applicationId);
    const planned: { row: DocumentRow; html: string }[] = [];
    for (const kind of new Set(edits.map((e) => e.document))) {
      const row = rows.find((d) => d.kind === kind);
      if (!row?.file_path) return { error: `Für ${DOCUMENT_MENTION[kind]} gibt es keine Datei.` };
      const html = readFileSync(resolveDocumentPath(userDataPath, row.file_path), 'utf8');
      const res = applyEdits(
        html,
        edits.filter((e) => e.document === kind),
      );
      /* All or nothing across every document, not just within one: the
         request was one request. */
      if (res.failed) return { error: res.reason };
      planned.push({ row, html: res.html });
    }
    for (const { row, html } of planned) {
      const abs = resolveDocumentPath(userDataPath, row.file_path!);
      writeFileSync(abs, html);
      const pdfAbs = abs.replace(/\.html?$/i, '.pdf');
      try {
        await renderPdf(abs, pdfAbs);
      } catch (err) {
        /* Same trade the orchestrator makes: the HTML is the document, and
           losing it because Chromium could not print would be worse. */
        console.error('[agent] PDF-Export nach Änderung fehlgeschlagen', err);
      }
      repo.setDocumentFile(row.id, row.file_path!, row.pdf_path, row.template_label);
    }
    return { error: null };
  };

  const answer = async (req: AskRequest): Promise<AskResult> => {
    if (!repo.getApplicationWithCompany(req.applicationId)) {
      return { ok: false, error: 'Unbekannte Bewerbung.' };
    }
    if (runs.activeRun(req.applicationId)) {
      return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
    }
    const snap = repo.load();
    const asking = snap.comments.find(
      (c) => c.id === req.commentId && c.application_id === req.applicationId,
    );
    if (!asking) return { ok: false, error: 'Kommentar nicht gefunden.' };

    /* Which documents the comment named, and whether the editor already has
       one of them open — Kepler must not write under a screen the user is
       typing in, and that is checked before the model is even asked. */
    const mentioned = mentionedDocuments(asking.text);
    if (req.openDocument && mentioned.includes(req.openDocument)) {
      return { ok: false, error: 'Das Dokument ist gerade im Editor offen. Schließ es, dann ändere ich es.' };
    }

    const documents: AskDocument[] = [];
    for (const kind of mentioned) {
      const row = snap.documents.find((d) => d.application_id === req.applicationId && d.kind === kind);
      if (!row?.file_path) continue;
      const html = readFileSync(resolveDocumentPath(userDataPath, row.file_path), 'utf8');
      documents.push({ kind, title: DOCUMENT_MENTION[kind], text: documentExcerpt(html) });
    }

    const controller = new AbortController();
    inFlight.set(req.applicationId, controller);
    try {
      const reply = await llm({
        prompt: askPrompt(buildInput(snap, req.applicationId, asking, documents)),
        schema: ASK_SCHEMA,
        validate: validateAsk,
        timeoutMs: ASK_TIMEOUT,
        signal: controller.signal,
      });
      /* The card may have gone while the model was thinking; the row would
         then be an orphan and the caller has nothing to show it in. */
      if (controller.signal.aborted || !repo.getApplicationWithCompany(req.applicationId)) {
        return { ok: false, error: 'Abgebrochen.' };
      }
      if (!reply.edits.length) {
        return {
          ok: true,
          comment: repo.addComment(req.applicationId, Author.KEPLER, reply.antwort).comment,
          edits: [],
        };
      }
      const written = await writeGroups(req.applicationId, reply.edits);
      if (written.error) {
        /* The prose still posts — with the reason appended, so the thread
           shows why nothing changed rather than a silent no-op. */
        const comment = repo.addComment(
          req.applicationId,
          Author.KEPLER,
          `${reply.antwort}\n\n${written.error}`,
        ).comment;
        return { ok: true, comment, edits: [] };
      }
      const comment = repo.addComment(req.applicationId, Author.KEPLER, reply.antwort).comment;
      return { ok: true, comment, edits: repo.addCommentEdits(comment.id, reply.edits) };
    } catch (err) {
      return { ok: false, error: userMessage(err) };
    } finally {
      inFlight.delete(req.applicationId);
    }
  };

  return {
    ask(req: AskRequest): Promise<AskResult> {
      const previous = chains.get(req.applicationId) ?? Promise.resolve();
      /* answer() never rejects, so the chain cannot poison; a queued question
         re-checks the card once its turn comes, since it may have gone by then. */
      const next = previous.then(() => answer(req));
      chains.set(req.applicationId, next);
      next.finally(() => {
        if (chains.get(req.applicationId) === next) chains.delete(req.applicationId);
      });
      return next;
    },

    /* The retry icon on an applied answer. The stored pairs turned around are
       the whole of it — if the document has moved on since, they no longer
       match and applyEdits refuses, which is the same guard the forward
       direction has. */
    async undo(applicationId: string, commentId: number): Promise<AskResult> {
      if (!repo.getApplicationWithCompany(applicationId)) {
        return { ok: false, error: 'Unbekannte Bewerbung.' };
      }
      if (runs.activeRun(applicationId)) {
        return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
      }
      const stored = repo.commentEdits(commentId).filter((r) => r.undone_at === null);
      if (!stored.length) return { ok: false, error: 'Diese Änderung wurde schon zurückgenommen.' };

      const written = await writeGroups(applicationId, reverseEdits(fromRows(stored)));
      if (written.error) return { ok: false, error: written.error };
      repo.markEditsUndone(commentId);
      return { ok: true, comment: repo.load().comments.find((c) => c.id === commentId)!, edits: [] };
    },

    /* The card is gone: end the call in the air rather than let it run out its
       timeout for an answer nobody will read. Anything still queued behind it
       finds no card when its turn comes and answers accordingly. */
    stop(applicationId: string): void {
      inFlight.get(applicationId)?.abort();
    },
  };
}

/* Answering a comment that addressed Kepler.

   Beside the pipeline, like the letter rewrite: one call, outside the queue,
   refused while a run holds the card. Unlike the rewrite it writes — the answer
   lands in the thread as a Kepler comment and travels back as that row, so the
   renderer appends it without a re-pull. Kepler reads only this card: its
   facts, people, thread, interviews and follow-ups. It answers; it does not
   touch documents or data. */
import type { Repo } from '../db/repo.ts';
import type { RunStore } from './run-store.ts';
import type { AskRequest, AskResult } from '../../src/shared/agent.ts';
import type { CommentRow, DbSnapshot, RoundNoteRow } from '../../src/shared/db-types.ts';
import { APPLICANT_NAME } from '../../src/shared/applicant.ts';
import { Author, AUTHOR_LABEL, RoundState } from '../../src/shared/enums.ts';
import type { LlmRunner } from './orchestrator.ts';
import { askPrompt } from './prompts.ts';
import type { AskComment, AskInput, AskInterview } from './prompts.ts';
import { ASK_SCHEMA, validateAsk } from './schemas.ts';
import { userMessage } from './errors.ts';

/* One answer, not a document: a stuck call holds a thread the user is
   watching. */
const ASK_TIMEOUT = 90_000;

interface AskDeps {
  repo: Repo;
  runs: RunStore;
  llm: LlmRunner;
}

export interface AskService {
  ask(req: AskRequest): Promise<AskResult>;
  stop(applicationId: string): void;
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
function buildInput(snap: DbSnapshot, applicationId: string, asking: CommentRow): AskInput {
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
  };
}

export function createAskService({ repo, runs, llm }: AskDeps): AskService {
  /* Questions on one card are answered in the order they were asked — a thread
     reads as a conversation, and two Kepler replies racing each other would
     not. Each card has its own chain, so cards do not wait on each other. */
  const chains = new Map<string, Promise<unknown>>();
  /* The call currently in the air per card — what stop() aborts. */
  const inFlight = new Map<string, AbortController>();

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

    const controller = new AbortController();
    inFlight.set(req.applicationId, controller);
    try {
      const antwort = await llm({
        prompt: askPrompt(buildInput(snap, req.applicationId, asking)),
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
      return { ok: true, comment: repo.addComment(req.applicationId, Author.KEPLER, antwort).comment };
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

    /* The card is gone: end the call in the air rather than let it run out its
       timeout for an answer nobody will read. Anything still queued behind it
       finds no card when its turn comes and answers accordingly. */
    stop(applicationId: string): void {
      inFlight.get(applicationId)?.abort();
    },
  };
}

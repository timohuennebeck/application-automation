/* Rewriting one marked passage of a finished letter.

   This sits beside the pipeline rather than inside it. A run is a chain of
   steps that writes documents and rows; this is a single call that writes
   nothing — the suggestions go back to the renderer and only land in the
   letter if the user picks one. Each still spawns the same CLI subprocess a run
   does, so how many may be in the air is bounded — and a card Kepler is already
   working on is off limits: the letter would be overwritten underneath the
   editor. */
import type { Repo } from '../db/repo.ts';
import type { RunStore } from './run-store.ts';
import { readSelectedTemplate } from '../files.ts';
import { TemplateKind } from '../../src/shared/enums.ts';
import type { VariantsRequest, VariantsResult } from '../../src/shared/agent.ts';
import type { LlmRunner } from './orchestrator.ts';
import { variantsPrompt } from './prompts.ts';
import { VARIANT_COUNT, VARIANTS_SCHEMA, validateVariants } from './schemas.ts';
import { userMessage } from './errors.ts';

/* Shorter than a document step: this is one small answer, and a stuck call
   holds a slot the user is waiting on. */
const VARIANTS_TIMEOUT = 90_000;

/* How many rewrites may be in the air at once. Each one is its own CLI
   subprocess, so this is not free — but a single slot meant marking a second
   passage had to wait out the first, which is most of the time this feature
   costs. Three is what a letter's worth of marking actually needs; beyond that
   the answer is to wait, not to spawn. */
const MAX_IN_FLIGHT = 3;

interface VariantsDeps {
  repo: Repo;
  runs: RunStore;
  userDataPath: string;
  llm: LlmRunner;
}

/* One rewrite in the air. Held as a record in a set rather than in a map keyed
   by callId: the renderer numbers its calls per editor mount, so two calls on
   one card can carry the same name across a remount — a keyed map would have
   the second silently overwrite the first, leaving it unstoppable, and the
   first's cleanup would then remove the second's entry. Identity cannot
   collide, so registering and cleaning up are exact. */
interface InFlightCall {
  applicationId: string;
  callId: string;
  controller: AbortController;
}

export interface VariantsService {
  suggest(req: VariantsRequest): Promise<VariantsResult>;
  stop(applicationId: string, callId?: string): void;
}

export function createVariantsService({ repo, runs, userDataPath, llm }: VariantsDeps): VariantsService {
  /* Every call in the air. Two things pull them: the passage's own stop, which
     names its call, and the editor closing, which takes the card's lot — nobody
     is waiting on those answers any more, and a call left running would hold
     one of the three slots for its full timeout. The set is also the count, so
     the two cannot drift apart. */
  const inFlightCalls = new Set<InFlightCall>();

  return {
    async suggest(req: VariantsRequest): Promise<VariantsResult> {
      const passage = req.passage.trim();
      if (!passage) return { ok: false, error: 'Keine Stelle markiert.' };

      const ctx = repo.getApplicationWithCompany(req.applicationId);
      if (!ctx) return { ok: false, error: 'Unbekannte Bewerbung.' };
      if (runs.activeRun(req.applicationId)) {
        return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
      }
      if (inFlightCalls.size >= MAX_IN_FLIGHT) {
        return { ok: false, error: `Kepler schreibt schon an ${MAX_IN_FLIGHT} Stellen — kurz warten.` };
      }

      const { application, company } = ctx;
      const call: InFlightCall = {
        applicationId: req.applicationId,
        callId: req.callId,
        controller: new AbortController(),
      };
      inFlightCalls.add(call);
      try {
        const variants = await llm({
          prompt: variantsPrompt({
            letter: req.letter,
            passage,
            instruction: req.instruction?.trim() || null,
            /* The text the run worked from, which is the scraped page when the
               card was created from a link; the pasted text is the fallback. */
            listing: runs.latestRun(req.applicationId)?.listing || application.posting_text || '',
            profileFacts: repo.load().profileFacts.map((f) => f.text),
            /* The same Lebenslauf Fassung the letter was written from, so a
               rewritten passage draws on the facts the rest of it already
               used. */
            cv: readSelectedTemplate(userDataPath, TemplateKind.LEBENSLAUF)?.html ?? null,
            company: company.name,
            role: application.role,
            count: VARIANT_COUNT,
          }),
          schema: VARIANTS_SCHEMA,
          validate: validateVariants,
          timeoutMs: VARIANTS_TIMEOUT,
          signal: call.controller.signal,
        });
        return { ok: true, variants };
      } catch (err) {
        return { ok: false, error: userMessage(err) };
      } finally {
        inFlightCalls.delete(call);
      }
    },

    /* One rewrite by its call id, or everything this card has in the air when
       no call is named. Both paths abort the SDK call, give the slot back and
       close the CLI subprocess behind it rather than leaving it to run out its
       timeout with nobody to hand the answer to. */
    stop(applicationId: string, callId?: string): void {
      for (const call of inFlightCalls) {
        if (call.applicationId !== applicationId) continue;
        if (callId !== undefined && call.callId !== callId) continue;
        /* The entry itself is left to the call's own finally: it is still in
           the air until its await unwinds, and it is the one that knows when
           the slot is actually free. */
        call.controller.abort();
      }
    },
  };
}

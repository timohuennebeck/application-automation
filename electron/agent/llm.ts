/* The bridge to Claude. createLlmRunner owns the one behavior worth testing —
   validate, retry once with the complaint, give up — while sdkInvoke is the
   thin adapter around the Agent SDK's query(): subscription auth via the
   spawned CLI's own login, structured output enforced by JSON Schema, and
   failures translated into German before anyone sees them. */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { KeplerError } from './errors.ts';
import type { LlmRequest, LlmRunner } from './orchestrator.ts';

/* Alias, not a dated id — quality/cost fits every step, and the subscription
   plans include it. */
const MODEL = 'sonnet';
const DEFAULT_TIMEOUT = 120_000;

export interface ModelCall {
  prompt: string;
  schema: object;
  tools: string[];
  maxTurns: number;
  timeoutMs: number;
  /* The run's stop signal; the call is aborted the moment it fires. */
  signal?: AbortSignal;
}

export type ModelInvoke = (call: ModelCall) => Promise<unknown>;

export function createLlmRunner(invoke: ModelInvoke): LlmRunner {
  return async <T>(req: LlmRequest<T>): Promise<T> => {
    const call: ModelCall = {
      prompt: req.prompt,
      schema: req.schema,
      tools: req.tools ?? [],
      maxTurns: req.maxTurns ?? 1,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT,
      signal: req.signal,
    };
    let complaint: string;
    try {
      return req.validate(await invoke(call));
    } catch (err) {
      /* Infrastructure failures (auth, timeout) won't get better on a second
         try; only an answer the validator rejected earns one. */
      if (err instanceof KeplerError || call.signal?.aborted) throw err;
      complaint = err instanceof Error ? err.message : String(err);
    }
    const retry = {
      ...call,
      prompt:
        call.prompt +
        `\n\nDie vorige Antwort war ungültig (${complaint}). Antworte erneut und halte dich exakt an das Schema.`,
    };
    return req.validate(await invoke(retry));
  };
}

/* Maps whatever the SDK/CLI failed with onto a message the panel can show.
   `timedOut` is our own clock — the SDK's abort surfaces in shapes that vary
   by version, so whether the deadline fired is not read off the error. */
function classify(err: unknown, timedOut: boolean): KeplerError {
  if (timedOut) return new KeplerError('Zeitüberschreitung bei der Anfrage an Claude.');
  /* Aborted by the user's stop — the orchestrator writes the real message. */
  if (err instanceof Error && err.name === 'AbortError') return new KeplerError('Abgebrochen.');
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (/login|log in|logged out|authenticat|api key|credential|unauthorized|oauth/.test(lower)) {
    return new KeplerError(
      'Claude Code ist nicht angemeldet. Bitte im Terminal einmal `claude` starten und anmelden.',
    );
  }
  return new KeplerError('Anfrage an Claude fehlgeschlagen: ' + raw);
}

export function sdkInvoke(): ModelInvoke {
  return async ({ prompt, schema, tools, maxTurns, timeoutMs, signal }) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    /* The user's stop rides the same controller as the deadline — and it
       also settles `stopped` on the spot: the SDK only lets the stream end
       once it has torn the CLI subprocess down, which takes a couple of
       seconds the panel should not spend spinning. The step fails at once;
       the teardown finishes on its own in the background. */
    let onStop = () => controller.abort();
    const stopped = new Promise<never>((_, reject) => {
      onStop = () => {
        controller.abort();
        reject(new KeplerError('Abgebrochen.'));
      };
    });
    stopped.catch(() => {});
    if (signal?.aborted) onStop();
    else signal?.addEventListener('abort', onStop, { once: true });
    try {
      const q = query({
        prompt,
        options: {
          model: MODEL,
          maxTurns,
          /* `tools` is the restriction ([] = no built-in tools at all);
             `allowedTools` only pre-approves what exists, so with no
             canUseTool callback nothing may ever wait on a prompt. Both are
             needed: prompts embed untrusted listing text, and an unrestricted
             toolset would hand an injected listing whatever the user's own
             allowlist auto-approves. */
          tools,
          allowedTools: tools,
          /* Isolation mode: never load ~/.claude or project settings/CLAUDE.md
             into Kepler's calls. */
          settingSources: [],
          /* The one place our schema objects meet the SDK's index-signature
             type — cast here rather than at every call site. */
          outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> },
          abortController: controller,
        },
      });
      const consume = async (): Promise<unknown> => {
        for await (const message of q) {
          if (message.type !== 'result') continue;
          if (message.subtype === 'success') {
            if (message.structured_output !== undefined) return message.structured_output;
            /* No structured payload despite the schema — hand the raw text to
               the validator, whose complaint drives the retry. */
            return message.result;
          }
          throw new Error(`${message.subtype} (stop_reason: ${message.stop_reason ?? 'unbekannt'})`);
        }
        /* An aborted stream may simply end without a result message. */
        throw new Error('Claude hat nicht geantwortet.');
      };
      const stream = consume();
      /* Once the stop won the race, whatever the stream ends with is noise. */
      stream.catch(() => {});
      return await Promise.race([stream, stopped]);
    } catch (err) {
      throw classify(err, timedOut);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onStop);
    }
  };
}

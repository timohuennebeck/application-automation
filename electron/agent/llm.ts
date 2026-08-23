/* The bridge to Claude. createLlmRunner owns the one behavior worth testing —
   validate, retry once with the complaint, give up — while sdkInvoke is the
   thin adapter around the Agent SDK's query(): subscription auth via the
   spawned CLI's own login, structured output enforced by JSON Schema, and
   failures translated into German before anyone sees them. */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeCliPath } from './cli-path.ts';
import { KeplerError } from './errors.ts';
import type { LlmRequest, LlmRunner } from './orchestrator.ts';

/* Alias, not a dated id — quality/cost fits every step, and the subscription
   plans include it. */
const MODEL = 'sonnet';
const DEFAULT_TIMEOUT = 120_000;

interface ModelCall {
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
      /* Two, not one. A single structured completion still takes the model an
         assistant turn to answer and the CLI another to emit the structured
         output, so `maxTurns: 1` fails with error_max_turns on every prompt
         long enough to matter — which is all of them. Verified against the
         real extraction prompt: 1 fails, 2 answers. This is a floor for a
         non-agentic call, not a budget; the one step that actually loops
         (contact research) asks for 8. */
      maxTurns: req.maxTurns ?? 2,
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
    /* Held outside the try so the finally can close it on every path. */
    let pending: ReturnType<typeof query> | undefined;
    try {
      const q = (pending = query({
        prompt,
        options: {
          /* See cli-path.ts — the SDK's own lookup lands inside app.asar. */
          pathToClaudeCodeExecutable: claudeCliPath(),
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
             into Kepler's calls. settingSources covers settings files only —
             strictMcpConfig is the separate lever that stops a project
             .mcp.json contributing mcp__* tools, which `tools: []` does not
             govern because they are not built-ins. */
          settingSources: [],
          strictMcpConfig: true,
          /* Nothing here resumes a session, and the transcript would carry the
             user's CV, letter and contacts into ~/.claude/projects — outside
             userData, unpruned, in an app that is otherwise local-first. */
          persistSession: false,
          /* Without this the CLI's own startup failures are discarded, which
             is the difference between a diagnosable packaged build and one
             opaque German sentence. */
          stderr: (data) => console.error('[kepler cli]', data.trimEnd()),
          /* The one place our schema objects meet the SDK's index-signature
             type — cast here rather than at every call site. */
          outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> },
          abortController: controller,
        },
      }));
      const consume = async (): Promise<unknown> => {
        for await (const message of q) {
          if (message.type !== 'result') continue;
          if (message.subtype === 'success') {
            if (message.structured_output !== undefined) return message.structured_output;
            /* No structured payload despite the schema — hand the raw text to
               the validator, whose complaint drives the retry. */
            return message.result;
          }
          /* The CLI reports many failures — an expired login among them — as an
             error result rather than a throw, with the real text in errors[].
             Drop it and classify() can never match its auth pattern. */
          const detail = message.errors?.length
            ? message.errors.join('; ')
            : `stop_reason: ${message.stop_reason ?? 'unbekannt'}`;
          throw new Error(`${message.subtype} (${detail})`);
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
      /* A no-op once consume() returned; on the stop and timeout paths it is
         the documented teardown. Without it the 300 MB CLI subprocess is left
         to wind itself down with nothing bounding how long that takes. */
      pending?.close();
    }
  };
}

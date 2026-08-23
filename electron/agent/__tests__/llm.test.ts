import { describe, expect, it, vi } from 'vitest';
import { classify, createLlmRunner } from '../llm.ts';
import { KeplerError } from '../errors.ts';

const SCHEMA = { type: 'object' };
const request = (validate: (x: unknown) => string) => ({
  prompt: 'Extrahiere …',
  schema: SCHEMA,
  validate,
});

describe('createLlmRunner', () => {
  it('validates and returns the model output', async () => {
    const invoke = vi.fn(async () => ({ value: 'ok' }));
    const run = createLlmRunner(invoke);
    const out = await run(request((x) => (x as { value: string }).value));
    expect(out).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('retries once with the complaint appended, then succeeds', async () => {
    const invoke = vi
      .fn<(call: { prompt: string }) => Promise<unknown>>()
      .mockResolvedValueOnce({ kaputt: true })
      .mockResolvedValueOnce({ value: 'ok' });
    const run = createLlmRunner(invoke);

    const out = await run(
      request((x) => {
        const v = (x as { value?: string }).value;
        if (!v) throw new Error('value fehlt');
        return v;
      }),
    );

    expect(out).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0].prompt).toContain('value fehlt');
  });

  it('gives up after the second invalid answer', async () => {
    const invoke = vi.fn(async () => ({ kaputt: true }));
    const run = createLlmRunner(invoke);
    await expect(
      run(
        request(() => {
          throw new Error('value fehlt');
        }),
      ),
    ).rejects.toThrow('value fehlt');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer that came back after the run was stopped', async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      throw new Error('stream ended');
    });
    const run = createLlmRunner(invoke);
    await expect(run({ ...request(() => 'x'), signal: controller.signal })).rejects.toThrow('stream ended');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('leaves the model turns to spare beyond the one the answer costs', async () => {
    const invoke = vi.fn<(call: { maxTurns: number }) => Promise<unknown>>(async () => ({ value: 'ok' }));
    const run = createLlmRunner(invoke);
    await run(request(() => 'x'));
    expect(invoke.mock.calls[0][0].maxTurns).toBe(3);
  });

  it('leaves a step that asked for its own turn budget alone', async () => {
    const invoke = vi.fn<(call: { maxTurns: number }) => Promise<unknown>>(async () => ({ value: 'ok' }));
    const run = createLlmRunner(invoke);
    await run({ ...request(() => 'x'), maxTurns: 8 });
    expect(invoke.mock.calls[0][0].maxTurns).toBe(8);
  });

  it('asks again after a retryable failure, with the prompt untouched', async () => {
    const invoke = vi
      .fn<(call: { prompt: string }) => Promise<unknown>>()
      .mockRejectedValueOnce(new KeplerError('Anfrage an Claude fehlgeschlagen: error_max_turns', true))
      .mockResolvedValueOnce({ value: 'ok' });
    const run = createLlmRunner(invoke);

    const out = await run(request((x) => (x as { value: string }).value));

    expect(out).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(2);
    /* Nothing was wrong with the answer — there was no answer. */
    expect(invoke.mock.calls[1][0].prompt).toBe(invoke.mock.calls[0][0].prompt);
  });

  it('passes infrastructure errors straight through without retrying', async () => {
    const invoke = vi.fn(async () => {
      throw new KeplerError('Claude Code ist nicht angemeldet.');
    });
    const run = createLlmRunner(invoke);
    await expect(run(request(() => 'x'))).rejects.toThrow('nicht angemeldet');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('classify', () => {
  it('marks a call that ran out of turns as worth asking again', () => {
    const err = classify(new Error('error_max_turns (Reached maximum number of turns (1))'), false);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('error_max_turns');
  });

  it('marks exhausted structured-output retries the same way', () => {
    expect(classify(new Error('error_max_structured_output_retries (…)'), false).retryable).toBe(true);
  });

  it('settles the failures a second ask cannot fix', () => {
    expect(classify(new Error('Invalid API key'), false).retryable).toBe(false);
    expect(classify(new Error('error_during_execution (boom)'), false).retryable).toBe(false);
    expect(classify(new Error('irgendwas'), true).retryable).toBe(false);
  });

  it('still names the login as the fix when the CLI is logged out', () => {
    expect(classify(new Error('error_during_execution (Please log in)'), false).message).toContain(
      'nicht angemeldet',
    );
  });
});

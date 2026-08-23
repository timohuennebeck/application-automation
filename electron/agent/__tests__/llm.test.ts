import { describe, expect, it, vi } from 'vitest';
import { createLlmRunner } from '../llm.ts';
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

  it('gives a plain completion two turns, so the structured answer fits', async () => {
    /* One turn is not enough: the model answers in one and the CLI emits the
       structured output in another, so every real prompt came back
       error_max_turns. Every Kepler run failed at its first step. */
    const invoke = vi.fn<(call: { maxTurns: number }) => Promise<unknown>>().mockResolvedValue({});

    await createLlmRunner(invoke)({ prompt: 'p', schema: SCHEMA, validate: (x) => x });

    expect(invoke.mock.lastCall?.[0].maxTurns).toBe(2);
  });

  it('lets a step ask for more turns than the floor', async () => {
    /* The contact step actually loops — it searches the web — so the floor
       is a floor, not a budget. */
    const invoke = vi.fn<(call: { maxTurns: number }) => Promise<unknown>>().mockResolvedValue({});

    await createLlmRunner(invoke)({ prompt: 'p', schema: SCHEMA, validate: (x) => x, maxTurns: 8 });

    expect(invoke.mock.lastCall?.[0].maxTurns).toBe(8);
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

  it('passes infrastructure errors straight through without retrying', async () => {
    const invoke = vi.fn(async () => {
      throw new KeplerError('Claude Code ist nicht angemeldet.');
    });
    const run = createLlmRunner(invoke);
    await expect(run(request(() => 'x'))).rejects.toThrow('nicht angemeldet');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

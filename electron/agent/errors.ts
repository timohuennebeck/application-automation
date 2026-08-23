/* A failure whose message is written for the user — German, and safe to show
   verbatim in the run panel. Anything else that escapes a step is wrapped as
   "Unerwarteter Fehler" instead. */
export class KeplerError extends Error {
  /* Almost all of these are settled: an expired login or a blown deadline
     answers the same way the second time, so the runner gives up on them.
     `retryable` marks the exception — a failure of how the model behaved
     rather than of the machinery, which one more ask can still resolve. */
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export function userMessage(err: unknown): string {
  if (err instanceof KeplerError) return err.message;
  return 'Unerwarteter Fehler: ' + (err instanceof Error ? err.message : String(err));
}

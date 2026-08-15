/* A failure whose message is written for the user — German, and safe to show
   verbatim in the run panel. Anything else that escapes a step is wrapped as
   "Unerwarteter Fehler" instead. */
export class KeplerError extends Error {}

export function userMessage(err: unknown): string {
  if (err instanceof KeplerError) return err.message;
  return 'Unerwarteter Fehler: ' + (err instanceof Error ? err.message : String(err));
}

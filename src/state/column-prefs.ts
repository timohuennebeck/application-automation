import { COLUMNS, STAGE_IDS } from '../data/config';

const KEY = 'kb-columns';

/* Which board columns the user has folded away, kept across restarts the same
   way the detail sections are. Stored by stage id rather than column index so
   a reordered or newly inserted stage never reads another stage's setting. */
export function readColumnOpen(): boolean[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  return mergeColumnOpen(raw);
}

export function writeColumnOpen(open: boolean[]): void {
  const m: Record<string, boolean> = {};
  STAGE_IDS.forEach((id, i) => {
    m[id] = open[i] !== false;
  });
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/* Defaults from COLUMNS, overridden by whatever the saved map knows about;
   anything malformed falls back to the defaults. */
export function mergeColumnOpen(raw: string | null): boolean[] {
  const defaults = COLUMNS.map((c) => c.open);
  if (!raw) return defaults;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!saved || typeof saved !== 'object') return defaults;
  const m = saved as Record<string, unknown>;
  return STAGE_IDS.map((id, i) => (typeof m[id] === 'boolean' ? m[id] : defaults[i]));
}

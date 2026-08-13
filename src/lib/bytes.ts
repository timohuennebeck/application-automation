/* File sizes as they are quoted about documents: decimal units, at most one
   decimal place, German comma. */

const UNITS = [
  { limit: 1_000_000, factor: 1_000_000, suffix: 'MB' },
  { limit: 1_000, factor: 1_000, suffix: 'KB' },
] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  for (const { limit, factor, suffix } of UNITS) {
    if (bytes < limit) continue;
    const value = bytes / factor;
    /* One decimal up to three digits, none beyond — "12,4 MB" still says
       something, "124,3 MB" only adds a digit nobody reads. */
    const text = value < 100 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
    return text.replace('.', ',') + ' ' + suffix;
  }
  return bytes + ' B';
}

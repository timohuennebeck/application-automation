export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);
}

export function cap(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/* Splits text around a search match so the middle run can be highlighted. */
export function highlight(text: string, q: string): { pre: string; mid: string; post: string } {
  const i = q ? String(text).toLowerCase().indexOf(q) : -1;
  if (i < 0) return { pre: text, mid: '', post: '' };
  return { pre: text.slice(0, i), mid: text.slice(i, i + q.length), post: text.slice(i + q.length) };
}

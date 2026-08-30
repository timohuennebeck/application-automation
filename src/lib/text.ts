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

/* Gender markers postings hang onto a title: "(m/w/d)", "(all genders)",
   "(gn)", bare "m/w/d", and the inflected "Entwickler*in" family. Without
   this the vocabulary grows a near-duplicate per posting — "Frontend Engineer"
   next to "Frontend Engineer (all genders)". */
const GENDER_MARKER =
  /\s*[-–—,|/]?\s*(?:[([]\s*(?:all\s+genders|gn|[mwfdx](?:\s*[/|,]\s*[mwfdx](?:iv)?){1,2})\s*[)\]]|\b[mwfdx](?:\s*[/|]\s*[mwfdx](?:iv)?){1,2}\b|\ball\s+genders\b)/giu;
const INFLECTION = /(\p{L}+)(?:\*|:|_|\/|\(|·)(?:in|innen)\)?(?=\W|$)/gu;

export function normalizeRole(role: string): string {
  return role
    .replace(GENDER_MARKER, '')
    .replace(INFLECTION, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—,|/:]+\s*$/u, '')
    .trim();
}

/* A value counts as a link only when it is a full web address — scheme
   included. "firma.de/karriere" or a bare word is text, not a URL; the sidebar
   link rows and the create dialog refuse it, and nothing renders it as a
   clickable pill. */
export function isHttpUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

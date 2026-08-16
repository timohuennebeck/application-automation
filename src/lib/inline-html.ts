/* Turning a model's answer into markup the letter can hold.

   A suggestion replaces a passage inside the user's own HTML document, so it
   cannot be trusted as markup: it is escaped first and only the handful of
   inline tags a letter actually uses are handed back. Escaping everything and
   then re-opening the few allowed forms is the safe order — the reverse leaves
   whatever the pattern failed to anticipate. */

/* Emphasis only. A letter needs no links, no spans, no styles, and anything
   that carries an attribute cannot be spelled with these patterns at all. */
const INLINE_TAGS = 'strong|em|b|i';

/* Ampersands that already spell an entity stay as they are; a bare one becomes
   one. Without the lookahead a model answering "&amp;" would render "&amp;". */
const BARE_AMPERSAND = /&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);)/gi;

export function sanitizeInline(html: string): string {
  const escaped = html.replace(BARE_AMPERSAND, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(new RegExp(`&lt;(/?)(${INLINE_TAGS})&gt;`, 'gi'), (_m, slash: string, tag: string) => {
      return `<${slash}${tag.toLowerCase()}>`;
    })
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

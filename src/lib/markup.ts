/* What a document SAYS, not how it is styled: style/script and tags gone,
   the common entities of hand-written templates spelled out, whitespace
   folded. Block-level tags become line breaks so stations stay apart.

   Shared by both processes for the same reason: the main process reads a
   Fassung this way to build a prompt (electron/agent/prompts.ts), and the
   renderer reads a stored find/replace pair this way before showing it in
   the thread (src/state/selectors.ts) — the pair is kept with its markup
   because that is what has to match the file's own bytes (see
   documentMarkup in prompts.ts), but nobody reading the thread should see a
   tag. One parser, so the two sides cannot drift apart on what a tag is. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&middot;': '·',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&ndash;': '–',
  '&mdash;': '—',
  /* German templates are hand-written HTML, and an author who escapes at all
     escapes these. Left out, "Zust&auml;ndig" reached the thread as
     "Zust ndig" — the edit lines this feeds are what the user reads to decide
     whether to take a change back. */
  '&auml;': 'ä',
  '&ouml;': 'ö',
  '&uuml;': 'ü',
  '&Auml;': 'Ä',
  '&Ouml;': 'Ö',
  '&Uuml;': 'Ü',
  '&szlig;': 'ß',
  '&eacute;': 'é',
  '&hellip;': '…',
  '&apos;': "'",
  '&bdquo;': '„',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&sbquo;': '‚',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&shy;': '',
};

/* Out of range for String.fromCodePoint, or a surrogate half — a malformed
   entity, left as it was written rather than thrown over. */
function codePoint(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
  return String.fromCodePoint(n);
}

export function stripMarkup(html: string): string {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      /* A printed application document has no buttons — this rule needs no
       knowledge of any particular template, a <button> is app chrome by
       definition. Accepted gap: [\s\S]*? is unbounded, so a malformed,
       unclosed <button> swallows everything up to the next </button>
       anywhere later in the document, or to the end. Left as-is — a
       <button> is unambiguously chrome, so even the mangled case never
       eats real prose the model should have judged as content. */
      .replace(/<button\b[\s\S]*?<\/button>/gi, ' ')
      /* class="toolbar" and class="edit-hint" are not this module's classes —
       they name the Fassung editor's own on-screen controls (see the same
       two classes in src/features/letter/letter-styles.ts, which hides them
       the same way for the same reason: dead weight in a frame that never
       prints, here dead weight in front of a reader seeing what the
       document says). Dropped by name because, unlike a <button>, nothing
       about the tag itself says "chrome". The templates are user-authored
       HTML this codebase doesn't control, so the class attribute is matched
       double-quoted, single-quoted or bare, and the class value as a token
       list — (?<![\w-])…(?![\w-]) requires a real token boundary, not just
       \b, since "-" is a non-word character and would let "toolbar-note" or
       "sub-toolbar" match a plain \b(?:toolbar|edit-hint)\b and drop real
       document content. The bare-value branch checks the same boundary
       rather than the whole token, but needs no scan for other tokens: an
       unquoted HTML attribute value ends at the first space, so it can only
       ever hold the one token. */
      .replace(
        /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*(?:"[^"]*(?<![\w-])(?:toolbar|edit-hint)(?![\w-])[^"]*"|'[^']*(?<![\w-])(?:toolbar|edit-hint)(?![\w-])[^']*'|(?<![\w-])(?:toolbar|edit-hint)(?![\w-]))[^>]*>[\s\S]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      /* Numeric forms too, and an unrecognised entity is left as written
         rather than becoming a space: swallowing it silently turned
         "Berlin&#8211;Mitte" into "Berlin Mitte" and "Zust&auml;ndig" into
         "Zust ndig", which reads as the document's own wording. Named
         entities are case-sensitive (&Auml; is not &auml;), so the exact
         spelling is tried before the lenient lowercase fallback. */
      .replace(/&#(\d+);|&#x([0-9a-f]+);|&([a-z][a-z0-9]*);/gi, (raw, dec, hex, name) => {
        if (dec !== undefined) return codePoint(Number(dec)) ?? raw;
        if (hex !== undefined) return codePoint(parseInt(hex, 16)) ?? raw;
        return ENTITIES[`&${name};`] ?? ENTITIES[`&${String(name).toLowerCase()};`] ?? raw;
      })
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
  );
}

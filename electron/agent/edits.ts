/* Placing Kepler's changes in a document, and taking them back out.

   This is the one part of the feature with no side channel: a string and a
   set of pairs go in, a string comes out. Everything else trusts the rule it
   carries, which is why it lives alone and is tested without a database, a
   model or a window.

   The rule is strict on purpose. Kepler writes here without asking, so a
   passage that cannot be placed beyond doubt is not placed at all — the wrong
   paragraph silently rewritten is the failure that matters, and it is the one
   nobody would notice until the application had gone out. */
import type { DocumentEdit } from '../../src/shared/db-types.ts';
import { EditKind } from '../../src/shared/enums.ts';

export interface ApplyResult {
  html: string;
  /* The edit that could not be placed, or null when every one was. */
  failed: DocumentEdit | null;
  /* German, shown in the thread as-is. Null when nothing failed. */
  reason: string | null;
}

/* The passage an edit is located by: what it replaces or deletes, or the
   anchor it is inserted after. */
function needle(edit: DocumentEdit): string {
  return edit.kind === EditKind.INSERT ? (edit.after ?? '') : edit.find;
}

/* Verbatim, with no normalisation. Normalising entities would mean mapping
   indices from a normalised view back onto the real bytes, and that mapping is
   exactly where a write-without-asking path should not be clever: a passage
   carrying &amp; simply misses, and is refused like any other miss. */
function occurrences(html: string, text: string): number {
  if (!text) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = html.indexOf(text, from);
    if (at < 0) return count;
    count++;
    from = at + text.length;
  }
}

/* Applies the set in order, each against what the previous one left. Nothing
   is written unless all of them land: a letter whose recipient changed but
   whose salutation did not is worse than one left alone, and the half-changed
   state is the one a reader does not catch. */
export function applyEdits(html: string, edits: DocumentEdit[]): ApplyResult {
  let next = html;
  for (const edit of edits) {
    const text = needle(edit);
    const found = occurrences(next, text);
    if (found === 0) {
      return { html, failed: edit, reason: `„${text}“ steht so nicht im Dokument.` };
    }
    if (found > 1) {
      return { html, failed: edit, reason: `„${text}“ steht mehrfach im Dokument.` };
    }
    const at = next.indexOf(text);
    if (edit.kind === EditKind.INSERT) {
      next = next.slice(0, at + text.length) + edit.replace + next.slice(at + text.length);
    } else {
      next = next.slice(0, at) + edit.replace + next.slice(at + text.length);
    }
  }
  return { html: next, failed: null, reason: null };
}

/* The set that undoes this one. Each pair turns around, and the whole list
   turns around with it — an edit that built on its predecessor has to come
   out before that predecessor does. */
export function reverseEdits(edits: DocumentEdit[]): DocumentEdit[] {
  return [...edits].reverse().map((edit) => {
    if (edit.kind === EditKind.DELETE) {
      return { ...edit, kind: EditKind.INSERT, find: '', replace: edit.find };
    }
    if (edit.kind === EditKind.INSERT) {
      return { ...edit, kind: EditKind.DELETE, find: edit.replace, replace: '' };
    }
    return { ...edit, find: edit.replace, replace: edit.find };
  });
}

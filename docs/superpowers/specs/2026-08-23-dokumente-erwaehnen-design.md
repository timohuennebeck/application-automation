# Dokumente erwähnen — design

Today Kepler answers questions about a card and nothing else. `askPrompt` tells
it so in as many words: "Anschreiben, Lebenslauf und Stellenanzeige siehst du
nicht", and "Es gibt keine Erwähnungen wie @Stelle, @Anschreiben oder
@Lebenslauf; empfiehl sie nicht."

This design removes both sentences. `@Anschreiben` and `@Lebenslauf` become
things you can mention in a comment, Kepler reads them, and when you ask for a
change it makes the change — writes the file, re-renders the PDF, and reports
what it did in the thread.

The driving case, in the user's words: _"@Kepler heres the recruiters
information — add her into our @CoverLetter."_

## What was settled visually

The interaction was designed in mockups before this document; the decisions
below are the outcome, not proposals.

**The mention picker groups.** Headings "Personen" and "Dokumente", plain small
caps, no rule line. A heading disappears with its group when the query empties
it, and when only one group survives its heading goes too — it has nothing left
to separate. Documents carry the page glyph of the document cards, not a round
avatar: a round avatar means "human" everywhere else in this app.

**The document in the comment text** is the attachment chip — same paperclip,
same `--c-f1efe9`, same radius and hover — with tighter padding so it sits in a
sentence rather than in a row of its own. It keeps the size, read from disk at
render time so it does not go stale when Kepler rewrites the file. Clicking it
opens the document.

**Kepler's answer** is lines, not a card. One line per change:

```
Engineering Hiring Team → Frau Maria Haushofer          replaced
Sehr geehrtes Engineering Hiring Team → Sehr geehrte …  replaced
− Meine Gehaltserwartung liegt bei 80.000 EUR …          deleted
+ Über Ihre Rückmeldung freue ich mich sehr.             inserted
```

The old text is struck through in its own colour (`currentColor`, so the rule
follows the text wherever it is used). The new text sits on the green the
editor already uses for a passage that stands — a flat tint, no underline.
A replacement shows both halves and needs no sign; a deletion and an insertion
are each missing a half, so each takes one. Green means "this holds now", which
is why it cannot also mean "this is new" — the sign carries that.

**Below it, one status line**, left-aligned, a single dot, and the retry icon
(`RegenGlyph` in an `.icon-btn`) at the right edge with no label:

- applied: green dot, "Anschreiben und PDF aktualisiert", icon = undo
- refused: grey dot, "Nichts geändert", icon = try again

The dot alone tells you whether the file was touched, without reading the
sentence.

## What Kepler returns

Edits, as pairs:

```ts
interface DocumentEdit {
  document: DocumentKind;
  kind: 'replace' | 'delete' | 'insert';
  /* The passage as the document words it today. Empty for an insert. */
  find: string;
  /* What replaces it. Empty for a delete. */
  replace: string;
  /* For an insert: the passage it goes after. */
  after?: string;
}
```

The pair shape is not a free choice. The struck-through rendering _is_ the
pair, and so is the undo: applying the pairs backwards restores the document.
Nothing else needs storing.

## Applying them

**All or nothing.** If any one edit cannot be placed, none is applied and the
document is untouched. The reason is the coupling that showed up in every
mockup: "add the recruiter" means recipient _and_ salutation, and a letter
whose recipient reads "Frau Maria Haushofer" over a salutation reading "Sehr
geehrtes Engineering Hiring Team" is worse than one that was left alone. A
partial application produces exactly that, and hides it in a grey line the
reader may not read.

**A match must be exact and unique.** `find` is searched in the document's HTML
after entity normalisation. Zero matches or more than one, and the whole set is
refused. Kepler writes without asking, so the placement rule has to be strict —
the wrong paragraph rewritten silently is the failure that matters.

**A passage carrying markup cannot be matched.** Kepler reads the document
through `documentExcerpt`, which strips tags, so it returns plain text; a
passage that contains `<strong>phase6</strong>` in the file will not be found
as plain text and the set is refused. That is a real limitation, not an
oversight: the proof-point cells of the letter are exactly where emphasis
lives, and they are also where the editor's own passage rewriting already
works. The refusal message points there.

## When it refuses

Both refusals render identically — grey dot, "Nichts geändert" — and differ
only in the sentence:

- **A passage was not found or found twice.** Kepler names the passage it could
  not place and says the document is unchanged, pointing at the editor.
- **The document is open in the editor.** Kepler does not touch a file whose
  other half you are holding. Editing is already blocked while a run owns the
  card (`agentLocked`); this is the same rule from the other side.

## Undo

The retry icon on an applied answer reverses the edits: swap `find` and
`replace`, apply again, re-render the PDF. It is refused, with the same grey
line, if the document has changed since — the pairs no longer match, which the
exact-once rule detects on its own.

This needs the edits to outlive the call, so they are stored beside the comment
that reported them:

```sql
CREATE TABLE comment_edits (
  id            INTEGER PRIMARY KEY,
  comment_id    INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  document      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  find_text     TEXT NOT NULL,
  replace_text  TEXT NOT NULL,
  after_text    TEXT,
  position      INTEGER NOT NULL,
  undone_at     TEXT
);
CREATE INDEX idx_comment_edits_comment ON comment_edits(comment_id);
```

One row per edit, ordered, cascading with its comment — the same shape
`comment_attachments` already uses. `after_text` carries an insert's anchor, so
the row holds everything `DocumentEdit` does and a reversal needs nothing else.
`find_text`/`replace_text` rather than `find`/`replace` because `replace` is a
SQLite function name and a bare column of that name has to be quoted at every
use.

`undone_at` is what turns the icon back into "try again" and keeps a reversed
set from being reversed twice. This is **Migration 25 (index 22)** in the
project's numbering, and needs a test, per CLAUDE.md.

## Two things the main process cannot see by itself

**Which documents were mentioned** is derived in the main process from the
comment's own text, not passed in by the renderer. The comment row is already
the record of what was asked; deriving from it means a mention that never
reached the text cannot cause an edit.

**Whether the editor is open** is renderer state the main process has no view
of, so `AskRequest` carries it — the kind currently open on this card, or null.
The refusal itself stays on the main side with every other refusal, rather than
splitting the rule across the boundary.

## Reading is the same feature

A mentioned document is readable whether or not a change is asked for. "Was
steht im @Anschreiben über meine Expo-Erfahrung" is answered from the document
text with no edits returned and no status line. The same prompt covers both;
what separates them is whether the answer carries edits.

## Structure

```
src/lib/mentions.ts          Mentionable gains a kind; document entries
src/ui/MentionComposer.tsx   grouped picker, headings that come and go
src/ui/MentionText.tsx       document mentions render as the chip
src/features/detail/CommentsSection.tsx   the edit lines and status line
src/shared/agent.ts          AskRequest gains the open document
electron/agent/ask.ts        reads the mentions, applies the edits
electron/agent/prompts.ts    the document blocks and the edit rules
electron/agent/schemas.ts    EDITS_SCHEMA, validateEdits
electron/agent/edits.ts      (new) matching and applying, forwards and back
electron/db/schema.ts        migration 22: comment_edits
electron/db/repo.ts          writing and reading the edit rows
```

`edits.ts` is a new file rather than more of `ask.ts` because matching and
applying is the one part with no side channel — it is a pure function over a
string and a set of pairs, and it carries the rule everything else trusts.

## Testing

- A `find` that occurs once is replaced; zero and two occurrences both refuse
  the whole set.
- A set where one edit fails leaves the document byte-identical.
- Applying and then reversing a set returns the original bytes.
- A passage spanning markup refuses rather than mangling.
- Delete and insert round-trip the same way replace does.
- A mention of an open document refuses without calling the model.
- The picker drops a group's heading when the query empties it, and drops the
  last heading when only one group remains.
- Migration 22 creates the table and cascades with its comment.

## Not in this design

- **`@Stelle`.** The posting as readable context is a separate ask; every block
  makes the prompt costlier and the answer looser. Retrofittable.
- **Editing the Fassungen.** Kepler changes a card's documents, never the
  templates in the profile.
- **A history beyond one step.** Undo reverses the last set on a comment. There
  is no stack.

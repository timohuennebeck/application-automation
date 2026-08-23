# Dokumente erwähnen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@Anschreiben` and `@Lebenslauf` mentionable in a card's comment thread, so Kepler can read them and — when asked — change them, reporting each change as a reversible pair.

**Architecture:** A comment that mentions a document carries that document's text into Kepler's prompt. Kepler answers with prose plus a list of edits, each a `find`/`replace` pair. A pure module places them: every pair must match the document's HTML exactly once, and if any one misses, none is applied. Applied sets are stored beside the comment that reported them, so the retry icon can apply them backwards.

**Tech Stack:** TypeScript, Electron main + React renderer, `node:sqlite`, Vitest, Claude Agent SDK.

**Spec:** `docs/superpowers/specs/2026-08-23-dokumente-erwaehnen-design.md`

## Global Constraints

Copied from `CLAUDE.md`; every task is bound by these.

- `npx tsc -b`, `npm run lint` and `npm test` must all be clean before work is called done.
- Named exports and `export function` declarations. No default exports, no exported arrow functions. (Module-private arrow functions are fine and are the established pattern in several files.)
- Explicit return types on exported functions in `electron/` and `src/lib/`. React components are exempt.
- Relative imports inside `electron/` carry the `.ts` extension (nodenext requires it). Imports inside `src/` omit it — **except** from `src/shared/` and `src/data/`, which `electron/` also consumes, where the extension is required and must stay.
- `import type` for type-only imports — `verbatimModuleSyntax` is on.
- Comments are `/* */` blocks that explain **why**, not what. This codebase comments heavily and deliberately; the comments in this plan's code blocks are part of the deliverable.
- Prettier: single quotes, 2-space indent, semicolons, trailing commas, 110 columns. Run prettier **only on the files you touched** — peer sessions edit this repo concurrently, so never run `npm run format`.
- German is the UI language: user-facing strings, prompts and comment text are German. Identifiers, code comments and commit messages are English.
- Styling in the renderer is inline `style={{ … }}` against the custom properties in `src/app/theme.css`. Shared fragments live in `src/ui/styles.ts`.
- Every mutation is written through `window.desktop.db`; the store keeps the in-memory view in sync.
- Schema changes need a migration in `electron/db/migrate.ts` with a test. `MIGRATIONS` in `electron/db/schema.ts` is an append-only array; an entry's index is its `user_version`.
- The Agent SDK may only be imported from the main process.
- Tests live in `__tests__/` next to the code they cover.

---

## File Structure

| File                                      | Responsibility                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/agent/edits.ts`                 | **New.** The whole placement rule: match, apply, reverse. Pure — a string and a set of pairs in, a string out. Everything else trusts it. |
| `electron/agent/__tests__/edits.test.ts`  | **New.** Exact-once matching, all-or-nothing, round-tripping.                                                                             |
| `electron/agent/schemas.ts`               | `DocumentEdit`, `EditKind`, `EDITS_SCHEMA`, `validateEdits`; `ASK_SCHEMA` gains the edits array.                                          |
| `electron/agent/prompts.ts`               | `askPrompt` loses the two "you cannot see documents" sentences and gains the document blocks and the edit rules.                          |
| `electron/agent/ask.ts`                   | Derives the mentioned documents, refuses an open document, applies the edits, re-renders the PDF, stores the set.                         |
| `electron/db/schema.ts`                   | Migration 25 (index 22): `comment_edits`.                                                                                                 |
| `electron/db/repo.ts`                     | Writing an edit set, reading it back, marking it undone.                                                                                  |
| `src/shared/agent.ts`                     | `AskRequest` gains the open document; `AskResult` gains the stored edits.                                                                 |
| `src/shared/enums.ts`                     | `EditKind`.                                                                                                                               |
| `src/lib/mentions.ts`                     | `Mentionable` gains a kind; the two document entries.                                                                                     |
| `src/ui/MentionComposer.tsx`              | The grouped picker with headings that come and go.                                                                                        |
| `src/ui/MentionText.tsx`                  | A document mention renders as the attachment chip.                                                                                        |
| `src/features/detail/CommentsSection.tsx` | The edit lines, the status line, the retry icon.                                                                                          |
| `electron/agent/orchestrator.ts`          | Item 5: the closing comment names the researched contact.                                                                                 |

`edits.ts` is its own file because it is the one part with no side channel, and it carries the rule every other part trusts. It must stay testable without a database, a model or a window.

---

### Task 1: Placing and reversing edits

**Files:**

- Create: `electron/agent/edits.ts`
- Create: `electron/agent/__tests__/edits.test.ts`
- Modify: `src/shared/enums.ts`

**Interfaces:**

- Consumes: `DocumentKind` from `src/shared/enums.ts`.
- Produces:
  - `EditKind` in `src/shared/enums.ts`: `{ REPLACE: 'replace', DELETE: 'delete', INSERT: 'insert' }`
  - `interface DocumentEdit { document: DocumentKind; kind: EditKind; find: string; replace: string; after: string | null }`
  - `interface ApplyResult { html: string; failed: DocumentEdit | null; reason: string | null }`
  - `applyEdits(html: string, edits: DocumentEdit[]): ApplyResult`
  - `reverseEdits(edits: DocumentEdit[]): DocumentEdit[]`

- [ ] **Step 1: Write the failing test**

Create `electron/agent/__tests__/edits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyEdits, reverseEdits } from '../edits.ts';
import type { DocumentEdit } from '../edits.ts';
import { DocumentKind, EditKind } from '../../../src/shared/enums.ts';

const LETTER =
  '<!doctype html><html><body>' +
  '<p class="recipient">Engineering Hiring Team</p>' +
  '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>' +
  '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>' +
  '</body></html>';

const edit = (over: Partial<DocumentEdit>): DocumentEdit => ({
  document: DocumentKind.COVER_LETTER,
  kind: EditKind.REPLACE,
  find: '',
  replace: '',
  after: null,
  ...over,
});

describe('applyEdits', () => {
  it('replaces a passage that occurs exactly once', () => {
    const res = applyEdits(LETTER, [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toContain('<p class="recipient">Frau Maria Haushofer</p>');
  });

  it('refuses a passage that occurs twice, and changes nothing', () => {
    /* "Engineering Hiring Team" appears in the recipient AND the salutation.
       Rewriting the first one silently is the failure this rule exists for. */
    const res = applyEdits(LETTER, [edit({ find: 'Engineering Hiring Team', replace: 'X' })]);

    expect(res.failed).not.toBeNull();
    expect(res.reason).toContain('mehrfach');
    expect(res.html).toBe(LETTER);
  });

  it('refuses a passage that does not occur at all', () => {
    const res = applyEdits(LETTER, [edit({ find: 'Sehr geehrte Frau Weber', replace: 'X' })]);

    expect(res.failed).not.toBeNull();
    expect(res.reason).toContain('nicht');
    expect(res.html).toBe(LETTER);
  });

  it('applies nothing when one edit of several misses', () => {
    /* All or nothing: a letter whose recipient changed but whose salutation
       did not is worse than one left alone. */
    const res = applyEdits(LETTER, [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
      edit({ find: 'gibt es nicht', replace: 'X' }),
    ]);

    expect(res.failed?.find).toBe('gibt es nicht');
    expect(res.html).toBe(LETTER);
  });

  it('deletes a passage', () => {
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
      }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).not.toContain('Gehaltserwartung');
  });

  it('inserts after an anchor', () => {
    const res = applyEdits(LETTER, [
      edit({
        kind: EditKind.INSERT,
        after: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        replace: '<p>Über Ihre Rückmeldung freue ich mich sehr.</p>',
      }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toContain('brutto p.a.</p><p>Über Ihre Rückmeldung freue ich mich sehr.</p>');
  });

  it('refuses an insert whose anchor is not unique', () => {
    const res = applyEdits(LETTER, [
      edit({ kind: EditKind.INSERT, after: 'Engineering Hiring Team', replace: '<p>X</p>' }),
    ]);

    expect(res.failed).not.toBeNull();
    expect(res.html).toBe(LETTER);
  });

  it('applies each edit against the document the previous one left', () => {
    /* Two edits where the second's passage only exists after the first ran
       would be a trap; both are measured against the running document, so the
       order the model returned them in is the order they take effect. */
    const res = applyEdits('<p>eins</p><p>zwei</p>', [
      edit({ find: '<p>eins</p>', replace: '<p>drei</p>' }),
      edit({ find: '<p>drei</p>', replace: '<p>vier</p>' }),
    ]);

    expect(res.failed).toBeNull();
    expect(res.html).toBe('<p>vier</p><p>zwei</p>');
  });

  it('leaves the document byte-identical when handed no edits', () => {
    expect(applyEdits(LETTER, []).html).toBe(LETTER);
  });
});

describe('reverseEdits', () => {
  it('turns a replacement around', () => {
    const [back] = reverseEdits([edit({ find: 'alt', replace: 'neu' })]);

    expect(back.find).toBe('neu');
    expect(back.replace).toBe('alt');
    expect(back.kind).toBe(EditKind.REPLACE);
  });

  it('turns a deletion into an insertion and back', () => {
    const [back] = reverseEdits([edit({ kind: EditKind.DELETE, find: '<p>weg</p>', after: '<p>davor</p>' })]);

    expect(back.kind).toBe(EditKind.INSERT);
    expect(back.replace).toBe('<p>weg</p>');
    expect(back.after).toBe('<p>davor</p>');
  });

  it('turns an insertion into a deletion', () => {
    const [back] = reverseEdits([
      edit({ kind: EditKind.INSERT, replace: '<p>neu</p>', after: '<p>davor</p>' }),
    ]);

    expect(back.kind).toBe(EditKind.DELETE);
    expect(back.find).toBe('<p>neu</p>');
  });

  it('reverses in the opposite order, so a chain undoes cleanly', () => {
    const back = reverseEdits([edit({ find: 'a', replace: 'b' }), edit({ find: 'b', replace: 'c' })]);

    expect(back.map((e) => e.find)).toEqual(['c', 'b']);
  });

  it('round-trips a document to its original bytes', () => {
    const edits = [
      edit({ find: 'Engineering Hiring Team</p>', replace: 'Frau Maria Haushofer</p>' }),
      edit({
        kind: EditKind.DELETE,
        find: '<p>Meine Gehaltserwartung liegt bei 80.000 EUR brutto p.a.</p>',
        after: '<p class="salutation">Sehr geehrtes Engineering Hiring Team,</p>',
      }),
    ];
    const forward = applyEdits(LETTER, edits);
    expect(forward.failed).toBeNull();

    const backward = applyEdits(forward.html, reverseEdits(edits));

    expect(backward.failed).toBeNull();
    expect(backward.html).toBe(LETTER);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/agent/__tests__/edits.test.ts`
Expected: FAIL — `Cannot find module '../edits.ts'`.

- [ ] **Step 3: Add the enum**

In `src/shared/enums.ts`, beside the other small const-object enums:

```ts
/* What one of Kepler's document changes does. A replacement carries both
   halves; a deletion has no replacement and an insertion no passage to find,
   which is why the comment thread gives those two a leading sign and a
   replacement none. */
export const EditKind = {
  REPLACE: 'replace',
  DELETE: 'delete',
  INSERT: 'insert',
} as const;
export type EditKind = (typeof EditKind)[keyof typeof EditKind];
```

- [ ] **Step 4: Write the implementation**

Create `electron/agent/edits.ts`:

```ts
/* Placing Kepler's changes in a document, and taking them back out.

   This is the one part of the feature with no side channel: a string and a
   set of pairs go in, a string comes out. Everything else trusts the rule it
   carries, which is why it lives alone and is tested without a database, a
   model or a window.

   The rule is strict on purpose. Kepler writes here without asking, so a
   passage that cannot be placed beyond doubt is not placed at all — the wrong
   paragraph silently rewritten is the failure that matters, and it is the one
   nobody would notice until the application had gone out. */
import { DocumentKind, EditKind } from '../../src/shared/enums.ts';

export interface DocumentEdit {
  document: DocumentKind;
  kind: EditKind;
  /* The passage as the document words it today. Empty for an insertion. */
  find: string;
  /* What takes its place. Empty for a deletion. */
  replace: string;
  /* Where an insertion goes: the passage it follows. Also filled on a
     deletion, so the reversal knows where to put the text back. */
  after: string | null;
}

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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run electron/agent/__tests__/edits.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/edits.ts electron/agent/__tests__/edits.test.ts src/shared/enums.ts
git add electron/agent/edits.ts electron/agent/__tests__/edits.test.ts src/shared/enums.ts
git commit -m "feat(agent): place and reverse document edits, all or nothing"
```

---

### Task 2: The edits outlive the call

**Files:**

- Modify: `electron/db/schema.ts` (append to `MIGRATIONS`)
- Modify: `electron/db/repo.ts`
- Modify: `src/shared/db-types.ts`
- Test: `electron/db/__tests__/migrate.test.ts`, `electron/db/__tests__/repo.test.ts`

**Interfaces:**

- Consumes: `DocumentEdit` from `electron/agent/edits.ts`, `EditKind` from `src/shared/enums.ts`.
- Produces:
  - `interface CommentEditRow { id: number; comment_id: number; document: DocumentKind; kind: EditKind; find_text: string; replace_text: string; after_text: string | null; position: number; undone_at: string | null }` in `src/shared/db-types.ts`
  - On `Repo`: `addCommentEdits(commentId: number, edits: DocumentEdit[]): CommentEditRow[]`, `commentEdits(commentId: number): CommentEditRow[]`, `markEditsUndone(commentId: number): void`
  - `DbSnapshot` gains `commentEdits: CommentEditRow[]`

- [ ] **Step 1: Write the failing migration test**

Append to `electron/db/__tests__/migrate.test.ts`. That file already has
`dbAtVersion(version)` (a database as it stood after `version` migrations) and
`seedApp(db)` (a company plus application `BEW-1`) — use both:

```ts
describe('migration 25', () => {
  it('creates comment_edits and cascades it with its comment', () => {
    const db = dbAtVersion(MIGRATIONS.length - 1);
    seedApp(db);
    db.exec(
      'INSERT INTO comments (id, application_id, author, text, created_at) ' +
        "VALUES (9, 'BEW-1', 'KEPLER', 'Text', 't')",
    );

    db.exec(MIGRATIONS[MIGRATIONS.length - 1]);

    db.exec(
      'INSERT INTO comment_edits (comment_id, document, kind, find_text, replace_text, position) ' +
        "VALUES (9, 'COVER_LETTER', 'replace', 'alt', 'neu', 0)",
    );
    expect(db.prepare('SELECT count(*) c FROM comment_edits').get()).toMatchObject({ c: 1 });

    db.exec('DELETE FROM comments WHERE id = 9');

    /* The edits describe a comment; without it they are unreachable rows that
       nothing ever cleans. */
    expect(db.prepare('SELECT count(*) c FROM comment_edits').get()).toMatchObject({ c: 0 });
  });
});
```

The file also keeps a `TABLES` list used by a whole-schema test — add
`'comment_edits'` to it, or that test fails with a table it does not expect.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/db/__tests__/migrate.test.ts`
Expected: FAIL — `no such table: comment_edits`.

- [ ] **Step 3: Append the migration**

At the end of the `MIGRATIONS` array in `electron/db/schema.ts`, after the `language` entry:

```ts
  /* Migration 25 (index 22): the changes Kepler made to a document, kept
     beside the comment that reported them. The retry icon on that comment
     applies them backwards, so this table is the whole of undo — there is no
     document versioning behind it and none is needed: a pair reversed is the
     way back. find_text/replace_text rather than find/replace because
     `replace` is a SQLite function name and a column of that name would need
     quoting at every use. undone_at turns the icon back into "try again" and
     keeps a reversed set from being reversed twice. */
  `
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
  `,
```

- [ ] **Step 4: Write the failing repo test**

Append to `electron/db/__tests__/repo.test.ts`, matching how that file builds its repo:

```ts
describe('comment edits', () => {
  it('stores a set in order and reads it back', () => {
    const { repo, appId } = fixture();
    const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;

    repo.addCommentEdits(comment.id, [
      { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
      { document: DocumentKind.COVER_LETTER, kind: EditKind.DELETE, find: 'c', replace: '', after: 'd' },
    ]);

    const rows = repo.commentEdits(comment.id);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ kind: EditKind.REPLACE, find_text: 'a', replace_text: 'b' });
    expect(rows[1]).toMatchObject({ kind: EditKind.DELETE, after_text: 'd', undone_at: null });
  });

  it('marks a set undone so the icon can change its meaning', () => {
    const { repo, appId } = fixture();
    const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;
    repo.addCommentEdits(comment.id, [
      { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
    ]);

    repo.markEditsUndone(comment.id);

    expect(repo.commentEdits(comment.id).every((r) => r.undone_at !== null)).toBe(true);
  });

  it('carries the edits in the snapshot the renderer loads', () => {
    const { repo, appId } = fixture();
    const comment = repo.addComment(appId, Author.KEPLER, 'geändert').comment;
    repo.addCommentEdits(comment.id, [
      { document: DocumentKind.COVER_LETTER, kind: EditKind.REPLACE, find: 'a', replace: 'b', after: null },
    ]);

    expect(repo.load().commentEdits).toHaveLength(1);
  });
});
```

Replace `fixture()` with whatever that test file already uses to get a repo and an application id.

- [ ] **Step 5: Write the repo methods**

Add `CommentEditRow` to `src/shared/db-types.ts` beside `CommentAttachmentRow`, and add `commentEdits: CommentEditRow[]` to `DbSnapshot`.

In `electron/db/repo.ts`, beside the comment-attachment queries:

```ts
    /* One row per edit, in the order the model returned them — the order is
       load-bearing, because each edit was applied against what the one before
       it left. */
    addCommentEdits(commentId: number, edits: DocumentEdit[]): CommentEditRow[] {
      return tx(() => {
        const ins = db.prepare(
          'INSERT INTO comment_edits (comment_id, document, kind, find_text, replace_text, after_text, position) ' +
            'VALUES (?,?,?,?,?,?,?)',
        );
        edits.forEach((e, i) =>
          ins.run(commentId, e.document, e.kind, e.find, e.replace, e.after ?? null, i),
        );
        return this.commentEdits(commentId);
      });
    },

    commentEdits(commentId: number): CommentEditRow[] {
      return db
        .prepare('SELECT * FROM comment_edits WHERE comment_id = ? ORDER BY position')
        .all(commentId) as unknown as CommentEditRow[];
    },

    /* A reversed set stays on the comment rather than being deleted: the
       thread still shows what was changed, and the row is what stops it from
       being reversed a second time. */
    markEditsUndone(commentId: number): void {
      db.prepare('UPDATE comment_edits SET undone_at = ? WHERE comment_id = ? AND undone_at IS NULL').run(
        nowISO(),
        commentId,
      );
    },
```

Add `commentEdits` to the snapshot `load()` builds, using the same shape as `commentAttachments`:

```ts
      commentEdits: db
        .prepare('SELECT * FROM comment_edits ORDER BY comment_id, position')
        .all() as unknown as CommentEditRow[],
```

`this.commentEdits` inside `addCommentEdits` requires the returned object literal to be typed such that `this` resolves — if `tsc` objects, call a module-level helper instead of `this`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run electron/db/__tests__/migrate.test.ts electron/db/__tests__/repo.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/db/schema.ts electron/db/repo.ts src/shared/db-types.ts electron/db/__tests__/migrate.test.ts electron/db/__tests__/repo.test.ts
git add electron/db/schema.ts electron/db/repo.ts src/shared/db-types.ts electron/db/__tests__
git commit -m "feat(db): keep a comment's document edits so they can be reversed"
```

---

### Task 3: The schema Kepler answers in

**Files:**

- Modify: `electron/agent/schemas.ts`
- Test: `electron/agent/__tests__/schemas.test.ts`

**Interfaces:**

- Consumes: `DocumentEdit` from `electron/agent/edits.ts`, `EditKind`/`DocumentKind` from `src/shared/enums.ts`.
- Produces: `ASK_SCHEMA` gains an `edits` array; `interface AskAnswer { antwort: string; edits: DocumentEdit[] }`; `validateAsk(x: unknown): AskAnswer`.

- [ ] **Step 1: Write the failing test**

Append to `electron/agent/__tests__/schemas.test.ts`:

```ts
describe('validateAsk with edits', () => {
  it('reads the answer and its edits', () => {
    const out = validateAsk({
      antwort: 'Eingetragen.',
      edits: [
        {
          document: 'COVER_LETTER',
          kind: 'replace',
          find: 'Engineering Hiring Team',
          replace: 'Frau Maria Haushofer',
          after: null,
        },
      ],
    });

    expect(out.antwort).toBe('Eingetragen.');
    expect(out.edits).toHaveLength(1);
    expect(out.edits[0]).toMatchObject({ kind: EditKind.REPLACE, find: 'Engineering Hiring Team' });
  });

  it('treats a missing edits list as a plain answer', () => {
    /* Most questions change nothing; an answer without edits is the common
       case and must not be rejected. */
    expect(validateAsk({ antwort: 'Steht so im Brief.' }).edits).toEqual([]);
  });

  it('drops an edit naming a document the app does not have', () => {
    const out = validateAsk({
      antwort: 'x',
      edits: [{ document: 'GLOSSAR', kind: 'replace', find: 'a', replace: 'b', after: null }],
    });

    expect(out.edits).toEqual([]);
  });

  it('drops an edit whose kind it does not know', () => {
    const out = validateAsk({
      antwort: 'x',
      edits: [{ document: 'COVER_LETTER', kind: 'verschieben', find: 'a', replace: 'b', after: null }],
    });

    expect(out.edits).toEqual([]);
  });

  it('drops a replacement with nothing to find', () => {
    /* An empty needle matches everywhere and nowhere; applyEdits would refuse
       it, but it should never get that far. */
    const out = validateAsk({
      antwort: 'x',
      edits: [{ document: 'COVER_LETTER', kind: 'replace', find: '', replace: 'b', after: null }],
    });

    expect(out.edits).toEqual([]);
  });

  it('drops an insertion with no anchor', () => {
    const out = validateAsk({
      antwort: 'x',
      edits: [{ document: 'COVER_LETTER', kind: 'insert', find: '', replace: 'b', after: '' }],
    });

    expect(out.edits).toEqual([]);
  });

  it('still rejects an answer with no prose', () => {
    expect(() => validateAsk({ edits: [] })).toThrow();
  });
});
```

Extend the file's imports with `EditKind` from `'../../../src/shared/enums.ts'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/agent/__tests__/schemas.test.ts`
Expected: FAIL — `validateAsk` returns a string, not an object with `edits`.

- [ ] **Step 3: Widen the schema and the validator**

In `electron/agent/schemas.ts`, replace `ASK_SCHEMA`:

```ts
/* Kepler's answer to a comment that addressed it, and the changes it made to
   a mentioned document. Most answers carry no edits at all — the array is
   required so a model that changed nothing says so explicitly rather than
   leaving the caller to guess from an absent field. */
export const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    antwort: { type: 'string' },
    edits: {
      type: 'array',
      maxItems: MAX_EDITS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'string', enum: [DocumentKind.LEBENSLAUF, DocumentKind.COVER_LETTER] },
          kind: { type: 'string', enum: [EditKind.REPLACE, EditKind.DELETE, EditKind.INSERT] },
          find: { type: 'string' },
          replace: { type: 'string' },
          after: nullableString,
        },
        required: ['document', 'kind', 'find', 'replace', 'after'],
      },
    },
  },
  required: ['antwort', 'edits'],
} as const;
```

Add above it:

```ts
/* More than a handful of changes in one comment is not an answer, it is a
   rewrite — and a rewrite belongs in the editor, where each passage can be
   looked at. */
export const MAX_EDITS = 8;
```

Replace `validateAsk`:

```ts
export interface AskAnswer {
  antwort: string;
  edits: DocumentEdit[];
}

/* The prose is required — an answer with edits and no sentence would leave
   the thread showing changes nobody explained. The edits are filtered rather
   than rejected: one malformed entry should not cost the whole reply, and
   applyEdits refuses anything that still slips through. */
export function validateAsk(x: unknown): AskAnswer {
  const r = asRecord(x, 'Antwort');
  const antwort = text(r.antwort);
  if (!antwort) throw new Error('Antwort: kein Text erhalten');
  const edits: DocumentEdit[] = [];
  if (Array.isArray(r.edits)) {
    for (const entry of r.edits) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const document = text(e.document);
      const kind = text(e.kind);
      if (document !== DocumentKind.LEBENSLAUF && document !== DocumentKind.COVER_LETTER) continue;
      if (kind !== EditKind.REPLACE && kind !== EditKind.DELETE && kind !== EditKind.INSERT) continue;
      const find = typeof e.find === 'string' ? e.find : '';
      const replace = typeof e.replace === 'string' ? e.replace : '';
      const after = text(e.after);
      /* Each kind needs the half it is located by. */
      if (kind === EditKind.INSERT ? !after : !find) continue;
      edits.push({ document, kind, find, replace, after });
    }
  }
  return { antwort, edits: edits.slice(0, MAX_EDITS) };
}
```

Import `EditKind` alongside the existing `DocumentKind`/`DocumentLanguage` import, and `DocumentEdit` as a type from `'./edits.ts'`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/agent/__tests__/schemas.test.ts`
Expected: PASS. `ask.ts` will not typecheck yet — Task 5 updates its caller.

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/agent/schemas.ts electron/agent/__tests__/schemas.test.ts
git add electron/agent/schemas.ts electron/agent/__tests__/schemas.test.ts
git commit -m "feat(agent): let Kepler's answer carry document edits"
```

`npx tsc -b` is expected to fail at `ask.ts` after this task and is fixed in Task 5; run it there.

---

### Task 4: What Kepler is told about the documents

**Files:**

- Modify: `electron/agent/prompts.ts` — `AskInput`, `askPrompt`
- Test: `electron/agent/__tests__/prompts.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `AskInput` gains `documents: AskDocument[]`; `interface AskDocument { kind: DocumentKind; title: string; text: string }`.

- [ ] **Step 1: Write the failing test**

Append to the `askPrompt` describe block in `electron/agent/__tests__/prompts.test.ts`:

```ts
it('hands over a mentioned document and drops the “you cannot see them” rule', () => {
  const prompt = askPrompt({
    ...ASK_INPUT,
    documents: [
      {
        kind: DocumentKind.COVER_LETTER,
        title: 'Anschreiben',
        text: 'Sehr geehrtes Engineering Hiring Team,',
      },
    ],
  });

  expect(prompt).toContain('Sehr geehrtes Engineering Hiring Team');
  expect(prompt).not.toContain('Anschreiben, Lebenslauf und Stellenanzeige siehst du nicht');
  expect(prompt).not.toContain('empfiehl sie nicht');
});

it('tells the model how a change has to be worded', () => {
  const prompt = askPrompt({
    ...ASK_INPUT,
    documents: [{ kind: DocumentKind.COVER_LETTER, title: 'Anschreiben', text: 'Text' }],
  });

  /* The passage has to be quoted exactly, or applyEdits refuses it. */
  expect(prompt).toContain('wörtlich');
  expect(prompt).toContain('edits');
});

it('says nothing about editing when no document was mentioned', () => {
  const prompt = askPrompt({ ...ASK_INPUT, documents: [] });

  expect(prompt).not.toContain('edits');
  expect(prompt).toContain('<karte>');
});
```

`ASK_INPUT` is the existing fixture in that describe block; extend it with `documents: []`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/agent/__tests__/prompts.test.ts`
Expected: FAIL — `documents` is not a property of `AskInput`.

- [ ] **Step 3: Widen the prompt**

In `electron/agent/prompts.ts`, add above `AskInput`:

```ts
/* One document the comment mentioned, as what it says. The model reads text,
   never markup — but it has to quote a passage back exactly, and what it
   quotes is matched against the file's own bytes. A passage carrying emphasis
   therefore cannot be changed from the thread; the rules below say so. */
export interface AskDocument {
  kind: DocumentKind;
  title: string;
  text: string;
}
```

Add `documents: AskDocument[];` to `AskInput`, with a comment saying it is empty for a comment that mentioned none.

In `askPrompt`, delete these two rules:

- `- Es gibt keine Erwähnungen wie @Stelle, @Anschreiben oder @Lebenslauf; empfiehl sie nicht.` (the sentence is part of a longer rule about the comment thread — remove only that sentence, keep the rest of the rule)
- `- Du liest nur — du änderst keine Dokumente und keine Daten der Karte. Anschreiben, Lebenslauf und Stellenanzeige siehst du nicht; sag das, wenn eine Frage darauf zielt.`

Replace the second with:

```ts
- Du änderst keine Daten der Karte. Die Stellenanzeige siehst du nicht; sag das, wenn eine Frage darauf zielt.
```

Then append, only when documents were mentioned:

```ts
/* The rules that only exist once a document is on the table. Kept out of the
   prompt entirely otherwise: a model told how to edit will look for something
   to edit. */
const editRules = (docs: AskDocument[]) => `
Die unten stehenden Dokumente sind erwähnt worden. Du darfst sie lesen — und ändern, wenn der Bewerber darum bittet.

Regeln für Änderungen:
- Jede Änderung ist ein Eintrag in edits. document ist "COVER_LETTER" oder "LEBENSLAUF", kind ist "replace", "delete" oder "insert".
- find ist die Stelle im Dokument, wörtlich und Zeichen für Zeichen so, wie sie unten steht. Eine Stelle, die du nicht wörtlich zitieren kannst, änderst du nicht.
- Die Stelle muss im Dokument genau einmal vorkommen. Kommt sie mehrfach vor, nimm mehr Text drumherum dazu, bis sie eindeutig ist.
- replace ist der neue Text. Bei "delete" ist replace leer, bei "insert" ist find leer und after die Stelle, hinter der eingefügt wird.
- Ändere nur, worum gebeten wurde, und alles, was davon abhängt: eine neue Empfängerin verlangt auch die passende Anrede, sonst widerspricht sich der Brief.
- Kann eine der nötigen Stellen nicht eindeutig zitiert werden, gib gar keine edits zurück und sag im Text, welche Stelle das war.
- Wird nur gefragt und nicht um eine Änderung gebeten, bleibt edits leer.

${docs.map((d) => `<${d.kind === DocumentKind.COVER_LETTER ? 'anschreiben' : 'lebenslauf-dokument'}>\n${sealed(d.text)}\n</${d.kind === DocumentKind.COVER_LETTER ? 'anschreiben' : 'lebenslauf-dokument'}>`).join('\n\n')}
`;
```

and interpolate `${input.documents.length ? editRules(input.documents) : ''}` into `askPrompt`, after the `<profil>` block.

`anschreiben` and `lebenslauf-dokument` are already in `sealed()`'s alternation — verify before assuming.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/agent/__tests__/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/agent/prompts.ts electron/agent/__tests__/prompts.test.ts
git add electron/agent/prompts.ts electron/agent/__tests__/prompts.test.ts
git commit -m "feat(agent): let a mentioned document into Kepler's answer prompt"
```

---

### Task 5: The ask service reads, changes and records

**Files:**

- Modify: `electron/agent/ask.ts`
- Modify: `src/shared/agent.ts`
- Modify: `electron/agent/index.ts` (the `agent:ask` handler and `createAskService` wiring)
- Test: `electron/agent/__tests__/ask.test.ts`

**Interfaces:**

- Consumes: `applyEdits`/`reverseEdits`/`DocumentEdit` (Task 1), `addCommentEdits`/`commentEdits`/`markEditsUndone` (Task 2), `validateAsk`/`AskAnswer`/`ASK_SCHEMA` (Task 3), `AskDocument`/`askPrompt` (Task 4).
- Produces:
  - `AskRequest` gains `openDocument: DocumentKind | null`
  - `AskResult` on success gains `edits: CommentEditRow[]`
  - `AskService` gains `undo(applicationId: string, commentId: number): Promise<AskResult>`
  - `AskDeps` gains `userDataPath: string` and `renderPdf(htmlAbs: string, pdfAbs: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `electron/agent/__tests__/ask.test.ts`, matching how that file builds its service:

```ts
describe('a comment that mentions a document', () => {
  it('hands the document text to the model', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler was steht im @Anschreiben?');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(llm.mock.calls[0][0].prompt).toContain('Engineering Hiring Team');
  });

  it('applies the edits, re-renders the PDF and stores the set', async () => {
    const { service, repo, appId, renderPdf } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Maria Haushofer',
            after: null,
          },
        ],
      },
    });
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');

    const res = await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(res.ok).toBe(true);
    expect(readLetter(appId)).toContain('Frau Maria Haushofer');
    expect(renderPdf).toHaveBeenCalled();
    const reply = repo.load().comments.at(-1)!;
    expect(repo.commentEdits(reply.id)).toHaveLength(1);
  });

  it('changes nothing when a passage cannot be placed', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Ich ändere das.',
        edits: [
          { document: 'COVER_LETTER', kind: 'replace', find: 'gibt es nicht', replace: 'X', after: null },
        ],
      },
    });
    const original = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    writeLetter(appId, original);
    const comment = addComment(appId, '@Kepler ändere das @Anschreiben');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(readLetter(appId)).toBe(original);
    const reply = repo.load().comments.at(-1)!;
    expect(repo.commentEdits(reply.id)).toHaveLength(0);
    expect(reply.text).toContain('gibt es nicht');
  });

  it('refuses while the document is open in the editor, without calling the model', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Text</p>');
    const comment = addComment(appId, '@Kepler kürze das @Anschreiben');

    const res = await service.ask({
      applicationId: appId,
      commentId: comment.id,
      openDocument: DocumentKind.COVER_LETTER,
    });

    expect(res.ok).toBe(false);
    expect(llm).not.toHaveBeenCalled();
  });

  it('ignores a document that was not mentioned', async () => {
    const { service, appId, llm } = fixture();
    writeLetter(appId, '<p>Sehr geehrtes Engineering Hiring Team,</p>');
    const comment = addComment(appId, '@Kepler wie ist der Stand?');

    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });

    expect(llm.mock.calls[0][0].prompt).not.toContain('Engineering Hiring Team');
  });
});

describe('undo', () => {
  it('puts the document back and marks the set undone', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [
          {
            document: 'COVER_LETTER',
            kind: 'replace',
            find: 'Engineering Hiring Team',
            replace: 'Frau Maria Haushofer',
            after: null,
          },
        ],
      },
    });
    const original = '<p>Sehr geehrtes Engineering Hiring Team,</p>';
    writeLetter(appId, original);
    const comment = addComment(appId, '@Kepler trag Maria ins @Anschreiben ein');
    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });
    const reply = repo.load().comments.at(-1)!;

    await service.undo(appId, reply.id);

    expect(readLetter(appId)).toBe(original);
    expect(repo.commentEdits(reply.id).every((r) => r.undone_at !== null)).toBe(true);
  });

  it('refuses to undo a set twice', async () => {
    const { service, repo, appId } = fixture({
      answer: {
        antwort: 'Eingetragen.',
        edits: [{ document: 'COVER_LETTER', kind: 'replace', find: 'alt', replace: 'neu', after: null }],
      },
    });
    writeLetter(appId, '<p>alt</p>');
    const comment = addComment(appId, '@Kepler ändere das @Anschreiben');
    await service.ask({ applicationId: appId, commentId: comment.id, openDocument: null });
    const reply = repo.load().comments.at(-1)!;
    await service.undo(appId, reply.id);

    const again = await service.undo(appId, reply.id);

    expect(again.ok).toBe(false);
  });
});
```

`ask.test.ts` already has `createApp()`, `ask(id, text)` (inserts a `DU` comment
and returns its id) and `service(answer, onPrompt?)` (builds the service around a
fake `llm` that hands back `answer`). Extend them rather than starting over:

```ts
const ROOT = mkdtempSync(path.join(tmpdir(), 'bew-ask-'));

/* A generated Anschreiben on disk with its row pointed at it — the shape
   ask() reads and writes. */
function writeLetter(appId: string, html: string): void {
  const { htmlAbs, htmlRel } = documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE);
  mkdirSync(path.dirname(htmlAbs), { recursive: true });
  writeFileSync(htmlAbs, html);
  const row = repo
    .load()
    .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
  repo.setDocumentFile(row.id, htmlRel, null, 'Standard');
}

const readLetter = (appId: string) =>
  readFileSync(documentPaths(ROOT, appId, DocumentKind.COVER_LETTER, DocumentLanguage.DE).htmlAbs, 'utf8');
```

and widen `service()` to pass the two new deps:

```ts
const renderPdf = vi.fn(async () => undefined);
const service = (answer: unknown, onPrompt?: (p: string) => void) =>
  createAskService({
    repo,
    runs,
    userDataPath: ROOT,
    renderPdf,
    llm: (async (req: LlmRequest<unknown>) => {
      onPrompt?.(req.prompt);
      return req.validate(answer);
    }) as Parameters<typeof createAskService>[0]['llm'],
  });
```

Every existing call to `service(...)` keeps working; every existing call to
`.ask({ applicationId, commentId })` needs `openDocument: null` added, since the
field is required.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run electron/agent/__tests__/ask.test.ts`
Expected: FAIL — `openDocument` is not a property of `AskRequest`.

- [ ] **Step 3: Widen the shared types**

In `src/shared/agent.ts`:

```ts
export interface AskRequest {
  applicationId: string;
  commentId: number;
  /* The document the editor currently has open on this card, or null. The
     main process has no view of renderer state, and Kepler must not swap a
     file out from under a screen the user is typing in. */
  openDocument: DocumentKind | null;
}
```

and on the success branch of `AskResult`, add `edits: CommentEditRow[]`.

- [ ] **Step 4: Write the service**

In `electron/agent/ask.ts`:

Add a module-private mention reader:

```ts
/* Which documents this comment named. Read from the comment's own text rather
   than passed in by the renderer: the row is the record of what was asked, so
   a mention that never reached the text cannot cause a change. */
function mentionedDocuments(text: string): DocumentKind[] {
  const found: DocumentKind[] = [];
  for (const [kind, title] of Object.entries(DOCUMENT_MENTION) as [DocumentKind, string][]) {
    if (new RegExp('(?<![\\p{L}\\d@])@' + title + '(?![\\p{L}\\d])', 'u').test(text)) found.push(kind);
  }
  return found;
}
```

with, beside it:

```ts
/* What each document is mentioned as. The same strings the picker offers, so
   what the user clicked is what this finds. */
const DOCUMENT_MENTION: Record<DocumentKind, string> = {
  [DocumentKind.COVER_LETTER]: 'Anschreiben',
  [DocumentKind.LEBENSLAUF]: 'Lebenslauf',
  [DocumentKind.OTHER]: '',
};
```

In `answer()`, before the model call:

1. `const mentioned = mentionedDocuments(asking.text)`
2. If `req.openDocument && mentioned.includes(req.openDocument)`, return `{ ok: false, error: 'Das Dokument ist gerade im Editor offen. Schließ es, dann ändere ich es.' }` — before any model call.
3. Build `documents: AskDocument[]` by reading each mentioned document's `file_path` off the snapshot and running it through `documentExcerpt`; skip one whose file is missing.

After the model call, when `answer.edits.length`:

1. Group the edits by document, apply each group with `applyEdits` against that document's HTML.
2. If any group reports `failed`, write the reply comment with the model's prose plus the German `reason` appended, store no edits, and return.
3. Otherwise write each document's new HTML, re-render its PDF through `deps.renderPdf`, update the row through `repo.setDocumentFile`, then write the reply and `repo.addCommentEdits(reply.id, applied)`.

Add `undo`:

```ts
/* A stored row back into the shape edits.ts works in. The column names differ
   because `replace` is a SQLite function name; nothing else does. */
function fromRows(rows: CommentEditRow[]): DocumentEdit[] {
  return rows.map((r) => ({
    document: r.document,
    kind: r.kind,
    find: r.find_text,
    replace: r.replace_text,
    after: r.after_text,
  }));
}
```

and, on the service:

```ts
    /* The retry icon on an applied answer. The stored pairs turned around are
       the whole of it — if the document has moved on since, they no longer
       match and applyEdits refuses, which is the same guard the forward
       direction has. */
    async undo(applicationId: string, commentId: number): Promise<AskResult> {
      if (!repo.getApplicationWithCompany(applicationId)) {
        return { ok: false, error: 'Unbekannte Bewerbung.' };
      }
      if (runs.activeRun(applicationId)) {
        return { ok: false, error: 'Kepler arbeitet bereits an dieser Bewerbung.' };
      }
      const stored = repo.commentEdits(commentId).filter((r) => r.undone_at === null);
      if (!stored.length) return { ok: false, error: 'Diese Änderung wurde schon zurückgenommen.' };

      const written = await writeGroups(applicationId, reverseEdits(fromRows(stored)));
      if (written.error) return { ok: false, error: written.error };
      repo.markEditsUndone(commentId);
      return { ok: true, comment: repo.load().comments.find((c) => c.id === commentId)!, edits: [] };
    },
```

`writeGroups(applicationId, edits)` is the piece both directions share — extract
it while writing `answer()` rather than duplicating it here:

```ts
/* Groups the edits by document, applies each group against that document's
   HTML, and — only if every group landed — writes the files and re-renders
   their PDFs. Returns the German reason on the first group that refused, with
   nothing written. */
async function writeGroups(applicationId: string, edits: DocumentEdit[]): Promise<{ error: string | null }> {
  const rows = deps.repo.load().documents.filter((d) => d.application_id === applicationId);
  const planned: { row: DocumentRow; html: string }[] = [];
  for (const kind of new Set(edits.map((e) => e.document))) {
    const row = rows.find((d) => d.kind === kind);
    if (!row?.file_path) return { error: `Für ${DOCUMENT_MENTION[kind]} gibt es keine Datei.` };
    const html = readFileSync(resolveDocumentPath(deps.userDataPath, row.file_path), 'utf8');
    const res = applyEdits(
      html,
      edits.filter((e) => e.document === kind),
    );
    /* All or nothing across every document, not just within one: the request
       was one request. */
    if (res.failed) return { error: res.reason };
    planned.push({ row, html: res.html });
  }
  for (const { row, html } of planned) {
    const abs = resolveDocumentPath(deps.userDataPath, row.file_path!);
    writeFileSync(abs, html);
    const pdfAbs = abs.replace(/\.html?$/i, '.pdf');
    try {
      await deps.renderPdf(abs, pdfAbs);
    } catch (err) {
      /* Same trade the orchestrator makes: the HTML is the document, and
         losing it because Chromium could not print would be worse. */
      console.error('[agent] PDF-Export nach Änderung fehlgeschlagen', err);
    }
    deps.repo.setDocumentFile(row.id, row.file_path!, row.pdf_path, row.template_label);
  }
  return { error: null };
}
```

Add `AskDeps.userDataPath` and `AskDeps.renderPdf`, and pass both from `electron/agent/index.ts` (`userDataPath` is already in scope there; `renderPdf` is already imported from `../pdf.ts`). Register `agent:undo` beside `agent:ask` in the same file, and expose it in `electron/preload.ts` as `agent.undo(applicationId, commentId)`.

- [ ] **Step 5: Run the tests and the whole suite**

Run: `npx vitest run electron/agent/__tests__/ask.test.ts && npx tsc -b && npm test`
Expected: PASS everywhere — this is the task where `tsc` comes back clean after Task 3.

- [ ] **Step 6: Commit**

```bash
npx prettier --write electron/agent/ask.ts src/shared/agent.ts electron/agent/index.ts electron/preload.ts electron/agent/__tests__/ask.test.ts
git add electron/agent/ask.ts src/shared/agent.ts electron/agent/index.ts electron/preload.ts electron/agent/__tests__/ask.test.ts
git commit -m "feat(agent): let Kepler change a mentioned document, and take it back"
```

---

### Task 6: Documents in the mention picker

**Files:**

- Modify: `src/lib/mentions.ts`
- Modify: `src/ui/MentionComposer.tsx`
- Modify: `src/features/detail/CommentsSection.tsx` (assembling the list)
- Test: `src/lib/__tests__/mentions.test.ts`

**Interfaces:**

- Consumes: `documentFor` from `src/state/selectors`, `DocumentKind` from `src/shared/enums`.
- Produces:
  - `Mentionable` gains `kind: MentionKind` where `MentionKind = 'person' | 'document'`, and `document?: DocumentKind`
  - `documentEntries(st: AppState, cardId: string): Mentionable[]` in `src/state/selectors.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/mentions.test.ts`:

```ts
describe('document mentions', () => {
  it('splits a document mention out of the text like a person’s', () => {
    const parts = splitMentions('trag sie ins @Anschreiben ein', ['Kepler', 'Anschreiben']);

    expect(parts.map((p) => p.t)).toEqual(['trag sie ins ', '@Anschreiben', ' ein']);
    expect(parts[1].mention).toBe(true);
  });

  it('does not take @Anschreibens for the document', () => {
    /* Same word rule the assistant's own mention uses. */
    const parts = splitMentions('mein @Anschreibens', ['Anschreiben']);

    expect(parts.every((p) => !p.mention)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/__tests__/mentions.test.ts`
Expected: PASS already — `splitMentions` matches by name and does not care what a name refers to. This test exists to pin that down before the picker starts relying on it. If it fails, fix `splitMentions` before going on.

- [ ] **Step 3: Widen `Mentionable`**

In `src/lib/mentions.ts`:

```ts
/* What a mention stands for. A person gets a round avatar, which in this app
   means "human" everywhere — so a document may not have one, and the picker
   and the comment text both branch on this. */
export type MentionKind = 'person' | 'document';

export interface Mentionable {
  key: string;
  name: string;
  role: string;
  bg: string;
  initials: string;
  kind: MentionKind;
  /* Set for a document mention; the chip needs it to open the file. */
  document?: DocumentKind;
}
```

Add `kind: 'person'` to `KEPLER_ENTRY` and `USER_ENTRY`, and to wherever `peopleForCard` builds its entries.

- [ ] **Step 4: Add the document entries**

In `src/state/selectors.ts`:

```ts
/* The card's two generated documents as mention entries — only the ones that
   actually have a file, since a mention of a document that was never
   generated would offer Kepler nothing to read. */
export function documentEntries(st: AppState, cardId: string): Mentionable[] {
  const titles: [DocumentKind, string][] = [
    [DocumentKind.COVER_LETTER, 'Anschreiben'],
    [DocumentKind.LEBENSLAUF, 'Lebenslauf'],
  ];
  return titles
    .filter(([kind]) => !!documentFor(st, cardId, kind)?.file_path)
    .map(([kind, name]) => ({
      key: 'doc:' + kind,
      name,
      role: 'Dokument',
      bg: 'var(--c-f1efe9)',
      initials: '',
      kind: 'document' as const,
      document: kind,
    }));
}
```

In `CommentsSection.tsx`, change the list to
`const mentionable = [KEPLER_ENTRY, USER_ENTRY, ...peopleForCard(cardId), ...documentEntries(st, cardId)];`

- [ ] **Step 5: Group the picker**

In `src/ui/MentionComposer.tsx`, replace the flat `matches.map(...)` inside the
popover with a grouped render. Above the component, add:

```tsx
/* Small caps, no rule line: the heading names a group, it does not draw a
   border between two lists. */
const GROUP_LABEL: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--c-b3b0a8)',
  fontWeight: 600,
  padding: '7px 7px 3px',
};
```

Inside the component, before the return:

```tsx
const people = matches.filter((m) => m.kind === 'person');
const docs = matches.filter((m) => m.kind === 'document');
/* The arrow keys walk what is rendered, so the flat order has to be the
     rendered order — and a heading must never be a stop on the way. */
const ordered = [...people, ...docs];
/* Headings only earn their place when there are two groups to tell apart.
     By the second keystroke the query is usually down to one, and a heading
     over a single row is decoration. */
const grouped = people.length > 0 && docs.length > 0;
```

and change the popover body to:

```tsx
<div data-dd="1" style={popStyle}>
  {grouped && <div style={GROUP_LABEL}>Personen</div>}
  {people.map((m) => row(m))}
  {grouped && <div style={GROUP_LABEL}>Dokumente</div>}
  {docs.map((m) => row(m))}
</div>
```

with `row` a local function that renders exactly what the flat version rendered,
except that the index comes from `ordered` and a document gets the page glyph
instead of the avatar:

```tsx
const row = (m: Mentionable) => (
  <MenuItem
    key={m.key}
    selected={ordered.indexOf(m) === ix % ordered.length}
    hideCheck
    // mousedown, not click: the textarea must not blur first.
    onMouseDown={() => pick(m.name)}
  >
    {m.kind === 'document' ? (
      /* A round avatar means "human" everywhere in this app, so a document
           takes the same page glyph its card carries. */
      <span style={{ display: 'flex', width: 20, justifyContent: 'center', flexShrink: 0 }}>
        <DocGlyph format={DocFormat.HTML} width={17} height={21} />
      </span>
    ) : (
      <Avatar bg={m.bg} size={20} fontSize={8.5}>
        {m.initials}
      </Avatar>
    )}
    <span style={{ whiteSpace: 'nowrap' }}>{m.name}</span>
    <span
      style={{
        fontSize: 11.5,
        color: 'var(--c-a5a29a)',
        marginLeft: 'auto',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '50%',
      }}
    >
      {m.role}
    </span>
  </MenuItem>
);
```

`handleKey` already indexes `matches[ix % matches.length]` — change both uses to
`ordered` so Enter picks the row the highlight is on.

`DocGlyph` is fixed at 26×32 today. Give it optional `width`/`height` props
defaulting to the current numbers, so this call can ask for a row-sized one
without duplicating its paths:

```tsx
export function DocGlyph({
  format = DocFormat.PDF,
  width = 26,
  height = 32,
}: {
  format?: DocFormat;
  width?: number;
  height?: number;
}) {
```

- [ ] **Step 6: Verify by hand and commit**

There is no renderer test harness in this project, so verify by reading the diff against rules 1-6 above and by `npx tsc -b`.

```bash
npx tsc -b && npm run lint && npm test
npx prettier --write src/lib/mentions.ts src/ui/MentionComposer.tsx src/ui/icons.tsx src/state/selectors.ts src/features/detail/CommentsSection.tsx src/lib/__tests__/mentions.test.ts
git add src/lib/mentions.ts src/ui/MentionComposer.tsx src/ui/icons.tsx src/state/selectors.ts src/features/detail/CommentsSection.tsx src/lib/__tests__/mentions.test.ts
git commit -m "feat(comments): offer the card's documents in the mention picker"
```

---

### Task 7: The document chip in the comment text

**Files:**

- Modify: `src/ui/MentionText.tsx`
- Modify: `src/features/detail/CommentsSection.tsx` (passing the entries down)

**Interfaces:**

- Consumes: `Mentionable` with `kind`/`document` (Task 6), `AttachmentChip` from `src/ui/AttachmentChip`.
- Produces: `MentionText` takes `mentionables: Mentionable[]` instead of `names: string[]`.

- [ ] **Step 1: Change the prop**

`MentionText` currently takes `names: string[]` and passes them to `splitMentions`. Give it the full entries instead — it needs to know which mention is a document — and derive the names inside: `splitMentions(text, mentionables.map((m) => m.name))`.

Update every caller (`CommentsSection`, `RoundNoteThread`) to pass the entries. `RoundNoteThread` has no documents to offer; it passes its people list with `kind: 'person'`.

- [ ] **Step 2: Render a document mention as the chip**

In `Inline`, where a mention part is rendered, branch on the entry:

```tsx
const entry = mentionables.find((m) => '@' + m.name === p.t);
```

For `entry?.kind === 'document'`, render the attachment chip's look inline. The existing blue person chip is unchanged. The document chip:

```tsx
<span
  className="attachment-chip"
  title={entry.name}
  style={{
    display: 'inline-flex',
    gap: 4,
    padding: '1px 5px',
    verticalAlign: -2,
    /* The attachment chip is built to stand alone in a row under the
       composer. In running text it needs less padding, or it breaks the
       line it sits in — same colour, same paperclip, same radius. */
  }}
  onClick={() => onOpenDocument?.(entry.document!)}
>
  <PaperclipGlyph />
  <span style={{ fontSize: 12, color: 'var(--c-1b1a17)', whiteSpace: 'nowrap' }}>{entry.name}</span>
  {size != null && (
    <span style={{ fontSize: 11, color: 'var(--c-a5a29a)', whiteSpace: 'nowrap' }}>{formatBytes(size)}</span>
  )}
</span>
```

The size comes from the same `documents.sizes` call `DocumentsSection` already makes — read at render time, so it does not go stale when Kepler rewrites the file. Lift that lookup into a prop (`sizeOf?: (kind: DocumentKind) => number | null`) rather than making `MentionText` do IPC.

`onOpenDocument` is passed from `CommentsSection` and calls the same `window.desktop.documents.open` path the document cards use.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc -b && npm run lint && npm test
npx prettier --write src/ui/MentionText.tsx src/features/detail/CommentsSection.tsx src/features/interviews/RoundNoteThread.tsx
git add src/ui/MentionText.tsx src/features/detail/CommentsSection.tsx src/features/interviews/RoundNoteThread.tsx
git commit -m "feat(comments): render a mentioned document as its attachment chip"
```

---

### Task 8: Kepler's answer in the thread

**Files:**

- Modify: `src/features/detail/CommentsSection.tsx`
- Modify: `src/state/store.tsx` (the undo call), `src/state/store-context.ts`
- Modify: `src/desktop.d.ts` (the `agent.undo` signature)

**Interfaces:**

- Consumes: `CommentEditRow` (Task 2), `agent.undo` (Task 5).
- Produces: `undoEdits(applicationId: string, commentId: number): Promise<string | null>` on the store.

- [ ] **Step 1: Render the edit lines**

Under a Kepler comment that has rows in `st.commentEdits`, render one line per edit, in `position` order:

- `kind === 'replace'`: struck old, an arrow, the new text on the green tint
- `kind === 'delete'`: a leading `−`, struck old, nothing else
- `kind === 'insert'`: a leading `+`, the new text on the green tint

Exact styling, settled in the mockups:

```tsx
const OLD: CSSProperties = {
  color: 'var(--c-9a978f)',
  textDecoration: 'line-through',
  /* The rule follows the text rather than sitting a shade lighter — a lighter
     rule read as a printing flaw rather than a decision. */
  textDecorationColor: 'currentColor',
  textDecorationThickness: 1,
};
const NEW: CSSProperties = {
  fontWeight: 600,
  color: 'var(--c-1b1a17)',
  /* The green the editor puts on a passage that stands. Flat: it means "this
     holds now", and an underline would make it look like the marks. */
  background: 'color-mix(in srgb, var(--c-4f8f6a) 12%, transparent)',
  borderRadius: 3,
  padding: '0 3px',
};
/* A replacement shows both halves and needs no sign. The other two are each
   missing a half, so each takes one — green cannot carry the difference,
   because the right half of a replacement is green too. */
const SIGN: CSSProperties = {
  color: 'var(--c-b3b0a8)',
  fontSize: 11.5,
  display: 'inline-block',
  width: 11,
};
```

- [ ] **Step 2: Render the status line**

Below the lines, left-aligned, one dot, the icon at the right edge:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 11.5, color: applied ? 'var(--c-4f8f6a)' : 'var(--c-8b8880)' }}>
  <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: applied ? 'var(--c-4f8f6a)' : 'var(--c-c9c5bb)' }} />
  {applied ? `${title} und PDF aktualisiert` : 'Nichts geändert'}
  <span style={{ flex: 1 }} />
  <div
    className="icon-btn"
    title={applied ? 'Änderung zurücknehmen' : 'Nochmal versuchen'}
    style={{ flexShrink: 0, marginTop: -4, marginBottom: -4 }}
    onClick={…}
  >
    <RegenGlyph />
  </div>
</div>
```

`applied` is true when the comment has rows and none is undone. A refused answer has no rows, so it shows the grey line and the icon means "try again"; an undone set shows the grey line too.

The dot alone has to tell the reader whether the file was touched — that is why both refusals look identical and only the sentence above differs.

- [ ] **Step 3: Wire undo through the store**

Add to `src/state/store.tsx`:

```ts
const undoEdits = useCallback(
  async (applicationId: string, commentId: number): Promise<string | null> => {
    const res = await window.desktop?.agent.undo(applicationId, commentId);
    if (!res) return 'Ohne Desktop-Umgebung nicht möglich.';
    if (!res.ok) return res.error;
    /* The undo moved files and rewrote rows on the main side; the in-memory
         view has no way to know what changed, so it re-pulls. `resync` is the
         store's own name for that — see useResync near the top of the file. */
    resync();
    return null;
  },
  [resync],
);
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc -b && npm run lint && npm test
npx prettier --write src/features/detail/CommentsSection.tsx src/state/store.tsx src/state/store-context.ts src/desktop.d.ts
git add src/features/detail/CommentsSection.tsx src/state/store.tsx src/state/store-context.ts src/desktop.d.ts
git commit -m "feat(comments): show what Kepler changed, and let it be taken back"
```

---

### Task 9: The run comment names the contact it found

This is the bounded item 5, unrelated to the rest of the plan and independently testable.

**Files:**

- Modify: `electron/agent/orchestrator.ts` — the CONTACTS step and `finalComment`
- Test: `electron/agent/__tests__/orchestrator.test.ts`

**Interfaces:**

- Consumes: `Findings` in `finalComment` (already there).
- Produces: `Findings` gains `researched: { name: string; role: string | null; linkedin: string | null } | null`.

- [ ] **Step 1: Write the failing test**

Add to `describe('runPipeline', …)` in `electron/agent/__tests__/orchestrator.test.ts`:

```ts
it('names a researched contact in the closing comment, with the profile link', async () => {
  /* The posting names nobody, so the step goes looking. Linking the person
       silently means the user never learns that the name in their letter is a
       guess someone should check. */
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const llm = fakeLlm({
    extraction: () => ({ ...EXTRACTION, people: [] }),
    contact: () => ({
      person: {
        name: 'Maria Haushofer',
        role: 'Talent Acquisition',
        email: null,
        phone: null,
        linkedin: 'https://linkedin.com/in/mariahaushofer',
      },
    }),
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  const text = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!.text;
  expect(text).toContain('Maria Haushofer');
  expect(text).toContain('https://linkedin.com/in/mariahaushofer');
  expect(text).toContain('prüf');
});

it('says nothing about a contact the posting named itself', async () => {
  /* Only a researched name is a guess. One the posting printed is a fact,
       and reporting it would spend a bullet on nothing. */
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });

  await runPipeline(appId, createRun(appId), deps());

  const text = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!.text;
  expect(text).not.toContain('Lena Vogt');
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: FAIL — the comment names nobody.

- [ ] **Step 3: Carry the researched person to the comment**

In the CONTACTS step, where the researched person is marked `(unbestätigt)`, keep it:

```ts
/* Only a researched contact is worth reporting: one the posting printed
       is a fact, one Kepler found is a guess the user has to confirm before
       the letter goes out addressed to them. */
let researched: ExtractedPerson | null = null;
```

set it beside the existing `people = [...]` assignment, and add it to `Findings`. In `finalComment`, prepend its bullet ahead of the claims — a name in the salutation that nobody checked outranks a wording problem:

```ts
const contact = findings.researched
  ? [
      `**${findings.researched.name}**${findings.researched.role ? ` (${findings.researched.role})` : ''} ` +
        `im Web gefunden und eingetragen — bitte prüf sie${findings.researched.linkedin ? `: ${findings.researched.linkedin}` : '.'}`,
    ]
  : [];
```

On a resumed run `researched` is null, because the research happened in an earlier attempt; that is correct — the bullet reports what this run did.

- [ ] **Step 4: Run and commit**

```bash
npx tsc -b && npm run lint && npm test
npx prettier --write electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git add electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git commit -m "feat(agent): name a researched contact in the run's closing comment"
```

---

## Final verification

- [ ] `npx tsc -b` clean
- [ ] `npm run lint` clean
- [ ] `npm test` clean
- [ ] `npx prettier --check` clean on every touched file
- [ ] A real run: mention `@Anschreiben` in a comment, ask for a change, confirm the file and the PDF moved and the thread shows the pairs; press the icon and confirm the file comes back.

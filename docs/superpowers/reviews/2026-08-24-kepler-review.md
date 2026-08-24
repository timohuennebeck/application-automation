# Review — `7e74017..25cdba0`

38 commits, 68 files, +9,472/−654 (≈3.7k of that is `docs/` plans and specs).
Baseline on `25cdba0`: `npx tsc -b` clean, `oxlint` clean, 518/518 tests pass.
After the fixes in this branch: clean, clean, **530/530**.

## How this was produced

Six review agents, two each in three roles, split main-process / renderer so the
two passes in a role covered different ground:

| Role | Pass A | Pass B |
| --- | --- | --- |
| code-reviewer | `electron/agent`, `electron/db`, `files.ts`, IPC | `src/state`, `src/features`, `src/ui`, React |
| code-simplifier | `electron/` | `src/` |
| silent-failure-hunter | agent, DB, IPC | renderer, store, undo UI |

> **On the toolkit**: the `pr-review-toolkit` plugin is not in this
> environment's catalog (`SearchPlugins` returns `engineering`, `qodo-skills`,
> `miro`, `qt-development-skills`). The three roles were run as subagents with
> equivalent mandates instead of the packaged agents.

Every finding below that is marked **Confirmed** was re-verified against the
source by hand before it was acted on — several agent claims did not survive
that, and are recorded in *Rejected* at the end.

---

## Implemented — 6 commits

### 1. `fix(agent): refuse edits that could never be placed or reversed`
`edits.ts`, `schemas.ts` + tests

Three ways an edit set could be written and then never taken back.

- **A deletion's `after` anchor was never checked.** On the forward path a
  `DELETE` is located by `find` alone, so `after` is read for the first time by
  `reverseEdits`, as the anchor the passage goes back behind. An anchor that
  resolves but is not byte-adjacent to `find` still matches then, and the text
  comes back somewhere it never stood — a `<p>` nested inside the salutation —
  with `failed: null` reported. This is exactly the failure `edits.ts`'s own
  header says the module exists to prevent. Now verified at apply time, where
  the document still says what the edit was written against.
- **An edit whose `replace` was empty.** `validateAsk` required `find` for a
  replacement and `after` for a deletion, but never a non-empty `replace`. Such
  an edit placed nothing, reported success, and `reverseEdits` then turned it
  into a needle of `''` that `occurrences()` can never find — blocking the undo
  of the **whole set**, permanently, since the undo is all-or-nothing.
- **Four of the five drop paths in `validateAsk` were silent.** The model's own
  prose already promised every change it returned, so a silent drop leaves the
  thread describing a change that never happened. All drops are counted now,
  truncation past `MAX_EDITS` included; the deletion keeps its specific
  sentence while it is the only drop.

Also un-exports `MAX_EDITS` (verified: three occurrences, all inside
`schemas.ts`).

### 2. `fix(agent): keep Kepler's writes to the documents a comment named`
`ask.ts` + tests, `src/shared/agent.ts`

**The most serious finding in the review.** `answer()` computed `mentioned`,
used it to gate what the model may *read* (`ask.ts:312`) and the open-editor
refusal (`:307`) — then handed `writeGroups` **every** document row on the card
and `reply.edits` **unfiltered** (`:354`). `editRules` in `prompts.ts` actively
invites the mismatch: it tells the model `document ist "COVER_LETTER" oder
"LEBENSLAUF"` regardless of which document it was given.

So an edit naming the Lebenslauf was applied when only `@Anschreiben` was
mentioned — against bytes Kepler never read, matching by luck — and the
open-editor guard never fired for it, because that check consults `mentioned`.
The editor's next debounced flush then writes its stale DOM back over it.

Pass A reproduced this against the real service. The test named *"ignores a
document that was not mentioned"* (`ask.test.ts:613`) only asserted the prompt's
contents, so it read as locking the behaviour in while leaving the write path
untested.

Three more places on the same path went quiet, fixed in the same commit:

- A mentioned document that could not be read was dropped from the prompt
  silently. With no document in the prompt the model is never told there was one
  to change, answers in prose, and the reply reads as an ordinary success over a
  file nobody touched. The German sentence for it already existed one function
  over, unreachable.
- A PDF re-render that failed nulled `pdf_path` and still returned
  `{ error: null }`. `writeGroups` carries the reason out now.
- `undoOne`: its two pre-flight reads sat outside the `try`, contradicting
  `enqueue`'s own comment that neither task ever rejects; it never checked the
  comment belongs to the application it was handed (which `answer()` does); and
  it asserted the comment row back with `!` after an await wide enough to delete
  it.

**Two existing tests changed.** Both relied on Kepler writing a document the
comment never named; each now names it, which preserves the test's actual
intent (queue-poisoning, undo ordering).

### 3. `fix(agent): stop a failed check reading as a clean one`
`orchestrator.ts`

- **`claims = []` in the proofs catch** (`:420`) is the same value a clean
  document produces, and `done(PROOFS, true)` ran unconditionally after. A
  broken call, a malformed answer, or a throw from the rewrite mid-block all
  closed the run with `**Fertig**` and no bullets. Worst case: the first reading
  finds three unbacked claims, the letter is rewritten *for them*, the second
  reading throws — and the findings the rewrite was made for are erased. The
  reason now reaches the closing comment above every other bullet.
- **`readGeneratedHtml` returned `''`** (`:588`, `:591`) for a missing row or a
  failed read. Both checks then passed judgement on an empty string and found
  nothing wrong with it — the hazard the function's own comment names. It
  throws now: PROOFS turns that into the bullet above, VALIDATE fails the step.
- **Bullet truncation was silent.** The three-bullet cap stays (it is a
  deliberate design decision, argued in the code); the remainder is counted on
  its own line rather than spending a bullet a reader could have acted on.

### 4. `fix(pdf): put every writer through one render queue`
`pdf.ts`, `main.ts`, `agent/index.ts`

`queuePdfRender` lived in `main.ts` and its comment claimed *"Both write routes
come through here."* Since the edit feature there are three: `agent/index.ts:9`
imports `renderPdf` straight from `pdf.ts` and injects it into both the pipeline
and the ask service. A run, an answer carrying edits, and the editor's debounced
save can therefore print the same PDF path at once; the loser's `rmSync` cleanup
deletes what the winner just wrote and nulls `pdf_path`. Moved beside
`renderPdf`, where every caller can reach it.

### 5. `fix(comments): let an undo hold the card and report what it did`
`store.tsx`, `selectors.ts`, `CommentsSection.tsx` + tests

- **`undoEdits` never set `pending`**, so `DocumentsSection`'s editor lock — whose
  comment says the card *"stays shut for as long as the answer is owed"* — was
  off for the whole undo. And both its exits wrote the `keplerAsk` row
  wholesale, so an undo resolving while an ask was in flight cleared **that
  ask's** `pending` and unlocked the card under it.
- **No `catch` on the bridge call**, unlike `askKepler`; the click handler floated
  the promise too. A rejection reached nothing but devtools while the line
  stayed green over a document that was never reverted.
- **The undo icon had no in-flight guard.** The status line only turns grey after
  a resync round trip — wide enough to click twice, and the second call then
  reports *"Diese Änderung wurde schon zurückgenommen"* over an undo that worked.
- **`und PDF aktualisiert` was printed unconditionally** whenever the set applied
  (`CommentsSection.tsx:114`), in the success green, *including* when the
  re-print had failed and the PDF had been deleted. `editStatus` reads the row
  now.
- **`setLanguage` missing from the actions dependency array.** Benign today; the
  next dep added to it would silently hand out a stale closure.

### 6. `fix(lib): keep escaped characters intact in what the thread shows`
`markup.ts`, `mentions.ts` + new test file

`stripMarkup` mapped every named entity outside its eight-entry table to a
**space** and never matched numeric ones at all. Tolerable while it only fed
prompts; `editText` now routes it into the comment thread, so an ordinary
hand-written Fassung reached the reader as `Zust ndig` and `Berlin&#8211;Mitte`.
The edit lines are what the user reads to decide whether to take a change back.

Named entities are case-sensitive, so the exact spelling is tried before the
lenient lowercase fallback the old table relied on — otherwise `&Auml;` would
collapse onto `ä`. `markup.ts` gets the co-located test file it was missing.

Also drops `selectMentionMatches`'s `budget` parameter (no caller ever passed
it) and `store.tsx`'s private copy of the three document titles that
`DOCUMENT_TITLE` already exports.

---

## Not implemented — and why

### Real, but pre-existing rather than introduced here

**`use-document-save.ts:83-86` — the unmount flush always discards its result.**
The cleanup sets `live.current = false` *before* calling the flush, and the
flush's `if (!live.current) return` (`:61`) then drops the outcome. So the one
save that most needs reporting — the one carrying up to 700 ms of unwritten
typing, fired precisely because the page is going away — is the only one
guaranteed to be silent, error *and* success.

I checked `7e74017:src/features/letter/use-letter-save.ts`: **byte-identical
before the range.** These commits only widened the blast radius (both documents
are freely editable now, every typing pause schedules a save). It is a genuine
bug and worth fixing, but it is not one of these commits' defects, and fixing it
properly means adding a store-level `documentSaveError` surface — a design
decision rather than a patch. Flagged for a separate change.

### Real, but the fix is a design call you should make

- **A retried run loses the first attempt's findings.** `claims`, `tooLong` and
  `issues` are pipeline-scoped, so a run that fails at VALIDATE and is retried
  skips GEN/PROOFS as already DONE and reaches `finalComment` empty — producing
  a *better-looking* comment than the original run would have. The code comment
  acknowledges this as pre-existing for `tooLong`; `claims` is new and is the
  one of the three that describes a factual error in a document about to be
  sent. The fix needs findings persisted onto the step (a `run_findings` column
  or similar) — a schema change plus migration, out of scope for a review patch.
- **Deleting a Kepler reply cascades away the only record of what it changed.**
  `comment_edits` has `ON DELETE CASCADE` and `deleteComment` is reachable from
  the thread menu with no warning; the document stays edited with nothing left
  to reverse it. Both plausible fixes (refuse the delete, or warn in the
  confirmation) are product decisions.
- **`replaceDocument` is not covered by the editor lock.** `DocumentsSection`
  gates `editable` on `locked` but not the "Ersetzen mit eigener Datei" menu
  entry, which writes the same path. One-line fix, but it changes what the user
  can do during a run — your call whether that is intended.
- **`LetterEditor.blur()` wipes typing inside a focused mark.** `syncMarks`
  deliberately skips `focusedRef.current`, and `blur()` unconditionally restores
  `state.committed` for every phase — so typing into an accepted (green) passage
  is wiped from the screen while the already-scheduled save writes the typed
  version to disk. Screen and file disagree. Confirmed by reading; the fix
  (track the previewed element separately from the focused one) touches the
  editor's core interaction model and deserves its own change with manual
  testing, which I cannot do here.
- **Where the undo refusal renders.** `keplerAsk.error` is one row per card,
  shown after the last comment, so a refusal from a set several replies up
  appears at the bottom of the thread. Keying the error by comment id is a
  reasonable improvement; the current behaviour is a deliberate trade
  (`e2b44ef`: "the icon itself has no room for a sentence").

### Worth doing, deliberately deferred (simplifications)

These are all genuine and verified. None is a defect, and each touches code the
bug fixes above also touch — landing them together would have made the fixes
harder to review. Recommended as a follow-up, roughly in payoff order:

1. **One `DocumentKind → German title` map.** `DOCUMENT_MENTION` (`ask.ts:55`),
   `DOCUMENT_LABEL` (`orchestrator.ts:785`) and `DOCUMENT_TITLE`
   (`selectors.ts:56`) are the same record three times; two are byte-identical.
   `src/shared/enums.ts` already houses exactly this kind of map and is reachable
   from both processes. Commit 6 removed a fourth copy.
2. **One mention word-boundary rule.** The `(?<![\p{L}\d@])@…(?![\p{L}\d])`
   pattern is hand-written in three places across two processes (`ask.ts:70`,
   `mentions.ts:13`, `:76`). Correct today — pass B verified the three agree —
   but nothing enforces it, and a change to the boundary would fix the
   renderer's chips and silently leave Kepler's detection behind.
3. **`MentionText`'s document chip re-implements `AttachmentChip`** — same class,
   same two inner style objects, byte for byte. CLAUDE.md's "the same look is the
   same bytes everywhere" rule applies directly.
4. **The document-size fetch effect is duplicated verbatim** between
   `CommentsSection` and `DocumentsSection`. The repo already has the precedent
   for collapsing this (`useDesktopList`).
5. **`editText` belongs in `src/lib/markup.ts`**, not `selectors.ts` — both
   processes compute `stripMarkup(raw) || '(kein Text)'`, including the same
   German literal.
6. **`repo.load()` reads the whole database to fetch one field**, ~15× per run
   (~21 unfiltered `SELECT *` each time). Narrow getters, per call site.
7. **`GROUP_LABEL` re-implements `MenuLabel`** with three drifted values.
8. Smaller: hoist `modelPlaceholders(template)` (scanned twice per generation);
   a `generate()` closure for the three GEN blocks; a `relabel()` helper for the
   duplicated relabel dance; one `CHROME_CLASSES` for the toolbar/edit-hint list.

### Rejected

- **`Mentionable` as a discriminated union** (simplifier B). A sound design, but
  it reshapes a shared `src/ui/` primitive and its two consumers to remove two
  props — medium risk, no defect behind it.
- **A `ChipSelect` for the four sidebar pickers.** The full version needs ~7
  props to cover the row-content variations; that is not a simplification.
- **Moving `writeAllOrNothing` into `files.ts`.** The tmp/rename ordering is
  subtle and currently correct; the payoff does not justify moving it.
- **`ProofsInput` as a dead export.** It matches the established shape of
  `DocumentInput`/`VariantsInput`/`AskInput` in the same file.
- **`displayReason`'s empty-pattern bug, as originally reported.** Hunter A
  claimed `reason.replace('', …)` was reachable on the forward path. It is not —
  the validator guarantees a non-empty needle for every kind. It *is* reachable
  on **undo**, where `reverseEdits` produces `find: ''` from an edit whose
  `replace` was empty. Commit 1 removes the cause; commit 2 adds the guard
  anyway, since it costs one line.
- **Per-keystroke regex recompilation in the mention composer.** Real, and
  sub-millisecond.
- **`EMPTY_SIDES` aliasing in `ProfileModal`.** Every `onChange` path is
  non-mutating, so it is harmless today. Worth a comment, not a change.

### Checked and clean

Both reviewers independently confirmed these, and I spot-checked the list:
migrations 24 and 25 match their row types and are covered by tests; the
`comment_edits` cascade is real (`PRAGMA foreign_keys = ON`); `files.ts` path
handling rejects traversal on every new route, including the new `language`
segment; `writeGroups`' staging/rename/tmp-cleanup is sound, including the
"the write that itself threw" case; the mention picker's row-budget arithmetic
and its agreement with the main process; `documentLanguageOf`'s legacy fallback;
`serializeLetter`'s `contenteditable` round trip; `commentEdits` store
discipline; and the new tests in `mentions.test.ts` and `selectors.test.ts`
assert what their names claim.

---

## Applying this

The fixes are the six commits this document sits on top of, on
`claude/review-commits-7e74017-zih0oa`.

Pushing that branch was refused — Claude has no GitHub access for this org — so
the same six commits were also delivered directly as a `git am`-able mailbox
(`kepler-review-fixes.mbox`) and as one flat diff (`all-fixes.patch`). Those two
files are regenerable from this branch and are deliberately not committed here:

```
git format-patch 25cdba0..HEAD --stdout > kepler-review-fixes.mbox
git diff 25cdba0..HEAD > all-fixes.patch
```

Verified per commit, not just at the tip — `npx tsc -b` clean and the suite
green at each of the six:

| | commit | tests |
| --- | --- | --- |
| | *(base `25cdba0`)* | 518 |
| 1 | `refuse edits that could never be placed or reversed` | 521 |
| 2 | `keep Kepler's writes to the documents a comment named` | 523 |
| 3 | `stop a failed check reading as a clean one` | 523 |
| 4 | `put every writer through one render queue` | 523 |
| 5 | `let an undo hold the card and report what it did` | 524 |
| 6 | `keep escaped characters intact in what the thread shows` | 530 |

`npm run lint` is clean throughout.

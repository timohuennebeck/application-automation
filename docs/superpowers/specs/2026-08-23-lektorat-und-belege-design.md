# Lektorat und Belege — design

Two faults in the documents Kepler generates, and one step that answers both.

- A generated letter opens with a sixty-word paragraph no recruiter reads.
- Nothing checks that a proof point is backed by the Lebenslauf. The prompts
  say "erfinde nichts"; that is the whole enforcement.

Both are failures of the same kind: the values come back plausible and nobody
measures them. The design adds two measurements — one deterministic, one a
model call — and gives each exactly one chance to be answered better.

## Why the paragraph is long

The letter's opening is three slots concatenated by the Fassung:

```html
{{COMPANY_HOOK_SENTENCE}} Software, die {{COMPANY_PRODUCT_PURPOSE}}, ist genau die Art Aufgabe, für die ich
mich bewerbe – und in der ich {{CANDIDATE_PRIMARY_EXPERIENCE}} bereits in Produktion gebracht habe.
```

`cvPrompt` tells the model to keep each value about as long as the text beside
it in the Fassung (`prompts.ts:134`). `letterPrompt` says nothing of the kind —
and the letter's Fassung shows the model bare `{{…}}` at those positions, so
there is no length beside them to match even if it wanted to. The slots have no
budget at all.

So the fix is two-sided: give each slot a stated budget, and split the
paragraph so the hook stands on its own.

## What is added

### 1. A budget per slot, stated once

A record maps placeholder names to a maximum word count. It is the single
source for both the prompt and the check, so the two cannot drift:

```ts
/* electron/agent/budgets.ts */
export interface OverBudget {
  slot: string;
  budget: number;
  /* What the answer actually came back at — the redo quotes it. */
  words: number;
}
export const VALUE_BUDGET: Record<string, number>;
export function overBudget(values: Record<string, string>): OverBudget[];
```

The glossary in `letterPrompt` renders "(höchstens N Wörter)" from this record
rather than repeating numbers in prose. `overBudget` counts words after
stripping the emphasis tags the values are allowed to carry.

Proposed budgets, from what the T-format actually has room for:

| Slot                           | Words | Why                                             |
| ------------------------------ | ----- | ----------------------------------------------- |
| `COMPANY_HOOK_SENTENCE`        | 25    | One sentence, its own paragraph after the split |
| `COMPANY_PRODUCT_PURPOSE`      | 8     | A relative-clause fragment, not a sentence      |
| `CANDIDATE_PRIMARY_EXPERIENCE` | 8     | An object, same                                 |
| `JOB_REQUIREMENT_1…4`          | 8     | A matrix cell, scanned not read                 |
| `CANDIDATE_PROOF_POINT_1…4`    | 18    | Result plus method, one line in the cell        |
| `RELEVANT_TECH_STACK_SUMMARY`  | 10    | A turn of phrase                                |
| `CANDIDATE_HEADER_ROLE`        | 12    | One line under the name                         |

Slots not in the record have no budget — the address block and the salary
sentence are as long as the facts make them.

### 2. The paragraph splits

Both Anschreiben Fassungen get the opening broken in two, so the hook is a
paragraph and the bridge to the applicant is the next one:

```html
<p>{{COMPANY_HOOK_SENTENCE}}</p>
<p>
  Software, die {{COMPANY_PRODUCT_PURPOSE}}, ist genau die Art Aufgabe, für die ich mich bewerbe – und in der
  ich {{CANDIDATE_PRIMARY_EXPERIENCE}} bereits in Produktion gebracht habe.
</p>
```

With the budgets above that is two paragraphs of about 25 words each in place
of one of sixty.

### 3. The check inside the document step

`generateDocument` measures the values it just received. If anything is over
budget it asks once more — the same prompt with a paragraph naming the slots,
their budgets and what came back — and keeps whichever answer it then has.

This is deliberately **not** routed through `validate`. A validator that throws
gets one retry from `createLlmRunner` and then fails the step, which is the
behaviour for a malformed answer and the wrong one here: a letter that is three
words long is worth having. The redo lives in `generateDocument`, where it can
take the second answer whether or not it is better.

`generateDocument` returns `{ html, overBudget }` rather than the HTML string
it returns today; the two call sites in the pipeline take the html off it. The
`overBudget` list travels to the final comment.

A second parameter, `complaint`, lets a caller append a reason to the prompt
and suppress the budget redo — that is how the proofs step reuses this function
without a third generation.

### 4. A new step: Belege prüfen

`AgentStepKey.PROOFS`, between `GEN_LETTER` and `VALIDATE`:

```
… → GEN_CV → GEN_LETTER → PROOFS → VALIDATE → COMMENT
```

One model call. It reads the two generated documents as text, the selected
Lebenslauf Fassung as text, and the profile facts, and it answers with the
claims it could not find support for:

```
{ unsupported: [ { document, quote, why } ] }   // at most 5
```

The question it is asked is narrow on purpose: for every factual claim in the
documents — a number, a duration, an employer, a technology, a scope — name the
line in `<lebenslauf>` or `<profil>` that carries it; list the ones no line
carries. Style is not its business; the letter prompt owns that.

If it finds anything in the **Anschreiben** on the first pass, the step rewrites
that document once: `generateDocument` again with the unsupported quotes
appended as the reason and its own budget redo suppressed, then the same check
over the new text. Whatever the second check says is what the run reports.

Unsupported claims in the Lebenslauf are reported but never rewritten — see
"Not in this design". A run whose only findings are in the CV therefore does
not regenerate anything. The step's running label says what it is doing, so a
rewrite is not hidden inside a step called "prüfen":

- waiting: `Belege prüfen`
- running: `Belege werden geprüft…`
- rewriting: `Anschreiben wird mit belegten Angaben neu geschrieben…`
- done: `Belege geprüft`

### 5. What reaches the user

`finalComment` already renders up to three issue bullets. It now receives three
sources, in this order of importance:

1. claims still unsupported after the rewrite
2. slots still over budget after the redo
3. what `VALIDATE` found, as today

Still capped at three bullets — the comment is a note, not a report.

## Structure

```
electron/agent/
  budgets.ts        VALUE_BUDGET, overBudget()          (new)
  prompts.ts        proofsPrompt(); glossary renders budgets
  schemas.ts        PROOFS_SCHEMA, validateProofs()
  orchestrator.ts   the PROOFS step; generateDocument's redo
  labels.ts         the four PROOFS labels
src/shared/enums.ts AgentStepKey.PROOFS
```

No migration. `agent_steps.key` is a free `TEXT` column with no CHECK, and a
run created before this change simply has no PROOFS row — `pending()` returns
false for a key the run does not carry, which is how the pipeline already
tolerates a plan that has changed under it.

## Cost

A letter that is both verbose and ungrounded is generated three times: once,
once for the budget, once for the proofs — the proofs rewrite suppresses the
budget redo, so three is the ceiling, not a floor that stacks. Each document
call has a 180 s timeout, so the worst case is slow. Both redos are conditional
and neither fires on a document that came back right, which is the common
case. The
alternative — one combined check with a single redo — is cheaper by one call
and worse in two ways: the budget is deterministic and can be answered without
a model call at all, and the proofs check reads a better document when the
verbose values have already been cut.

## Testing

Against the existing fakes; the whole pipeline already runs in tests against an
in-memory database and a scripted `llm`.

- `overBudget` counts words, ignores `<strong>`, and reports only what is over.
- The glossary quotes the same numbers the check enforces — read from the
  record, so a changed budget moves both.
- A document step whose first answer is over budget asks again, and the second
  prompt names the offending slots.
- A second over-budget answer is kept, and the slot is reported in the comment.
- The proofs step rewrites the letter once when a claim in it is unsupported,
  and reports when the rewrite does not fix it.
- A finding that sits only in the Lebenslauf is reported without regenerating
  anything.
- The letter is generated at most three times, whatever both checks say.
- A run created without a PROOFS row completes, skipping it.
- The comment caps at three bullets across all three sources.

## Not in this design

- Rewriting the Lebenslauf for proofs. The CV is copied from the Fassung and
  only its header line is generated; the letter is where invention happens.
- Style or tone review. The letter prompt already forbids the floskeln, and a
  second opinion on voice is a different feature.
- Anything about the recruiter search (5) or `@CoverLetter` (6).

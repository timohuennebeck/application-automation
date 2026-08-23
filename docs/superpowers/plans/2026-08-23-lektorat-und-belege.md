# Lektorat und Belege Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Kepler writing sixty-word paragraphs and unbacked proof points — give every generated value a word budget the code enforces, and add a pipeline step that checks each claim against the Lebenslauf.

**Architecture:** Two measurements, each with one retry. The word budget is a pure function over the returned values, checked inside `generateDocument`, which asks once more and then keeps whatever it has. The grounding check is a new pipeline step (`PROOFS`) between `GEN_LETTER` and `VALIDATE`: one model call over the finished documents, the Lebenslauf Fassung and the profile facts, which rewrites the Anschreiben once if a claim is unsupported. Everything either check still objects to afterwards becomes a bullet in the run's closing comment.

**Tech Stack:** TypeScript, Node `node:sqlite`, Vitest, Claude Agent SDK. Main process only — no renderer changes in this plan.

**Spec:** `docs/superpowers/specs/2026-08-23-lektorat-und-belege-design.md`

## Global Constraints

Copied from `CLAUDE.md`; every task is bound by these.

- `npx tsc -b`, `npm run lint` and `npm test` must all be clean before work is called done.
- Named exports and `export function` declarations. No default exports, no exported arrow functions.
- Explicit return types on exported functions in `electron/`.
- Relative imports inside `electron/` carry the `.ts` extension (nodenext). Imports from `src/shared/` and `src/data/` also carry it.
- `import type` for type-only imports — `verbatimModuleSyntax` is on.
- Comments are `/* */` blocks that explain **why**, not what. Match the surrounding density — this codebase comments heavily and every comment earns its place.
- Prettier: single quotes, 2-space indent, semicolons, trailing commas, 110 columns. Run `npm run format` rather than hand-aligning. Format **only the files you touched** — peer sessions edit this repo concurrently.
- German is the UI language: prompts, labels, comment text and error messages are German. Identifiers, code comments and commit messages are English.
- Tests live in `__tests__/` next to the code they cover.
- The Agent SDK may only be imported from the main process.

---

## File Structure

| File                                        | Responsibility                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/agent/budgets.ts`                 | **New.** `VALUE_BUDGET`, `OverBudget`, `overBudget()`. The single source for how long a value may be — read by the prompt glossary and by the check. |
| `electron/agent/__tests__/budgets.test.ts`  | **New.** Word counting, emphasis stripping, which slots are reported.                                                                                |
| `electron/agent/prompts.ts`                 | `placeholderGlossary` renders budgets from the record; new `proofsPrompt`.                                                                           |
| `electron/agent/schemas.ts`                 | `PROOFS_SCHEMA`, `validateProofs`, the `UnsupportedClaim` type.                                                                                      |
| `electron/agent/labels.ts`                  | The `PROOFS` labels, including the rewriting form; `stepPlan` gains the step.                                                                        |
| `electron/agent/orchestrator.ts`            | `generateDocument` returns `{ html, overBudget }` and does the budget redo; the `PROOFS` step; `finalComment` takes three sources.                   |
| `src/shared/enums.ts`                       | `AgentStepKey.PROOFS`.                                                                                                                               |
| The two Anschreiben Fassungen in `userData` | The opening paragraph splits in two. Not in the repo — a task with its own verification.                                                             |

No database migration. `agent_steps.key` is a free `TEXT` column with no CHECK (`electron/db/schema.ts:408`), and a run created before this change carries no `PROOFS` row — `pending()` returns false for a key the run does not have, which is how the pipeline already tolerates a changed plan.

---

### Task 1: The budget record and the check

**Files:**

- Create: `electron/agent/budgets.ts`
- Test: `electron/agent/__tests__/budgets.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `VALUE_BUDGET: Record<string, number>`, `interface OverBudget { slot: string; budget: number; words: number }`, `overBudget(values: Record<string, string>): OverBudget[]`.

- [ ] **Step 1: Write the failing test**

Create `electron/agent/__tests__/budgets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VALUE_BUDGET, overBudget } from '../budgets.ts';

describe('overBudget', () => {
  it('says nothing about a value that fits', () => {
    expect(overBudget({ COMPANY_PRODUCT_PURPOSE: 'Personalprozesse zuverlässig macht' })).toEqual([]);
  });

  it('reports a value over its budget with what it came back at', () => {
    /* The purpose slot is a fragment; nine words is a sentence. */
    const long = 'eins zwei drei vier fünf sechs sieben acht neun';

    expect(overBudget({ COMPANY_PRODUCT_PURPOSE: long })).toEqual([
      { slot: 'COMPANY_PRODUCT_PURPOSE', budget: VALUE_BUDGET.COMPANY_PRODUCT_PURPOSE, words: 9 },
    ]);
  });

  it('counts words, not markup', () => {
    /* A proof point may carry emphasis; <strong> is not a word. */
    const value = '<strong>phase6</strong> auf 1 Mio. Nutzer gebracht';

    expect(overBudget({ CANDIDATE_PROOF_POINT_1: value })).toEqual([]);
  });

  it('ignores a slot that has no budget', () => {
    /* The address block is as long as the facts make it. */
    expect(
      overBudget({ COMPANY_STREET: 'eins zwei drei vier fünf sechs sieben acht neun zehn elf' }),
    ).toEqual([]);
  });

  it('treats an empty optional value as fitting', () => {
    expect(overBudget({ SALARY_EXPECTATION_SENTENCE: '' })).toEqual([]);
  });

  it('reports every slot that is over, in the order the record names them', () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => 'w' + i).join(' ');

    const over = overBudget({
      CANDIDATE_PROOF_POINT_1: long(40),
      COMPANY_HOOK_SENTENCE: long(40),
    });

    expect(over.map((o) => o.slot)).toEqual(['COMPANY_HOOK_SENTENCE', 'CANDIDATE_PROOF_POINT_1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/agent/__tests__/budgets.test.ts`
Expected: FAIL — `Cannot find module '../budgets.ts'`.

- [ ] **Step 3: Write the implementation**

Create `electron/agent/budgets.ts`:

```ts
/* How long a generated value may be.

   The letter's slots had no length rule at all: cvPrompt tells the model to
   match the text beside the slot in the Fassung, but the letter's Fassung
   shows it a bare {{…}} at those positions, so there is nothing to match. The
   result was an opening paragraph of sixty words — three slots the template
   runs together — that a recruiter scanning for fifteen seconds does not read.

   The numbers live here rather than in the prompt because two things need
   them: the glossary that states them to the model, and the check that
   measures what came back. Written twice they would drift, and the drift
   would show as a document that is refused for a rule it was never told. */

/* Maximum words per placeholder, from what the T-format has room for. A slot
   that is absent has no budget — the address block and the salary sentence are
   as long as the facts make them. */
export const VALUE_BUDGET: Record<string, number> = {
  /* One sentence, standing as its own paragraph. */
  COMPANY_HOOK_SENTENCE: 25,
  /* A relative-clause fragment after "Software, die …" — not a sentence. */
  COMPANY_PRODUCT_PURPOSE: 8,
  /* An object, same. */
  CANDIDATE_PRIMARY_EXPERIENCE: 8,
  /* Matrix cells: scanned down the column, not read. */
  JOB_REQUIREMENT_1: 8,
  JOB_REQUIREMENT_2: 8,
  JOB_REQUIREMENT_3: 8,
  JOB_REQUIREMENT_4: 8,
  /* Result plus method, on one line of the right-hand cell. */
  CANDIDATE_PROOF_POINT_1: 18,
  CANDIDATE_PROOF_POINT_2: 18,
  CANDIDATE_PROOF_POINT_3: 18,
  CANDIDATE_PROOF_POINT_4: 18,
  /* A turn of phrase, not a list. */
  RELEVANT_TECH_STACK_SUMMARY: 10,
  /* The line under the name, in both documents. */
  CANDIDATE_HEADER_ROLE: 12,
};

export interface OverBudget {
  slot: string;
  budget: number;
  /* What the answer actually came back at — the redo quotes it back, so the
     model is told the distance rather than just that it missed. */
  words: number;
}

/* Values may carry the emphasis the Fassung uses at that position. A tag is
   not a word, and "<strong>phase6</strong>" is one word rather than three. */
function countWords(value: string): number {
  const text = value.replace(/<[^>]+>/g, ' ').trim();
  return text ? text.split(/\s+/).length : 0;
}

/* Every value that came back longer than its slot allows, in the order
   VALUE_BUDGET names them — so a redo reads the offenders top-down through the
   document rather than in whatever order the model answered. */
export function overBudget(values: Record<string, string>): OverBudget[] {
  const over: OverBudget[] = [];
  for (const [slot, budget] of Object.entries(VALUE_BUDGET)) {
    const value = values[slot];
    if (value === undefined) continue;
    const words = countWords(value);
    if (words > budget) over.push({ slot, budget, words });
  }
  return over;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/agent/__tests__/budgets.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/budgets.ts electron/agent/__tests__/budgets.test.ts
git add electron/agent/budgets.ts electron/agent/__tests__/budgets.test.ts
git commit -m "feat(agent): give every generated value a word budget"
```

---

### Task 2: The glossary states the budgets it enforces

**Files:**

- Modify: `electron/agent/prompts.ts` — `placeholderGlossary`, and the `CV_GLOSSARY` line
- Test: `electron/agent/__tests__/prompts.test.ts`

**Interfaces:**

- Consumes: `VALUE_BUDGET` from Task 1.
- Produces: nothing new — `letterPrompt` and `cvPrompt` keep their signatures.

- [ ] **Step 1: Write the failing test**

Append to the `describe('letterPrompt', …)` block in `electron/agent/__tests__/prompts.test.ts`:

```ts
it('states each slot’s budget, from the same record the check reads', () => {
  /* The model was never told how long a value may be — that is why the
       opening ran to sixty words. Told here, and measured against the same
       number in budgets.ts, so the two cannot drift. */
  const prompt = letterPrompt(DOC_INPUT);

  expect(prompt).toContain(`höchstens ${VALUE_BUDGET.COMPANY_HOOK_SENTENCE} Wörter`);
  expect(prompt).toContain(`höchstens ${VALUE_BUDGET.CANDIDATE_PROOF_POINT_1} Wörter`);
  expect(prompt).toContain(`höchstens ${VALUE_BUDGET.RELEVANT_TECH_STACK_SUMMARY} Wörter`);
});
```

Add the import at the top of the file:

```ts
import { VALUE_BUDGET } from '../budgets.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/agent/__tests__/prompts.test.ts`
Expected: FAIL — the prompt contains no "höchstens 25 Wörter".

- [ ] **Step 3: Write the implementation**

In `electron/agent/prompts.ts`, import the record:

```ts
import { VALUE_BUDGET } from './budgets.ts';
```

Add a helper above `placeholderGlossary`:

```ts
/* The budget of a slot as the glossary states it, or nothing for a slot that
   has none. Read from VALUE_BUDGET rather than written into the prose, so the
   number the model is given and the number the check applies are one number. */
function budget(slot: string): string {
  const max = VALUE_BUDGET[slot];
  return max ? ` (höchstens ${max} Wörter)` : '';
}
```

Then append `${budget('SLOT_NAME')}` to each budgeted entry in `placeholderGlossary`, immediately after the placeholder name's colon. The four entries to change, with the exact target text:

- `- {{CANDIDATE_HEADER_ROLE}}: Unterzeile unter dem Namen des Bewerbers` → `- {{CANDIDATE_HEADER_ROLE}}${budget('CANDIDATE_HEADER_ROLE')}: Unterzeile unter dem Namen des Bewerbers`
- `- {{COMPANY_HOOK_SENTENCE}}: ein ganzer Satz über die Firma` → `- {{COMPANY_HOOK_SENTENCE}}${budget('COMPANY_HOOK_SENTENCE')}: ein ganzer Satz über die Firma`
- `- {{COMPANY_PRODUCT_PURPOSE}}: dieselbe Wirkung` → `- {{COMPANY_PRODUCT_PURPOSE}}${budget('COMPANY_PRODUCT_PURPOSE')}: dieselbe Wirkung`
- `- {{CANDIDATE_PRIMARY_EXPERIENCE}}: die zur Stelle am besten passende Erfahrung` → `- {{CANDIDATE_PRIMARY_EXPERIENCE}}${budget('CANDIDATE_PRIMARY_EXPERIENCE')}: die zur Stelle am besten passende Erfahrung`

The two ranged entries name the budget once for the range, since all four share it:

- `- {{JOB_REQUIREMENT_1}} … {{JOB_REQUIREMENT_4}}: die vier wichtigsten` → `- {{JOB_REQUIREMENT_1}} … {{JOB_REQUIREMENT_4}}${budget('JOB_REQUIREMENT_1')}: die vier wichtigsten`
- `- {{CANDIDATE_PROOF_POINT_1}} … {{CANDIDATE_PROOF_POINT_4}}: der jeweils passende Beleg` → `- {{CANDIDATE_PROOF_POINT_1}} … {{CANDIDATE_PROOF_POINT_4}}${budget('CANDIDATE_PROOF_POINT_1')}: der jeweils passende Beleg`
- `- {{RELEVANT_TECH_STACK_SUMMARY}}: der für die Stelle relevante Stack` → `- {{RELEVANT_TECH_STACK_SUMMARY}}${budget('RELEVANT_TECH_STACK_SUMMARY')}: der für die Stelle relevante Stack`

Do the same to the one entry in `CV_GLOSSARY`:

- `- {{CANDIDATE_HEADER_ROLE}}: Unterzeile unter dem Namen (z. B.` → `- {{CANDIDATE_HEADER_ROLE}}${budget('CANDIDATE_HEADER_ROLE')}: Unterzeile unter dem Namen (z. B.`

`CV_GLOSSARY` is currently a `const` string, not a function. Change it to a function so it can call `budget`, keeping its leading comment block exactly as it is:

```ts
const cvGlossary = () =>
  `- {{CANDIDATE_HEADER_ROLE}}${budget('CANDIDATE_HEADER_ROLE')}: Unterzeile unter dem Namen (z. B. "Senior Frontend Developer · React, Next.js, Expo"). Die Berufsbezeichnung bleibt die tatsächliche des Bewerbers — gewichtet wird nur, welche seiner Technologien genannt werden und in welcher Reihenfolge, passend zur ausgeschriebenen Rolle. Nur Technologien, die der Lebenslauf ohnehin führt.`;
```

and change its use in `cvPrompt` from `${CV_GLOSSARY}` to `${cvGlossary()}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/agent/__tests__/prompts.test.ts`
Expected: PASS. The existing prompt tests must still pass unchanged.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/prompts.ts electron/agent/__tests__/prompts.test.ts
git add electron/agent/prompts.ts electron/agent/__tests__/prompts.test.ts
git commit -m "feat(agent): state each slot's word budget in the glossary"
```

---

### Task 3: generateDocument measures what came back and asks once more

**Files:**

- Modify: `electron/agent/orchestrator.ts` — `DocumentJob`, `generateDocument`, its two call sites (lines ~290 and ~301)
- Test: `electron/agent/__tests__/orchestrator.test.ts`

**Interfaces:**

- Consumes: `overBudget`, `OverBudget` from Task 1.
- Produces: `generateDocument(deps, applicationId, job): Promise<{ html: string; overBudget: OverBudget[] }>`; `DocumentJob` gains `complaint?: string` (appended to the prompt) and `skipBudgetRedo?: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `describe('runPipeline', …)` in `electron/agent/__tests__/orchestrator.test.ts`:

```ts
it('asks again when a value came back over its budget', async () => {
  uploadTemplates(['lebenslauf']);
  uploadTemplates(
    ['anschreiben'],
    'Standard',
    '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
  );
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
  let asked = 0;
  const llm = fakeLlm({
    document: () => {
      asked++;
      /* Both templates' slots in one answer: the CV Fassung wants
           COMPANY_NAME, and a value for a slot a template does not have is
           ignored by fillPlaceholders. Answering only the hook would fail the
           CV step for an unanswered placeholder. */
      return {
        fields: [
          { key: 'COMPANY_NAME', value: 'Helios Energie' },
          { key: 'COMPANY_HOOK_SENTENCE', value: asked === 1 ? long : 'Kurz und knapp.' },
        ],
      };
    },
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  /* Two document calls for the letter, one for the CV. */
  expect(asked).toBe(3);
  const letter = repo
    .load()
    .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
  expect(readFileSync(path.join(root, letter.file_path!), 'utf8')).toContain('Kurz und knapp.');
});

it('names the offending slot and its budget in the second ask', async () => {
  uploadTemplates(['lebenslauf']);
  uploadTemplates(
    ['anschreiben'],
    'Standard',
    '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
  );
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
  const prompts: string[] = [];
  const llm = fakeLlm({
    document: (req) => {
      prompts.push(req.prompt);
      return {
        fields: [
          { key: 'COMPANY_NAME', value: 'Helios Energie' },
          { key: 'COMPANY_HOOK_SENTENCE', value: long },
        ],
      };
    },
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  const redo = prompts.at(-1)!;
  expect(redo).toContain('COMPANY_HOOK_SENTENCE');
  expect(redo).toContain(String(VALUE_BUDGET.COMPANY_HOOK_SENTENCE));
  expect(redo).toContain('40');
});

it('keeps a second answer that is still too long rather than failing the step', async () => {
  /* A letter three words too long is worth having; a failed step is not. */
  uploadTemplates(['lebenslauf']);
  uploadTemplates(
    ['anschreiben'],
    'Standard',
    '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
  );
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
  const llm = fakeLlm({
    document: () => ({
      fields: [
        { key: 'COMPANY_NAME', value: 'Helios Energie' },
        { key: 'COMPANY_HOOK_SENTENCE', value: long },
      ],
    }),
  });

  const runId = createRun(appId);
  await runPipeline(appId, runId, deps({ llm }));

  expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
  const letter = repo
    .load()
    .documents.find((d) => d.application_id === appId && d.kind === DocumentKind.COVER_LETTER)!;
  expect(letter.file_path).toBeTruthy();
});
```

Add the import at the top of the file:

```ts
import { VALUE_BUDGET } from '../budgets.ts';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: FAIL — `asked` is 2, not 3; the last prompt names no slot.

- [ ] **Step 3: Write the implementation**

In `electron/agent/orchestrator.ts`, import from Task 1:

```ts
import { overBudget, type OverBudget } from './budgets.ts';
```

Extend `DocumentJob`:

```ts
interface DocumentJob {
  kind: DocumentKind;
  buildPrompt: (input: DocumentInput) => string;
  input: DocumentInput;
  templateLabel: string;
  /* Appended to the prompt as the reason this document is being written
     again. The proofs step passes the claims it could not find support for. */
  complaint?: string;
  /* The proofs rewrite sets this: its complaint already says what to change,
     and letting the budget ask a third time would triple the cost of one
     unlucky letter for a rule the redo cannot see the answer to anyway. */
  skipBudgetRedo?: boolean;
}
```

Add the redo prompt beside the other prompt strings in the file:

```ts
/* What the second ask says. It quotes the distance rather than only the rule:
   told "höchstens 25" against an answer of 40, the model cuts; told only that
   it was too long, it shortens by a word. */
function budgetComplaint(over: OverBudget[]): string {
  const lines = over.map((o) => `- ${o.slot}: höchstens ${o.budget} Wörter, erhalten ${o.words}`);
  return [
    '',
    'Diese Werte sind zu lang. Schreibe die ganze Antwort noch einmal, alle Platzhalter, und halte für diese die Wortzahl ein:',
    ...lines,
    'Kürze, indem du weglässt — nicht, indem du Wörter zusammenziehst.',
  ].join('\n');
}
```

Rewrite `generateDocument`. Everything from `if (!deps.repo.getApplicationWithCompany(...))` onward is unchanged; only the asking and the return change:

```ts
async function generateDocument(
  deps: PipelineDeps,
  applicationId: string,
  { kind, buildPrompt, input, templateLabel, complaint, skipBudgetRedo }: DocumentJob,
): Promise<{ html: string; overBudget: OverBudget[] }> {
  const template = input.template;
  const basePrompt = buildPrompt(input) + (complaint ?? '');
  const ask = (prompt: string) =>
    deps.llm({
      prompt,
      schema: FILL_SCHEMA,
      /* An answer that skipped half the slots is a bad answer, not a failed
         step: complaining here rather than after the fill is what puts it in
         front of the runner, which asks once more with the reason attached. */
      validate: (x) => {
        const values = validateFill(x);
        const unanswered = modelPlaceholders(template).filter((name) => values[name] === undefined);
        if (unanswered.length) throw new Error(`Platzhalter ohne Wert: ${unanswered.join(', ')}`);
        return values;
      },
      timeoutMs: DOCUMENT_TIMEOUT,
      signal: deps.signal,
    });

  let values = await ask(basePrompt);
  let over = overBudget(values);
  /* One redo, and then whatever it says. This is deliberately not routed
     through validate(): a validator that throws gets one retry from
     createLlmRunner and fails the step after it, which is right for a
     malformed answer and wrong here — a letter a few words too long is worth
     having, and the user is told about it in the closing comment instead. */
  if (over.length && !skipBudgetRedo) {
    values = await ask(basePrompt + budgetComplaint(over));
    over = overBudget(values);
  }

  /* Everything after this point is the function as it stands today, verbatim
     and in the same order: the `Deleted` guard, `fillPlaceholders(template,
     { ...values, ...systemValues(input.language, deps.now?.() ?? new Date()) })`,
     the `missing.length` check that throws a KeplerError, `documentPaths`,
     `mkdirSync`, `writeFileSync`, the `renderPdf` try/catch, and the
     `setDocumentFile` block. Do not change any of it — only the two lines
     below replace the old `return html`. */

  return { html, overBudget: over };
}
```

Declare the accumulator beside `let cvHtml`. It is keyed by document rather
than a flat list, because the proofs step regenerates the Anschreiben later and
must **replace** that document's findings rather than add a second set for the
same slots:

```ts
/* Values still over budget after the redo, per document. They do not stop
       the run — they become a bullet in the closing comment. Keyed so a
       regenerated document overwrites its own earlier findings instead of
       reporting the same slot twice. */
const tooLong = new Map<DocumentKind, OverBudget[]>();
```

Update the CV call site (line ~290):

```ts
const generated = await generateDocument(deps, applicationId, {
  kind: DocumentKind.LEBENSLAUF,
  buildPrompt: cvPrompt,
  ...docInput(TemplateKind.LEBENSLAUF),
});
cvHtml = generated.html;
tooLong.set(DocumentKind.LEBENSLAUF, generated.overBudget);
```

Update the letter call site (line ~301):

```ts
const generated = await generateDocument(deps, applicationId, {
  kind: DocumentKind.COVER_LETTER,
  buildPrompt: letterPrompt,
  ...docInput(TemplateKind.ANSCHREIBEN),
});
letterHtml = generated.html;
tooLong.set(DocumentKind.COVER_LETTER, generated.overBudget);
```

Both `generated` bindings are block-scoped inside their own `if (pending(…))`, so
the shared name is not a conflict.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git add electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git commit -m "feat(agent): ask again when a generated value overruns its budget"
```

---

### Task 4: The opening paragraph splits in two

**Files:**

- Modify: `~/Library/Application Support/application-automation/templates/anschreiben/de/Standard/Timo_Huennebeck_Anschreiben.html:391-393`
- Modify: `~/Library/Application Support/application-automation/templates/anschreiben/en/Standard/Timo_Huennebeck_Cover_Letter.html:391-393`

These are the user's own files in `userData`, not repo files — there is nothing to commit and no unit test to write. The verification is a script that reads them back.

**Interfaces:**

- Consumes: nothing.
- Produces: nothing in code. Later tasks do not depend on this.

- [ ] **Step 1: Back the two files up**

```bash
cd ~/Library/Application\ Support/application-automation/templates/anschreiben
cp de/Standard/Timo_Huennebeck_Anschreiben.html /tmp/anschreiben-de.bak
cp en/Standard/Timo_Huennebeck_Cover_Letter.html /tmp/anschreiben-en.bak
```

- [ ] **Step 2: Split the German paragraph**

Replace lines 391-393 of `de/Standard/Timo_Huennebeck_Anschreiben.html`, which currently read:

```html
<p>
  {{COMPANY_HOOK_SENTENCE}} Software, die {{COMPANY_PRODUCT_PURPOSE}}, ist genau die Art Aufgabe, für die ich
  mich bewerbe – und in der ich {{CANDIDATE_PRIMARY_EXPERIENCE}} bereits in Produktion gebracht habe.
</p>
```

with:

```html
<p>{{COMPANY_HOOK_SENTENCE}}</p>

<p>
  Software, die {{COMPANY_PRODUCT_PURPOSE}}, ist genau die Art Aufgabe, für die ich mich bewerbe – und in der
  ich {{CANDIDATE_PRIMARY_EXPERIENCE}} bereits in Produktion gebracht habe.
</p>
```

- [ ] **Step 3: Split the English paragraph**

Replace the same lines of `en/Standard/Timo_Huennebeck_Cover_Letter.html`, currently:

```html
<p>
  {{COMPANY_HOOK_SENTENCE}} Software that {{COMPANY_PRODUCT_PURPOSE}} is exactly the kind of work I am
  applying for – and where I have already taken {{CANDIDATE_PRIMARY_EXPERIENCE}} into production.
</p>
```

with:

```html
<p>{{COMPANY_HOOK_SENTENCE}}</p>

<p>
  Software that {{COMPANY_PRODUCT_PURPOSE}} is exactly the kind of work I am applying for – and where I have
  already taken {{CANDIDATE_PRIMARY_EXPERIENCE}} into production.
</p>
```

- [ ] **Step 4: Verify both files still fill without a remainder**

```bash
cd /Users/timohuennebeck/Desktop/application-automation
mkdir -p .tmp-check && cat > .tmp-check/templates.test.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fillPlaceholders, modelPlaceholders, systemValues } from '../electron/agent/fill.ts';
import { DocumentLanguage } from '../src/shared/enums.ts';

const BASE = process.env.HOME + '/Library/Application Support/application-automation/templates/anschreiben';

describe('the Anschreiben Fassungen', () => {
  it.each([
    [DocumentLanguage.DE, `${BASE}/de/Standard/Timo_Huennebeck_Anschreiben.html`],
    [DocumentLanguage.EN, `${BASE}/en/Standard/Timo_Huennebeck_Cover_Letter.html`],
  ])('fills with the hook on its own paragraph (%s)', (language, file) => {
    const html = readFileSync(file, 'utf8');
    const values = Object.fromEntries(modelPlaceholders(html).map((n) => [n, 'X']));
    const filled = fillPlaceholders(html, { ...values, ...systemValues(language, new Date(2026, 7, 23)) });

    expect(filled.missing).toEqual([]);
    /* The hook stands alone: its paragraph holds nothing else. */
    expect(filled.html).toContain('<p>X</p>');
  });
});
EOF
npx vitest run .tmp-check/templates.test.ts
rm -rf .tmp-check
```

Expected: PASS, 2 tests. If it fails, restore from `/tmp/anschreiben-*.bak` and re-do the edit.

- [ ] **Step 5: Remove the backups**

```bash
rm -f /tmp/anschreiben-de.bak /tmp/anschreiben-en.bak
```

Nothing to commit — these files are outside the repository.

---

### Task 5: The PROOFS step key, labels and plan

**Files:**

- Modify: `src/shared/enums.ts:115-125`
- Modify: `electron/agent/labels.ts` — `FORMS`, `stepPlan`, and a new exported rewriting label
- Test: `electron/agent/__tests__/labels.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `AgentStepKey.PROOFS`; `PROOFS_REWRITE_LABEL: string`.

- [ ] **Step 1: Write the failing test**

Append to `electron/agent/__tests__/labels.test.ts`:

```ts
describe('the proofs step', () => {
  const ctx = { company: 'Helios Energie', source: 'LinkedIn' };

  it('reads in all three forms', () => {
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.WAIT, ctx)).toBe('Belege prüfen');
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.RUN, ctx)).toBe('Belege werden geprüft…');
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.DONE, ctx)).toBe('Belege geprüft');
  });

  it('sits between the letter and the format check', () => {
    /* It reads the finished documents, so it cannot run before them; and what
       it finds has to reach the closing comment, so it cannot run after it. */
    const keys = stepPlan(true, ctx).map((s) => s.key);

    expect(keys.indexOf(AgentStepKey.PROOFS)).toBe(keys.indexOf(AgentStepKey.GEN_LETTER) + 1);
    expect(keys.indexOf(AgentStepKey.VALIDATE)).toBe(keys.indexOf(AgentStepKey.PROOFS) + 1);
  });

  it('says so while it is rewriting, rather than hiding it under “prüfen”', () => {
    expect(PROOFS_REWRITE_LABEL).toContain('neu geschrieben');
  });
});
```

Extend the file's existing import from `'../labels.ts'` to include `PROOFS_REWRITE_LABEL`, and make sure `stepPlan`, `stepLabel`, `AgentStepKey` and `AgentStepStatus` are imported (most already are — check the top of the file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/agent/__tests__/labels.test.ts`
Expected: FAIL — `AgentStepKey.PROOFS` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/shared/enums.ts`, add the key between `GEN_LETTER` and `VALIDATE` so the constant reads in run order:

```ts
export const AgentStepKey = {
  FETCH: 'FETCH',
  EXTRACT: 'EXTRACT',
  CONTACTS: 'CONTACTS',
  READ_CV: 'READ_CV',
  READ_LETTER: 'READ_LETTER',
  GEN_CV: 'GEN_CV',
  GEN_LETTER: 'GEN_LETTER',
  PROOFS: 'PROOFS',
  VALIDATE: 'VALIDATE',
  COMMENT: 'COMMENT',
} as const;
```

In `electron/agent/labels.ts`, add the entry to `FORMS` after `GEN_LETTER`:

```ts
  [AgentStepKey.PROOFS]: () => ({
    wait: 'Belege prüfen',
    run: 'Belege werden geprüft…',
    done: 'Belege geprüft',
  }),
```

and export the fourth form, which is not a status and so cannot live in `FORMS`:

```ts
/* The running label while the step is not checking but rewriting. A step
   called "Belege prüfen" that quietly generates a second Anschreiben would be
   lying about what the run is doing — and this is the one label the panel
   shows for the two minutes that takes. */
export const PROOFS_REWRITE_LABEL = 'Anschreiben wird mit belegten Angaben neu geschrieben…';
```

In `stepPlan`, add `step(AgentStepKey.PROOFS)` between `GEN_LETTER` and `VALIDATE`.

`FORMS` is a `Record<AgentStepKey, …>`, so `tsc` fails until the entry exists — that is the intended guard.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/agent/__tests__/labels.test.ts && npx tsc -b`
Expected: PASS, and a clean typecheck.

- [ ] **Step 5: Lint, format and commit**

```bash
npm run lint
npx prettier --write src/shared/enums.ts electron/agent/labels.ts electron/agent/__tests__/labels.test.ts
git add src/shared/enums.ts electron/agent/labels.ts electron/agent/__tests__/labels.test.ts
git commit -m "feat(agent): add the proofs step to the run plan"
```

---

### Task 6: The proofs prompt and its schema

**Files:**

- Modify: `electron/agent/schemas.ts`
- Modify: `electron/agent/prompts.ts`
- Test: `electron/agent/__tests__/schemas.test.ts`, `electron/agent/__tests__/prompts.test.ts`

**Interfaces:**

- Consumes: `documentExcerpt` and the module-private `documentText` in `prompts.ts`.
- Produces:
  - `interface UnsupportedClaim { document: DocumentKind; quote: string; why: string }`
  - `PROOFS_SCHEMA` (a `const` object literal, like `CHECKS_SCHEMA`)
  - `validateProofs(x: unknown): UnsupportedClaim[]`
  - `interface ProofsInput { cv: string; letter: string; cvFassung: string | null; profileFacts: string[] }`
  - `proofsPrompt(input: ProofsInput): string`

- [ ] **Step 1: Write the failing tests**

Append to `electron/agent/__tests__/schemas.test.ts`:

```ts
describe('validateProofs', () => {
  it('reads the claims it was handed', () => {
    const claims = validateProofs({
      unsupported: [
        { document: 'COVER_LETTER', quote: 'zwei Produktbereiche von Grund auf gebaut', why: 'nicht im CV' },
      ],
    });

    expect(claims).toEqual([
      {
        document: DocumentKind.COVER_LETTER,
        quote: 'zwei Produktbereiche von Grund auf gebaut',
        why: 'nicht im CV',
      },
    ]);
  });

  it('drops an entry naming a document that does not exist', () => {
    /* The schema carries the closed set; the validator is the net for the
       rest, the way every other validator in this file is. */
    const claims = validateProofs({
      unsupported: [{ document: 'GLOSSAR', quote: 'x', why: 'y' }],
    });

    expect(claims).toEqual([]);
  });

  it('treats a missing list as nothing found', () => {
    expect(validateProofs({})).toEqual([]);
  });

  it('caps what it returns, however much comes back', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      document: 'COVER_LETTER',
      quote: 'q' + i,
      why: 'w',
    }));

    expect(validateProofs({ unsupported: many })).toHaveLength(MAX_UNSUPPORTED);
  });
});
```

Append to `electron/agent/__tests__/prompts.test.ts`:

```ts
describe('proofsPrompt', () => {
  const INPUT = {
    cv: '<p>Timo Hünnebeck · 3,5 Jahre React</p>',
    letter: '<p>Zwei Produktbereiche von Grund auf gebaut.</p>',
    cvFassung: '<p>Senior Frontend Developer bei Horizon Alpha seit 2023</p>',
    profileFacts: ['Kündigungsfrist 3 Monate'],
  };

  it('hands over both documents, the Fassung and the profile', () => {
    const prompt = proofsPrompt(INPUT);

    expect(prompt).toContain('Zwei Produktbereiche von Grund auf gebaut.');
    expect(prompt).toContain('Horizon Alpha');
    expect(prompt).toContain('Kündigungsfrist 3 Monate');
  });

  it('asks about facts, not about style', () => {
    /* The letter prompt owns the voice. A second opinion on tone here would
       rewrite a well-grounded letter for no reason. */
    const prompt = proofsPrompt(INPUT);

    expect(prompt).toContain('Zahl');
    expect(prompt).not.toContain('Floskel');
  });

  it('says what to do when nothing backs a claim and when the CV is missing', () => {
    const prompt = proofsPrompt({ ...INPUT, cvFassung: null, profileFacts: [] });

    expect(prompt).toContain('(kein Lebenslauf hinterlegt)');
    expect(prompt).toContain('(keine Angaben)');
  });
});
```

Extend the imports at the top of `electron/agent/__tests__/schemas.test.ts` to
include `MAX_UNSUPPORTED` and `validateProofs` from `'../schemas.ts'`, and
`DocumentKind` from `'../../../src/shared/enums.ts'`. Extend the import in
`electron/agent/__tests__/prompts.test.ts` to include `proofsPrompt` from
`'../prompts.ts'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/agent/__tests__/schemas.test.ts electron/agent/__tests__/prompts.test.ts`
Expected: FAIL — `validateProofs` and `proofsPrompt` are not exported.

- [ ] **Step 3: Write the schema and validator**

In `electron/agent/schemas.ts`, beside the result types:

```ts
/* One claim in a generated document that nothing in the Lebenslauf or the
   profile backs up. */
export interface UnsupportedClaim {
  document: DocumentKind;
  /* The passage as the document words it — quoted back to the model when the
     letter is rewritten, and shown to the user in the closing comment. */
  quote: string;
  why: string;
}

/* Five is already more than the comment can show; past that the answer is
   the model listing everything it is unsure about rather than what is wrong. */
export const MAX_UNSUPPORTED = 5;
```

Import `DocumentKind` at the top of the file — the module already imports `DocumentLanguage` from the same path, so extend that import.

Beside `CHECKS_SCHEMA`:

```ts
export const PROOFS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unsupported: {
      type: 'array',
      maxItems: MAX_UNSUPPORTED,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'string', enum: [DocumentKind.LEBENSLAUF, DocumentKind.COVER_LETTER] },
          quote: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['document', 'quote', 'why'],
      },
    },
  },
  required: ['unsupported'],
} as const;
```

Beside `validateChecks`:

```ts
/* Never throws: an empty answer means the documents hold up, which is the
   common case and must not fail the step. Entries that name a document the
   app does not have are dropped rather than stored. */
export function validateProofs(x: unknown): UnsupportedClaim[] {
  const r = asRecord(x, 'Belege');
  if (!Array.isArray(r.unsupported)) return [];
  const claims: UnsupportedClaim[] = [];
  for (const entry of r.unsupported) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { document, quote, why } = entry as Record<string, unknown>;
    const kind = text(document);
    const passage = text(quote);
    if (!passage) continue;
    if (kind !== DocumentKind.LEBENSLAUF && kind !== DocumentKind.COVER_LETTER) continue;
    claims.push({ document: kind, quote: passage, why: text(why) ?? '' });
  }
  return claims.slice(0, MAX_UNSUPPORTED);
}
```

- [ ] **Step 4: Write the prompt**

In `electron/agent/prompts.ts`, after `checksPrompt`:

```ts
/* What the proofs step reads. The documents arrive as the HTML that was just
   written — documentExcerpt turns each into what it says — while the Fassung
   and the profile are the two places a fact may legitimately come from. */
export interface ProofsInput {
  cv: string;
  letter: string;
  /* The selected Lebenslauf Fassung, or null when none is uploaded — then the
     letter had nothing but the profile to work from and the check says so. */
  cvFassung: string | null;
  profileFacts: string[];
}

export function proofsPrompt(input: ProofsInput): string {
  return `Du bist Kepler, der Assistent einer Bewerbungs-App. Prüfe, ob die Aussagen in den zwei erzeugten Dokumenten durch die Quellen gedeckt sind.

Quellen sind ausschließlich <lebenslauf> und <profil>. Alles andere zählt nicht — auch nicht, was plausibel klingt.

Prüfe jede sachliche Aussage: Zahl, Zeitraum, Arbeitgeber, Rolle, Technologie, Umfang. Für jede gilt: Steht sie so in einer Quelle, ist sie gedeckt. Steht dort weniger ("mitgebaut" statt "von Grund auf gebaut"), eine andere Zahl oder gar nichts, ist sie nicht gedeckt.

Nicht deine Aufgabe sind Stil, Ton, Länge und Formulierung. Dazu sagst du nichts.

unsupported: die ungedeckten Aussagen, höchstens fünf. document ist "LEBENSLAUF" oder "COVER_LETTER", quote die Aussage im Wortlaut des Dokuments, why in unter 12 Wörtern, was die Quelle stattdessen hergibt. Leer, wenn alles gedeckt ist.

<anschreiben>
${documentExcerpt(input.letter)}
</anschreiben>

<lebenslauf-dokument>
${documentExcerpt(input.cv)}
</lebenslauf-dokument>

<lebenslauf>
${cvBlock(input.cvFassung)}
</lebenslauf>

<profil>
${bullets(input.profileFacts, '(keine Angaben)')}
</profil>`;
}
```

Add `lebenslauf-dokument` to the alternation in `sealed()` so an embedded closing tag cannot break the block:

```ts
    /<\/(anzeige|vorlage|platzhalter|profil|kontakte|lebenslauf|lebenslauf-dokument|anschreiben|brief|stelle|hinweis|karte|personen|kommentare|interviews|aufgaben|frage)>/gi,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run electron/agent/__tests__/schemas.test.ts electron/agent/__tests__/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/schemas.ts electron/agent/prompts.ts electron/agent/__tests__/schemas.test.ts electron/agent/__tests__/prompts.test.ts
git add electron/agent/schemas.ts electron/agent/prompts.ts electron/agent/__tests__/schemas.test.ts electron/agent/__tests__/prompts.test.ts
git commit -m "feat(agent): add the proofs prompt and its schema"
```

---

### Task 7: The proofs step in the pipeline

**Files:**

- Modify: `electron/agent/orchestrator.ts`
- Test: `electron/agent/__tests__/orchestrator.test.ts`

**Interfaces:**

- Consumes: `AgentStepKey.PROOFS` and `PROOFS_REWRITE_LABEL` (Task 5); `PROOFS_SCHEMA`, `validateProofs`, `UnsupportedClaim` (Task 6); `generateDocument`'s `complaint`/`skipBudgetRedo` (Task 3).
- Produces: `claims: UnsupportedClaim[]` in the pipeline scope, consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `describe('runPipeline', …)` in `electron/agent/__tests__/orchestrator.test.ts`:

```ts
it('rewrites the Anschreiben once when a claim in it is unsupported', async () => {
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  let checks = 0;
  let letters = 0;
  const llm = fakeLlm({
    document: (req) => {
      if (req.prompt.includes('anschreiben-Vorlage')) letters++;
      return FILLED;
    },
    proofs: () => {
      checks++;
      return checks === 1
        ? { unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }] }
        : { unsupported: [] };
    },
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  expect(letters).toBe(2);
  expect(checks).toBe(2);
});

it('quotes the unsupported claim back when it rewrites', async () => {
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const prompts: string[] = [];
  let checks = 0;
  const llm = fakeLlm({
    document: (req) => {
      prompts.push(req.prompt);
      return FILLED;
    },
    proofs: () => {
      checks++;
      return checks === 1
        ? { unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }] }
        : { unsupported: [] };
    },
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  expect(prompts.at(-1)).toContain('zwei Bereiche');
  expect(prompts.at(-1)).toContain('nicht im CV');
});

it('reports a finding in the Lebenslauf without regenerating anything', async () => {
  /* The CV is copied from the Fassung; only its header line is generated.
       Rewriting it would not fix a claim the Fassung itself makes. */
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  let documents = 0;
  const llm = fakeLlm({
    document: () => {
      documents++;
      return FILLED;
    },
    proofs: () => ({
      unsupported: [{ document: 'LEBENSLAUF', quote: '1 Mio. Nutzer', why: 'Fassung sagt 12.000' }],
    }),
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  expect(documents).toBe(2);
  const comment = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!;
  expect(comment.text).toContain('1 Mio. Nutzer');
});

it('gives up after one rewrite and reports what is left', async () => {
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const llm = fakeLlm({
    proofs: () => ({
      unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }],
    }),
  });

  const runId = createRun(appId);
  await runPipeline(appId, runId, deps({ llm }));

  expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
  const comment = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!;
  expect(comment.text).toContain('zwei Bereiche');
});

it('generates the letter at most three times, whatever both checks say', async () => {
  /* The ceiling the design promises: one letter, one budget redo, one
       proofs rewrite — and the rewrite suppresses a second budget redo, so
       the two do not stack into four. */
  uploadTemplates(['lebenslauf']);
  uploadTemplates(
    ['anschreiben'],
    'Standard',
    '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
  );
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
  let letters = 0;
  const llm = fakeLlm({
    document: (req) => {
      if (req.prompt.includes('COMPANY_HOOK_SENTENCE')) letters++;
      return {
        fields: [
          { key: 'COMPANY_NAME', value: 'Helios Energie' },
          { key: 'COMPANY_HOOK_SENTENCE', value: long },
        ],
      };
    },
    proofs: () => ({
      unsupported: [{ document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' }],
    }),
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  expect(letters).toBe(3);
});

it('completes a run whose plan predates the step', async () => {
  /* A run created by an older build has no PROOFS row. pending() returns
       false for a key the run does not carry, so the step is skipped. */
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const app = repo.getApplicationWithCompany(appId)!;
  const plan = stepPlan(false, { company: app.company.name, source: '' }).filter(
    (s) => s.key !== AgentStepKey.PROOFS,
  );
  const runId = runs.createRun(appId, 'wartet', plan).run.id;

  await runPipeline(appId, runId, deps());

  expect(runs.getRun(runId).status).toBe(AgentRunStatus.DONE);
});
```

Extend `fakeLlm` in the same file so it can answer the new schema. Add to the `pick()` chain, before the `throw`:

```ts
if (req.schema === PROOFS_SCHEMA) return overrides.proofs?.(req) ?? { unsupported: [] };
```

and add `PROOFS_SCHEMA` to the schema import at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: FAIL — `letters` is 1, the comment holds no claim.

- [ ] **Step 3: Write the implementation**

In `electron/agent/orchestrator.ts`, extend the imports:

```ts
import { PROOFS_REWRITE_LABEL, STOP_ERROR, stepLabel, type LabelCtx } from './labels.ts';
import {
  checksPrompt,
  contactPrompt,
  cvPrompt,
  extractionPrompt,
  letterPrompt,
  proofsPrompt,
  type DocumentInput,
} from './prompts.ts';
import {
  CHECKS_SCHEMA,
  CONTACT_SCHEMA,
  EXTRACTION_SCHEMA,
  FILL_SCHEMA,
  PROOFS_SCHEMA,
  validateChecks,
  validateContact,
  validateExtraction,
  validateFill,
  validateProofs,
  type ExtractedPerson,
  type Extraction,
  type UnsupportedClaim,
} from './schemas.ts';
```

That second block is the file's existing `./schemas.ts` import with
`PROOFS_SCHEMA`, `validateProofs` and `UnsupportedClaim` added — replace it
whole rather than editing around it.

Add the step after the `GEN_LETTER` block and before `VALIDATE`:

```ts
/* ── Are the claims backed by the Lebenslauf? ─────────────────────── */
let claims: UnsupportedClaim[] = [];
if (pending(AgentStepKey.PROOFS)) {
  start(AgentStepKey.PROOFS);
  const cvFassung = readSelectedTemplate(deps.userDataPath, TemplateKind.LEBENSLAUF, language)?.html ?? null;
  const profileFacts = repo.load().profileFacts.map((f) => f.text);
  /* On a resumed run the documents are not in memory — they are read back
         off disk, the same way the validation step reads them. */
  const readCv = () => cvHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.LEBENSLAUF);
  const readLetter = () => letterHtml ?? readGeneratedHtml(deps, applicationId, DocumentKind.COVER_LETTER);

  const check = () =>
    deps.llm({
      prompt: proofsPrompt({
        cv: readCv(),
        letter: readLetter(),
        cvFassung,
        profileFacts,
      }),
      schema: PROOFS_SCHEMA,
      validate: validateProofs,
      timeoutMs: SINGLE_CALL_TIMEOUT,
      signal,
    });

  claims = await check();
  /* Only the Anschreiben is rewritten. The Lebenslauf is copied from the
         Fassung and only its header line is generated, so a claim it makes is
         the Fassung's to fix, not Kepler's — it is reported instead. */
  const inLetter = claims.filter((c) => c.document === DocumentKind.COVER_LETTER);
  if (inLetter.length) {
    alive();
    runs.setRunLabel(runId, PROOFS_REWRITE_LABEL);
    const step = byKey.get(AgentStepKey.PROOFS);
    if (step) byKey.set(AgentStepKey.PROOFS, runs.relabelStep(step.id, PROOFS_REWRITE_LABEL));
    push(byKey.get(AgentStepKey.PROOFS));

    const generated = await generateDocument(deps, applicationId, {
      kind: DocumentKind.COVER_LETTER,
      buildPrompt: letterPrompt,
      ...docInput(TemplateKind.ANSCHREIBEN),
      complaint: proofsComplaint(inLetter),
      /* Its complaint already says what to change; a budget redo on top
             would make one unlucky letter three generations. */
      skipBudgetRedo: true,
    });
    letterHtml = generated.html;
    /* set, not push: this document was just written again, so its earlier
           findings describe a file that no longer exists. */
    tooLong.set(DocumentKind.COVER_LETTER, generated.overBudget);
    /* One rewrite, then whatever the second reading says. */
    claims = await check();
  }
  done(AgentStepKey.PROOFS, true);
}
```

Add the complaint builder beside `budgetComplaint`:

```ts
/* What the rewrite is told. The claims are quoted in the document's own words
   so the model can find them, and the reason is quoted with them — "nicht im
   CV" and "Fassung sagt 12.000" call for different repairs. */
function proofsComplaint(claims: UnsupportedClaim[]): string {
  return [
    '',
    'Diese Aussagen im bisherigen Anschreiben sind durch <lebenslauf> und <profil> nicht gedeckt. Schreibe die ganze Antwort noch einmal, alle Platzhalter, und stütze dich nur auf Belegtes:',
    ...claims.map((c) => `- „${c.quote}" — ${c.why}`),
  ].join('\n');
}
```

`readGeneratedHtml` and `docInput` already exist in this file; `cvHtml`, `letterHtml` and `tooLong` are the `let`s declared around the generation steps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: PASS. The claim-reporting assertions in tests 3 and 4 will still fail until Task 8 — if so, complete Task 8 and re-run both.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git add electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git commit -m "feat(agent): check generated claims against the Lebenslauf"
```

---

### Task 8: The closing comment carries all three sources

**Files:**

- Modify: `electron/agent/orchestrator.ts` — `finalComment` (line ~587) and its call site
- Test: `electron/agent/__tests__/orchestrator.test.ts`

**Interfaces:**

- Consumes: `claims` (Task 7), `tooLong` (Task 3), `issues` (existing).
- Produces: `finalComment(postingUrl: string | null, findings: Findings): string` where `interface Findings { claims: UnsupportedClaim[]; tooLong: OverBudget[]; issues: string[] }`.

- [ ] **Step 1: Write the failing test**

Add to `describe('runPipeline', …)` in `electron/agent/__tests__/orchestrator.test.ts`:

```ts
it('puts unsupported claims before length before format, and stops at three', async () => {
  uploadTemplates(['lebenslauf']);
  uploadTemplates(
    ['anschreiben'],
    'Standard',
    '<!doctype html><html><body><p>{{COMPANY_HOOK_SENTENCE}}</p></body></html>',
  );
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });
  const long = Array.from({ length: 40 }, (_, i) => 'wort' + i).join(' ');
  const llm = fakeLlm({
    document: () => ({
      fields: [
        { key: 'COMPANY_NAME', value: 'Helios Energie' },
        { key: 'COMPANY_HOOK_SENTENCE', value: long },
      ],
    }),
    proofs: () => ({
      unsupported: [
        { document: 'COVER_LETTER', quote: 'zwei Bereiche', why: 'nicht im CV' },
        { document: 'LEBENSLAUF', quote: '1 Mio. Nutzer', why: 'Fassung sagt 12.000' },
      ],
    }),
    checks: () => ({ issues: ['**Gehaltsangabe** widerspricht der Anzeige.'] }),
  });

  await runPipeline(appId, createRun(appId), deps({ llm }));

  const text = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!.text;
  const bullets = text.split('\n').filter((l) => l.startsWith('•'));
  expect(bullets).toHaveLength(3);
  expect(bullets[0]).toContain('zwei Bereiche');
  expect(bullets[1]).toContain('1 Mio. Nutzer');
  expect(bullets[2]).toContain('COMPANY_HOOK_SENTENCE');
  /* The format issue was crowded out — three bullets is the cap, and an
       unbacked claim outranks a salary format. */
  expect(text).not.toContain('Gehaltsangabe');
});

it('says nothing extra when both documents hold up', async () => {
  uploadTemplates();
  const appId = createApp({ postingText: 'Wir suchen einen Senior Designer …' });

  await runPipeline(appId, createRun(appId), deps());

  const text = repo
    .load()
    .comments.filter((c) => c.application_id === appId)
    .at(-1)!.text;
  expect(text.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/agent/__tests__/orchestrator.test.ts`
Expected: FAIL — the comment holds only the format issue.

- [ ] **Step 3: Write the implementation**

Replace `finalComment` in `electron/agent/orchestrator.ts`:

```ts
/* Everything the run has to say about what it produced, in the order it
   matters. A claim the Lebenslauf does not back is the one thing that can
   cost an interview; a value a few words too long is a blemish; the format
   check is the long tail. */
interface Findings {
  claims: UnsupportedClaim[];
  /* Keyed by document, the way the pipeline collects it: the same slot can be
     over budget in both documents, and a bullet naming only the slot would not
     say which file to open. */
  tooLong: Map<DocumentKind, OverBudget[]>;
  issues: string[];
}

/* Three bullets. The comment is a note under the card, not a report — a
   fourth line is one nobody reads, and the ranking above already put the
   thing worth acting on first. */
const MAX_BULLETS = 3;

const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  [DocumentKind.COVER_LETTER]: 'Anschreiben',
  [DocumentKind.LEBENSLAUF]: 'Lebenslauf',
  [DocumentKind.OTHER]: 'Dokument',
};

function finalComment(postingUrl: string | null, findings: Findings): string {
  const lengths = [...findings.tooLong.entries()].flatMap(([kind, over]) =>
    over.map(
      (o) => `**${DOCUMENT_LABEL[kind]}**: ${o.slot} ist mit ${o.words} Wörtern zu lang (${o.budget}).`,
    ),
  );
  const bullets = [
    ...findings.claims.map(
      (c) => `**${DOCUMENT_LABEL[c.document]}**: „${c.quote}" ist nicht belegt — ${c.why}`,
    ),
    ...lengths,
    ...findings.issues,
  ];
  const lines = ['**Fertig** — Firmendetails, Kontakte und Unterlagen sind ergänzt.'];
  if (bullets.length) lines.push('', ...bullets.slice(0, MAX_BULLETS).map((b) => '• ' + b));
  lines.push('', postingUrl ? `@Timo Hier bewerben: ${postingUrl}` : '@Timo Die Unterlagen sind bereit.');
  return lines.join('\n');
}
```

Update the call site inside the `COMMENT` step:

```ts
repo.addComment(applicationId, Author.KEPLER, finalComment(app.posting_url, { claims, tooLong, issues }));
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — every test in the repository, including the ones from Tasks 1-7.

- [ ] **Step 5: Typecheck, lint, format and commit**

```bash
npx tsc -b && npm run lint
npx prettier --write electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git add electron/agent/orchestrator.ts electron/agent/__tests__/orchestrator.test.ts
git commit -m "feat(agent): report unbacked claims and overlong values in the run comment"
```

---

## Final verification

- [ ] `npx tsc -b` clean
- [ ] `npm run lint` clean
- [ ] `npm test` clean
- [ ] `npx prettier --check` clean on every touched file
- [ ] Both Anschreiben Fassungen fill without a remainder and the hook stands alone (Task 4, Step 4)

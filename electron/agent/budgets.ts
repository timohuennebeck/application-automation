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

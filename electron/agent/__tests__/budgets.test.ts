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

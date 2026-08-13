import { describe, expect, it } from 'vitest';
import { isInFocusedField } from '../dom.ts';

/* Stand-ins for the two DOM nodes the check compares — it only ever reads a
   tag name and asks about containment, so the real thing is not needed. */
function node(tagName: string, children: unknown[] = []) {
  const el = {
    tagName,
    contains: (other: unknown) => other === el || children.includes(other),
  };
  return el as unknown as Element;
}

describe('isInFocusedField', () => {
  it('recognises a click on the focused input itself', () => {
    const input = node('INPUT');
    expect(isInFocusedField(input, input)).toBe(true);
  });

  it('recognises a click on something inside the focused field', () => {
    const inner = node('SPAN');
    expect(isInFocusedField(node('TEXTAREA', [inner]), inner)).toBe(true);
  });

  it('rejects a click that landed elsewhere', () => {
    expect(isInFocusedField(node('INPUT'), node('DIV'))).toBe(false);
  });

  it('rejects anything that is not a text field, focused or not', () => {
    const div = node('DIV');
    expect(isInFocusedField(div, div)).toBe(false);
  });

  it('copes with nothing focused and with no target', () => {
    expect(isInFocusedField(null, node('INPUT'))).toBe(false);
    expect(isInFocusedField(node('INPUT'), null)).toBe(false);
  });
});

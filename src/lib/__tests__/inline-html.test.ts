import { describe, expect, it } from 'vitest';
import { sanitizeInline } from '../inline-html.ts';

describe('sanitizeInline', () => {
  it('keeps the emphasis a letter actually uses', () => {
    expect(sanitizeInline('Auslieferung von <strong>neun auf zwei</strong> Tage')).toBe(
      'Auslieferung von <strong>neun auf zwei</strong> Tage',
    );
    expect(sanitizeInline('<em>a</em><b>b</b><i>c</i>')).toBe('<em>a</em><b>b</b><i>c</i>');
    expect(sanitizeInline('erste Zeile<br/>zweite')).toBe('erste Zeile<br>zweite');
  });

  it('normalises the case of the tags it keeps', () => {
    expect(sanitizeInline('<STRONG>Expo</STRONG>')).toBe('<strong>Expo</strong>');
  });

  it('escapes every other tag rather than dropping it', () => {
    expect(sanitizeInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeInline('<div>x</div>')).toBe('&lt;div&gt;x&lt;/div&gt;');
  });

  /* What actually has to hold: whatever comes back, the only markup in it is a
     bare emphasis tag. Asserting the exact escaped string instead would pin
     down incidentals — an unmatched </strong> the parser drops on its own — and
     go red on a harmless change while missing the property that matters. */
  const MARKUP = /<[^>]*>/g;
  const ALLOWED = /^<\/?(?:strong|em|b|i|br)>$/;
  const onlyBareEmphasis = (html: string) => (html.match(MARKUP) ?? []).every((t) => ALLOWED.test(t));

  it('never lets an attribute through, on any tag', () => {
    for (const evil of [
      '<strong onmouseover="steal()">x</strong>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">klick</a>',
      '<b style="position:fixed">x</b>',
      '<svg/onload=alert(1)>',
      '<iframe src="http://elsewhere"></iframe>',
    ]) {
      expect(onlyBareEmphasis(sanitizeInline(evil))).toBe(true);
    }
  });

  it('leaves a disallowed tag escaped, so it reads as text', () => {
    /* Escaped is the safe resting place: innerHTML renders "&lt;script&gt;" as
       the characters <script>, it does not build an element. */
    expect(sanitizeInline('<script>alert(1)</script>')).not.toMatch(/<script/i);
    expect(onlyBareEmphasis(sanitizeInline('&lt;script&gt;'))).toBe(true);
  });

  it('escapes a bare ampersand but leaves an entity alone', () => {
    expect(sanitizeInline('Forschung & Entwicklung')).toBe('Forschung &amp; Entwicklung');
    expect(sanitizeInline('Forschung &amp; Entwicklung')).toBe('Forschung &amp; Entwicklung');
    expect(sanitizeInline('100&nbsp;% TypeScript')).toBe('100&nbsp;% TypeScript');
    expect(sanitizeInline('&#8211;')).toBe('&#8211;');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'Personio räumt dem Mittelstand die Personalarbeit aus dem Weg.';
    expect(sanitizeInline(text)).toBe(text);
  });
});

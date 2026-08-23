import { describe, expect, it } from 'vitest';
import {
  SYSTEM_PLACEHOLDERS,
  fillPlaceholders,
  findPlaceholders,
  modelPlaceholders,
  systemValues,
} from '../fill.ts';
import { DocumentLanguage } from '../../../src/shared/enums.ts';

describe('findPlaceholders', () => {
  it('lists every placeholder once, in the order the template uses them', () => {
    const html = '<p>{{SALUTATION}}</p><p>{{COMPANY_NAME}} und nochmal {{SALUTATION}}</p>';

    expect(findPlaceholders(html)).toEqual(['SALUTATION', 'COMPANY_NAME']);
  });

  it('ignores braces that are not a placeholder', () => {
    const html = '<style>.a{ color:red }</style><script>if(x){{y}}</script><p>{{ROLE}}</p>';

    expect(findPlaceholders(html)).toEqual(['ROLE']);
  });
});

describe('fillPlaceholders', () => {
  it('replaces every occurrence of a placeholder', () => {
    const { html } = fillPlaceholders('{{A}}-{{B}}-{{A}}', { A: 'eins', B: 'zwei' });

    expect(html).toBe('eins-zwei-eins');
  });

  it('leaves the rest of the document byte-identical', () => {
    /* The point of the whole exercise: a base64 image must survive untouched,
       which is exactly what the model failed to do. */
    const base64 = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(5_000);
    const template = `<img src="data:image/png;base64,${base64}"><p>{{ROLE}}</p>`;

    const { html } = fillPlaceholders(template, { ROLE: 'Senior Frontend Developer' });

    expect(html).toBe(template.replace('{{ROLE}}', 'Senior Frontend Developer'));
    expect(html).toContain(base64);
  });

  it('reports placeholders the model did not answer and leaves them in place', () => {
    const { html, missing } = fillPlaceholders('{{A}} {{B}}', { A: 'eins' });

    expect(missing).toEqual(['B']);
    expect(html).toBe('eins {{B}}');
  });

  it('drops an optional placeholder that was answered with an empty string', () => {
    /* The letter glossary has slots that vanish when there is nothing to say —
       an empty answer is a filled one, not a missing one. */
    const { html, missing } = fillPlaceholders('Titel{{JOB_REFERENCE_OPTIONAL}}', {
      JOB_REFERENCE_OPTIONAL: '',
    });

    expect(missing).toEqual([]);
    expect(html).toBe('Titel');
  });

  it('ignores values for placeholders the template does not have', () => {
    const { html, missing } = fillPlaceholders('{{A}}', { A: 'eins', GIBTS_NICHT: 'zwei' });

    expect(html).toBe('eins');
    expect(missing).toEqual([]);
  });

  it('does not re-scan inserted text for placeholders', () => {
    /* A value that happens to contain braces must land as text, not become a
       slot the next replacement fills. */
    const { html } = fillPlaceholders('{{A}} {{B}}', { A: '{{B}}', B: 'zwei' });

    expect(html).toBe('{{B}} zwei');
  });

  it('inserts the value literally, without treating $& as a backreference', () => {
    /* String.replace assigns meaning to $ in the replacement — a salary line
       like "80.000 EUR ($&-Basis)" would otherwise mangle itself. */
    const { html } = fillPlaceholders('{{A}}', { A: 'Gehalt $& $1 $$' });

    expect(html).toBe('Gehalt $& $1 $$');
  });

  /* A Fassung is hand-authored. A slot the strict pattern does not match is
     never offered to the model, so without this it would report success with
     the braces still printed in the PDF — the one outcome the whole step
     exists to prevent. */
  it.each([
    ['a lowercase name', '{{Anrede}}'],
    ['padding inside the braces', '{{ COMPANY_NAME }}'],
    ['a hyphen', '{{JOB-REF}}'],
  ])('reports a slot the model was never shown: %s', (_label, slot) => {
    const { html, missing } = fillPlaceholders(`<p>${slot} und {{ROLE}}</p>`, { ROLE: 'Entwickler' });

    expect(missing).toEqual([slot]);
    /* Still in the document — the caller fails the step over exactly this. */
    expect(html).toContain(slot);
  });

  it('does not mistake a stylesheet or a script for an unfilled slot', () => {
    /* `if(x){{y}}` is shaped exactly like a slot. Failing the step over it
       would break every template that carries a script — which is why the
       loose scan drops code blocks before it looks. */
    const template = '<style>.a{ color:red }</style><script>if(x){{y}}</script><p>{{ROLE}}</p>';

    const { html, missing } = fillPlaceholders(template, { ROLE: 'Entwickler' });

    expect(missing).toEqual([]);
    expect(html).toContain('if(x){{y}}');
  });
});

describe('modelPlaceholders', () => {
  it('leaves out the slots the pipeline fills itself', () => {
    const html = '<p>{{SALUTATION}}</p><p class="place-date">München, {{LETTER_DATE}}</p>';

    expect(modelPlaceholders(html)).toEqual(['SALUTATION']);
    /* The full list still sees it — unofferedSlots reads that one, and a slot
       missing from it would be reported as printed braces. */
    expect(findPlaceholders(html)).toEqual(['SALUTATION', 'LETTER_DATE']);
  });
});

describe('systemValues', () => {
  const day = new Date(2026, 7, 23);

  it('writes the German date the way the Fassung reads', () => {
    expect(systemValues(DocumentLanguage.DE, day)).toEqual({ LETTER_DATE: '23.08.2026' });
  });

  it('writes the English date in the long British form', () => {
    expect(systemValues(DocumentLanguage.EN, day)).toEqual({ LETTER_DATE: '23 August 2026' });
  });

  it('covers every system placeholder, so none can reach the document unfilled', () => {
    const values = systemValues(DocumentLanguage.DE, day);

    for (const name of SYSTEM_PLACEHOLDERS) expect(values[name]).toBeTruthy();
  });
});

describe('fillPlaceholders with a system slot', () => {
  it('does not report a system slot as missing once its value is merged in', () => {
    const { html, missing } = fillPlaceholders('München, {{LETTER_DATE}} — {{ROLE}}', {
      ...systemValues(DocumentLanguage.DE, new Date(2026, 7, 23)),
      ROLE: 'Entwickler',
    });

    expect(missing).toEqual([]);
    expect(html).toBe('München, 23.08.2026 — Entwickler');
  });
});

/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { withEditorStyles } from '../letter-styles';
import { MARK_ATTR, STYLE_ATTR, TAG_ATTR, serializeLetter } from '../mark';

const DOC = '<!DOCTYPE html><html><head><title>Brief</title></head><body><p>Text</p></body></html>';

describe('withEditorStyles', () => {
  it('puts the editor stylesheet inside the head the document already has', () => {
    const html = withEditorStyles(DOC);

    expect(html).toContain(`<style ${STYLE_ATTR}>`);
    /* Inside the head, so the iframe never paints a frame without it — that
       was the layout shift: the page width arrived after the first paint. */
    expect(html.indexOf(STYLE_ATTR)).toBeLessThan(html.indexOf('</head>'));
  });

  it('leaves the document itself untouched', () => {
    const html = withEditorStyles(DOC);

    expect(html.replace(/<style data-kepler-style>[\s\S]*?<\/style>/, '')).toBe(DOC);
  });

  it('still places the stylesheet when the template has no head', () => {
    const html = withEditorStyles('<html><body><p>Text</p></body></html>');

    expect(html).toContain(STYLE_ATTR);
    expect(html.indexOf(STYLE_ATTR)).toBeLessThan(html.indexOf('<body'));
  });

  it('places the sheet after the template’s own styles, so its rules win', () => {
    /* Both carry the same specificity, so only order decides. In front of the
       template's stylesheet, the editor's page width was overridden and the
       letter sat against the left edge instead of centred. */
    const doc = '<html><head><style>body{max-width:none}</style></head><body></body></html>';
    const html = withEditorStyles(doc);

    expect(html.indexOf(STYLE_ATTR)).toBeGreaterThan(html.indexOf('body{max-width:none}'));
  });

  it('marks the stylesheet so it is stripped again on save', () => {
    /* The round trip the editor actually makes: the sheet rides in with the
       source, and serializeLetter has to take it back out — otherwise every
       save would write the editor's own CSS into the user's document and grow
       it by a copy on each open. */
    const doc = new DOMParser().parseFromString(withEditorStyles(DOC), 'text/html');

    const saved = serializeLetter(doc);

    expect(saved).not.toContain(STYLE_ATTR);
    expect(saved).not.toContain('@media print');
    expect(saved).toContain('<title>Brief</title>');
    expect(saved).toContain('<p>Text</p>');
  });
});

describe('print rules', () => {
  it('takes the editor back off the page before it is printed', () => {
    /* ⌘P prints the live document, marks and pills included, unless the sheet
       says otherwise — the amber highlight and "Kepler erstellt Optionen…"
       would land on paper. */
    const sheet = withEditorStyles(DOC);
    const print = sheet.slice(sheet.indexOf('@media print'));

    expect(sheet).toContain('@media print');
    expect(print).toContain(TAG_ATTR);
    expect(print).toContain(MARK_ATTR);
    expect(print).toContain('display: none');
  });

  it('states them after the on-screen rules, so they win', () => {
    /* [attr='v'] and [attr] carry the same specificity, so only order decides.
       Stated first, the print block would be overridden by the very rules it
       exists to undo — the same trap the [TAG_ATTR='ready'] rules sit in. */
    const sheet = withEditorStyles(DOC);

    /* indexOf, not lastIndexOf: the first occurrence is the on-screen rule,
       the last one is inside the print block being checked. */
    expect(sheet.indexOf('@media print')).toBeGreaterThan(sheet.indexOf(`[${MARK_ATTR}='done']`));
  });
});

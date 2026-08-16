import { describe, expect, it } from 'vitest';
import { withEditorStyles } from '../letter-styles';
import { STYLE_ATTR } from '../mark';

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
    /* serializeLetter removes every [STYLE_ATTR] element, so a sheet carried in
       the source never reaches the file — same as one injected on load. */
    expect(withEditorStyles(DOC)).toContain(`<style ${STYLE_ATTR}>`);
  });
});

import { describe, expect, it } from 'vitest';
import { documentCaption, documentFormat } from '../document-caption';
import { DocFormat } from '../../../ui/icons';

describe('documentCaption', () => {
  const t = '2026-08-14T09:00:00.000Z';

  it('names the Fassung a generated document came from', () => {
    expect(documentCaption({ created_at: t, updated_at: t, template_label: 'Kurz' })).toBe(
      'erstellt am 14.08.2026 · Fassung Kurz',
    );
  });

  it('says nothing about a Fassung for hand-uploaded or older documents', () => {
    expect(documentCaption({ created_at: t, updated_at: t, template_label: null })).toBe(
      'erstellt am 14.08.2026',
    );
  });

  it('reads "aktualisiert" once the file was replaced', () => {
    expect(
      documentCaption({ created_at: t, updated_at: '2026-08-15T09:00:00.000Z', template_label: null }),
    ).toBe('aktualisiert am 15.08.2026');
  });
});

describe('documentFormat', () => {
  it('colours a generated document by its rendition: red with a PDF, orange for HTML alone', () => {
    expect(documentFormat({ file_path: 'documents/BEW-1/a.html', pdf_path: 'documents/BEW-1/a.pdf' })).toBe(
      DocFormat.PDF,
    );
    expect(documentFormat({ file_path: 'documents/BEW-1/a.html', pdf_path: null })).toBe(DocFormat.HTML);
  });

  it('reads an uploaded file by its extension, whatever the case', () => {
    expect(documentFormat({ file_path: 'documents/BEW-1/Zeugnis.PDF', pdf_path: null })).toBe(DocFormat.PDF);
    expect(documentFormat({ file_path: 'documents/BEW-1/CV.docx', pdf_path: null })).toBe(DocFormat.FILE);
    expect(documentFormat({ file_path: 'documents/BEW-1/scan.png', pdf_path: null })).toBe(DocFormat.FILE);
  });

  it('shows an empty slot for a row without any file', () => {
    expect(documentFormat({ file_path: null, pdf_path: null })).toBe(DocFormat.EMPTY);
  });
});

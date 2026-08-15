import { describe, expect, it } from 'vitest';
import { documentCaption } from '../document-caption';

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
